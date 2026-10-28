// public/js/map.js

let mapData = [];
let currentBuilding = null;
let currentFloorObj = null;
let activeTargetRoom = null; // 검색으로 하이라이트할 대상 호실

// 1. map-data.json 로드
async function loadMapData() {
  try {
    let res = await fetch('/data/map-data.json');
    if (!res.ok) res = await fetch('/map-data.json');
    if (!res.ok) throw new Error('Data fetch failed');

    mapData = await res.json();
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
    selectBuilding(e.target.value);
  });
}

// 3. 건물 선택 처리
function selectBuilding(buildingId) {
  currentBuilding = mapData.find(b => b.buildingId === buildingId);
  if (!currentBuilding) return;

  const buildingSelect = document.getElementById('buildingSelect');
  if (buildingSelect) buildingSelect.value = buildingId;

  if (currentBuilding.floors && currentBuilding.floors.length > 0) {
    const defaultFloor = currentBuilding.floors.find(f => f.floor === '1F');
    currentFloorObj = defaultFloor || currentBuilding.floors[0];
  } else {
    currentFloorObj = null;
  }

  renderFloorButtons();
  updateFloorPlanImage();
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

// 5. 층 변경 처리
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

  if (currentFloorObj && currentFloorObj.mapImage) {
    mapImageElem.src = currentFloorObj.mapImage;
    mapImageElem.alt = `${currentBuilding.buildingName} ${currentFloorObj.floor} 도면`;
    mapImageElem.style.display = 'block';

    // 해당 층에 하이라이트할 호실 정보가 있는 경우 핀 노출
    if (activeTargetRoom && activeTargetRoom.floor === currentFloorObj.floor) {
      if (roomPinElem && pinLabelElem) {
        pinLabelElem.textContent = activeTargetRoom.name || `${activeTargetRoom.number}호`;
        
        // x, y 좌표 퍼센티지 적용 (좌표가 없으면 중앙에 핀)
        const posX = activeTargetRoom.x !== undefined ? activeTargetRoom.x : 50;
        const posY = activeTargetRoom.y !== undefined ? activeTargetRoom.y : 50;
        
        roomPinElem.style.left = `${posX}%`;
        roomPinElem.style.top = `${posY}%`;
        roomPinElem.classList.add('active');
      }
    } else {
      if (roomPinElem) roomPinElem.classList.remove('active');
    }

  } else {
    mapImageElem.style.display = 'none';
    if (roomPinElem) roomPinElem.classList.remove('active');
  }
}

// 7. 실시간 강의실 검색 이벤트 처리
function initSearchEvent() {
  const searchInput = document.getElementById('roomSearchInput');
  if (!searchInput) return;

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim().toLowerCase();
    if (!query) {
      activeTargetRoom = null;
      updateFloorPlanImage();
      return;
    }

    // 21개 전 건물 및 각 층의 rooms 탐색
    for (const b of mapData) {
      const isBuildingMatch = b.buildingName.toLowerCase().includes(query) || 
                              b.aliases.some(a => a.toLowerCase().includes(query));

      for (const f of b.floors) {
        if (!f.rooms) continue;
        
        const roomMatch = f.rooms.find(r => 
          r.number.toLowerCase() === query ||
          (r.name && r.name.toLowerCase().includes(query)) ||
          (r.aliases && r.aliases.some(a => a.toLowerCase().includes(query)))
        );

        if (roomMatch) {
          activeTargetRoom = { ...roomMatch, floor: f.floor };
          if (currentBuilding.buildingId !== b.buildingId) {
            selectBuilding(b.buildingId);
          }
          selectFloor(f.floor);
          return;
        }
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', loadMapData);
