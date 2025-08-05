import pool from "./db.js";

export async function logAction(username, action, details = null) {
  if (!username || !action) {
    console.warn("logAction 呼叫時缺少必要參數:", { username, action });
    return;
  }

  const query = `
    INSERT INTO logs (username, action, details)
    VALUES ($1, $2, $3)
  `;
  const values = [username, action, details ? JSON.stringify(details) : null];

  try {
    await pool.query(query, values);
  } catch (err) {
    console.error("操作紀錄寫入失敗:", err);
  }
}
