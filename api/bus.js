// api/bus.js

const STOPS = {
  'main-gate':   { ko: '경희대정문',           en: 'Main Gate',        dir: 'in',  id: '228000707' },
  'foreign':     { ko: '외국어대학',           en: 'Foreign Lang',     dir: 'in',  id: '228000701' },
  'lifesci':     { ko: '생명과학대',           en: 'Life Sciences',    dir: 'in',  id: '228000702' },
  'square':      { ko: '사색의광장',           en: 'Square of Thought',dir: 'out', id: '228000703' },
  'lifesci-ind': { ko: '생명과학대·산업대학', en: 'Life & Applied',   dir: 'out', id: '228000704' },
  'pe-foreign':  { ko: '경희대체육대학·외대', en: 'Physical Ed & For', dir: 'out', id: '228000708' }
};

const ROUTES = new Set(['M5107', '9', '5100', '1112', '7000', '1560']);
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

async function fetchStop(key) {
  const s = STOPS[key];
  const apiKey = process.env.BUS_API_KEY;
  const url = `${API_URL}?serviceKey=${apiKey}&stationId=${s.id}&format=json`;

  // 💡 [속도 개선 1] 타임아웃을 4000ms -> 1500ms로 단축 (지연 정류장 빠른 포기)
  const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
  if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
  
  const json = await res.json();
  let list = json?.response?.msgBody?.busArrivalList ?? [];
  if (!Array.isArray(list)) list = [list];

  const filteredList = isLateNightOffTime() 
    ? [] 
    : list.filter((b) => ROUTES.has(String(b.routeName)) && !isDepotReturnVehicle(b));

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

  const results = await Promise.allSettled(keys.map(fetchStop));

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

  res.status(200).json({ fetchedAt, stops });
}
