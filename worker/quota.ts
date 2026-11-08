import { HttpError } from "./security.ts";
export interface Limit { key: string; amount: number; max: number }
export function quotaStatements(db: D1Database, limits: Limit[]) {
  return limits.flatMap(({ key, amount, max }) => [
    db.prepare("INSERT INTO usage_limits (key, value) VALUES (?, 0) ON CONFLICT(key) DO NOTHING").bind(key),
    db.prepare("UPDATE usage_limits SET value = CASE WHEN value + ? <= ? THEN value + ? ELSE -1 END WHERE key = ?").bind(amount, max, amount, key),
  ]);
}
export async function reserve(db: D1Database, limits: Limit[]) {
  try { await db.batch(quotaStatements(db, limits)); }
  catch { throw new HttpError(429, "안전한 저장 한도에 도달했어요. 잠시 후 다시 시도하거나 보관량을 확인해주세요."); }
}
