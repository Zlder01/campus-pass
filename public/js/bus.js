// public/js/bus.js

// 1. 실시간 버스 도착 데이터 요청
async function fetchBusArrivals() {
  try {
    const response = await fetch('/api/bus-arrivals');
    if (!response.ok) throw new Error('API 응답 에러');
    const data = await response.json();
    updateBusUI(data);
  } catch (error) {
    console.error('버스 도착 정보 로드 실패:', error);
    // API 연결 실패 시 기본 예외 처리
    updateBusUI([]);
  }
}

// 2. 심야 시간대 및 유효성 검증
function isValidData(busData) {
  const currentHour = new Date().getHours();

  // 새벽 01시 ~ 05시 사이 도착 정보는 차고지 복귀 데이터로 간주해 무시
  if (currentHour >= 1 && currentHour < 5) {
    return false;
  }

  if (!busData || !busData.predictTime1 || busData.predictTime1 <= 0) {
    return false;
  }

  if (busData.flag === 'STOP' || busData.flag === 'END') {
    return false;
  }

  return true;
}

// 3. UI 안전 업데이트
function updateBusUI(arrivalList) {
  // 노선 목록 정의
  const routes = ['M5107', '5100', '1112', '7000', '1560', '9'];

  // dynamic-list 방식과 static-item 방식 모두 대응
  const busContainer = document.querySelector('.bus-list') || document.getElementById('busListContainer');

  // 만약 컨테이너 안에 이미 개별 엘리먼트들이 지정되어 있는 경우
  routes.forEach(routeName => {
    const busItem = arrivalList.find(item => item.routeId === routeName || item.routeName === routeName);
    const isValid = isValidData(busItem);

    // ID나 클래스로 특정 노선 영역 찾기
    const targetElem = document.getElementById(`bus-${routeName.toLowerCase()}`) || 
                       document.querySelector(`.bus-item[data-route="${routeName}"]`);

    if (targetElem) {
      const statusElem = targetElem.querySelector('.bus-status') || targetElem.querySelector('.arrival-info');
      if (statusElem) {
        if (isValid) {
          const min = busItem.predictTime1;
          const next = busItem.predictTime2 ? `다음 ${busItem.predictTime2}분` : '';
          statusElem.innerHTML = `<span class="time-main">${min}분</span> ${next ? `<span class="time-sub">${next}</span>` : ''}`;
        } else {
          statusElem.innerHTML = `<span class="status-end">운행종료</span>`;
        }
      }
    }
  });

  // 동적으로 전체 리스트를 새로 그리는 구조일 경우
  if (busContainer && busContainer.children.length === 0) {
    busContainer.innerHTML = routes.map(routeName => {
      const busItem = arrivalList.find(item => item.routeId === routeName || item.routeName === routeName);
      const isValid = isValidData(busItem);

      let statusHtml = isValid 
        ? `<span class="time-main">${busItem.predictTime1}분</span>` 
        : `<span class="status-end">운행종료</span>`;

      return `
        <div class="bus-item" id="bus-${routeName.toLowerCase()}">
          <div class="bus-info">
            <span class="bus-badge">${routeName}</span>
            <span class="bus-dir">사색의 광장 방면</span>
          </div>
          <div class="bus-status">${statusHtml}</div>
        </div>
      `;
    }).join('');
  }
}

// 4. 초기화
function initBusModule() {
  fetchBusArrivals();

  const refreshBtn = document.getElementById('refreshBusBtn') || document.querySelector('.btn-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', fetchBusArrivals);
  }

  setInterval(fetchBusArrivals, 5000);
}

document.addEventListener('DOMContentLoaded', initBusModule);
