// api/track.js
// 외부 크론(cron-job.org 등)이 1~2분마다 호출 → 버스 위치를 받아 Redis에 저장
//   호출 예: https://<도메인>/api/track?key=<TRACK_SECRET>
//   점검용:  https://<도메인>/api/track?key=<TRACK_SECRET>&debug=1  (저장된 노선·정류장·버스 상태 보기)

import { runTracker, describeTracker } from '../lib/tracker.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const secret = process.env.TRACK_SECRET;
  const given = req.query?.key || req.headers['x-track-key'];
  if (!secret || given !== secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    if (req.query?.debug) return res.status(200).json(await describeTracker());
    const result = await runTracker();
    return res.status(200).json({ ok: true, at: new Date().toISOString(), ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
