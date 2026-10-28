// public/js/map.js

let mapData = [];
let currentBuilding = null;
let currentFloorObj = null;

// 1. map-data.json 불러오기 (경로 2중 방어 처리)
async function loadMapData() {
  try {
    let res = await fetch('/data/map-data.json');
    if (!res.ok) {
      // /data/ 폴더에 없을 경우 루트 경로 시도
      res = await fetch('/map-data.json');
    }
    
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);

    mapData = await res.json();
    initBuildingSelect();
  } catch (err) {
    console.error('지도 데이터를 불러오는 중 오류 발생:', err);
    alert('지도 데이터를 불러오지 못했습니다. map-data.json 경로를 확인해 주세요.');
  }
}

// 2. 건물 드롭다운 초기화
function initBuildingSelect() {
  const buildingSelect = document.getElementById('buildingSelect');
  if (!buildingSelect || !mapData.length) return;

  buildingSelect.innerHTML = mapData.map(b => 
    `<option value="${b.buildingId}">${b.buildingName}</option>`
  ).join('');

  // 첫 번째 건물 자동 선택
  selectBuilding(mapData[0].buildingId);

  buildingSelect.addEventListener('change', (e) => {
    selectBuilding(e.target.value);
  });
}

// 3. 건물 선택 처리
function selectBuilding(buildingId) {
  currentBuilding = mapData.find(b => b.buildingId === buildingId);
  if (!currentBuilding) return;

  // 1층을 우선 선택하고, 없으면 첫 번째 층을 기본 선택
  if (currentBuilding.floors && currentBuilding.floors.length > 0) {
    const defaultFloor = currentBuilding.floors.find(f => f.floor === '1F');
    currentFloorObj = defaultFloor || currentBuilding.floors[0];
  } else {
    currentFloorObj = null;
  }

  renderFloorButtons();
  updateFloorPlanImage();
}

// 4. 층 버튼 목록 생성
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

// 6. 도면 이미지 업데이트
function updateFloorPlanImage() {
  const mapImageElem = document.getElementById('floorPlanImg');
  if (!mapImageElem) return;

  if (currentFloorObj && currentFloorObj.mapImage) {
    mapImageElem.src = currentFloorObj.mapImage;
    mapImageElem.alt = `${currentBuilding.buildingName} ${currentFloorObj.floor} 도면`;
    mapImageElem.style.display = 'block';

    mapImageElem.onerror = function() {
      console.error('이미지 로드 실패:', currentFloorObj.mapImage);
      this.style.display = 'none';
      alert(`도면 이미지를 불러올 수 없습니다.\n경로: ${currentFloorObj.mapImage}`);
    };
  } else {
    mapImageElem.style.display = 'none';
  }
}

document.addEventListener('DOMContentLoaded', loadMapData);
