import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import multer from "multer";
import path from "path";
import fs from "fs";
import nodemailer from "nodemailer";
import timeout from "connect-timeout";
import "./init_db.js";

const app = express();
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
});

app.use(cors());
app.use(express.json());
app.use(timeout("10s"));

const uploadDir = "uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage });
app.use("/uploads", express.static(uploadDir));

const dbPath = process.env.RENDER ? "/render/data/MYDB.db" : path.resolve("MYDB.db");
const db = new Database(dbPath);
console.log("使用的資料庫位置：", dbPath);

function logAction(username, action, details = null) {
  try {
    db.prepare(
      `
      INSERT INTO logs (username, action, details)
      VALUES (?, ?, ?)
    `
    ).run(username, action, details ? JSON.stringify(details) : null);
  } catch (err) {
    console.error("❌ 操作紀錄寫入失敗:", err);
  }
}

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
app.get("/products", (req, res) => {
  try {
    const rows = db.prepare(`SELECT * FROM products`).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/products/:id", (req, res) => {
  try {
    const row = db
      .prepare(`SELECT * FROM products WHERE id = ?`)
      .get(req.params.id);
    if (row) res.json(row);
    else res.status(404).json({ error: "Product not found" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/products", checkAdmin, (req, res) => {
  const { name, stock, price, category, description, image } = req.body;
  const username = req.headers["x-username"] || "unknown";

  try {
    const stmt = db.prepare(`
      INSERT INTO products (name, stock, price, category, description, image)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(name, stock, price, category, description, image);

    logAction(username, "add_product", { id: result.lastInsertRowid, name });

    res.status(201).json({
      id: result.lastInsertRowid,
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

app.put("/products/:id", checkAdmin, (req, res) => {
  const { name, stock, price, category, description, image } = req.body;
  const username = req.headers["x-username"] || "unknown";

  try {
    const stmt = db.prepare(`
      UPDATE products
      SET name = ?, stock = ?, price = ?, category = ?, description = ?, image = ?
      WHERE id = ?
    `);
    const result = stmt.run(
      name,
      stock,
      price,
      category,
      description,
      image,
      req.params.id
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    logAction(username, "update_product", {
      id: Number(req.params.id),
      name,
      stock,
      price,
      category,
      description,
      image,
    });

    res.json({
      id: Number(req.params.id),
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

app.delete("/products/:id", checkAdmin, (req, res) => {
  const username = req.headers["x-username"] || "unknown";

  try {
    const result = db
      .prepare(`DELETE FROM products WHERE id = ?`)
      .run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    logAction(username, "delete_product", { id: Number(req.params.id) });
    res.json({ id: Number(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${
    req.file.filename
  }`;
  res.json({ imageUrl });
});

// === Auth APIs ===
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "帳號與密碼不得為空" });

  try {
    const row = db
      .prepare(`SELECT * FROM users WHERE username = ? AND password = ?`)
      .get(username, password);

    if (row) {
      logAction(username, "login_success", { username });
      res.json({ success: true, username: row.username, role: row.role });
    } else {
      res.status(401).json({ error: "帳號或密碼錯誤" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/register", (req, res) => {
  const { username, password, email } = req.body;
  if (!username || !password || !email)
    return res.status(400).json({ error: "帳號、密碼與信箱不得為空" });

  try {
    const stmt = db.prepare(
      `INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, 'viewer')`
    );
    const result = stmt.run(username, password, email);

    logAction(username, "register_user", { username });
    res.status(201).json({ success: true, userId: result.lastInsertRowid });
  } catch (err) {
    if (err.message.includes("UNIQUE constraint failed")) {
      return res.status(409).json({ error: "帳號已存在" });
    }
    res.status(500).json({ error: "伺服器錯誤" });
  }
});

app.post("/api/forgot-password", (req, res) => {
  const { identifier } = req.body;
  if (!identifier) return res.status(400).json({ error: "請提供帳號" });

  try {
    const user = db
      .prepare(`SELECT * FROM users WHERE username = ?`)
      .get(identifier);
    if (!user) return res.status(404).json({ error: "查無此帳號" });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = Date.now() + 60 * 1000;

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
      text: `您好，您的驗證碼為：${code}，1 分鐘內有效。\n帳號：${user.username}`,
    };

    transporter.sendMail(mailOptions, (error) => {
      if (error) return res.status(500).json({ error: "寄信失敗" });

      db.prepare(
        `
        UPDATE users
        SET email_verification_code = ?, email_code_expires = ?
        WHERE id = ?
      `
      ).run(code, expires, user.id);

      res.json({ message: "已發送驗證碼至註冊信箱" });
    });
  } catch (err) {
    res.status(500).json({ error: "查詢使用者失敗" });
  }
});

app.post("/api/verify-code", (req, res) => {
  const { username, code } = req.body;
  if (!username || !code)
    return res.status(400).json({ error: "缺少帳號或驗證碼" });

  try {
    const user = db
      .prepare(
        `
      SELECT * FROM users
      WHERE username = ? AND email_verification_code = ? AND email_code_expires > ?
    `
      )
      .get(username, code, Date.now());

    if (!user) {
      return res.status(400).json({ error: "驗證碼錯誤或已過期" });
    }

    res.json({ message: "驗證成功，請繼續設定新密碼", token: code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/reset-password", (req, res) => {
  const { code, newPassword } = req.body;
  if (!code || !newPassword)
    return res.status(400).json({ error: "缺少驗證碼或新密碼" });

  try {
    const user = db
      .prepare(
        `
      SELECT * FROM users
      WHERE email_verification_code = ? AND email_code_expires > ?
    `
      )
      .get(code, Date.now());

    if (!user) {
      return res.status(400).json({ error: "驗證碼錯誤或已過期" });
    }

    db.prepare(
      `
      UPDATE users
      SET password = ?, email_verification_code = NULL, email_code_expires = NULL
      WHERE id = ?
    `
    ).run(newPassword, user.id);

    res.json({ message: "密碼重設成功，請重新登入" });
  } catch (err) {
    res.status(500).json({ error: "更新密碼失敗" });
  }
});

// === Logs API ===
app.get("/logs", checkAdmin, (req, res) => {
  try {
    const rows = db
      .prepare(
        `
      SELECT id, username, action, details, timestamp
      FROM logs
      ORDER BY timestamp DESC
      LIMIT 100
    `
      )
      .all();

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "查詢失敗" });
  }
});

app.post("/transactions", checkAdmin, (req, res) => {
  const { product_id, type, quantity, note } = req.body;
  const operator = req.headers["x-username"] || "unknown";

  if (!product_id || !type || !quantity || !["in", "out"].includes(type)) {
    return res.status(400).json({ error: "參數錯誤" });
  }

  try {
    const productRow = db
      .prepare(`SELECT name FROM products WHERE id = ?`)
      .get(product_id);
    const productName = productRow?.name || `ID ${product_id}`;

    const updateStmt =
      type === "in"
        ? db.prepare(`UPDATE products SET stock = stock + ? WHERE id = ?`)
        : db.prepare(
            `UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?`
          );

    const result =
      type === "in"
        ? updateStmt.run(quantity, product_id)
        : updateStmt.run(quantity, product_id, quantity);

    if (result.changes === 0) {
      return res.status(400).json({ error: "庫存不足或商品不存在" });
    }

    const insertStmt = db.prepare(`
      INSERT INTO transactions (product_id, type, quantity, note, operator)
      VALUES (?, ?, ?, ?, ?)
    `);
    const info = insertStmt.run(product_id, type, quantity, note, operator);

    logAction(operator, "add_transaction", {
      product_id,
      type,
      quantity,
      productName,
    });

    res
      .status(201)
      .json({ success: true, transaction_id: info.lastInsertRowid });
  } catch (err) {
    console.error("❌ 出入庫處理錯誤:", err);
    res.status(500).json({ error: "處理失敗" });
  }
});

app.get("/transactions", (req, res) => {
  try {
    const rows = db
      .prepare(
        `
      SELECT t.*, p.name AS product_name
      FROM transactions t
      JOIN products p ON t.product_id = p.id
      ORDER BY t.timestamp DESC
    `
      )
      .all();

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "查詢失敗" });
  }
});

// === users APIs（僅限 admin） ===
app.get("/users", checkAdmin, (req, res) => {
  try {
    const users = db
      .prepare(`SELECT id, username, email, role FROM users`)
      .all();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "查詢使用者失敗" });
  }
});

app.put("/users/:id/role", checkAdmin, (req, res) => {
  const { role } = req.body;
  const validRoles = ["admin", "viewer"];
  const currentUser = req.headers["x-username"] || "unknown";

  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: "角色不合法" });
  }

  try {
    const userRow = db
      .prepare(`SELECT username FROM users WHERE id = ?`)
      .get(req.params.id);
    if (!userRow) {
      return res.status(404).json({ error: "找不到使用者" });
    }

    if (userRow.username === currentUser && role !== "admin") {
      return res.status(403).json({ error: "不能將自己的權限改為 viewer" });
    }

    const result = db
      .prepare(`UPDATE users SET role = ? WHERE id = ?`)
      .run(role, req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: "找不到使用者" });
    }

    logAction(currentUser, "update_permissions", {
      username: userRow.username,
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
