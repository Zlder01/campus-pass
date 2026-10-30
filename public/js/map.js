// public/js/map.js

let mapData = [];
let currentBuilding = null;
let currentFloorObj = null;
let activeTargetRoom = null; // 핀 표시용 대표 호실 { number, floor, buildingId, x?, y? }
let activeHits = [];         // 표에서 하이라이트할 호실들 [{ buildingId, floor, room }]
let prefixIndex = [];        // [{ prefix, building }] — 긴 접두어 우선 정렬
let roomIndex = [];          // [{ building, floor, room, keys:[...], nameKey }] — 전체 호실 검색용

// ───────────────────────── 검색어 해석 유틸 ─────────────────────────

// 비교용 정규화: 공백 제거 + 대문자 (한글은 영향 없음, b → B)
function normalize(str) {
  return String(str || '').replace(/\s+/g, '').toUpperCase();
}

// 호실 번호 비교용: 정규화 + 끝의 "호"/"호실" 제거  ("D402호" → "D402")
function normalizeRoom(str) {
  return normalize(str).replace(/호실?$/, '');
}

// 층 표기 정규화: "B1F" / "B1" → "B1", "1F" → "1"
function normalizeFloor(floor) {
  return normalize(floor).replace(/F$/, '');
}

// 사람이 읽는 층 이름: "B1" → "B1층", "3" → "3층"
function floorLabel(floorKey) {
  return `${normalizeFloor(floorKey)}층`;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// 표의 호실 칸 하나가 여러 호실을 묶고 있을 수 있어서 검색용 키로 펼친다.
//   "505, 506"   → ["505", "506"]
//   "B101~B104"  → ["B101", "B102", "B103", "B104"]
//   "101-C,D"    → ["101-C", "101-D"]
function expandRoomKeys(label) {
  const keys = [];
  let lastBase = null; // "101-C" 다음에 오는 "D" 처리용 → "101-"
  for (const raw of String(label).split(',')) {
    const part = normalizeRoom(raw);
    if (!part) continue;

    const range = part.match(/^([A-Z]*)(\d+)~([A-Z]*)(\d+)$/);
    if (range) {
      const [, pre, from, , to] = range;
      const start = parseInt(from, 10);
      const end = parseInt(to, 10);
      if (end >= start && end - start <= 100) {
        for (let n = start; n <= end; n++) keys.push(pre + String(n).padStart(from.length, '0'));
        continue;
      }
    }

    if (!/\d/.test(part) && lastBase) {
      keys.push(lastBase + part);
      continue;
    }

    keys.push(part);
    const dash = part.match(/^(.*-)[A-Z0-9]+$/);
    lastBase = dash ? dash[1] : null;
  }
  return keys;
}

// 약칭 · 별칭 · 정식 건물명을 모두 접두어 목록으로 만든다.
// "국경103"이 "국"(국제학관)이 아닌 "국경"(국제경영대학관)에 걸리도록 긴 것부터 비교.
function buildPrefixIndex() {
  const seen = new Set();
  prefixIndex = [];
  for (const b of mapData) {
    const names = [...(b.abbreviations || []), ...(b.aliases || []), b.buildingName];
    for (const name of names) {
      const key = normalize(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      prefixIndex.push({ prefix: key, building: b });
    }
  }
  prefixIndex.sort((a, b) => b.prefix.length - a.prefix.length);
}

// map-data.json 의 floors[].rooms 를 검색용 목록으로 펼친다.
function buildRoomIndex() {
  roomIndex = [];
  for (const b of mapData) {
    for (const f of b.floors || []) {
      for (const room of f.rooms || []) {
        roomIndex.push({
          building: b,
          floor: f,
          room,
          keys: expandRoomKeys(room.number),
          nameKey: normalize(room.name),
        });
      }
    }
  }
}

// 호실 번호 → 층 키 (표에 없는 호실을 검색했을 때만 쓰는 추정값)
//   101 → "1", 365 → "3", 1203 → "12", B101 → "B1", B01 → "B1"
function floorFromRoom(isBasement, digits) {
  let level = digits.length <= 3 ? digits[0] : digits.slice(0, -2);
  level = String(parseInt(level, 10) || 1);
  return (isBasement ? 'B' : '') + level;
}

// 검색어 앞부분에서 건물 약칭/이름을 떼어낸다. { building | null, rest }
function splitBuildingPrefix(q) {
  for (const { prefix, building } of prefixIndex) {
    if (q.startsWith(prefix)) return { building, rest: q.slice(prefix.length) };
  }
  return { building: null, rest: q };
}

// 현재 보고 있는 건물 → 현재 층 순으로 앞에 오도록 정렬
function sortByCurrentView(hits) {
  const score = h =>
    (currentBuilding && h.building === currentBuilding ? 0 : 2) +
    (currentFloorObj && h.floor === currentFloorObj ? 0 : 1);
  return [...hits].sort((a, b) => score(a) - score(b));
}

// 표(roomIndex)에서 찾기
function findByRoomNumber(key, building = null) {
  const k = normalizeRoom(key);
  if (!k) return [];
  return roomIndex.filter(e => (!building || e.building === building) && e.keys.includes(k));
}

function findByName(key, building = null) {
  const k = normalize(key);
  if (k.length < 2) return []; // 한 글자는 결과가 너무 많아서 제외
  return roomIndex.filter(e => (!building || e.building === building) && e.nameKey.includes(k));
}

// 검색어 해석 결과
//   { type: 'rooms', hits }                       표에서 찾음 (호실 번호 or 시설명)
//   { type: 'building', building }                건물명만 입력
//   { type: 'guess', building, floorKey, roomNumber }  표에 없는 번호 → 번호로 층 추정
//   null                                          해석 불가
function resolveQuery(rawQuery) {
  const q = normalize(rawQuery);
  if (!q) return null;

  const { building, rest } = splitBuildingPrefix(q);
  // "공101", "실1", "예B1" 처럼 건물 약칭 뒤에 호실 번호가 오는 형태인지
  const restLooksLikeRoom = /^[A-Z]?\d/.test(rest);

  // 1) 호실 번호: "공D402", "공 101호"
  if (building && rest) {
    const hits = findByRoomNumber(rest, building);
    if (hits.length) return { type: 'rooms', hits };
  }
  // 2) 호실 번호만: "D402", "501"
  //    지금 보는 건물에 있으면 거기로. 없으면 "D402"처럼 문자가 붙은 번호만 다른 건물까지 찾고,
  //    "403", "B103" 같은 흔한 번호는 다른 건물로 튀지 않고 지금 건물에서 층을 추정한다(6번).
  if (!building) {
    const hits = findByRoomNumber(q);
    const here = hits.filter(h => h.building === currentBuilding);
    if (here.length) return { type: 'rooms', hits: here };
    if (hits.length && /^[A-Z]/.test(q) && !/^B\d/.test(q)) return { type: 'rooms', hits };
  }
  // 3) 건물명만: "공", "공학관"
  if (building && !rest) return { type: 'building', building };

  // 4) 시설명 전체: "공학도서관"
  //    단, "실1"처럼 건물+번호 입력 중일 때는 "세미나실1" 같은 이름에 잘못 걸리지 않게 건너뜀
  if (!(building && restLooksLikeRoom)) {
    const hits = findByName(q);
    if (hits.length) return { type: 'rooms', hits };
  }
  // 5) 건물 + 시설명: "공 도서관"
  if (building && rest && !restLooksLikeRoom) {
    const hits = findByName(rest, building);
    if (hits.length) return { type: 'rooms', hits };
  }

  // 6) 표에 없는 호실 번호 → 기존처럼 번호로 층 추정
  const m = rest.match(/^(B)?(\d+)(-\d+)?/);
  if (m) {
    const isBasement = Boolean(m[1]);
    return {
      type: 'guess',
      building, // null이면 현재 건물
      floorKey: floorFromRoom(isBasement, m[2]),
      roomNumber: `${isBasement ? 'B' : ''}${m[2]}${m[3] || ''}`,
    };
  }
  return null;
}

// ───────────────────────── 데이터 로드 & 렌더링 ─────────────────────────

// 1. map-data.json 로드
async function loadMapData() {
  try {
    let res = await fetch('/map-data.json');
    if (!res.ok) res = await fetch('/data/map-data.json');
    if (!res.ok) throw new Error('Data fetch failed');

    mapData = await res.json();
    buildPrefixIndex();
    buildRoomIndex();
    initBuildingSelect();
    initSearchEvent();
    applyUrlParams();
  } catch (err) {
    console.error('데이터 로드 실패:', err);
  }
}

// 2. 건물 드롭다운 초기화
function initBuildingSelect() {
  const buildingSelect = document.getElementById('buildingSelect');
  if (!buildingSelect || !mapData.length) return;

  buildingSelect.innerHTML = mapData.map(b =>
    `<option value="${b.buildingId}">${escapeHtml(b.buildingName)}</option>`
  ).join('');

  selectBuilding(mapData[0].buildingId);

  buildingSelect.addEventListener('change', (e) => {
    const buildingId = e.target.value;
    const building = mapData.find(b => b.buildingId === buildingId);
    const hitsHere = activeHits.filter(h => h.buildingId === buildingId);

    // 검색 결과(🟡)가 있는 건물을 고르면: 결과는 유지하고 그 건물의 첫 결과 층으로 이동
    if (building && hitsHere.length) {
      const order = f => building.floors.findIndex(x => x.floor === f);
      const first = [...hitsHere].sort((a, b) => order(a.floor) - order(b.floor))[0];
      activeTargetRoom = { ...first.room, floor: first.floor, buildingId };
      selectBuilding(buildingId, first.floor);
      const others = hitsHere.length - 1;
      const label = `${building.buildingName} ${floorLabel(first.floor)} · ${first.room.number} ${first.room.name}`;
      setSearchStatus(others > 0 ? `${label} 외 ${others}곳` : label);
      return;
    }

    // 검색 중인데 결과가 없는 건물을 고르면: 🟡 표시는 유지하고 안내만
    if (building && activeHits.length) {
      activeTargetRoom = null;
      selectBuilding(buildingId);
      setSearchStatus(`${building.buildingName}에는 검색 결과가 없어요 (🟡 표시 건물 확인)`, true);
      return;
    }

    clearSearchResult(); // 검색 중이 아니면 핀 · 하이라이트 초기화
    setSearchStatus('');
    selectBuilding(buildingId);
  });
}

function clearSearchResult() {
  activeTargetRoom = null;
  activeHits = [];
}

// 3. 건물 선택 처리 (floorKey를 주면 해당 층, 없으면 1층 → 첫 층)
function selectBuilding(buildingId, floorKey = null) {
  currentBuilding = mapData.find(b => b.buildingId === buildingId);
  if (!currentBuilding) return;

  const buildingSelect = document.getElementById('buildingSelect');
  if (buildingSelect) buildingSelect.value = buildingId;

  currentFloorObj = findFloor(currentBuilding, floorKey)
    || findFloor(currentBuilding, '1')
    || (currentBuilding.floors && currentBuilding.floors[0])
    || null;

  renderAll();
  preloadFloorImages(currentBuilding);
}

// 같은 건물의 다른 층 도면을 미리 받아둠 → 층 버튼을 누르면 바로 표시
const preloadedImages = new Set();
function preloadFloorImages(building) {
  for (const f of building.floors || []) {
    if (!f.mapImage || preloadedImages.has(f.mapImage)) continue;
    preloadedImages.add(f.mapImage);
    const img = new Image();
    img.decoding = 'async';
    img.src = f.mapImage;
  }
}

function findFloor(building, floorKey) {
  if (!building || !building.floors || !floorKey) return null;
  const key = normalizeFloor(floorKey);
  return building.floors.find(f => normalizeFloor(f.floor) === key) || null;
}

function renderAll() {
  renderBuildingOptions();
  renderFloorButtons();
  updateFloorPlanImage();
  renderRoomTable();
}

// 건물 드롭다운: 검색 결과가 있는 건물 앞에 🟡, 뒤에 개수 표시
//   (<select> 목록은 휴대폰에서 OS 화면으로 떠서 CSS 점을 못 그리므로 글자로 표시)
function renderBuildingOptions() {
  const buildingSelect = document.getElementById('buildingSelect');
  if (!buildingSelect) return;

  const counts = {};
  for (const h of activeHits) counts[h.buildingId] = (counts[h.buildingId] || 0) + 1;

  for (const opt of buildingSelect.options) {
    const b = mapData.find(x => x.buildingId === opt.value);
    if (!b) continue;
    const n = counts[b.buildingId];
    const text = n ? `🟡 ${b.buildingName} (${n}곳)` : b.buildingName;
    if (opt.textContent !== text) opt.textContent = text;
  }
}

// 4. 층 버튼 렌더링 (검색 결과가 있는 층에는 점 표시)
function renderFloorButtons() {
  const floorContainer = document.getElementById('floorButtons');
  if (!floorContainer || !currentBuilding) return;

  const hitFloors = new Set(
    activeHits.filter(h => h.buildingId === currentBuilding.buildingId).map(h => h.floor)
  );

  floorContainer.innerHTML = currentBuilding.floors.map(f => `
    <button
      class="floor-btn ${currentFloorObj && currentFloorObj.floor === f.floor ? 'active' : ''} ${hitFloors.has(f.floor) ? 'has-hit' : ''}"
      onclick="selectFloor('${f.floor}')"
    >
      ${f.floor}
    </button>
  `).join('');
}

// 5. 층 변경 처리 (층 버튼 클릭) — 검색 하이라이트는 유지
function selectFloor(floorName) {
  if (!currentBuilding) return;
  currentFloorObj = currentBuilding.floors.find(f => f.floor === floorName);
  renderAll();
}

// 6. 도면 및 하이라이트 핀 렌더링
function updateFloorPlanImage() {
  const mapImageElem = document.getElementById('floorPlanImg');
  const roomPinElem = document.getElementById('roomPin');
  const pinLabelElem = document.getElementById('pinLabel');
  if (!mapImageElem) return;

  if (!(currentFloorObj && currentFloorObj.mapImage)) {
    mapImageElem.style.display = 'none';
    if (roomPinElem) roomPinElem.classList.remove('active');
    return;
  }

  mapImageElem.src = currentFloorObj.mapImage;
  mapImageElem.alt = `${currentBuilding.buildingName} ${currentFloorObj.floor} 도면`;
  mapImageElem.style.display = 'block';

  // 좌표가 등록된 호실일 때만 핀 표시 (좌표 없이 가운데 찍으면 위치를 잘못 알려줌)
  const showPin = activeTargetRoom
    && activeTargetRoom.buildingId === currentBuilding.buildingId
    && activeTargetRoom.floor === currentFloorObj.floor
    && activeTargetRoom.x !== undefined
    && activeTargetRoom.y !== undefined;

  if (roomPinElem && pinLabelElem && showPin) {
    pinLabelElem.textContent = activeTargetRoom.name || `${activeTargetRoom.number}호`;
    roomPinElem.style.left = `${activeTargetRoom.x}%`;
    roomPinElem.style.top = `${activeTargetRoom.y}%`;
    roomPinElem.classList.add('active');
  } else if (roomPinElem) {
    roomPinElem.classList.remove('active');
  }
}

// 7. 현재 층의 호실 표 렌더링
function renderRoomTable() {
  const titleElem = document.getElementById('roomTableTitle');
  const bodyElem = document.getElementById('roomTableBody');
  const emptyElem = document.getElementById('roomTableEmpty');
  const tableElem = document.getElementById('roomTable');
  if (!bodyElem) return;

  const rooms = (currentFloorObj && currentFloorObj.rooms) || [];
  if (titleElem) {
    titleElem.textContent = currentBuilding && currentFloorObj
      ? `${currentBuilding.buildingName} ${floorLabel(currentFloorObj.floor)} 호실 안내`
      : '호실 안내';
  }

  if (!rooms.length) {
    bodyElem.innerHTML = '';
    if (tableElem) tableElem.style.display = 'none';
    if (emptyElem) emptyElem.style.display = 'block';
    return;
  }
  if (tableElem) tableElem.style.display = '';
  if (emptyElem) emptyElem.style.display = 'none';

  const hitRooms = new Set(
    activeHits
      .filter(h => currentBuilding && h.buildingId === currentBuilding.buildingId && h.floor === currentFloorObj.floor)
      .map(h => h.room)
  );

  bodyElem.innerHTML = rooms.map((r, i) => `
    <tr class="${hitRooms.has(r) ? 'hit' : ''}" data-idx="${i}">
      <td class="room-no">${escapeHtml(r.number)}</td>
      <td class="room-name">${escapeHtml(r.name)}</td>
    </tr>
  `).join('');

  // 첫 번째 하이라이트 행이 보이도록 표 안에서만 스크롤 (도면은 그대로 보이게)
  const scrollElem = document.getElementById('roomTableScroll');
  const firstHit = bodyElem.querySelector('tr.hit');
  if (scrollElem) {
    scrollElem.scrollTop = firstHit
      ? Math.max(0, firstHit.offsetTop - scrollElem.clientHeight / 2 + firstHit.offsetHeight / 2)
      : 0;
  }
}

// 검색 결과 안내 문구
function setSearchStatus(text, isError = false) {
  const el = document.getElementById('searchStatus');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', isError);
}

// 8. 검색 실행
function runSearch(rawQuery) {
  if (!normalize(rawQuery)) {
    clearSearchResult();
    setSearchStatus('');
    renderAll();
    return;
  }

  const result = resolveQuery(rawQuery);
  if (!result) {
    clearSearchResult();
    setSearchStatus('호실 번호나 시설명으로 검색해 주세요 (예: 공D402, 공학도서관)', true);
    renderAll();
    return;
  }

  // 표에서 찾은 경우: 표에 적힌 층으로 이동 + 해당 행 하이라이트
  if (result.type === 'rooms') {
    const hits = sortByCurrentView(result.hits);
    const first = hits[0];

    activeHits = hits.map(h => ({ buildingId: h.building.buildingId, floor: h.floor.floor, room: h.room }));
    activeTargetRoom = { ...first.room, floor: first.floor.floor, buildingId: first.building.buildingId };

    selectBuilding(first.building.buildingId, first.floor.floor);

    const where = `${first.building.buildingName} ${floorLabel(first.floor.floor)}`;
    const label = `${first.room.number} ${first.room.name}`;
    const others = hits.length - 1;
    setSearchStatus(others > 0 ? `${where} · ${label} 외 ${others}곳` : `${where} · ${label}`);
    return;
  }

  // 건물만 입력
  if (result.type === 'building') {
    clearSearchResult();
    selectBuilding(result.building.buildingId);
    setSearchStatus(result.building.buildingName);
    return;
  }

  // 표에 없는 호실 번호 → 번호로 층 추정 (기존 방식)
  const building = result.building || currentBuilding;
  if (!building) return;
  clearSearchResult();

  const floorObj = findFloor(building, result.floorKey);
  if (!floorObj) {
    if (currentBuilding !== building) selectBuilding(building.buildingId);
    else renderAll();
    setSearchStatus(`${building.buildingName}에는 ${floorLabel(result.floorKey)} 도면이 없어요`, true);
    return;
  }

  activeTargetRoom = { number: result.roomNumber, floor: floorObj.floor, buildingId: building.buildingId };
  selectBuilding(building.buildingId, floorObj.floor);
  setSearchStatus(`${building.buildingName} ${floorLabel(floorObj.floor)} · ${result.roomNumber}호 (표에 없는 호실)`);
}

// 9. 검색 이벤트 (입력할 때마다 실시간 + Enter)
function initSearchEvent() {
  const searchInput = document.getElementById('roomSearchInput');
  if (!searchInput) return;

  searchInput.addEventListener('input', (e) => runSearch(e.target.value));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      runSearch(e.target.value);
      searchInput.blur(); // 모바일 키보드 내리기
    }
  });
}

// 10. 캠퍼스 지도에서 넘어온 주소 처리
//   /map.html?b=eng_main  → 해당 건물 열기
//   /map.html?q=공101     → 검색창에 넣고 바로 검색
function applyUrlParams() {
  const params = new URLSearchParams(location.search);
  const b = params.get('b');
  const q = params.get('q');

  if (b && mapData.some(x => x.buildingId === b)) selectBuilding(b);
  if (q) {
    const searchInput = document.getElementById('roomSearchInput');
    if (searchInput) searchInput.value = q;
    runSearch(q);
  }
}

document.addEventListener('DOMContentLoaded', loadMapData);
