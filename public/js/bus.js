// public/js/bus.js

const TARGET_ROUTES = [
  { 
    name: 'M5107', type: 'm', desc: '서울역 방면 (광역급행)',
    startHour: 5, startMin: 0, endHour: 23, endMin: 0,
    intervals: [
      { start: 5,  end: 9,  interval: 6 },
      { start: 9,  end: 17, interval: 11 },
      { start: 17, end: 20, interval: 7 },
      { start: 20, end: 24, interval: 12 }
    ]
  },
  { 
    name: '5100', type: 'red', desc: '강남역 방면 (직행좌석)',
    startHour: 5, startMin: 30, endHour: 0, endMin: 10,
    intervals: [
      { start: 5,  end: 9,  interval: 7 },
      { start: 9,  end: 17, interval: 11 },
      { start: 17, end: 20, interval: 8 },
      { start: 20, end: 25, interval: 15 }
    ]
  },
  { 
    name: '1112', type: 'red', desc: '강변역 방면 (직행좌석)',
    startHour: 4, startMin: 40, endHour: 22, endMin: 30,
    intervals: [
      { start: 4,  end: 9,  interval: 12 },
      { start: 9,  end: 17, interval: 18 },
      { start: 17, end: 20, interval: 15 },
      { start: 20, end: 23, interval: 20 }
    ]
  },
  { 
    name: '7000', type: 'red', desc: '사당역 방면 (직행좌석)',
    startHour: 5, startMin: 30, endHour: 0, endMin: 0,
    intervals: [
      { start: 5,  end: 9,  interval: 12 },
      { start: 9,  end: 17, interval: 18 },
      { start: 17, end: 20, interval: 14 },
      { start: 20, end: 24, interval: 20 }
    ]
  },
  { 
    name: '1560', type: 'red', desc: '신논현역 방면 (직행좌석)',
    startHour: 5, startMin: 0, endHour: 23, endMin: 30,
    intervals: [
      { start: 5,  end: 9,  interval: 10 },
      { start: 9,  end: 17, interval: 18 },
      { start: 17, end: 20, interval: 12 },
      { start: 20, end: 24, interval: 20 }
    ]
  },
  { 
    name: '9', type: 'green', desc: '수원역·용남고속 (일반)',
    startHour: 5, startMin: 30, endHour: 23, endMin: 0,
    intervals: [
      { start: 5,  end: 9,  interval: 12 },
      { start: 9,  end: 17, interval: 16 },
      { start: 17, end: 20, interval: 14 },
      { start: 20, end: 23, interval: 20 }
    ]
  }
];

const STATIONS = {
  inbound: [
    { id: 'gate_in', name: { ko: '경희대정문', en: 'Main Gate' }, where: { ko: '입교 방향', en: 'Inbound' }, pos: { x: 80.0, y: 5.5 } },
    { id: 'foreign_in', name: { ko: '외국어대학', en: 'Foreign Languages' }, where: { ko: '사색의 광장 방향', en: 'To Square' }, pos: { x: 52, y: 12.0 } },
    { id: 'life_in', name: { ko: '생명과학대', en: 'Life Sciences' }, where: { ko: '사색의 광장 방향', en: 'To Square' }, pos: { x: 38.5, y: 38.0 } },
    { id: 'square_in', name: { ko: '사색의 광장 (종점)', en: 'Square of Thought' }, where: { ko: '하차 전용', en: 'Terminus' }, pos: { x: 23.2, y: 65 } }
  ],
  outbound: [
    { id: 'square_out', name: { ko: '사색의 광장 (기점)', en: 'Square of Thought' }, where: { ko: '승차 기점', en: 'Departure' }, pos: { x: 23.2, y: 65 } },
    { id: 'life_out', name: { ko: '생명과학대·산업대학', en: 'Life & Applied Sciences' }, where: { ko: '정문 방향', en: 'To Main Gate' }, pos: { x: 38.5, y: 38.0 } },
    { id: 'foreign_out', name: { ko: '경희대체육대학·외대', en: 'Sports & Foreign Lang' }, where: { ko: '정문 방향', en: 'To Main Gate' }, pos: { x: 52, y: 12.0 } },
    { id: 'gate_out', name: { ko: '경희대정문 (출교)', en: 'Main Gate' }, where: { ko: '시외/수원 방면', en: 'Outbound' }, pos: { x: 80.0, y: 5.5 } }
  ]
};

const state = {
  direction: 'inbound',
  selectedStopId: 'gate_in',
  dataMode: 'api',
  updatedAt: Date.now(),
  busRawData: generateSimulationData(),
  tracked: {} // 위치 추적 기반 추정치 { gate_in: { M5107: [6, 21] }, ... }
};

// 1. 심야 시간대(01:00 ~ 05:00) 검증
function isLateNightOffTime() {
  const currentHour = new Date().getHours();
  return currentHour >= 1 && currentHour < 5;
}

// 2. 주간 차고지 복귀 및 불량 유령 데이터 필터링 검증
function isDepotReturnVehicle(arr) {
  if (!arr) return true;

  // 경기 GBIS flag: RUN·PASS = 운행중, STOP = 운행종료, WAIT = 회차지대기
  if (arr.flag === 'STOP') {
    return true;
  }

  // 차고지 입고 차량 특성: 차량번호가 누락되거나 빈 문자열인 경우
  if (arr.plateNo1 === null || arr.plateNo1 === '') {
    return true;
  }

  // 남은 정류장 수가 비정상적인 경우 (0 이하 또는 90 이상)
  if (arr.locationNo1 !== undefined && (arr.locationNo1 <= 0 || arr.locationNo1 > 90)) {
    return true;
  }

  return false;
}

function getTimetableDeparture(routeObj) {
  if (isLateNightOffTime()) return null;

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinutes = currentHour * 60 + now.getMinutes();
  const startMinutes = routeObj.startHour * 60 + routeObj.startMin;
  let endMinutes = routeObj.endHour * 60 + routeObj.endMin;
  // 막차가 자정 넘어서(00:10 등)면 다음날 시각으로 계산 — 예전엔 5100·7000이 하루 종일 '운행종료'로 나왔음
  if (endMinutes <= startMinutes) endMinutes += 24 * 60;
  const nowMinutes = currentMinutes < startMinutes ? currentMinutes + 24 * 60 : currentMinutes;

  if (nowMinutes > endMinutes) return null;

  const matched = routeObj.intervals?.find(i => currentHour >= i.start && currentHour < i.end);
  const activeInterval = matched ? matched.interval : 15;

  const elapsed = nowMinutes - startMinutes;
  const nextIn = activeInterval - (elapsed % activeInterval);
  const nextT1 = nextIn === 0 ? activeInterval : nextIn;
  const nextT2 = nextT1 + activeInterval;

  return { t1: nextT1, t2: nextT2, isTimetable: true };
}

function generateSimulationData() {
  if (isLateNightOffTime()) {
    return { inbound: {}, outbound: {} };
  }

  const baseGateIn = { 'M5107': [3, 14], '5100': [2, 11], '1112': [5, 18], '7000': [8, 22], '1560': [1, 15], '9': [4, 12] };
  const baseGateOut = { 'M5107': [6, 17], '5100': [5, 14], '1112': [8, 21], '7000': [10, 25], '1560': [4, 18], '9': [7, 16] };
  const data = { inbound: {}, outbound: {} };

  STATIONS.inbound.forEach(st => {
    data.inbound[st.id] = {};
    TARGET_ROUTES.forEach(r => {
      const offset = st.id === 'gate_in' ? 0 : (st.id === 'foreign_in' ? 2.0 : (st.id === 'life_in' ? 3.5 : 5.0));
      const times = baseGateIn[r.name].map(t => Math.max(1, Math.round(t + offset)));
      data.inbound[st.id][r.name] = { t1: times[0], t2: times[1] };
    });
  });

  STATIONS.outbound.forEach(st => {
    data.outbound[st.id] = {};
    TARGET_ROUTES.forEach(r => {
      const off = st.id === 'square_out' ? 0 : (st.id === 'life_out' ? 1.5 : (st.id === 'foreign_out' ? 3.0 : 5.0));
      const t1 = Math.max(1, Math.round(baseGateOut[r.name][0] + off));
      const t2 = Math.max(t1 + 3, Math.round(baseGateOut[r.name][1] + off));
      data.outbound[st.id][r.name] = { t1, t2 };
    });
  });

  return data;
}

async function fetchRealApiData() {
  try {
    const res = await fetch('/api/bus', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const apiRes = await res.json();

    const newRaw = { inbound: {}, outbound: {} };
    STATIONS.inbound.forEach(st => newRaw.inbound[st.id] = {});
    STATIONS.outbound.forEach(st => newRaw.outbound[st.id] = {});

    const mapStopId = (vId, dir) => {
      if (dir === 'in') {
        if (vId === 'main-gate') return 'gate_in';
        if (vId === 'foreign') return 'foreign_in';
        if (vId === 'lifesci') return 'life_in';
        if (vId === 'square') return 'square_in';
      } else {
        if (vId === 'square') return 'square_out';
        if (vId === 'lifesci-ind') return 'life_out';
        if (vId === 'pe-foreign') return 'foreign_out';
        if (vId === 'main-gate') return 'gate_out';
      }
      return null;
    };

    // 심야 시간대 및 주간 차고지 복귀 차량 필터링 적용
    if (!isLateNightOffTime() && apiRes.stops) {
      apiRes.stops.forEach(stop => {
        const targetId = mapStopId(stop.id, stop.dir);
        const targetDict = stop.dir === 'in' ? newRaw.inbound : newRaw.outbound;
        if (targetId && targetDict[targetId]) {
          stop.arrivals.forEach(arr => {
            // 차고지 복귀 차량이 아닐 때만 정제 데이터에 삽입
            if (!isDepotReturnVehicle(arr)) {
              targetDict[targetId][arr.route] = { t1: arr.t1, t2: arr.t2 };
            }
          });
        }
      });
    }

    // 서버(api/track)가 버스 위치로 계산한 들어오는 방향 추정치
    const TRACK_STOP_MAP = {
      'main-gate': 'gate_in', foreign: 'foreign_in', lifesci: 'life_in', square: 'square_in',
      // 9번처럼 광장에서 바로 회차하는 노선의 나가는 방향
      'square-out': 'square_out', 'lifesci-ind': 'life_out', 'pe-foreign': 'foreign_out', 'main-gate-out': 'gate_out'
    };
    const tracked = {};
    if (!isLateNightOffTime()) {
      for (const [key, routes] of Object.entries(apiRes.estimates || {})) {
        if (TRACK_STOP_MAP[key]) tracked[TRACK_STOP_MAP[key]] = routes;
      }
    }

    state.busRawData = newRaw;
    state.tracked = tracked;
    state.updatedAt = Date.now();
    renderBusView();
  } catch (err) {
    console.warn('API 연동 실패, 시뮬레이션 데이터를 유지합니다:', err);
    renderBusView();
  }
}

function getProcessedStopArrivals(direction) {
  const isIn = direction === 'inbound';
  const stations = STATIONS[direction];
  const raw = state.busRawData[direction];

  const offsets = isIn 
    ? { gate_in: 0, foreign_in: 2.0, life_in: 3.5, square_in: 5.0 }
    : { square_out: 0, life_out: 1.5, foreign_out: 3.0, gate_out: 5.0 };

  const result = stations.map(st => ({ ...st, arrivals: [] }));

  TARGET_ROUTES.forEach(rt => {
    const routeDesc = isIn ? '사색의 광장 방면' : rt.desc;
    const originStopId = isIn ? 'gate_in' : 'square_out';

    let originData = isLateNightOffTime() ? null : raw[originStopId]?.[rt.name];
    let originT1 = originData?.t1;
    let originT2 = originData?.t2;
    let originIsTimetable = false;

    if (originT1 == null) {
      const tt = getTimetableDeparture(rt);
      if (tt) {
        originT1 = tt.t1;
        originT2 = tt.t2;
        originIsTimetable = true;
      }
    }

    stations.forEach((st) => {
      const stopIdx = result.findIndex(s => s.id === st.id);
      const candidates = [];

      const directData = isLateNightOffTime() ? null : raw[st.id]?.[rt.name];
      // M5107·1560처럼 정문이 종점인 노선은 학교 안 정류장 추정치가 없으므로 '정문 도착 + 진입 시간'으로 계산
      const gateTracked = isIn ? state.tracked?.gate_in?.[rt.name] : null;
      const trackedMins = state.tracked?.[st.id]?.[rt.name]
        ?? (gateTracked ? gateTracked.map(m => Math.round(m + (offsets[st.id] || 0))) : null);

      if (directData && directData.t1 != null) {
        // 이 정류장 도착정보가 비어 있는 '다음 버스'는 위치 추적값으로 채움
        let t2 = directData.t2;
        if (t2 == null && trackedMins) t2 = trackedMins.find(m => m >= directData.t1 + 3) ?? null;
        candidates.push({ t1: directData.t1, t2, isEstimated: false, isTimetable: false });
      }

      // 도착정보에 아직 안 잡히는 먼 버스(고속도로 위 등)는 위치 추적으로 계산한 값 사용
      if (trackedMins && trackedMins.length) {
        candidates.push({ t1: trackedMins[0], t2: trackedMins[1] ?? null, isEstimated: false, isTimetable: false, isTracked: true });
      }

      if (originT1 != null) {
        const diff = (offsets[st.id] || 0) - (offsets[originStopId] || 0);
        const estT1 = Math.max(1, Math.round(originT1 + diff));
        const estT2 = originT2 != null ? Math.max(estT1 + 4, Math.round(originT2 + diff)) : null;

        candidates.push({
          t1: estT1,
          t2: estT2,
          isEstimated: !originIsTimetable && (st.id !== originStopId),
          isTimetable: originIsTimetable
        });
      }

      if (candidates.length === 0) {
        result[stopIdx].arrivals.push({
          route: rt.name, type: rt.type, desc: routeDesc, t1: null, t2: null, isEstimated: false, isTimetable: false
        });
      } else {
        // 이 정류장의 실시간 값이 있으면 그걸 우선 (추정·시간표 값이 더 작다고 덮어쓰지 않음)
        // 우선순위: 이 정류장 실시간 도착정보 → 위치 추적 추정 → 기점 기준 추정 → 시간표
        const best = candidates.find(c => !c.isEstimated && !c.isTimetable && !c.isTracked)
          || candidates.find(c => c.isTracked)
          || candidates[0];
        result[stopIdx].arrivals.push({
          route: rt.name, type: rt.type, desc: routeDesc, t1: best.t1, t2: best.t2, isEstimated: best.isEstimated, isTimetable: best.isTimetable, isTracked: Boolean(best.isTracked)
        });
      }
    });
  });

  return result;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mins = (n) => (n <= 1 ? '<span class="soon">곧 출발</span>' : `${n}<small>분</small>`);
const ago = () => Math.round((Date.now() - state.updatedAt) / 1000);

function renderBusView() {
  const container = document.getElementById('busApp');
  if (!container) return;

  const stopsData = getProcessedStopArrivals(state.direction);
  const currentStops = STATIONS[state.direction];

  if (!currentStops.some(s => s.id === state.selectedStopId)) {
    state.selectedStopId = currentStops[0].id;
  }

  const selectedStopData = stopsData.filter(s => s.id === state.selectedStopId);

  container.innerHTML = `
    <div class="direction-tabs" role="tablist">
      <button type="button" role="tab" aria-selected="${state.direction === 'inbound'}" data-dir="inbound">
        들어오는 방향 (사색의 광장 行)
      </button>
      <button type="button" role="tab" aria-selected="${state.direction === 'outbound'}" data-dir="outbound">
        나가는 방향 (정문·시외 行)
      </button>
    </div>

    <div class="map-interactive-card">
      <div class="map-img-wrapper">
        <img class="bg-map" 
             src="/campus_map.png" 
             onError="if(!this.tried1){this.tried1=true;this.src='/campus_map.jpg';}else if(!this.tried2){this.tried2=true;this.src='/maps/campus_map.png';}" 
             alt="경희대 조감도 지도" />
        ${currentStops.map((st, idx) => `
          <div class="stop-pin ${st.id === state.selectedStopId ? 'active' : ''}" style="left: ${st.pos.x}%; top: ${st.pos.y}%;" data-stop-pin="${st.id}">
            <div class="pin-icon-wrap">
              <img src="/pin.png" alt="위치 핀" />
              <div class="pin-num">${idx + 1}</div>
            </div>
            <div class="pin-label">${esc(st.name.ko)}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="bus-meta">
      <div class="bus-meta-l">
        <span class="badge-sample">${state.dataMode === 'sim' ? '시뮬레이션' : '실시간 API'}</span>
        <span id="ago">${ago()}초 전 업데이트</span>
      </div>
      <button type="button" class="refresh" data-refresh>새로고침</button>
    </div>

    <div class="stops">
      ${selectedStopData.map(s => `
        <section class="stop">
          <div class="stop-header">
            <h2>${esc(s.name.ko)}</h2>
            <span class="stop-where">${esc(s.where.ko)}</span>
          </div>
          <table class="arrivals"><tbody>
            ${s.arrivals.map(a => `<tr>
              <td style="width:68px"><span class="route route-${a.type}">${esc(a.route)}</span></td>
              <td class="dest">
                ${esc(a.desc)}
                ${a.isEstimated ? '<br><span class="badge-est">[추정]</span>' : ''}
                ${a.isTracked ? '<br><span class="badge-est">[위치 기반 추정]</span>' : ''}
                ${a.isTimetable ? '<br><span class="badge-schedule">[시간표]</span>' : ''}
              </td>
              <td class="t1 ${a.t1 == null ? 'ended' : a.t1 <= 1 ? 'soon' : ''}">
                ${a.t1 == null ? '운행종료' : mins(a.t1)}
                ${a.t2 != null ? `<span class="t2">다음 ${a.t2}분</span>` : ''}
              </td>
            </tr>`).join('')}
          </tbody></table>
        </section>
      `).join('')}
    </div>
  `;
}

document.addEventListener('click', (e) => {
  const dirBtn = e.target.closest('[data-dir]');
  if (dirBtn) {
    state.direction = dirBtn.dataset.dir;
    renderBusView();
    return;
  }

  const pinBtn = e.target.closest('[data-stop-pin]');
  if (pinBtn) {
    state.selectedStopId = pinBtn.dataset.stopPin;
    renderBusView();
    return;
  }

  const refreshBtn = e.target.closest('[data-refresh]');
  if (refreshBtn) {
    fetchRealApiData();
    return;
  }
});

setInterval(() => {
  const el = document.getElementById('ago');
  if (el) el.textContent = `${ago()}초 전 업데이트`;
}, 1000);

setInterval(fetchRealApiData, 30000);

fetchRealApiData();
