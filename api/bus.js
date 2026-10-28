const STOPS = {
  'main-gate':   { ko: '경희대정문',           en: 'Main Gate',        dir: 'in',  id: '228000707' },
  'foreign':     { ko: '외국어대학',           en: 'Foreign Lang',     dir: 'in',  id: '228000701' },
  'lifesci':     { ko: '생명과학대',           en: 'Life Sciences',    dir: 'in',  id: '228000702' },
  'square':      { ko: '사색의광장',           en: 'Square of Thought',dir: 'out', id: '228000703' },
  'lifesci-ind': { ko: '생명과학대·산업대학', en: 'Life & Applied',   dir: 'out', id: '228000704' },
  'pe-foreign':  { ko: '경희대체육대학·외대', en: 'Physical Ed & For', dir: 'out', id: '228000708' }
};

const ROUTES = new Set(['M5107', '9', '5100', '1112', '7000', '1560']);
const API_URL = 'https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalListv2';

const num = (v) => (v === '' || v == null ? null : Number(v));

async function fetchStop(key) {
  const s = STOPS[key];
  const apiKey = process.env.BUS_API_KEY;
  const url = `${API_URL}?serviceKey=${apiKey}&stationId=${s.id}&format=json`;

  const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
  
  const json = await res.json();
  let list = json?.response?.msgBody?.busArrivalList ?? [];
  if (!Array.isArray(list)) list = [list];

  return {
    id: key,
    stationId: s.id,
    dir: s.dir,
    name: { ko: s.ko, en: s.en },
    arrivals: list
      .filter((b) => ROUTES.has(String(b.routeName)))
      .map((b) => ({
        route: String(b.routeName),
        dest: {
          ko: s.dir === 'in' ? '사색의 광장 방면' : '정문/차고지 방면',
          en: s.dir === 'in' ? 'Inbound' : 'Outbound'
        },
        t1: num(b.predictTime1),
        t2: num(b.predictTime2)
      }))
  };
}

export default async function handler(req, res) {
  const origin = process.env.ALLOW_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const fetchedAt = Date.now();
  const keys = Object.keys(STOPS);

  const results = await Promise.allSettled(keys.map(fetchStop));

  const stops = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    const s = STOPS[keys[i]];
    return {
      id: keys[i],
      stationId: s.id,
      dir: s.dir,
      name: { ko: s.ko, en: s.en },
      arrivals: []
    };
  });

  res.status(200).json({ fetchedAt, stops });
}
