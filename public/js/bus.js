// public/js/bus.js

// 버스 노선 기본 데이터
const BUS_ROUTES = [
  { id: 'M5107', name: 'M5107', direction: '사색의 광장 방면' },
  { id: '5100',  name: '5100',  direction: '사색의 광장 방면' },
  { id: '1112',  name: '1112',  direction: '사색의 광장 방면' },
  { id: '7000',  name: '7000',  direction: '사색의 광장 방면' },
  { id: '1560',  name: '1560',  direction: '사색의 광장 방면' },
  { id: '9',     name: '9',     direction: '사색의 광장 방면' }
];

// 1. 실시간 버스 도착 정보 가져오기
async function fetchBusArrivals() {
  try {
    const response = await fetch('/api/bus-arrivals');
    
    if (!response.ok) {
      throw new Error('API 응답에 오류가 있습니다.');
    }

    const data = await response.json();
    renderBusList(data);
  } catch (error) {
    console.error('버스 도착 정보를 불러오는 중 실패했습니다:', error);
    // API 연결 실패 시 기본 '운행종료' 상태로 UI 표시
    renderBusList([]);
  }
}

// 2. 심야 시간대 및 차고지 복귀 차량 예외 검증 함수
function isValidArrivalData(busData) {
  const currentHour = new Date().getHours();

  // 규칙 1: 심야 막차 이후 시간대 (00:30 ~ 05:00)에는 도착 정보 무시
  if (currentHour >= 1 && currentHour < 5) {
    return false;
  }

  // 규칙 2: API 응답 내 도착 예정 시간(predictTime)이 없거나 유효하지 않은 값인 경우
  if (!busData || !busData.predictTime1 || busData.predictTime1 <= 0) {
    return false;
  }

  // 규칙 3: API 플래그가 운행중지/종료(STOP, END 등) 상태인 경우
  if (busData.flag === 'STOP' || busData.flag === 'END') {
    return false;
  }

  return true;
}

// 3. 버스 리스트 UI 렌더링
function renderBusList(arrivalDataList) {
  const busContainer = document.getElementById('busListContainer');
  if (!busContainer) return;

  busContainer.innerHTML = BUS_ROUTES.map(route => {
    // API 데이터 중 해당 노선 찾기
    const arrivalInfo = arrivalDataList.find(item => item.routeId === route.id || item.routeName === route.name);

    // 심야 및 유효성 검증
    const hasValidData = isValidArrivalData(arrivalInfo);

    // 도착 시간 및 다음 차 안내 UI 구성
    let statusHtml = '';
    if (hasValidData) {
      const minutes = arrivalInfo.predictTime1;
      const nextBus = arrivalInfo.predictTime2 ? `다음 ${arrivalInfo.predictTime2}분` : '';

      statusHtml = `
        <div class="arrival-active">
          <span class="time-main">${minutes}분</span>
          ${nextBus ? `<span class="time-sub">${nextBus}</span>` : ''}
        </div>
      `;
    } else {
      statusHtml = `<span class="status-end">운행종료</span>`;
    }

    return `
      <div class="bus-item">
        <div class="bus-info">
          <span class="bus-badge bus-${route.id.toLowerCase()}">${route.name}</span>
          <span class="bus-dir">${route.direction}</span>
        </div>
        <div class="bus-status">
          ${statusHtml}
        </div>
      </div>
    `;
  }).join('');
}

// 4. 타이머 및 자동 새로고침 (5초 간격)
function initBusModule() {
  fetchBusArrivals();

  // 새로고침 버튼 이벤트 연동
  const refreshBtn = document.getElementById('refreshBusBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      fetchBusArrivals();
    });
  }

  // 5초마다 실시간 데이터 주기적 갱신
  setInterval(fetchBusArrivals, 5000);
}

document.addEventListener('DOMContentLoaded', initBusModule);
