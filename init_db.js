import path from "path";
import Database from "better-sqlite3";

const dbPath = path.resolve("MYDB.db");
console.log("目前連線的資料庫：", dbPath);
const db = new Database(dbPath);

console.log("📦 準備建立資料表...");

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    stock INTEGER NOT NULL,
    price REAL DEFAULT 0,
    category TEXT,
    description TEXT,
    image TEXT
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )
`
).run();

const userColumns = [
  { name: "email", type: "TEXT" },
  { name: "role", type: "TEXT DEFAULT 'viewer'" },
  { name: "email_verification_code", type: "TEXT" },
  { name: "email_code_expires", type: "INTEGER" },
  { name: "reset_token", type: "TEXT" },
  { name: "reset_expires", type: "INTEGER" },
];

for (const { name, type } of userColumns) {
  const row = db
    .prepare(
      `
    SELECT COUNT(*) as count FROM pragma_table_info('users') WHERE name = ?
  `
    )
    .get(name);

  if (row.count === 0) {
    try {
      db.prepare(`ALTER TABLE users ADD COLUMN ${name} ${type}`).run();
      console.log(`已新增欄位：${name}`);
    } catch (err) {
      console.error(`新增欄位 ${name} 失敗`, err);
    }
  }
}

try {
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      type TEXT CHECK(type IN ('in', 'out')) NOT NULL,
      quantity INTEGER NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      note TEXT,
      operator TEXT,
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `
  ).run();
  console.log("出入庫紀錄表 transactions 建立完成");
} catch (err) {
  console.error("建立 transactions 表失敗", err);
}

const operatorRow = db
  .prepare(
    `
  SELECT COUNT(*) as count FROM pragma_table_info('transactions') WHERE name = 'operator'
`
  )
  .get();

if (operatorRow.count === 0) {
  try {
    db.prepare(`ALTER TABLE transactions ADD COLUMN operator TEXT`).run();
    console.log("已新增欄位：operator");
  } catch (err) {
    console.error("新增 operator 欄位失敗", err);
  }
}

try {
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  ).run();
  console.log("操作記錄表 logs 建立完成");
} catch (err) {
  console.error("建立 logs 表失敗", err);
}

const productRow = db.prepare("SELECT COUNT(*) AS count FROM products").get();

if (productRow.count === 0) {
  console.log("🛒 插入預設商品資料...");

  const insertProduct = db.prepare(`
    INSERT INTO products (name, stock, price, category, description, image)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertProduct.run(
    "MacBook Pro",
    5,
    45000,
    "Laptop",
    "Apple high-end laptop.",
    "https://example.com/macbook.jpg"
  );

  insertProduct.run(
    "iPhone 15",
    10,
    35000,
    "Phone",
    "Apple flagship smartphone.",
    "https://example.com/iphone15.jpg"
  );
} else {
  console.log("products 資料已存在，跳過插入");
}

try {
  db.prepare(
    `
    INSERT OR IGNORE INTO users (username, password, email, role)
    VALUES (?, ?, ?, ?)
  `
  ).run("admin", "1234", "danny90628@gmail.com", "admin");

  console.log("預設帳號 admin 建立完成（或已存在）");
} catch (err) {
  console.error("插入預設使用者失敗", err);
}

db.close(() => {
  console.log("SQLite 初始化完成");
});
