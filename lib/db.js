const mysql = require("mysql2/promise");

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || "34.44.121.67",
      user: process.env.DB_USER || "appuser",
      password: process.env.DB_PASSWORD || "your_password_here",
      database: process.env.DB_NAME || "chessdb",
      connectTimeout: 10000,
      waitForConnections: true,
      connectionLimit: 5,
    });
  }
  return pool;
}

async function query(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

module.exports = { query };
