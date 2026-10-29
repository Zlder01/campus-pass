// lib/tracker.js
// 광역버스 위치 추적 → 캠퍼스 정류장(들어오는 방향) 도착 시간 추정
//
// 흐름
//  1) 노선마다 노선 ID와 경유 정류장 순서를 하루 1번 조회해 저장 (노선 조회 API)
//  2) 1~2분마다 /api/track 이 호출되면 노선별 버스 위치를 조회 (위치정보 API, 노선당 1번)
//  3) 버스가 새 정류장에 들어선 시각을 기록 → 고속도로처럼 정류장 사이가 긴 구간은
//     "직전 정류장을 떠난 지 몇 분 지났는지"로 남은 시간을 계산
//  4) 버스가 실제로 정류장 사이를 이동한 시간으로 구간 소요시간을 계속 보정(학습)

import { gbis, num, isLateNight } from './gbis.js';
import { getJSON, setJSON, storeEnabled } from './store.js';
import { recordPasses } from './schedule.js';

// 10분 주기 기준 하루 약 840건 (노선 7개: 1560A·B 포함) → 개발계정 1,000건 안
export const TRACKED_ROUTES = ['M5107', '5100', '1112', '7000', '1560', '9'];

// api/bus.js 의 STOPS 키와 같은 이름 (들어오는 방향 정류장)
export const INBOUND_TARGETS = {
  'main-gate': '228000723',
  foreign: '228000710',
  lifesci: '228000709',
  square: '228000708',
};

// 사색의 광장에서 쉬지 않고 바로 회차하는 노선 → 들어온 버스를 나가는 방향 정류장까지 계속 추적
// (5100·1112·7000 등은 광장에서 대기 후 출발할 수 있어서 제외)
export const THROUGH_ROUTES = ['9'];

// 나가는 방향 정류장 (api/bus.js STOPS 키와 별개로 추정치 전용 키)
const OUTBOUND_TARGETS = {
  'lifesci-ind': { id: '228000704', name: (n) => /생명과학대/.test(n) && /산업대/.test(n) },
  'pe-foreign': { id: '228000703', name: (n) => /체육대학/.test(n) },
  // 나가는 방향 정문은 '경희대학교'(203000125)로 등록돼 있음
  'main-gate-out': { id: '203000125', name: (n) => (/경희대/.test(n) && /정문/.test(n)) || n.trim() === '경희대학교' },
};

// 정류장 ID가 노선마다 다를 수 있어서 이름으로도 판별
const TARGET_NAME = {
  'main-gate': (n) => /경희대/.test(n) && /정문/.test(n),
  foreign: (n) => /외국어대/.test(n) && !/체육/.test(n),
  lifesci: (n) => /생명과학대/.test(n),
  square: (n) => /사색의\s*광장/.test(n),
};
const isTarget = (key, st) => st.id === INBOUND_TARGETS[key] || TARGET_NAME[key](st.name || '');
const isCampus = (st) => Object.keys(INBOUND_TARGETS).some((k) => isTarget(k, st)) || /경희대/.test(st.name || '');

const STATE_KEY = 'cp:tracker:v5'; // 9번 나가는 정문(경희대학교)·광장 출발 정류장 반영
const STATE_TTL_SEC = 6 * 3600;          // 6시간 갱신 없으면 자동 삭제
const META_MAX_AGE_MS = 24 * 3600 * 1000; // 노선 정보는 하루 1번 갱신
const STALE_SEEN_MS = 10 * 60 * 1000;     // 10분 넘게 위치 갱신이 없으면 표시 안 함
const LEARN_RATE = 0.25;
const MAX_ROUTE_CANDIDATES = 10;

// ───────────────────────── 기본 구간 소요시간 (학습 전 초기값) ─────────────────────────

function distanceKm(a, b) {
  if (a.x == null || a.y == null || b.x == null || b.y == null) return null;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.y - a.y);
  const dLon = toRad(b.x - a.x);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.y)) * Math.cos(toRad(b.y)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 정류장 사이가 2km 넘으면 고속도로/간선로로 보고 빠른 속도 적용
function defaultSegmentSec(a, b) {
  const km = distanceKm(a, b);
  if (km == null) return 90;
  const kmh = km > 2 ? 55 : 18;
  return clamp(Math.round((km / kmh) * 3600 + 20), 30, 2400);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ───────────────────────── 노선 정보 조회 ─────────────────────────

// 1560처럼 1560A·1560B 두 노선으로 등록된 경우도 같은 번호로 묶는다 ('(예약)' 같은 별도 노선은 제외)
export const matchesRoute = (base, routeName) => {
  const n = String(routeName);
  return n === base || new RegExp(`^${base}[A-Z]$`).test(n);
};

// ROUTE_IDS={"1560":["234000884","228000433"],"M5107":"234001243"} 형태로 직접 지정 가능
function routeIdOverride(base) {
  try {
    const v = JSON.parse(process.env.ROUTE_IDS || '{}')[base];
    return v == null ? null : (Array.isArray(v) ? v : [v]).map(String);
  } catch {
    return null;
  }
}

async function fetchStations(routeId) {
  const list = await gbis('busrouteservice/v2/getBusRouteStationListv2', { routeId }, 'busRouteStationList');
  return list
    .map((s) => ({
      seq: num(s.stationSeq),
      id: String(s.stationId),
      name: s.stationName,
      x: num(s.x),
      y: num(s.y),
      turnYn: s.turnYn,
      turnSeq: num(s.turnSeq),
    }))
    .filter((s) => s.seq != null)
    .sort((a, b) => a.seq - b.seq);
}

// 같은 정류장 ID가 노선에 두 번 나올 수 있어서(기점·종점이 둘 다 학교인 경우 등),
// "정문 → 외국어대학 → 생명과학대 → 사색의 광장" 순서가 맞는 순번을 찾는다
function resolveTargets(stations) {
  const seqsOf = (key) => stations.filter((s) => isTarget(key, s)).map((s) => s.seq);
  const turnSeq = stations.find((s) => s.turnSeq != null)?.turnSeq
    ?? stations.find((s) => s.turnYn === 'Y')?.seq
    ?? null;
  const nextAfter = (key, from, within = 6) =>
    seqsOf(key).filter((s) => s > from && s - from <= within).sort((a, b) => a - b)[0] ?? null;

  const gateSeqs = seqsOf('main-gate');
  // 1순위: 정문 바로 뒤에 외국어대학(들어오는 방향 정류장)이 이어지는 정문
  let gate = gateSeqs
    .map((g) => ({ g, f: nextAfter('foreign', g) ?? nextAfter('lifesci', g) }))
    .filter((c) => c.f != null)
    .sort((a, b) => (a.f - a.g) - (b.f - b.g))[0]?.g ?? null;
  // 2순위: 회차 지점 이후의 정문, 3순위: 마지막으로 나오는 정문
  if (gate == null) {
    const afterTurn = turnSeq != null ? gateSeqs.filter((s) => s > turnSeq) : [];
    gate = afterTurn.length ? Math.min(...afterTurn) : gateSeqs.length ? Math.max(...gateSeqs) : null;
  }

  const targets = {};
  if (gate == null) return { targets, turnSeq };
  targets['main-gate'] = gate;
  // 중간 정류장 하나가 없어도(정차 안 하는 노선) 그다음 정류장은 계속 찾음
  let prev = gate;
  for (const key of ['foreign', 'lifesci', 'square']) {
    const seq = nextAfter(key, prev);
    if (seq == null) continue;
    targets[key] = seq;
    prev = seq;
  }
  return { targets, turnSeq };
}

// 광장(회차) 뒤로 이어지는 나가는 방향 정류장 순번 찾기
function resolveOutbound(stations, squareSeq) {
  // 광장은 도착·출발 정류장이 따로 있는 경우가 있음 (9번: 46 도착, 47 출발) → 바로 뒤 광장을 출발점으로
  const departSeq = stations
    .filter((s) => s.seq > squareSeq && s.seq - squareSeq <= 2 && isTarget('square', s))
    .map((s) => s.seq)[0] ?? squareSeq;
  const out = { 'square-out': departSeq };
  let prev = departSeq;
  for (const [key, t] of Object.entries(OUTBOUND_TARGETS)) {
    const seq = stations
      .filter((s) => s.seq > prev && s.seq - prev <= 6 && (s.id === t.id || t.name(s.name || '')))
      .map((s) => s.seq)
      .sort((a, b) => a - b)[0];
    if (seq == null) continue;
    out[key] = seq;
    prev = seq;
  }
  return out;
}

function buildMeta(routeId, routeName, stations, through = false) {
  const { targets, turnSeq } = resolveTargets(stations);
  if (through && targets.square != null) Object.assign(targets, resolveOutbound(stations, targets.square));
  const targetSeqs = Object.values(targets);
  if (!targetSeqs.length) return null;

  const firstTarget = Math.min(...targetSeqs);
  const lastTarget = Math.max(...targetSeqs);
  // 회차 지점 이후부터 추적 (서울 쪽에서 돌아 나온 버스만 '들어오는 버스')
  const lowerSeq = turnSeq != null && turnSeq < firstTarget ? turnSeq : stations[0].seq;
  const kept = stations
    .filter((s) => s.seq >= lowerSeq && s.seq <= lastTarget)
    .map(({ seq, id, name: n, x, y }) => ({ seq, id, name: n, x, y }));

  // 나가는 방향 '경희대학교(정문 건너편)' 정류장 순번 — 시간표 학습용 통과 감지 기준
  // 9번처럼 광장 뒤로 이어지는 노선은 targets 에 있고, 5100·7000 같은 노선은 노선 맨 앞(광장 출발 직후)에 있음
  const outId = OUTBOUND_TARGETS['main-gate-out'].id;
  const outMatches = stations.filter((st) => (st.id === outId || OUTBOUND_TARGETS['main-gate-out'].name(st.name || '')) && !(isTarget('main-gate', st) && st.id !== outId));
  const outGate = targets['main-gate-out'] != null
    ? targets['main-gate-out']
    : (outMatches.find((st) => turnSeq == null || st.seq < turnSeq) ?? outMatches[0])?.seq ?? null;

  const seg = {};
  for (let i = 0; i < kept.length - 1; i++) seg[kept[i].seq] = defaultSegmentSec(kept[i], kept[i + 1]);

  return {
    routeId, routeName,
    signature: kept.map((s) => s.id).join(','),
    stations: kept, lowerSeq, targets, seg, outGateSeq: outGate, outGateVer: 2, outSeen: {},
    buses: {}, lastPollAt: null,
  };
}

// 번호 하나에 해당하는 실제 노선들(1560 → 1560A, 1560B)을 찾아 각각 메타 생성
async function discoverGroup(base) {
  let candidates;
  const override = routeIdOverride(base);
  if (override) {
    candidates = override.map((routeId) => ({ routeId, routeName: base }));
  } else {
    const list = await gbis('busrouteservice/v2/getBusRouteListv2', { keyword: base }, 'busRouteList');
    const named = list.filter((r) => matchesRoute(base, r.routeName));
    // '9'처럼 여러 도시에 같은 번호가 있으면 수원·용인 노선을 먼저 확인
    const local = named.filter((r) => /수원|용인/.test(r.regionName || ''));
    candidates = (local.length ? local : named)
      .map((r) => ({ routeId: String(r.routeId), routeName: String(r.routeName) }))
      .slice(0, MAX_ROUTE_CANDIDATES);
  }

  // 같은 이름의 다른 지역 노선이 섞여 나오므로, 이름별로 경희대 정류장이 가장 많은 노선 하나씩
  const best = {};
  for (const c of candidates) {
    const stations = await fetchStations(c.routeId);
    const score = stations.filter(isCampus).length;
    if (!score) continue;
    const meta = buildMeta(c.routeId, c.routeName, stations, THROUGH_ROUTES.includes(base));
    if (!meta) continue;
    const key = override ? `${base}#${c.routeId}` : c.routeName;
    if (!best[key] || score > best[key].score) best[key] = { score, meta };
  }

  const variants = Object.fromEntries(Object.entries(best).map(([n, v]) => [n, v.meta]));
  if (!Object.keys(variants).length) {
    throw new Error(`${base}: 경희대 정문을 지나는 노선을 찾지 못했습니다 (후보 ${candidates.length}개) — &discover=${base} 로 확인`);
  }
  return { fetchedAt: Date.now(), variants };
}

async function ensureGroup(base, current) {
  const hasOutGate = Object.values(current?.variants || {}).every((v) => v.outGateVer === 2);
  if (current?.variants && hasOutGate && Date.now() - current.fetchedAt < META_MAX_AGE_MS) return current;
  const fresh = await discoverGroup(base);
  // 노선이 그대로면 그동안 학습한 구간 시간과 버스 기록은 유지
  for (const [n, meta] of Object.entries(fresh.variants)) {
    const old = current?.variants?.[n];
    if (old && old.routeId === meta.routeId && old.signature === meta.signature) {
      meta.seg = { ...meta.seg, ...old.seg };
      meta.buses = old.buses;
      meta.lastPollAt = old.lastPollAt;
      meta.outSeen = old.outSeen || {};
    }
  }
  return fresh;
}

// ───────────────────────── 위치 폴링 & 학습 ─────────────────────────

const segAt = (route, seq) => route.seg[seq] ?? 90;

function sumSeg(route, fromSeq, toSeq) {
  let total = 0;
  for (let s = fromSeq; s < toSeq; s++) total += segAt(route, s);
  return total;
}

// 버스가 a번 정류장(tA에 진입) → b번 정류장(tB에 진입)으로 움직였을 때 구간 시간 보정
function learn(route, a, tA, b, tB) {
  if (b <= a || b - a > 6) return;
  const expected = sumSeg(route, a, b);
  const elapsed = (tB - tA) / 1000;
  if (elapsed < expected * 0.3 || elapsed > expected * 3 + 600) return; // 이상치 무시
  const ratio = elapsed / expected;
  for (let s = a; s < b; s++) {
    if (route.seg[s] == null) continue;
    const next = route.seg[s] * (1 - LEARN_RATE) + route.seg[s] * ratio * LEARN_RATE;
    route.seg[s] = clamp(Math.round(next), 20, 2400);
  }
}


// 나가는 방향 정문(건너편) 정류장을 버스가 지나간 시각을 감지 → 시간표 학습 기록용
// (추적 구간 밖이라 pollRoute 와 별도로 전체 위치 목록에서 본다. 실패해도 기존 동작에는 영향 없음)
function observeOutGate(route, list, now) {
  const g = route.outGateSeq;
  if (g == null) return [];
  const prevMap = route.outSeen || {};
  const nextMap = {};
  const passes = [];
  for (const loc of list) {
    const seq = num(loc.stationSeq);
    const plate = loc.plateNo;
    if (seq == null || !plate || seq < g - 12 || seq > g + 1) continue;
    const id = String(loc.vehId ?? plate);
    const prev = prevMap[id];
    let done = Boolean(prev?.done);
    if (!done && seq >= g) {
      if (prev && prev.seq < g) { passes.push(Math.round((prev.seenAt + now) / 2)); done = true; }
      else if (!prev && seq === g) { passes.push(now); done = true; }
    }
    nextMap[id] = { seq, seenAt: now, done };
  }
  route.outSeen = nextMap;
  return passes;
}

async function pollRoute(route, passesOut) {
  const list = await gbis('buslocationservice/v2/getBusLocationListv2', { routeId: route.routeId }, 'busLocationList');
  const now = Date.now();
  const minSeq = route.stations[0]?.seq ?? 0;
  const maxSeq = route.stations[route.stations.length - 1]?.seq ?? 0;
  const next = {};

  for (const loc of list) {
    const seq = num(loc.stationSeq);
    const plate = loc.plateNo;
    if (seq == null || !plate) continue;           // 차량번호 없는 유령 데이터 제외
    if (seq < minSeq || seq >= maxSeq) continue;    // 추적 구간 밖 (아직 서울 쪽 / 이미 지나감)

    const vehId = String(loc.vehId ?? plate);
    const prev = route.buses[vehId];
    let enteredAt;
    let approx = false;

    if (prev && prev.seq === seq) {
      enteredAt = prev.enteredAt;
      approx = prev.approx;
    } else if (prev && seq > prev.seq) {
      // 직전 폴링과 이번 폴링 사이 어딘가에서 진입 → 중간값 사용
      enteredAt = route.lastPollAt ? Math.round((route.lastPollAt + now) / 2) : now;
      if (!prev.approx) learn(route, prev.seq, prev.enteredAt, seq, enteredAt);
    } else {
      // 처음 보는 버스: 언제 진입했는지 모르므로 구간의 절반쯤 왔다고 가정
      enteredAt = now - Math.round(segAt(route, seq) * 500);
      approx = true;
    }

    next[vehId] = { seq, enteredAt, approx, seenAt: now, st: num(loc.stateCd) };
  }

  try { passesOut?.push(...observeOutGate(route, list, now)); } catch (err) { console.warn('통과 감지 실패:', err.message); }

  route.buses = next;
  route.lastPollAt = now;
  return list.length;
}

// ───────────────────────── 도착 시간 계산 ─────────────────────────

function etaMinutes(route, targetSeq, now) {
  const out = [];
  for (const bus of Object.values(route.buses)) {
    if (bus.seq >= targetSeq) continue;
    if (now - bus.seenAt > STALE_SEEN_MS) continue;
    // 회차 지점에 서 있는 버스는 출발 시각을 알 수 없어서 제외 (정류소 출발 상태일 때만 포함)
    if (bus.seq === route.lowerSeq && bus.st !== 2) continue;

    const here = segAt(route, bus.seq);
    const elapsed = (now - bus.enteredAt) / 1000;
    if (elapsed > here * 3 + 900) continue; // 한 정류장에 너무 오래 머문 차 = 회차 대기/차고지/고장 등

    const total = sumSeg(route, bus.seq, targetSeq);
    // 아직 다음 정류장에 도착 안 했으므로 '다음 정류장부터 남은 시간'보다 짧아질 수는 없음
    const remaining = Math.max(total - elapsed, total - here, 60);
    out.push(Math.max(1, Math.round(remaining / 60)));
  }
  return out.sort((a, b) => a - b).slice(0, 2);
}

// { 'main-gate': { M5107: [6, 21] }, ... } — 1560A·1560B는 '1560'으로 합쳐서 가까운 순 2대
export function computeEstimates(state, now = Date.now()) {
  const result = {};
  for (const [base, group] of Object.entries(state?.routes || {})) {
    for (const route of Object.values(group?.variants || {})) {
      if (!route?.stations?.length) continue;
      for (const [stopKey, targetSeq] of Object.entries(route.targets || {})) {
        const mins = etaMinutes(route, targetSeq, now);
        if (!mins.length) continue;
        ((result[stopKey] ||= {})[base] ||= []).push(...mins);
      }
    }
  }
  for (const stop of Object.values(result)) {
    for (const base of Object.keys(stop)) stop[base] = stop[base].sort((a, b) => a - b).slice(0, 2);
  }
  return result;
}

export async function readEstimates() {
  if (!storeEnabled) return null;
  const state = await getJSON(STATE_KEY);
  return state ? computeEstimates(state) : null;
}

// ───────────────────────── 폴링 1회 실행 (/api/track) ─────────────────────────

export async function runTracker() {
  if (!storeEnabled) throw new Error('Upstash Redis 환경변수가 설정되지 않았습니다');
  if (isLateNight()) return { skipped: 'late-night' };

  const state = (await getJSON(STATE_KEY)) || { routes: {} };
  const summary = {};
  const passes = [];

  await Promise.all(TRACKED_ROUTES.map(async (base) => {
    try {
      const group = await ensureGroup(base, state.routes[base]);
      state.routes[base] = group;
      for (const [n, route] of Object.entries(group.variants)) {
        try {
          const found = [];
          const seen = await pollRoute(route, found);
          found.forEach((at) => passes.push({ route: base, at }));
          summary[n] = { routeId: route.routeId, busesOnRoute: seen, tracked: Object.keys(route.buses).length };
        } catch (err) {
          summary[n] = { routeId: route.routeId, error: String(err.message || err) };
        }
      }
    } catch (err) {
      summary[base] = { error: String(err.message || err) };
    }
  }));

  state.lastRunAt = Date.now();
  await setJSON(STATE_KEY, state, STATE_TTL_SEC);
  let recorded = 0;
  try { recorded = await recordPasses(passes); } catch (err) { console.warn('시간표 기록 실패:', err.message); }
  return { recorded, summary, estimates: computeEstimates(state) };
}

// 디버그용: 노선별로 어떤 정류장을 기준으로 잡았는지 확인
export async function describeTracker() {
  const state = await getJSON(STATE_KEY);
  if (!state) return null;
  const out = {};
  for (const group of Object.values(state.routes || {})) {
    for (const [n, r] of Object.entries(group.variants || {})) {
      out[n] = {
        routeId: r.routeId,
        trackedFrom: r.stations?.[0]?.name,
        outGateSeq: r.outGateSeq ?? null,
        outSeen: r.outSeen,
        targets: Object.fromEntries(Object.entries(r.targets || {}).map(([k, seq]) =>
          [k, (() => { const st = r.stations.find((s) => s.seq === seq); return `${seq}번째 · ${st?.name ?? '?'} (${st?.id ?? '?'})`; })()])),
        stations: r.stations?.map((s) => `${s.seq} ${s.name} (${Math.round(segAt(r, s.seq) / 6) / 10}분)`),
        buses: r.buses,
      };
    }
  }
  return { lastRunAt: state.lastRunAt, routes: out };
}

// 진단용: 노선 번호로 검색되는 후보와, 각 후보의 경희대 근처 정류장 목록
export async function discoverDebug(name) {
  const list = await gbis('busrouteservice/v2/getBusRouteListv2', { keyword: name }, 'busRouteList');
  const rank = (r) => (matchesRoute(name, r.routeName) ? 0 : 2) + (/수원|용인/.test(r.regionName || '') ? 0 : 1);
  const out = [];
  for (const r of [...list].sort((a, b) => rank(a) - rank(b)).slice(0, 10)) {
    const entry = {
      routeId: r.routeId, routeName: r.routeName, region: r.regionName,
      from: r.startStationName, to: r.endStationName, match: matchesRoute(name, r.routeName),
    };
    if (entry.match) {
      try {
        const stations = await fetchStations(String(r.routeId));
        entry.stationCount = stations.length;
        entry.turnSeq = stations.find((s) => s.turnSeq != null)?.turnSeq ?? null;
        entry.campusStations = stations.filter(isCampus).map((s) => `${s.seq} ${s.name} (${s.id})`);
        const resolved = resolveTargets(stations).targets;
        if (THROUGH_ROUTES.includes(name) && resolved.square != null) Object.assign(resolved, resolveOutbound(stations, resolved.square));
        entry.resolved = resolved;
      } catch (err) {
        entry.error = String(err.message || err);
      }
    }
    out.push(entry);
  }
  return { keyword: name, candidates: out };
}
