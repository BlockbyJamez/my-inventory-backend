// routes/users.js
import express from "express";
import pool from "../db.js";
import { checkAdmin } from "../middleware/checkauth.js";
import { logAction } from "../log.js";

const router = express.Router();

router.get("/", checkAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, email, role FROM users`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "查詢使用者失敗" });
  }
});

router.put("/:id/role", checkAdmin, async (req, res) => {
  const { role } = req.body;
  const validRoles = ["admin", "viewer"];
  const currentUser = req.headers["x-username"] || "unknown";

  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: "角色不合法" });
  }

  try {
    const result = await pool.query(
      `SELECT username FROM users WHERE id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "找不到使用者" });
    }

    const targetUsername = result.rows[0].username;

    if (targetUsername === currentUser && role !== "admin") {
      return res.status(403).json({ error: "不能將自己的權限改為 viewer" });
    }

    const updateResult = await pool.query(
      `UPDATE users SET role = $1 WHERE id = $2`,
      [role, req.params.id]
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: "找不到使用者" });
    }

    await logAction(currentUser, "update_permissions", {
      username: targetUsername,
      newRole: role,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "更新角色失敗" });
  }
});

export default router;
