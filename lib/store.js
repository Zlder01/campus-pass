// lib/store.js
// Upstash Redis(무료 플랜: 256MB, 월 50만 명령)를 REST API로 사용. npm 패키지 없이 fetch만 씀.
// 환경변수는 Vercel 마켓플레이스 연동 시 자동으로 들어가는 이름을 둘 다 지원.

const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

export const storeEnabled = Boolean(URL_ && TOKEN);

async function command(args) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(2500),
  });
  if (!res.ok) throw new Error(`Redis HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`Redis: ${json.error}`);
  return json.result;
}

export async function getJSON(key) {
  if (!storeEnabled) return null;
  const raw = await command(['GET', key]);
  return raw ? JSON.parse(raw) : null;
}

// ttlSec: 일정 시간 갱신이 없으면 자동 삭제 (폴링이 멈췄을 때 오래된 위치가 남지 않도록)
export async function setJSON(key, value, ttlSec) {
  if (!storeEnabled) return;
  const args = ['SET', key, JSON.stringify(value)];
  if (ttlSec) args.push('EX', String(ttlSec));
  await command(args);
}
