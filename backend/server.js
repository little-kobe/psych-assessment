// backend/server.js
const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");

const app = express();
app.use(cors()); // 允许前端跨域请求
app.use(express.json()); // 让 Express 能解析前端发来的 JSON 数据

// 数据库连接配置——把下面的 password 换成你装 MySQL 时设置的 root 密码
const dbConfig = {
  host: "localhost",
  user: "root",
  password: "xinli0824",
  database: "psych_assessment",
};

// 测试接口：浏览器直接访问 http://localhost:3000 看到这句话说明后端启动成功
app.get("/", (req, res) => {
  res.send("心理测评后端服务运行中");
});

// 核心接口：接收前端提交的答题数据
app.post("/api/submit", async (req, res) => {
  const { answer_value, start_time, end_time } = req.body;
  const duration_ms = end_time - start_time; // 计算停留时长（毫秒）

  try {
    const connection = await mysql.createConnection(dbConfig);
    const sql = `INSERT INTO responses (answer_value, duration_ms, submitted_at) VALUES (?, ?, NOW())`;
    await connection.execute(sql, [answer_value, duration_ms]);
    await connection.end();

    res.json({ success: true, message: "提交成功", duration_ms });
  } catch (err) {
    console.error("数据库写入失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`后端服务已启动，访问 http://localhost:${PORT}`);
});
