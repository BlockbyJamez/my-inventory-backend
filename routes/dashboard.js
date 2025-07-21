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

export default router;
