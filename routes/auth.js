// routes/auth.js
import express from "express";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import { pool } from "../db.js";
import { logAction } from "../log.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "帳號與密碼不得為空" });

  try {
    const result = await pool.query(`SELECT * FROM users WHERE username = $1`, [username]);

    if (result.rows.length === 0) return res.status(401).json({ error: "帳號或密碼錯誤" });

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: "帳號或密碼錯誤" });

    await logAction(username, "login_success", { username });
    res.json({ success: true, username: user.username, role: user.role });
  } catch (err) {
    res.status(500).json({ error: "伺服器錯誤" });
  }
});

router.post("/send-code", async (req, res) => {
  const { username, email } = req.body;
  if (!username || !email)
    return res.status(400).json({ error: "請提供帳號與信箱" });

  try {
    const exists = await pool.query(`SELECT 1 FROM users WHERE username = $1`, [username]);
    if (exists.rows.length > 0) return res.status(409).json({ error: "帳號已存在" });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = Date.now() + 3 * 60 * 1000;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "danny90628@gmail.com",
        pass: "dnndvufcudqjdckn", // ❗記得上線時抽成 .env
      },
    });

    const mailOptions = {
      from: '"MY系統" <danny90628@gmail.com>',
      to: email,
      subject: "註冊驗證碼",
      text: `您好，您的註冊驗證碼為：${code}，3 分鐘內有效。\n帳號：${username}`,
    };

    transporter.sendMail(mailOptions, async (error) => {
      if (error) return res.status(500).json({ error: "無法發送驗證信" });

      await pool.query(
        `INSERT INTO users (username, email, email_verification_code, email_code_expires, role)
         VALUES ($1, $2, $3, $4, 'viewer')
         ON CONFLICT (username) DO UPDATE
         SET email = EXCLUDED.email,
             email_verification_code = EXCLUDED.email_verification_code,
             email_code_expires = EXCLUDED.email_code_expires`,
        [username, email, code, expires]
      );

      await logAction(username, "send_register_code", { email });
      res.json({ message: "驗證碼已發送至信箱" });
    });
  } catch (err) {
    res.status(500).json({ error: "寄送驗證碼失敗" });
  }
});

router.post("/register", async (req, res) => {
  const { username, password, email, code } = req.body;
  if (!username || !password || !email || !code)
    return res.status(400).json({ error: "請填寫完整資訊" });

  try {
    const result = await pool.query(
      `SELECT * FROM users
       WHERE username = $1 AND email = $2 AND email_verification_code = $3 AND email_code_expires > $4`,
      [username, email, code, Date.now()]
    );

    if (result.rows.length === 0)
      return res.status(400).json({ error: "驗證碼錯誤或已過期" });

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      `UPDATE users
       SET password = $1,
           email_verification_code = NULL,
           email_code_expires = NULL
       WHERE username = $2`,
      [hashedPassword, username]
    );

    await logAction(username, "register_user", { email });
    res.status(201).json({ success: true, message: "註冊成功" });
  } catch (err) {
    res.status(500).json({ error: "註冊失敗" });
  }
});

router.post("/forgot-password", async (req, res) => {
  const { identifier } = req.body;
  if (!identifier) return res.status(400).json({ error: "請提供帳號" });

  try {
    const result = await pool.query(`SELECT * FROM users WHERE username = $1`, [identifier]);
    if (result.rows.length === 0)
      return res.status(404).json({ error: "查無此帳號" });

    const user = result.rows[0];
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = Date.now() + 3 * 60 * 1000;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "danny90628@gmail.com",
        pass: "dnndvufcudqjdckn",
      },
    });

    const mailOptions = {
      from: '"MY系統客服" <danny90628@gmail.com>',
      to: user.email,
      subject: "密碼重設驗證碼",
      text: `您好，您的驗證碼為：${code}，3 分鐘內有效。\n帳號：${user.username}`,
    };

    transporter.sendMail(mailOptions, async (error) => {
      if (error) return res.status(500).json({ error: "寄信失敗" });

      await pool.query(
        `UPDATE users
         SET email_verification_code = $1, email_code_expires = $2
         WHERE id = $3`,
        [code, expires, user.id]
      );

      await logAction(user.username, "send_verification_code", { email: user.email });
      res.json({ message: "已發送驗證碼至註冊信箱" });
    });
  } catch (err) {
    res.status(500).json({ error: "查詢使用者失敗" });
  }
});

router.post("/verify-code", async (req, res) => {
  const { username, code } = req.body;
  if (!username || !code)
    return res.status(400).json({ error: "缺少帳號或驗證碼" });

  try {
    const result = await pool.query(
      `SELECT * FROM users
       WHERE username = $1 AND email_verification_code = $2 AND email_code_expires > $3`,
      [username, code, Date.now()]
    );

    if (result.rows.length === 0)
      return res.status(400).json({ error: "驗證碼錯誤或已過期" });

    res.json({ message: "驗證成功，請繼續設定新密碼", token: code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/reset-password", async (req, res) => {
  const { code, newPassword } = req.body;
  if (!code || !newPassword)
    return res.status(400).json({ error: "缺少驗證碼或新密碼" });

  try {
    const result = await pool.query(
      `SELECT * FROM users
       WHERE email_verification_code = $1 AND email_code_expires > $2`,
      [code, Date.now()]
    );

    if (result.rows.length === 0)
      return res.status(400).json({ error: "驗證碼錯誤或已過期" });

    const userId = result.rows[0].id;
    const username = result.rows[0].username;

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `UPDATE users
       SET password = $1,
           email_verification_code = NULL,
           email_code_expires = NULL
       WHERE id = $2`,
      [hashedPassword, userId]
    );

    await logAction(username, "reset_password");
    res.json({ message: "密碼重設成功，請重新登入" });
  } catch (err) {
    res.status(500).json({ error: "更新密碼失敗" });
  }
});

export default router;
