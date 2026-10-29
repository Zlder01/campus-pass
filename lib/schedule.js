// lib/schedule.js
// 나가는 방향 '경희대학교(정문 건너편)' 정류장 통과 기록을 모아 시간표를 학습한다.
//  - recordPasses : tracker 가 버스 통과를 감지할 때마다 호출 → Redis 에 날짜별로 저장 (최근 6주만 유지)
//  - buildLearned : 저장된 기록을 요일유형(평일/주말·공휴일)·노선별 평균 시간표로 집계
// 기본 시간표(사용자 제공값)는 public/js/schedule.js 에 있고, 두 값을 합치는 일은 브라우저에서 한다.

import { getJSON, setJSON, storeEnabled } from './store.js';

const KEY = 'cp:sched:v1';
const KEEP_DAYS = 42;      // 요일유형별 최근 N일만 보관
const MIN_PASSES_PER_DAY = 3; // 이 대수보다 적게 잡힌 날은 '관측이 불완전'하다고 보고 집계 제외

// 공휴일(대체공휴일 포함) — 매년 갱신 필요. 2027 은 고정 공휴일만 넣어 두었음.
const HOLIDAYS = new Set([
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-03-02',
  '2026-05-05', '2026-05-24', '2026-05-25', '2026-06-03', '2026-06-06',
  '2026-08-15', '2026-08-17', '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-03',
  '2026-10-05', '2026-10-09', '2026-12-25',
  '2027-01-01', '2027-03-01', '2027-05-05', '2027-06-06', '2027-08-15', '2027-10-03',
  '2027-10-09', '2027-12-25',
]);

const pad = (n) => String(n).padStart(2, '0');

// UTC 서버에서도 한국시간 기준으로 날짜·시각을 계산
export function kstParts(ms = Date.now()) {
  const d = new Date(ms + 9 * 3600 * 1000);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), dow: d.getUTCDay() };
}
export const dateStr = (p) => `${p.y}-${pad(p.mo)}-${pad(p.d)}`;

export function dayTypeOf(dateString, dow) {
  return dow === 0 || dow === 6 || HOLIDAYS.has(dateString) ? 'weekend' : 'weekday';
}

export function todayInfo(ms = Date.now()) {
  const p = kstParts(ms);
  const date = dateStr(p);
  return { date, dayType: dayTypeOf(date, p.dow), isHoliday: HOLIDAYS.has(date) };
}

// 새벽 0~3시 통과는 '전날 운행'으로 보고 분 단위를 1440 이상으로 저장
function toServiceDay(ms) {
  let p = kstParts(ms);
  let minutes = p.h * 60 + p.mi;
  if (p.h < 4) {
    p = kstParts(ms - 24 * 3600 * 1000);
    minutes += 1440;
  }
  const date = dateStr(p);
  return { date, minutes, dayType: dayTypeOf(date, p.dow) };
}

// passes: [{ route:'5100', at: epochMs }]
export async function recordPasses(passes) {
  if (!storeEnabled || !passes?.length) return 0;
  const data = (await getJSON(KEY)) || { routes: {} };
  let added = 0;
  for (const { route, at } of passes) {
    const { date, minutes, dayType } = toServiceDay(at);
    const bucket = ((data.routes[route] ||= {})[dayType] ||= {});
    const list = (bucket[date] ||= []);
    // 같은 버스를 두 번 센 경우 방지 (2분 이내 중복 제외)
    if (list.some((m) => Math.abs(m - minutes) < 2)) continue;
    list.push(minutes);
    list.sort((a, b) => a - b);
    added++;
  }
  // 오래된 날짜 정리
  for (const types of Object.values(data.routes)) {
    for (const [type, bucket] of Object.entries(types)) {
      const dates = Object.keys(bucket).sort();
      for (const old of dates.slice(0, Math.max(0, dates.length - KEEP_DAYS))) delete bucket[old];
    }
  }
  data.updatedAt = Date.now();
  await setJSON(KEY, data); // TTL 없음: 학습 기록은 영구 보관
  return added;
}

const median = (arr) => {
  const a = [...arr].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

// 며칠에 걸쳐 같은 시각(±4분)에 반복해서 나온 통과 시각을 '정시 운행 시각'으로 묶는다
function clusterTimes(days) {
  const pts = [];
  days.forEach((list, di) => list.forEach((m) => pts.push({ m, di })));
  pts.sort((a, b) => a.m - b.m);
  const need = Math.max(2, Math.ceil(days.length * 0.5));
  const out = [];
  let cur = [];
  const flush = () => {
    if (cur.length && new Set(cur.map((p) => p.di)).size >= need) out.push(Math.round(median(cur.map((p) => p.m))));
    cur = [];
  };
  for (const p of pts) {
    if (cur.length && p.m - cur[0].m > 4) flush();
    cur.push(p);
  }
  flush();
  return out;
}

export function buildLearned(data) {
  const learned = {};
  for (const [route, types] of Object.entries(data?.routes || {})) {
    for (const [type, bucket] of Object.entries(types)) {
      const days = Object.values(bucket).filter((l) => l.length >= MIN_PASSES_PER_DAY);
      if (!days.length) continue;
      const hourly = {};
      for (let h = 0; h < 28; h++) {
        const total = days.reduce((s, l) => s + l.filter((m) => Math.floor(m / 60) === h).length, 0);
        if (total) hourly[h] = Math.round((total / days.length) * 10) / 10;
      }
      (learned[route] ||= {})[type] = {
        days: days.length,
        first: Math.round(median(days.map((l) => l[0]))),
        last: Math.round(median(days.map((l) => l[l.length - 1]))),
        perDay: Math.round(days.reduce((s, l) => s + l.length, 0) / days.length),
        hourly,
        times: clusterTimes(days),
      };
    }
  }
  return learned;
}

export async function readLearned() {
  if (!storeEnabled) return {};
  const data = await getJSON(KEY);
  return data ? buildLearned(data) : {};
}
