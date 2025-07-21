// routes/dashboard.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

router.get("/summary", async (req, res) => {
  try {
    const [
      productCount,
      totalStock,
      todayTxnCount,
      todayStockIn,
      todayStockOut,
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM products`),
      pool.query(`SELECT SUM(stock) FROM products`),
      pool.query(`SELECT COUNT(*) FROM transactions WHERE DATE(timestamp) = CURRENT_DATE`),
      pool.query(`SELECT SUM(quantity) FROM transactions WHERE type = 'in' AND DATE(timestamp) = CURRENT_DATE`),
      pool.query(`SELECT SUM(quantity) FROM transactions WHERE type = 'out' AND DATE(timestamp) = CURRENT_DATE`),
    ]);

    res.json({
      productCount: Number(productCount.rows[0].count),
      totalStock: Number(totalStock.rows[0].sum) || 0,
      todayTxnCount: Number(todayTxnCount.rows[0].count),
      todayStockIn: Number(todayStockIn.rows[0].sum) || 0,
      todayStockOut: Number(todayStockOut.rows[0].sum) || 0,
    });
  } catch (err) {
    console.error("Dashboard summary 錯誤：", err);
    res.status(500).json({ error: "儀表板統計查詢失敗" });
  }
});

router.get("/weekly-summary", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('day', timestamp), 'MM-DD') AS date,
        SUM(CASE WHEN type = 'in' THEN quantity ELSE 0 END) AS stockin,
        SUM(CASE WHEN type = 'out' THEN quantity ELSE 0 END) AS stockout
      FROM transactions
      WHERE timestamp >= CURRENT_DATE - INTERVAL '6 days'
      GROUP BY DATE_TRUNC('day', timestamp)
      ORDER BY DATE_TRUNC('day', timestamp)
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("Weekly summary 錯誤：", err);
    res.status(500).json({ error: "近 7 日統計查詢失敗" });
  }
});

export default router;
