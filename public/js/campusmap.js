// public/js/campusmap.js — 국제캠퍼스 지도
//
// 데이터
//   /campus-buildings.json : scripts/scrape-khu-campus.mjs 로 경희대 캠퍼스맵에서 긁어온 33개 장소
//                            { no, name, aliases[], x, y (지도 이미지 기준 %), inMap, route, buildingIds[] }
//   /map-data.json         : 층별 안내도 데이터 (약칭·별칭을 검색어로 함께 사용, 안내도 링크 연결)
//
// 주소로 바로 열기: /campusmap.html?no=6   /campusmap.html?q=중도

const ZOOMS = [1, 1.6, 2.4, 3.2];
const FOCUS_ZOOM = 2;            // 장소 선택 시 확대 단계(인덱스)

let places = [];
let floorBuildings = {};          // buildingId → map-data 건물
let terms = [];                   // [{ key, place, kind: 'name' | 'abbr', buildingId? }]
let selected = null;
let zoomIdx = 0;
let suggestions = [];
let activeSuggest = -1;

const $ = (id) => document.getElementById(id);
const normalize = (s) => String(s || '').replace(/[\s·・:()\/]/g, '').toUpperCase();
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ───────────────────────── 데이터 ─────────────────────────

async function loadData() {
  const [pRes, fRes] = await Promise.all([
    fetch('/campus-buildings.json'),
    fetch('/map-data.json').catch(() => null),
  ]);
  if (!pRes.ok) throw new Error('campus-buildings.json 로드 실패');
  places = await pRes.json();

  if (fRes && fRes.ok) {
    for (const b of await fRes.json()) floorBuildings[b.buildingId] = b;
  }
  buildTerms();
}

function buildTerms() {
  const seen = new Set();
  const add = (key, place, kind, buildingId = null) => {
    const k = normalize(key);
    if (!k || seen.has(k + '|' + place.no)) return;
    seen.add(k + '|' + place.no);
    terms.push({ key: k, place, kind, buildingId });
  };
  for (const p of places) {
    p.aliases.forEach((a) => add(a, p, 'name'));
    for (const id of p.buildingIds) {
      const b = floorBuildings[id];
      if (!b) continue;
      add(b.buildingName, p, 'name', id);
      (b.aliases || []).forEach((a) => add(a, p, a.length <= 1 ? 'abbr' : 'name', id));
      (b.abbreviations || []).forEach((a) => add(a, p, 'abbr', id));
    }
  }
}

// ───────────────────────── 검색 ─────────────────────────
// 반환: [{ place, score, roomCode?, buildingId? }] 점수 높은 순

function search(raw) {
  const q = normalize(raw);
  if (!q) return [];

  // "6", "6번" → 번호로 찾기
  const num = q.match(/^(\d{1,2})번?$/);
  if (num) {
    const p = places.find((x) => x.no === Number(num[1]));
    return p ? [{ place: p, score: 1000 }] : [];
  }

  const best = new Map();
  const put = (place, score, roomCode, buildingId) => {
    const cur = best.get(place.no);
    if (!cur || score > cur.score) best.set(place.no, { place, score, roomCode, buildingId });
  };

  for (const t of terms) {
    if (t.key === q) put(t.place, 200 + t.key.length);
    else if (q.startsWith(t.key) && /^B?\d/.test(q.slice(t.key.length))) {
      put(t.place, 150 + t.key.length, q, t.buildingId || t.place.buildingIds[0]);   // "공101", "멀403" 같은 호실 검색
    } else if (t.kind === 'name' && t.key.startsWith(q)) put(t.place, 100 + q.length);
    else if (t.kind === 'name' && q.length >= 2 && t.key.includes(q)) put(t.place, 50 + q.length);
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.place.no - b.place.no);
}

// ───────────────────────── 지도 ─────────────────────────

function renderMarkers() {
  $('markerLayer').innerHTML = places.filter((p) => p.inMap).map((p) =>
    `<button type="button" class="cm-mk" data-no="${p.no}" style="left:${p.x}%;top:${p.y}%"
       aria-label="${escapeHtml(p.no + '. ' + p.name)}">${p.no}</button>`
  ).join('');
}

function setZoom(idx, focus) {
  const vp = $('mapViewport');
  const inner = $('mapInner');
  // 중심점 유지: focus가 없으면 현재 보이는 화면의 가운데를 기준으로
  const fx = focus ? focus.x / 100 : (vp.scrollLeft + vp.clientWidth / 2) / inner.offsetWidth;
  const fy = focus ? focus.y / 100 : (vp.scrollTop + vp.clientHeight / 2) / inner.offsetHeight;

  zoomIdx = Math.max(0, Math.min(ZOOMS.length - 1, idx));
  inner.style.width = `${ZOOMS[zoomIdx] * 100}%`;
  vp.classList.toggle('fit', zoomIdx === 0);

  requestAnimationFrame(() => {
    vp.scrollTo({
      left: inner.offsetWidth * fx - vp.clientWidth / 2,
      top: inner.offsetHeight * Math.min(fy, 1) - vp.clientHeight / 2,
      behavior: focus ? 'smooth' : 'auto',
    });
  });
}

function showBeacon(place) {
  const beacon = $('beacon');
  const edge = $('edgeHint');
  beacon.classList.remove('active');
  edge.hidden = true;
  if (!place) return;

  if (place.inMap) {
    beacon.style.left = `${place.x}%`;
    beacon.style.top = `${place.y}%`;
    void beacon.offsetWidth;                      // 애니메이션 재시작
    beacon.classList.add('active');
  } else {
    edge.style.left = `${Math.min(90, Math.max(10, place.x))}%`;
    edge.hidden = false;
  }
}

// ───────────────────────── 선택 ─────────────────────────

function selectPlace(place, roomCode = null, roomBuildingId = null) {
  selected = place;
  closeSuggest();

  document.querySelectorAll('.cm-mk.on, .cm-list button.on').forEach((el) => el.classList.remove('on'));
  if (!place) {
    showBeacon(null);
    $('infoCard').hidden = true;
    setStatus('');
    history.replaceState(null, '', location.pathname);
    return;
  }

  document.querySelector(`.cm-mk[data-no="${place.no}"]`)?.classList.add('on');
  document.querySelector(`.cm-list button[data-no="${place.no}"]`)?.classList.add('on');

  showBeacon(place);
  if (place.inMap) setZoom(FOCUS_ZOOM, place);
  else setZoom(Math.max(zoomIdx, 1), { x: place.x, y: 100 });

  renderInfo(place, roomCode, roomBuildingId);
  setStatus(roomCode ? `${roomCode} → ${place.name}` : `${place.no}. ${place.name}`);
  history.replaceState(null, '', `${location.pathname}?no=${place.no}`);
}

function renderInfo(place, roomCode, roomBuildingId) {
  $('infoCard').hidden = false;
  $('infoNo').textContent = place.no;
  $('infoName').textContent = place.name;

  const note = $('infoNote');
  note.hidden = place.inMap;
  if (!place.inMap) note.textContent = '이 장소는 지도 이미지의 아래쪽(잘린 영역)에 있어요. 경로찾기로 위치를 확인하세요.';

  const actions = [];
  if (place.route) {
    actions.push(`<a class="primary" href="${escapeHtml(place.route)}" target="_blank" rel="noopener">경로찾기 ↗</a>`);
  }
  for (const id of place.buildingIds) {
    const b = floorBuildings[id];
    if (!b) continue;
    const isRoom = roomCode && id === roomBuildingId;      // 호실 검색이면 map.html에서 그 호실까지 바로 검색
    const href = isRoom
      ? `/map.html?q=${encodeURIComponent($('placeInput').value.trim())}`
      : `/map.html?b=${encodeURIComponent(id)}`;
    const label = isRoom ? `${roomCode} 층별 안내도` : `${b.buildingName} 층별 안내도`;
    actions.push(`<a class="ghost" href="${href}">${escapeHtml(label)}</a>`);
  }
  $('infoActions').innerHTML = actions.join('');
}

function setStatus(text, isError = false) {
  const el = $('searchStatus');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

// ───────────────────────── 자동완성 ─────────────────────────

function renderSuggest(raw) {
  const list = $('suggestList');
  const input = $('placeInput');
  suggestions = search(raw).slice(0, 8);
  activeSuggest = suggestions.length ? 0 : -1;

  if (!normalize(raw)) { list.innerHTML = ''; closeSuggest(); setStatus(''); return; }
  if (!suggestions.length) {
    list.innerHTML = '';
    closeSuggest();
    setStatus('일치하는 건물·장소가 없어요', true);
    return;
  }
  setStatus('');
  list.innerHTML = suggestions.map((s, i) => `
    <li role="option" data-i="${i}" class="${i === activeSuggest ? 'active' : ''}">
      <span class="cm-no">${s.place.no}</span>
      <span>${escapeHtml(s.place.name)}</span>
      ${s.roomCode ? `<span class="sub">${escapeHtml(s.roomCode)}</span>` : (s.place.inMap ? '' : '<span class="sub">지도 밖</span>')}
    </li>`).join('');
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}

function moveSuggest(delta) {
  if (!suggestions.length) return;
  activeSuggest = (activeSuggest + delta + suggestions.length) % suggestions.length;
  document.querySelectorAll('#suggestList li').forEach((li, i) => li.classList.toggle('active', i === activeSuggest));
}

function pickSuggest(i) {
  const s = suggestions[i];
  if (!s) return;
  if (!s.roomCode) $('placeInput').value = s.place.name;
  selectPlace(s.place, s.roomCode || null, s.buildingId || null);
  $('placeInput').blur();                         // 모바일 키보드 내리기
}

function closeSuggest() {
  $('suggestList').hidden = true;
  $('placeInput').setAttribute('aria-expanded', 'false');
}

// ───────────────────────── 이벤트 ─────────────────────────

function initEvents() {
  const input = $('placeInput');
  const clearBtn = $('clearBtn');

  input.addEventListener('input', () => {
    clearBtn.hidden = !input.value;
    renderSuggest(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSuggest(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSuggest(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (!suggestions.length) renderSuggest(input.value);
      if (suggestions.length) pickSuggest(Math.max(activeSuggest, 0));
    } else if (e.key === 'Escape') closeSuggest();
  });
  input.addEventListener('focus', () => { if (input.value && !selected) renderSuggest(input.value); });

  $('suggestList').addEventListener('mousedown', (e) => {   // blur보다 먼저 처리
    const li = e.target.closest('li[data-i]');
    if (li) { e.preventDefault(); pickSuggest(Number(li.dataset.i)); }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.cm-search')) closeSuggest(); });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.hidden = true;
    selectPlace(null);
    setZoom(0);
    input.focus();
  });

  // 지도 번호 마커 / 목록 클릭
  const byNo = (no) => places.find((p) => p.no === Number(no));
  $('markerLayer').addEventListener('click', (e) => {
    const mk = e.target.closest('.cm-mk');
    if (!mk || dragMoved) return;
    const p = byNo(mk.dataset.no);
    input.value = p.name; clearBtn.hidden = false;
    selectPlace(p);
  });
  $('placeList').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-no]');
    if (!btn) return;
    const p = byNo(btn.dataset.no);
    input.value = p.name; clearBtn.hidden = false;
    selectPlace(p);
    document.querySelector('.cm-scroll').scrollTo({ top: 0, behavior: 'smooth' });
  });

  $('numToggle').addEventListener('change', (e) => $('markerLayer').classList.toggle('hidden', !e.target.checked));
  $('zoomIn').addEventListener('click', () => setZoom(zoomIdx + 1));
  $('zoomOut').addEventListener('click', () => setZoom(zoomIdx - 1));
  $('zoomReset').addEventListener('click', () => setZoom(0));

  initDragPan();
}

// PC에서 마우스로 끌어서 지도 이동 (터치는 기본 스크롤 사용)
let dragMoved = false;
function initDragPan() {
  const vp = $('mapViewport');
  let start = null;
  vp.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY, l: vp.scrollLeft, t: vp.scrollTop };
    dragMoved = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!dragMoved && Math.hypot(dx, dy) > 5) { dragMoved = true; vp.classList.add('dragging'); }
    if (dragMoved) { vp.scrollLeft = start.l - dx; vp.scrollTop = start.t - dy; }
  });
  window.addEventListener('pointerup', () => {
    start = null;
    vp.classList.remove('dragging');
    setTimeout(() => { dragMoved = false; }, 0);   // 드래그 직후 click 무시
  });
}

function renderList() {
  $('placeList').innerHTML = places.map((p) =>
    `<li><button type="button" data-no="${p.no}"><span class="n">${p.no}</span><span>${escapeHtml(p.name)}</span></button></li>`
  ).join('');
}

// ───────────────────────── 시작 ─────────────────────────

async function init() {
  try {
    await loadData();
  } catch (err) {
    console.error(err);
    setStatus('지도 데이터를 불러오지 못했어요', true);
    return;
  }
  renderMarkers();
  renderList();
  initEvents();
  setZoom(0);

  // 주소 파라미터: ?no=6 또는 ?q=공학관
  const params = new URLSearchParams(location.search);
  const no = Number(params.get('no'));
  const q = params.get('q');
  if (no) {
    const p = places.find((x) => x.no === no);
    if (p) { $('placeInput').value = p.name; $('clearBtn').hidden = false; selectPlace(p); }
  } else if (q) {
    $('placeInput').value = q; $('clearBtn').hidden = false;
    const [top] = search(q);
    if (top) selectPlace(top.place, top.roomCode || null, top.buildingId || null);
    else setStatus('일치하는 건물·장소가 없어요', true);
  }
}

document.addEventListener('DOMContentLoaded', init);
