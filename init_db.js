// init_db.js
import dotenv from "dotenv";
import pool from "./db.js";
import bcrypt from "bcrypt";
dotenv.config();

console.log("正在初始化 PostgreSQL 資料庫...");

async function initDB() {
  try {

    const hashedPassword = await bcrypt.hash("1234", 10);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        stock INTEGER NOT NULL,
        price REAL DEFAULT 0,
        category TEXT,
        description TEXT,
        image TEXT
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        email TEXT,
        role TEXT DEFAULT 'viewer',
        email_verification_code TEXT,
        email_code_expires BIGINT,
        reset_token TEXT,
        reset_expires BIGINT
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id),
        type TEXT CHECK(type IN ('in', 'out')) NOT NULL,
        quantity INTEGER NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        note TEXT,
        operator TEXT
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS logs (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const res = await pool.query(`SELECT COUNT(*) FROM products`);
    if (parseInt(res.rows[0].count) === 0) {
      console.log("插入預設商品資料...");

      await pool.query(`
        INSERT INTO products (name, stock, price, category, description, image)
        VALUES 
          ('MacBook Pro', 5, 45000, 'Laptop', 'Apple high-end laptop.', 'https://example.com/macbook.jpg'),
          ('iPhone 15', 10, 35000, 'Phone', 'Apple flagship smartphone.', 'https://example.com/iphone15.jpg')
      `);
    } else {
      console.log("products 資料已存在，跳過插入");
    }

    await pool.query(`
      INSERT INTO users (username, password, email, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (username) DO NOTHING
    `, ['admin', hashedPassword, 'danny90628@gmail.com', 'admin']);

    console.log("資料庫初始化完成！");
  } catch (err) {
    console.error("初始化資料庫失敗：", err);
  }
}

initDB();
