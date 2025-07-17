// routes/products.js
import express from "express";
import { pool } from "../db.js"; // 你的 PostgreSQL 連線池
import { checkAdmin } from "../middleware/auth.js"; // 假設你已拆出 auth middleware
import upload from "./upload.js"; // multer + cloudinary 上傳模組
import { logAction } from "../utils/log.js"; // action log 工具

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM products ORDER BY id`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
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

router.post("/", checkAdmin, async (req, res) => {
  const { name, stock, price, category, description, image } = req.body;
  const username = req.headers["x-username"] || "unknown";

  try {
    const result = await pool.query(
      `INSERT INTO products (name, stock, price, category, description, image)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [name, stock, price, category, description, image]
    );
    const id = result.rows[0].id;

    await logAction(username, "add_product", { id, name });
    res.status(201).json({ id, name, stock, price, category, description, image });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", checkAdmin, async (req, res) => {
  const { name, stock, price, category, description, image } = req.body;
  const username = req.headers["x-username"] || "unknown";

  try {
    const result = await pool.query(
      `UPDATE products
       SET name = $1, stock = $2, price = $3, category = $4, description = $5, image = $6
       WHERE id = $7 RETURNING *`,
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

router.delete("/:id", checkAdmin, async (req, res) => {
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

router.post("/upload", upload.single("image"), async (req, res) => {
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

export default router;
