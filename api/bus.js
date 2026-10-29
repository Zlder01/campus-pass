// api/bus.js

import { readEstimates } from '../lib/tracker.js';

const STOPS = {
  // 정문은 노선마다 쓰는 정류장 ID가 다름 (M5107 등 정문이 종점인 노선은 228000723) → 둘 다 조회해서 합침
  'main-gate':   { ko: '경희대정문',           en: 'Main Gate',        dir: 'in',  id: '228000707', extraIds: ['228000723'] },
  'foreign':     { ko: '외국어대학',           en: 'Foreign Lang',     dir: 'in',  id: '228000701' },
  'lifesci':     { ko: '생명과학대',           en: 'Life Sciences',    dir: 'in',  id: '228000702' },
  'square':      { ko: '사색의광장',           en: 'Square of Thought',dir: 'out', id: '228000703' },
  'lifesci-ind': { ko: '생명과학대·산업대학', en: 'Life & Applied',   dir: 'out', id: '228000704' },
  'pe-foreign':  { ko: '경희대체육대학·외대', en: 'Physical Ed & For', dir: 'out', id: '228000708' }
};

const ROUTES = new Set(['M5107', '9', '5100', '1112', '7000', '1560']);
// 1560A·1560B처럼 알파벳이 붙은 노선은 같은 번호로 취급
const displayRoute = (name) => {
  const n = String(name);
  if (ROUTES.has(n)) return n;
  const base = n.replace(/[A-Z]$/, '');
  return base !== n && ROUTES.has(base) ? base : null;
};

const API_URL = 'https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalListv2';

const num = (v) => (v === '' || v == null ? null : Number(v));

// Vercel 서버는 UTC 기준이라 getHours()를 그대로 쓰면 한국시간 10~14시가 '심야'로 잡힘 → KST로 변환
function kstHour() {
  return (new Date().getUTCHours() + 9) % 24;
}

function isLateNightOffTime() {
  const h = kstHour();
  return h >= 1 && h < 5;
}

function isDepotReturnVehicle(b) {
  if (!b) return true;
  // 경기 GBIS flag: RUN·PASS = 운행중, STOP = 운행종료, WAIT = 회차지대기
  // (예전 코드는 PASS까지 걸러서 실제 운행 중인 버스가 거의 다 빠졌음)
  if (b.flag === 'STOP') return true;
  if (b.plateNo1 === null || b.plateNo1 === '' || b.plateNo1 === undefined) return true;
  const loc = num(b.locationNo1);
  if (loc !== null && (loc <= 0 || loc > 90)) return true;
  return false;
}

async function fetchStationList(stationId) {
  const apiKey = process.env.BUS_API_KEY;
  const url = `${API_URL}?serviceKey=${apiKey}&stationId=${stationId}&format=json`;

  // 💡 [속도 개선 1] 타임아웃을 4000ms -> 1500ms로 단축 (지연 정류장 빠른 포기)
  const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
  if (!res.ok) throw new Error(`HTTP Error ${res.status}`);

  const json = await res.json();
  let list = json?.response?.msgBody?.busArrivalList ?? [];
  if (!Array.isArray(list)) list = [list];
  return list;
}

// 같은 번호(1560A·1560B, 정문 두 정류장 등)로 여러 건이 오면 가까운 순으로 2대만 남김
function mergeByRoute(list) {
  const groups = new Map();
  for (const b of list) {
    const route = displayRoute(b.routeName);
    if (!route) continue;
    const g = groups.get(route) || { b, times: [] };
    if (num(b.predictTime1) != null && (num(g.b.predictTime1) == null || num(b.predictTime1) < num(g.b.predictTime1))) g.b = b;
    for (const t of [num(b.predictTime1), num(b.predictTime2)]) if (t != null) g.times.push(t);
    groups.set(route, g);
  }
  return [...groups.entries()].map(([route, { b, times }]) => {
    times.sort((x, y) => x - y);
    return { ...b, routeName: route, predictTime1: times[0] ?? null, predictTime2: times[1] ?? null };
  });
}

async function fetchStop(key) {
  const s = STOPS[key];
  const ids = [s.id, ...(s.extraIds || [])];
  const lists = await Promise.allSettled(ids.map(fetchStationList));
  if (lists.every((r) => r.status === 'rejected')) throw lists[0].reason;
  const list = lists.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

  const filteredList = isLateNightOffTime()
    ? []
    : mergeByRoute(list.filter((b) => displayRoute(b.routeName) && !isDepotReturnVehicle(b)));

  return {
    id: key,
    stationId: s.id,
    dir: s.dir,
    name: { ko: s.ko, en: s.en },
    arrivals: filteredList.map((b) => ({
      route: String(b.routeName),
      dest: {
        ko: s.dir === 'in' ? '사색의 광장 방면' : '정문/차고지 방면',
        en: s.dir === 'in' ? 'Inbound' : 'Outbound'
      },
      t1: num(b.predictTime1),
      t2: num(b.predictTime2),
      flag: b.flag ?? null,
      plateNo1: b.plateNo1 ?? null,
      locationNo1: num(b.locationNo1)
    }))
  };
}

export default async function handler(req, res) {
  const origin = process.env.ALLOW_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  // 💡 [속도 개선 2] Vercel/서버 CDN 엣지 캐싱 적용 (10초간 즉시 응답 + 백그라운드 갱신)
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const fetchedAt = Date.now();
  const keys = Object.keys(STOPS);

  // 위치 추적 기반 추정치는 Redis에서 읽기만 함 (GBIS 호출 없음). 실패해도 기존 응답은 그대로.
  const [results, estimates] = await Promise.all([
    Promise.allSettled(keys.map(fetchStop)),
    readEstimates().catch((err) => { console.warn('추정치 읽기 실패:', err.message); return null; }),
  ]);

  const stops = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    const s = STOPS[keys[i]];
    return {
      id: keys[i],
      stationId: s.id,
      dir: s.dir,
      name: { ko: s.ko, en: s.en },
      arrivals: []
    };
  });

  res.status(200).json({ fetchedAt, stops, estimates: estimates || {} });
}
