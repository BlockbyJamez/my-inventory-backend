import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import nodemailer from "nodemailer";
import timeout from "connect-timeout";
import bcrypt from "bcrypt";
import "./init_db.js";
import pool from "./db.js";
import upload from "./upload.js";
import { logAction } from "./log.js";
import dotenv from "dotenv";
dotenv.config();

console.log("已連接 PostgreSQL");

const app = express();
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});

app.use(
  cors({
    origin: ["https://blockbyjamez.github.io"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-username", "x-role"],
    credentials: true,
  })
);
app.use(express.json());
app.use(timeout("10s"));

const uploadDir = "uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}
app.use("/uploads", express.static(uploadDir));

app.get("/ping", (req, res) => {
  res.send("pong");
});

function checkAdmin(req, res, next) {
  try {
    const role = req.headers["x-role"];
    if (role !== "admin") {
      return res.status(403).json({ error: "只有管理員可執行此操作" });
    }
    next();
  } catch (err) {
    next(err);
  }
}

// === Product APIs ===
app.get("/products", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM products ORDER BY id`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/products/:id", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM products WHERE id = $1`, [
      req.params.id,
    ]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/products", checkAdmin, async (req, res) => {
  const { name, stock, price, category, description, image } = req.body;
  const username = req.headers["x-username"] || "unknown";

  try {
    const insertQuery = `
      INSERT INTO products (name, stock, price, category, description, image)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `;
    const result = await pool.query(insertQuery, [
      name,
      stock,
      price,
      category,
      description,
      image,
    ]);
    const id = result.rows[0].id;

    await logAction(username, "add_product", { id, name });

    res.status(201).json({
      id,
      name,
      stock,
      price,
      category,
      description,
      image,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/products/:id", checkAdmin, async (req, res) => {
  const { name, stock, price, category, description, image } = req.body;
  const username = req.headers["x-username"] || "unknown";

  try {
    const result = await pool.query(
      `
      UPDATE products
      SET name = $1, stock = $2, price = $3, category = $4, description = $5, image = $6
      WHERE id = $7
      RETURNING *
    `,
      [name, stock, price, category, description, image, req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    await logAction(username, "update_product", {
      id: Number(req.params.id),
      name,
      stock,
      price,
      category,
      description,
      image,
    });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/products/:id", checkAdmin, async (req, res) => {
  const username = req.headers["x-username"] || "unknown";

  try {
    const result = await pool.query(`DELETE FROM products WHERE id = $1`, [
      req.params.id,
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    await logAction(username, "delete_product", {
      id: Number(req.params.id),
    });

    res.json({ id: Number(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/upload", upload.single("image"), async (req, res) => {
  if (!req.file || !req.file.path) {
    return res.status(400).json({ error: "圖片上傳失敗" });
  }

  const imageUrl = req.file.path;

  const username = req.headers["x-username"] || "unknown";
  await logAction(username, "upload_image", { imageUrl });

  res.json({ imageUrl });
});

// === Auth APIs ===
app.post("/api/login", async (req, res) => {
  console.log("收到登入請求:", req.body);
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "帳號與密碼不得為空" });

  try {
    const result = await pool.query(`SELECT * FROM users WHERE username = $1`, [
      username,
    ]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "帳號或密碼錯誤" });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "帳號或密碼錯誤" });
    }

    await logAction(username, "login_success", { username });
    res.json({ success: true, username: user.username, role: user.role });
  } catch (err) {
    console.error("登入錯誤：", err);
    res.status(500).json({ error: "伺服器錯誤" });
  }
});

app.post("/api/send-code", async (req, res) => {
  const { username, email } = req.body;
  if (!username || !email)
    return res.status(400).json({ error: "請提供帳號與信箱" });

  try {
    const exists = await pool.query(`SELECT 1 FROM users WHERE username = $1`, [
      username,
    ]);
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: "帳號已存在" });
    }

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
      from: '"MY系統" <danny90628@gmail.com>',
      to: email,
      subject: "註冊驗證碼",
      text: `您好，您的註冊驗證碼為：${code}，3 分鐘內有效。\n帳號：${username}`,
    };

    transporter.sendMail(mailOptions, async (error) => {
      if (error) {
        console.error("寄信失敗", error);
        return res.status(500).json({ error: "無法發送驗證信" });
      }

      await pool.query(
        `
        INSERT INTO users (username, email, email_verification_code, email_code_expires, role)
        VALUES ($1, $2, $3, $4, 'viewer')
        ON CONFLICT (username) DO UPDATE
        SET email = EXCLUDED.email,
            email_verification_code = EXCLUDED.email_verification_code,
            email_code_expires = EXCLUDED.email_code_expires
      `,
        [username, email, code, expires]
      );

      await logAction(username, "send_register_code", { email });
      res.json({ message: "驗證碼已發送至信箱" });
    });
  } catch (err) {
    console.error("寄送驗證碼失敗：", err);
    res.status(500).json({ error: "寄送驗證碼失敗" });
  }
});

app.post("/api/register", async (req, res) => {
  const { username, password, email, code } = req.body;
  if (!username || !password || !email || !code)
    return res.status(400).json({ error: "請填寫完整資訊" });

  try {
    const result = await pool.query(
      `
      SELECT * FROM users
      WHERE username = $1 AND email = $2 AND email_verification_code = $3 AND email_code_expires > $4
    `,
      [username, email, code, Date.now()]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "驗證碼錯誤或已過期" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      `
      UPDATE users
      SET password = $1,
          email_verification_code = NULL,
          email_code_expires = NULL
      WHERE username = $2
    `,
      [hashedPassword, username]
    );

    await logAction(username, "register_user", { email });
    res.status(201).json({ success: true, message: "註冊成功" });
  } catch (err) {
    console.error("註冊失敗：", err);
    res.status(500).json({ error: "註冊失敗" });
  }
});

app.post("/api/forgot-password", async (req, res) => {
  const { identifier } = req.body;
  if (!identifier) return res.status(400).json({ error: "請提供帳號" });

  try {
    const result = await pool.query(`SELECT * FROM users WHERE username = $1`, [
      identifier,
    ]);
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
        `
        UPDATE users
        SET email_verification_code = $1, email_code_expires = $2
        WHERE id = $3
      `,
        [code, expires, user.id]
      );

      await logAction(user.username, "send_verification_code", {
        email: user.email,
      });

      res.json({ message: "已發送驗證碼至註冊信箱" });
    });
  } catch (err) {
    res.status(500).json({ error: "查詢使用者失敗" });
  }
});

app.post("/api/verify-code", async (req, res) => {
  const { username, code } = req.body;
  if (!username || !code)
    return res.status(400).json({ error: "缺少帳號或驗證碼" });

  try {
    const result = await pool.query(
      `
      SELECT * FROM users
      WHERE username = $1 AND email_verification_code = $2 AND email_code_expires > $3
    `,
      [username, code, Date.now()]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "驗證碼錯誤或已過期" });
    }

    res.json({ message: "驗證成功，請繼續設定新密碼", token: code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/reset-password", async (req, res) => {
  const { code, newPassword } = req.body;
  if (!code || !newPassword)
    return res.status(400).json({ error: "缺少驗證碼或新密碼" });

  try {
    const result = await pool.query(
      `
      SELECT * FROM users
      WHERE email_verification_code = $1 AND email_code_expires > $2
    `,
      [code, Date.now()]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "驗證碼錯誤或已過期" });
    }

    const userId = result.rows[0].id;
    const username = result.rows[0].username;

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `
      UPDATE users
      SET password = $1,
          email_verification_code = NULL,
          email_code_expires = NULL
      WHERE id = $2
    `,
      [hashedPassword, userId]
    );

    await logAction(username, "reset_password");
    res.json({ message: "密碼重設成功，請重新登入" });
  } catch (err) {
    console.error("密碼重設失敗：", err);
    res.status(500).json({ error: "更新密碼失敗" });
  }
});

// === Logs API ===
app.get("/logs", checkAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, username, action, details, timestamp
      FROM logs
      ORDER BY timestamp DESC
      LIMIT 100
    `
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "查詢失敗" });
  }
});

app.post("/transactions", checkAdmin, async (req, res) => {
  const { product_id, type, quantity, note } = req.body;
  const operator = req.headers["x-username"] || "unknown";

  if (!product_id || !type || !quantity || !["in", "out"].includes(type)) {
    return res.status(400).json({ error: "參數錯誤" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const productResult = await client.query(
      `SELECT name, stock FROM products WHERE id = $1`,
      [product_id]
    );

    if (productResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "商品不存在" });
    }

    const productName = productResult.rows[0].name;

    if (type === "out" && productResult.rows[0].stock < quantity) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "庫存不足" });
    }

    const updateQuery =
      type === "in"
        ? `UPDATE products SET stock = stock + $1 WHERE id = $2`
        : `UPDATE products SET stock = stock - $1 WHERE id = $2`;
    await client.query(updateQuery, [quantity, product_id]);

    const insertResult = await client.query(
      `
      INSERT INTO transactions (product_id, type, quantity, note, operator)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `,
      [product_id, type, quantity, note, operator]
    );

    await logAction(operator, "add_transaction", {
      product_id,
      type,
      quantity,
      productName,
    });

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      transaction_id: insertResult.rows[0].id,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("出入庫處理錯誤:", err);
    res.status(500).json({ error: "處理失敗" });
  } finally {
    client.release();
  }
});

app.get("/transactions", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT t.*, p.name AS product_name
      FROM transactions t
      JOIN products p ON t.product_id = p.id
      ORDER BY t.timestamp DESC
    `
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "查詢失敗" });
  }
});

// === users APIs（僅限 admin） ===
app.get("/users", checkAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, email, role FROM users`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "查詢使用者失敗" });
  }
});

app.put("/users/:id/role", checkAdmin, async (req, res) => {
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

// === 全域錯誤處理 ===
app.use((err, req, res, next) => {
  console.error("🔥 全域錯誤攔截器：", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "系統內部錯誤" });
});
