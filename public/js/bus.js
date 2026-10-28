// public/js/bus.js

// 버스 노선 기본 데이터
const BUS_ROUTES = [
  { id: 'M5107', name: 'M5107', direction: '사색의 광장 방면', badgeClass: 'm5107' },
  { id: '5100',  name: '5100',  direction: '사색의 광장 방면', badgeClass: 'r5100' },
  { id: '1112',  name: '1112',  direction: '사색의 광장 방면', badgeClass: 'r1112' },
  { id: '7000',  name: '7000',  direction: '사색의 광장 방면', badgeClass: 'r7000' },
  { id: '1560',  name: '1560',  direction: '사색의 광장 방면', badgeClass: 'r1560' },
  { id: '9',     name: '9',     direction: '사색의 광장 방면', badgeClass: 'g9' }
];

// 1. 실시간 버스 도착 정보 가져오기
async function fetchBusArrivals() {
  try {
    const response = await fetch('/api/bus-arrivals');
    if (!response.ok) throw new Error('API 응답 오류');
    const data = await response.json();
    renderBusList(data);
  } catch (error) {
    console.error('버스 도착 정보를 불러오는 중 실패했습니다:', error);
    renderBusList([]);
  }
}

// 2. 심야 시간대 및 차고지 복귀 차량 예외 검증
function isValidArrivalData(busData) {
  const currentHour = new Date().getHours();

  // 심야 막차 이후 시간대 (01:00 ~ 05:00) 도착 데이터 무시
  if (currentHour >= 1 && currentHour < 5) {
    return false;
  }

  // API 응답 데이터 유효성 검사
  if (!busData || !busData.predictTime1 || busData.predictTime1 <= 0) {
    return false;
  }

  if (busData.flag === 'STOP' || busData.flag === 'END') {
    return false;
  }

  return true;
}

// 3. 버스 리스트 UI 렌더링 (기존 HTML 구조 100% 보존)
function renderBusList(arrivalDataList) {
  // 메인 버스 리스트 컨테이너
  const busContainer = document.querySelector('.bus-list') || document.getElementById('busListContainer');
  if (!busContainer) return;

  busContainer.innerHTML = BUS_ROUTES.map(route => {
    const arrivalInfo = arrivalDataList.find(item => item.routeId === route.id || item.routeName === route.name);
    const hasValidData = isValidArrivalData(arrivalInfo);

    let arrivalHtml = '';
    if (hasValidData) {
      const minutes = arrivalInfo.predictTime1;
      const nextBus = arrivalInfo.predictTime2 ? `다음 ${arrivalInfo.predictTime2}분` : '';

      arrivalHtml = `
        <div class="arrival-info">
          <span class="time-main">${minutes}분</span>
          ${nextBus ? `<span class="time-sub">${nextBus}</span>` : ''}
        </div>
      `;
    } else {
      arrivalHtml = `<span class="status-end">운행종료</span>`;
    }

    return `
      <div class="bus-card">
        <div class="bus-badge ${route.badgeClass}">${route.name}</div>
        <div class="bus-dir-info">
          <span class="dir-text">${route.direction}</span>
        </div>
        <div class="bus-arrival">
          ${arrivalHtml}
        </div>
      </div>
    `;
  }).join('');
}

// 4. 초기화 및 5초 간격 자동 새로고침
function initBusModule() {
  fetchBusArrivals();

  const refreshBtn = document.getElementById('refreshBusBtn') || document.querySelector('.btn-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      fetchBusArrivals();
    });
  }

  setInterval(fetchBusArrivals, 5000);
}

document.addEventListener('DOMContentLoaded', initBusModule);
