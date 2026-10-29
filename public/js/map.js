// public/js/map.js

let mapData = [];
let currentBuilding = null;
let currentFloorObj = null;
let activeTargetRoom = null; // 검색으로 찾은 대상 호실 { number, floor, x?, y? }
let prefixIndex = [];        // [{ prefix, building }] — 긴 접두어 우선 정렬

// ───────────────────────── 검색어 해석 유틸 ─────────────────────────

// 비교용 정규화: 공백 제거 + 대문자 (한글은 영향 없음, b → B)
function normalize(str) {
  return String(str || '').replace(/\s+/g, '').toUpperCase();
}

// 층 표기 정규화: "B1F" / "B1" → "B1", "1F" → "1"
function normalizeFloor(floor) {
  return normalize(floor).replace(/F$/, '');
}

// 사람이 읽는 층 이름: "B1" → "B1층", "3" → "3층"
function floorLabel(floorKey) {
  return `${floorKey}층`;
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

// 호실 번호 → 층 키
//   101 → "1", 365 → "3", 1203 → "12"
//   B101 → "B1", B203 → "B2", B01 → "B1"
//   한 자리(입력 중) "5" → "5"
function floorFromRoom(isBasement, digits) {
  let level = digits.length <= 3 ? digits[0] : digits.slice(0, -2);
  level = String(parseInt(level, 10) || 1); // "0"(B01 같은 표기) → 1
  return (isBasement ? 'B' : '') + level;
}

// "공101", "공 B102호", "국경103", "생119(시청각실)", "공102-1호", "501" 등을 해석
// 반환: { building | null, floorKey | null, roomNumber | null } 또는 null(해석 불가)
function parseQuery(rawQuery) {
  const q = normalize(rawQuery);
  if (!q) return null;

  let building = null;
  let rest = q;
  for (const { prefix, building: b } of prefixIndex) {
    if (q.startsWith(prefix)) {
      building = b;
      rest = q.slice(prefix.length);
      break;
    }
  }

  // 건물명만 입력한 경우 (예: "공", "공학관")
  if (building && rest === '') {
    return { building, floorKey: null, roomNumber: null };
  }

  // 남은 부분이 호실 번호인지 확인: [B]숫자[-숫자][호/호실/기타 설명]
  const m = rest.match(/^(B)?(\d+)(-\d+)?/);
  if (!m) return null;

  const isBasement = Boolean(m[1]);
  const digits = m[2];
  const roomNumber = `${isBasement ? 'B' : ''}${digits}${m[3] || ''}`;

  return {
    building, // null이면 현재 보고 있는 건물에서 찾음 (예: "501")
    floorKey: floorFromRoom(isBasement, digits),
    roomNumber,
  };
}

// ───────────────────────── 데이터 로드 & 렌더링 ─────────────────────────

// 1. map-data.json 로드
async function loadMapData() {
  try {
    let res = await fetch('/data/map-data.json');
    if (!res.ok) res = await fetch('/map-data.json');
    if (!res.ok) throw new Error('Data fetch failed');

    mapData = await res.json();
    buildPrefixIndex();
    initBuildingSelect();
    initSearchEvent();
  } catch (err) {
    console.error('데이터 로드 실패:', err);
  }
}

// 2. 건물 드롭다운 초기화
function initBuildingSelect() {
  const buildingSelect = document.getElementById('buildingSelect');
  if (!buildingSelect || !mapData.length) return;

  buildingSelect.innerHTML = mapData.map(b =>
    `<option value="${b.buildingId}">${b.buildingName}</option>`
  ).join('');

  selectBuilding(mapData[0].buildingId);

  buildingSelect.addEventListener('change', (e) => {
    activeTargetRoom = null; // 선택 직접 변경 시 핀 초기화
    setSearchStatus('');
    selectBuilding(e.target.value);
  });
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

  renderFloorButtons();
  updateFloorPlanImage();
}

function findFloor(building, floorKey) {
  if (!building || !building.floors || !floorKey) return null;
  return building.floors.find(f => normalizeFloor(f.floor) === floorKey) || null;
}

// 4. 층 버튼 렌더링
function renderFloorButtons() {
  const floorContainer = document.getElementById('floorButtons');
  if (!floorContainer || !currentBuilding) return;

  floorContainer.innerHTML = currentBuilding.floors.map(f => `
    <button
      class="floor-btn ${currentFloorObj && currentFloorObj.floor === f.floor ? 'active' : ''}"
      onclick="selectFloor('${f.floor}')"
    >
      ${f.floor}
    </button>
  `).join('');
}

// 5. 층 변경 처리 (층 버튼 클릭)
function selectFloor(floorName) {
  if (!currentBuilding) return;
  currentFloorObj = currentBuilding.floors.find(f => f.floor === floorName);
  renderFloorButtons();
  updateFloorPlanImage();
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

// 검색 결과 안내 문구
function setSearchStatus(text, isError = false) {
  const el = document.getElementById('searchStatus');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', isError);
}

// 7. 검색 실행
function runSearch(rawQuery) {
  if (!normalize(rawQuery)) {
    activeTargetRoom = null;
    setSearchStatus('');
    updateFloorPlanImage();
    return;
  }

  const parsed = parseQuery(rawQuery);
  if (!parsed) {
    setSearchStatus('건물 약칭 + 호실로 검색해 주세요 (예: 공101, 공B102)', true);
    return;
  }

  const building = parsed.building || currentBuilding;
  if (!building) return;

  // 건물만 입력
  if (!parsed.floorKey) {
    activeTargetRoom = null;
    selectBuilding(building.buildingId);
    setSearchStatus(building.buildingName);
    return;
  }

  const floorObj = findFloor(building, parsed.floorKey);
  if (!floorObj) {
    activeTargetRoom = null;
    if (currentBuilding !== building) selectBuilding(building.buildingId);
    setSearchStatus(`${building.buildingName}에는 ${floorLabel(parsed.floorKey)} 도면이 없어요`, true);
    return;
  }

  // 나중에 floors[].rooms 에 좌표를 넣으면 핀까지 자동 표시됨
  const roomInfo = (floorObj.rooms || []).find(r => normalize(r.number) === parsed.roomNumber) || {};
  activeTargetRoom = {
    ...roomInfo,
    number: parsed.roomNumber,
    floor: floorObj.floor,
    buildingId: building.buildingId,
  };

  selectBuilding(building.buildingId, parsed.floorKey);
  setSearchStatus(`${building.buildingName} ${floorLabel(parsed.floorKey)} · ${parsed.roomNumber}호`);
}

// 8. 검색 이벤트 (입력할 때마다 실시간 + Enter)
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

document.addEventListener('DOMContentLoaded', loadMapData);
