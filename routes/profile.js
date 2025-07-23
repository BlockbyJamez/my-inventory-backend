// routes/profile.js
import express from "express";
import bcrypt from "bcrypt";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { logAction } from "../log.js";

const router = express.Router();

// PUT /profile/change-password
router.put("/change-password", authMiddleware, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const username = req.user.username;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: "請填寫完整欄位" });
  }

  try {
    const result = await pool.query(
      `SELECT password FROM users WHERE username = $1`,
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "找不到使用者" });
    }

    const isMatch = await bcrypt.compare(oldPassword, result.rows[0].password);
    if (!isMatch) {
      return res.status(401).json({ error: "舊密碼錯誤" });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query(
      `UPDATE users SET password = $1 WHERE username = $2`,
      [hashed, username]
    );

    await logAction(username, "change_password");
    res.json({ message: "密碼修改成功" });
  } catch (err) {
    console.error("密碼變更失敗", err);
    res.status(500).json({ error: "伺服器錯誤" });
  }
});

export default router;
