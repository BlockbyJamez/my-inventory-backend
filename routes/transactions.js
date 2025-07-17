// routes/transactions.js
import express from "express";
import { pool } from "../db.js";
import { checkAdmin } from "../middleware/auth.js";
import { logAction } from "../utils/log.js";

const router = express.Router();

router.post("/", checkAdmin, async (req, res) => {
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
      `INSERT INTO transactions (product_id, type, quantity, note, operator)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
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

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, p.name AS product_name
       FROM transactions t
       JOIN products p ON t.product_id = p.id
       ORDER BY t.timestamp DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "查詢失敗" });
  }
});

export default router;
