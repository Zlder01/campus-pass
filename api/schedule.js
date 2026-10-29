// api/schedule.js
// 브라우저가 시간표를 합칠 때 필요한 정보: 오늘의 요일유형(평일/주말·공휴일) + 학습 집계
import { readLearned, todayInfo } from '../lib/schedule.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  const today = todayInfo();
  try {
    return res.status(200).json({ today, learned: await readLearned() });
  } catch (err) {
    console.warn('학습 시간표 읽기 실패:', err.message);
    return res.status(200).json({ today, learned: {} });
  }
}
