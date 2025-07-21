// index.js
import express from "express";
import cors from "cors";
import timeout from "connect-timeout";
import dotenv from "dotenv";
import pool from "./db.js";
import upload from "./upload.js";
import { logAction } from "./log.js";
import { checkAdmin } from "./middleware/checkauth.js";
import productRoutes from "./routes/products.js";
import authRoutes from "./routes/auth.js";
import transactionRoutes from "./routes/transactions.js";
import userRoutes from "./routes/users.js";
import dashboardRoutes from "./routes/dashboard.js";
import "./init_db.js";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
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

app.get("/ping", (req, res) => {
  res.send("pong");
});

app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file || !req.file.path) {
      return res.status(400).json({ error: "圖片上傳失敗" });
    }

    const imageUrl = req.file.path;
    const username = req.headers["x-username"] || "unknown";
    await logAction(username, "upload_image", { imageUrl });

    res.json({ imageUrl });
  } catch (err) {
    console.error("上傳錯誤：", err);
    res.status(500).json({ error: "系統錯誤" });
  }
});

app.get("/logs", checkAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, action, details, timestamp
       FROM logs
       ORDER BY timestamp DESC
       LIMIT 100`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "查詢失敗" });
  }
});

app.use("/products", productRoutes);
app.use("/api", authRoutes);
app.use("/transactions", transactionRoutes);
app.use("/users", userRoutes);
app.use("/dashboard", dashboardRoutes);

app.use((err, req, res, next) => {
  console.error("🔥 全域錯誤攔截器：", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "系統內部錯誤" });
});
