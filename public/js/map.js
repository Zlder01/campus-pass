// public/js/map.js

let mapData = [];
let currentBuilding = null;
let currentFloorObj = null;

// 1. map-data.json 로드
async function loadMapData() {
  try {
    const res = await fetch('/data/map-data.json');
    mapData = await res.json();
    
    initBuildingSelect();
  } catch (err) {
    console.error('지도 데이터를 불러오는 중 오류가 발생했습니다:', err);
  }
}

// 2. 건물 드롭다운 초기화
function initBuildingSelect() {
  const buildingSelect = document.getElementById('buildingSelect');
  if (!buildingSelect) return;

  buildingSelect.innerHTML = mapData.map(b => 
    `<option value="${b.buildingId}">${b.buildingName}</option>`
  ).join('');

  // 기본 첫 번째 건물 선택
  if (mapData.length > 0) {
    selectBuilding(mapData[0].buildingId);
  }

  buildingSelect.addEventListener('change', (e) => {
    selectBuilding(e.target.value);
  });
}

// 3. 건물 선택 처리
function selectBuilding(buildingId) {
  currentBuilding = mapData.find(b => b.buildingId === buildingId);
  if (!currentBuilding) return;

  // 등록된 층이 있으면 첫 번째 층을 기본 선택
  if (currentBuilding.floors && currentBuilding.floors.length > 0) {
    currentFloorObj = currentBuilding.floors[0];
  } else {
    currentFloorObj = null;
  }

  renderFloorButtons();
  updateFloorPlanImage();
}

// 4. 층 선택 버튼 렌더링
function renderFloorButtons() {
  const floorContainer = document.getElementById('floorButtons');
  if (!floorContainer || !currentBuilding) return;

  if (!currentBuilding.floors || currentBuilding.floors.length === 0) {
    floorContainer.innerHTML = '<span style="font-size:12px; color:#868e96;">등록된 도면이 없습니다.</span>';
    return;
  }

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

// 6. 도면 이미지 경로 업데이트
function updateFloorPlanImage() {
  const mapImageElem = document.getElementById('floorPlanImg');
  if (!mapImageElem) return;

  if (currentFloorObj && currentFloorObj.mapImage) {
    mapImageElem.src = currentFloorObj.mapImage;
    mapImageElem.alt = `${currentBuilding.buildingName} ${currentFloorObj.floor} 도면`;
    mapImageElem.style.display = 'block';
  } else {
    mapImageElem.src = '';
    mapImageElem.alt = '도면 준비 중';
    mapImageElem.style.display = 'none';
  }
}

document.addEventListener('DOMContentLoaded', loadMapData);
