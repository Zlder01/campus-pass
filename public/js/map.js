// 강의실 및 도면 다각형 좌표 데이터
let mapData = [];

async function initMapEngine() {
  try {
    const res = await fetch('/map-data.json');
    if (res.ok) mapData = await res.json();
  } catch (e) {
    console.warn('map-data.json 로드 실패, 기본 목업 동작 사용');
  }
}

// 기본 좌표 모음 (1층 도면 비율 기준)
const DEFAULT_ROOMS = {
  "101": { name: "101호", building: "공과대학 1층", polygon: "77.2,76.8 84.8,76.8 84.8,94.6 77.2,94.6" },
  "106": { name: "106호 (대강당)", building: "공과대학 1층", polygon: "1.8,2.2 21.8,2.2 21.8,43.2 14.5,43.2 14.5,51.0 1.8,51.0" },
  "108": { name: "108호", building: "공과대학 1층", polygon: "30.1,54.2 49.2,54.2 49.2,72.8 30.1,72.8" }
};

const input = document.getElementById('roomInput');
const roomPoly = document.getElementById('roomPolygon');
const roomNameEl = document.getElementById('roomName');
const buildingNameEl = document.getElementById('buildingName');

function searchAndHighlight(query) {
  const cleanQ = query.replace(/\s+/g, '').replace('공대', '').replace('공', '');
  const result = DEFAULT_ROOMS[cleanQ];

  if (result) {
    roomPoly.setAttribute('points', result.polygon);
    roomNameEl.textContent = result.name;
    buildingNameEl.textContent = result.building;
  } else {
    roomPoly.setAttribute('points', '');
    roomNameEl.textContent = '검색 결과 없음';
  }
}

input.addEventListener('input', (e) => searchAndHighlight(e.target.value));

initMapEngine().then(() => searchAndHighlight(input.value));
