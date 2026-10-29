// public/js/schedule.js
// 나가는 방향 시간표 (기준: '경희대학교' 정류장, 정문 건너편 출교)
//   1) BASE : 직접 정리한 3주치 운행 기록 + (자료가 모자란 부분은 온라인·비율 추정)
//   2) /api/schedule 의 학습 결과(실제 통과 기록의 평균)가 쌓이면 BASE 를 점점 대체
//   3) Schedule.nextAt() 이 현재 시각 기준 다음 2대를 계산 (학교 안 정류장은 delta 분만큼 앞당김)
// 시각은 'HH:MM' 문자열, 배차는 분. h:null 은 운행 공백.

(function () {
  const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const fmt = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min) % 60).padStart(2, '0')}`;

  // source: 'observed' = 사용자가 정리한 실제 기록 / 'estimate' = 추정
  const BASE = {
    M5107: {
      weekday: { source: 'observed', first: '05:18', last: '22:53', bands: [
        { from: '05:18', to: '06:00', h: 20 }, { from: '06:00', to: '08:00', h: 7 },
        { from: '08:00', to: '10:35', h: null },            // 운행 공백
        { from: '10:35', to: '11:00', h: 15 }, { from: '11:00', to: '14:00', h: 13 },
        { from: '14:00', to: '17:00', h: 10 }, { from: '17:00', to: '19:00', h: 11 },
        { from: '19:00', to: '20:00', h: 20 }, { from: '20:00', to: '21:00', h: 60 },
        { from: '21:00', to: '22:00', h: 8 }, { from: '22:00', to: '23:00', h: 7 } ] },
      weekend: { source: 'observed', first: '05:05', last: '23:01', bands: [
        { from: '05:05', to: '06:00', h: 11 }, { from: '06:00', to: '08:00', h: 10 },
        { from: '08:00', to: '09:00', h: 20 }, { from: '09:00', to: '11:00', h: 11 },
        { from: '11:00', to: '17:00', h: 15 }, { from: '17:00', to: '21:00', h: 25 },
        { from: '21:00', to: '23:01', h: 16 } ] },
    },
    '1112': {
      weekday: { source: 'observed', first: '04:44', last: '22:35', bands: [
        { from: '04:44', to: '05:00', h: 10 }, { from: '05:00', to: '08:00', h: 11 },
        { from: '08:00', to: '10:00', h: 18 }, { from: '10:00', to: '18:00', h: 13 },
        { from: '18:00', to: '19:00', h: 11 }, { from: '19:00', to: '22:36', h: 14 } ] },
      weekend: { source: 'observed', first: '04:44', last: '22:35', bands: [
        { from: '04:44', to: '08:00', h: 20 }, { from: '08:00', to: '22:36', h: 22 } ] },
    },
    '5100': {
      weekday: { source: 'observed', first: '05:34', last: '23:59', bands: [
        { from: '05:34', to: '06:00', h: 9 }, { from: '06:00', to: '09:00', h: 8 },
        { from: '09:00', to: '11:00', h: 10 }, { from: '11:00', to: '14:00', h: 12 },
        { from: '14:00', to: '17:00', h: 10 }, { from: '17:00', to: '18:00', h: 9 },
        { from: '18:00', to: '23:00', h: 10 }, { from: '23:00', to: '24:00', h: 13 } ] },
      // 주말 자료 없음 → 평일 배차 × 1.45 (과거 자료상 토요일 115회 / 평일 147회 비율 참고). 학습으로 대체됨.
      weekend: { source: 'estimate', first: '05:40', last: '23:40', bands: [
        { from: '05:40', to: '06:00', h: 13 }, { from: '06:00', to: '09:00', h: 12 },
        { from: '09:00', to: '11:00', h: 14 }, { from: '11:00', to: '14:00', h: 17 },
        { from: '14:00', to: '17:00', h: 14 }, { from: '17:00', to: '18:00', h: 13 },
        { from: '18:00', to: '23:00', h: 14 }, { from: '23:00', to: '23:40', h: 19 } ] },
    },
    '7000': {
      weekday: { source: 'observed', first: '05:33', last: '23:44', bands: [
        { list: ['05:33', '05:49', '06:01', '06:13', '06:22', '06:34', '06:43', '06:52'] },
        { from: '07:00', to: '19:00', at: [4, 19, 34, 49] },
        { from: '19:00', to: '24:00', at: [4, 25, 44] } ] },
      // 주말 자료 없음 → 평일 배차 × 1.5 추정
      weekend: { source: 'estimate', first: '05:40', last: '23:30', bands: [
        { from: '05:40', to: '09:00', h: 17 }, { from: '09:00', to: '19:00', h: 22 },
        { from: '19:00', to: '23:30', h: 30 } ] },
    },
    '9': {
      weekday: { source: 'observed', first: '05:57', last: '23:05', bands: [
        { from: '05:57', to: '09:00', h: 32 }, { from: '09:00', to: '17:00', h: 28 },
        { from: '17:00', to: '20:00', h: 33 }, { from: '20:00', to: '23:06', h: 31 } ] },
      weekend: { source: 'observed', first: '05:55', last: '23:03', bands: [
        { from: '05:55', to: '09:00', h: 42 }, { from: '09:00', to: '17:00', h: 43 },
        { from: '17:00', to: '20:00', h: 44 }, { from: '20:00', to: '23:04', h: 42 } ] },
    },
    // 1560A·B: 기록이 날마다 들쭉날쭉해서 온라인 안내(평일 15~30분, 주말 25~40분, 경희대 05:00 / 22:30)를 기준으로 함
    '1560': {
      weekday: { source: 'estimate', first: '05:00', last: '22:30', bands: [
        { from: '05:00', to: '09:00', h: 20 }, { from: '09:00', to: '17:00', h: 30 },
        { from: '17:00', to: '20:00', h: 25 }, { from: '20:00', to: '22:31', h: 30 } ] },
      weekend: { source: 'estimate', first: '05:00', last: '22:30', bands: [
        { from: '05:00', to: '22:31', h: 35 } ] },
    },
  };

  // 밴드 → 출발 시각(분) 목록
  function generate(def) {
    const out = [];
    let cursor = null;
    for (const b of def.bands) {
      if (b.list) { b.list.forEach((s) => out.push(hm(s))); cursor = null; continue; }
      const from = hm(b.from), to = hm(b.to);
      if (b.at) {
        for (let H = Math.floor(from / 60); H <= Math.floor(to / 60); H++)
          for (const m of b.at) { const t = H * 60 + m; if (t >= from && t < to) out.push(t); }
        cursor = null;
      } else if (b.h == null) {
        cursor = null;
      } else {
        let t = cursor != null && cursor >= from ? cursor : from;
        while (t < to) { out.push(Math.round(t)); t += b.h; }
        cursor = t;
      }
    }
    const last = hm(def.last);
    const times = [...new Set(out.filter((t) => t <= last))].sort((a, b) => a - b);
    if (times[times.length - 1] !== last) times.push(last);
    return times;
  }

  // ───── 학습 결과와 합치기 ─────
  const TOL = 6;          // 같은 운행으로 보는 시각 차이(분)
  const UNOBSERVED = 300; // 05:00 이전은 추적을 쉬는 시간대라 학습값이 없음 → 기본 시간표 유지
  const near = (arr, t) => arr.some((x) => Math.abs(x - t) <= TOL);

  function merge(base, def, L) {
    if (!L || L.days < 3) return { times: base, source: def.source };
    const w = Math.min(L.days / 8, 1);
    let times;
    const cl = L.times || [];
    const coverage = base.filter((t) => t >= UNOBSERVED).length
      ? base.filter((t) => t >= UNOBSERVED && near(cl, t)).length / base.filter((t) => t >= UNOBSERVED).length : 0;

    if (cl.length && (coverage >= 0.5 || cl.length >= 0.6 * base.length)) {
      // 정시 운행 노선: 며칠간 반복 확인된 시각을 시간표로. 학습 일수가 적으면 기본 시간표 중 아직 확인 안 된 시각을 남김
      times = [...cl, ...base.filter((t) => t < UNOBSERVED || (L.days < 8 && !near(cl, t)))];
    } else if (L.days >= 6 && L.hourly) {
      // 불규칙 노선: 시간대별 평균 운행 대수로 다시 구성 (대수만큼 시간대 안에 고르게 배치)
      const first = hm(def.first), last = hm(def.last);
      times = [];
      for (let h = Math.floor(first / 60); h <= Math.floor(last / 60); h++) {
        const c = L.hourly[h];
        const inHour = base.filter((t) => Math.floor(t / 60) === h);
        if (c == null || h * 60 < UNOBSERVED) { times.push(...inHour); continue; }
        const n = Math.round(c);
        for (let k = 0; k < n; k++) times.push(Math.round(h * 60 + ((k + 0.5) * 60) / n));
      }
    } else {
      times = base.slice();
    }
    // 첫차·막차는 관측 중앙값을 학습 비중만큼 반영 (±30분 이내일 때만)
    let first = hm(def.first), last = hm(def.last);
    if (first >= UNOBSERVED && L.first >= UNOBSERVED && Math.abs(L.first - first) <= 30) first = Math.round(first * (1 - w) + L.first * w);
    if (Math.abs(L.last - last) <= 30) last = Math.round(last * (1 - w) + L.last * w);
    times = [...new Set(times.filter((t) => t >= first - 1 && t <= last + 1))].sort((a, b) => a - b);
    if (!times.length || times[0] > first + 1) times.unshift(first);
    if (times[times.length - 1] < last - 1) times.push(last);
    return { times, source: 'learned' };
  }

  // ───── 시각 / 요일 ─────
  const state = { today: null, learned: {}, cache: {} };

  function kstNow() {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' })
      .formatToParts(new Date()).reduce((o, x) => (o[x.type] = x.value, o), {});
    return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) + Number(p.second) / 60, weekend: p.weekday === 'Sat' || p.weekday === 'Sun' };
  }

  function dayType(now) {
    // 서버가 알려준 오늘 유형(공휴일 반영)을 우선, 날짜가 다르거나 서버 응답이 없으면 토·일만 주말로 취급
    if (state.today && state.today.date === now.date) return state.today.dayType;
    return now.weekend ? 'weekend' : 'weekday';
  }

  function timetable(route, type) {
    const def = BASE[route]?.[type];
    if (!def) return null;
    const key = `${route}|${type}`;
    if (!state.cache[key]) state.cache[key] = merge(generate(def), def, state.learned?.[route]?.[type]);
    return state.cache[key];
  }

  const LABEL = { observed: '시간표', estimate: '시간표·추정', learned: '시간표·학습 반영' };

  // route: 노선 번호, deltaMin: 정문 건너편 기준 대비 이 정류장의 시간차(분, 학교 안은 음수)
  function nextAt(route, deltaMin = 0) {
    const now = kstNow();
    const tt = timetable(route, dayType(now));
    if (!tt) return null;
    const upcoming = tt.times.map((t) => t + deltaMin).filter((t) => t >= now.minutes - 0.5);
    if (!upcoming.length) return null; // 막차 이후 = 운행종료
    const rem = (t) => Math.max(1, Math.round(t - now.minutes));
    const t1 = rem(upcoming[0]);
    const far = upcoming[0] - now.minutes >= 60; // 운행 공백(M5107 08~10시 등)·첫차 전: 분 대신 출발 시각 표시
    return {
      t1,
      t2: far || upcoming[1] == null ? null : Math.max(t1 + 1, rem(upcoming[1])),
      clock: far ? fmt(upcoming[0]) : null,
      source: tt.source,
      label: LABEL[tt.source],
    };
  }

  async function load() {
    try {
      const res = await fetch('/api/schedule', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      state.today = json.today || null;
      state.learned = json.learned || {};
      state.cache = {};
    } catch (err) {
      console.warn('학습 시간표를 못 불러와 기본 시간표를 사용합니다:', err.message);
    }
  }

  window.Schedule = { BASE, generate, timetable, nextAt, load, merge, _state: state };
})();
