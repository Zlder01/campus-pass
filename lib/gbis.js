// lib/gbis.js
// 경기버스정보(GBIS) 공공데이터 API 공통 호출부

const BASE = 'https://apis.data.go.kr/6410000';

export const kstHour = () => (new Date().getUTCHours() + 9) % 24;
export const isLateNight = () => { const h = kstHour(); return h >= 1 && h < 5; };

const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
export const num = (v) => (v === '' || v == null ? null : Number(v));

// listKey: 응답 msgBody 안의 목록 이름 (busLocationList 등)
export async function gbis(path, params, listKey, timeoutMs = 3000) {
  const key = process.env.BUS_API_KEY;
  if (!key) throw new Error('BUS_API_KEY 환경변수가 없습니다');
  const qs = new URLSearchParams({ format: 'json', ...params });
  // 서비스키는 이미 인코딩된 형태로 발급되는 경우가 많아 그대로 붙인다 (기존 api/bus.js와 동일한 방식)
  const url = `${BASE}/${path}?serviceKey=${key}&${qs}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`GBIS HTTP ${res.status} (${path})`);
  const json = await res.json();
  const header = json?.response?.msgHeader;
  const code = num(header?.resultCode);
  if (code === 4) return []; // 결과 없음 (운행 중인 차가 없을 때 등)
  if (code !== null && code !== 0) throw new Error(`GBIS ${code}: ${header?.resultMessage} (${path})`);
  return toArray(json?.response?.msgBody?.[listKey]);
}
