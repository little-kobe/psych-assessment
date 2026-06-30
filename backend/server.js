// backend/server.js
const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const multer = require("multer");
const XLSX = require("xlsx");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const JWT_SECRET = "woshilanqiuzhishen"; //用于加密令牌
// 验证管理员登录令牌的中间件，挂在需要登录才能访问的接口前面
function verifyAdminToken(req, res, next) {
  const authHeader = req.headers.authorization; // 前端会把token放在请求头里传过来
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ success: false, message: "未登录或登录已过期" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded; // 把解码后的信息（adminId, username, role）挂在req上，后面的接口能直接用
    next();
  } catch (err) {
    return res
      .status(401)
      .json({ success: false, message: "登录已过期，请重新登录" });
  }
}
const dbConfig = {
  host: "localhost",
  user: "root",
  password: "xinli0824",
  database: "psych_assessment",
};

app.get("/", (req, res) => {
  res.send("心理测评后端服务运行中");
});

// 旧的单题demo接口
app.post("/api/submit", async (req, res) => {
  const { answer_value, start_time, end_time } = req.body;
  const duration_ms = end_time - start_time;

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

// 获取问卷信息和题目列表
app.get("/api/questionnaire/:id", async (req, res) => {
  const questionnaireId = req.params.id;

  try {
    const connection = await mysql.createConnection(dbConfig);

    const [questionnaireRows] = await connection.execute(
      "SELECT * FROM questionnaires WHERE id = ?",
      [questionnaireId],
    );

    if (questionnaireRows.length === 0) {
      await connection.end();
      return res.status(404).json({ success: false, message: "问卷不存在" });
    }

    const [questionRows] = await connection.execute(
      "SELECT * FROM questions WHERE questionnaire_id = ? ORDER BY order_num ASC",
      [questionnaireId],
    );

    await connection.end();

    res.json({
      success: true,
      questionnaire: questionnaireRows[0],
      questions: questionRows,
    });
  } catch (err) {
    console.error("获取问卷失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 接收整份问卷的提交
app.post("/api/submission", async (req, res) => {
  const { questionnaire_id, started_at, finished_at, answers } = req.body;

  const connection = await mysql.createConnection(dbConfig);

  try {
    const [submissionResult] = await connection.execute(
      "INSERT INTO submissions (questionnaire_id, started_at, finished_at) VALUES (?, ?, ?)",
      [questionnaire_id, started_at, finished_at],
    );
    const submissionId = submissionResult.insertId;

    for (const ans of answers) {
      await connection.execute(
        "INSERT INTO answers (submission_id, question_id, answer_value, duration_ms) VALUES (?, ?, ?, ?)",
        [submissionId, ans.question_id, ans.answer_value, ans.duration_ms],
      );
    }

    await connection.end();
    res.json({
      success: true,
      message: "问卷提交成功",
      submission_id: submissionId,
    });
  } catch (err) {
    await connection.end();
    console.error("提交问卷失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 批量导入题目接口
app.post("/api/questions/import", upload.single("file"), async (req, res) => {
  const questionnaireId = req.body.questionnaire_id;

  if (!req.file) {
    return res.status(400).json({ success: false, message: "未收到文件" });
  }
  if (!questionnaireId) {
    return res
      .status(400)
      .json({ success: false, message: "缺少questionnaire_id参数" });
  }

  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet);

    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: "Excel文件为空" });
    }
    const requiredColumns = [
      "题号",
      "题目内容",
      "最低分",
      "最高分",
      "是否反向计分",
    ];
    const firstRowKeys = Object.keys(rows[0]);
    const missingColumns = requiredColumns.filter(
      (col) => !firstRowKeys.includes(col),
    );
    if (missingColumns.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Excel缺少必要列：${missingColumns.join("、")}`,
      });
    }

    const connection = await mysql.createConnection(dbConfig);

    let successCount = 0;
    const errors = [];

    for (const row of rows) {
      try {
        const orderNum = row["题号"];
        const content = row["题目内容"];
        const minScore = row["最低分"];
        const maxScore = row["最高分"];
        const isReverse = row["是否反向计分"] === "是" ? 1 : 0;

        if (!content || orderNum === undefined) {
          errors.push(`第${orderNum || "未知"}题：题号或题目内容为空，已跳过`);
          continue;
        }

        await connection.execute(
          "INSERT INTO questions (questionnaire_id, content, order_num, min_score, max_score, is_reverse_scored) VALUES (?, ?, ?, ?, ?, ?)",
          [questionnaireId, content, orderNum, minScore, maxScore, isReverse],
        );
        successCount++;
      } catch (rowErr) {
        errors.push(`第${row["题号"] || "未知"}题导入失败：${rowErr.message}`);
      }
    }

    await connection.end();

    res.json({
      success: true,
      message: `成功导入${successCount}道题`,
      total: rows.length,
      successCount,
      errors,
    });
  } catch (err) {
    console.error("导入题目失败:", err);
    res
      .status(500)
      .json({ success: false, message: "文件解析失败，请检查Excel格式" });
  }
});

// 管理员登录接口
app.post("/api/admin/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res
      .status(400)
      .json({ success: false, message: "请输入账号和密码" });
  }

  try {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute(
      "SELECT * FROM admins WHERE username = ?",
      [username],
    );
    await connection.end();

    if (rows.length === 0) {
      return res
        .status(401)
        .json({ success: false, message: "账号或密码错误" });
    }

    const admin = rows[0];
    const isMatch = await bcrypt.compare(password, admin.password_hash);

    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: "账号或密码错误" });
    }

    const token = jwt.sign(
      { adminId: admin.id, username: admin.username, role: admin.role },
      JWT_SECRET,
      { expiresIn: "24h" },
    );

    res.json({
      success: true,
      message: "登录成功",
      token,
      adminId: admin.id,
      displayName: admin.display_name,
      role: admin.role,
    });
  } catch (err) {
    console.error("登录失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

const PORT = 3000;
// 获取问卷列表，按角色过滤：导师看全部，研究者只看自己创建的
app.get("/api/questionnaires", verifyAdminToken, async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);

    let sql, params;
    if (req.admin.role === "supervisor") {
      // 导师：查所有问卷，顺带查出创建者姓名方便前端展示
      sql = `
        SELECT q.*, a.display_name AS creator_name,
          (SELECT COUNT(*) FROM questions WHERE questionnaire_id = q.id) AS question_count
        FROM questionnaires q
        LEFT JOIN admins a ON q.created_by = a.id
        ORDER BY q.created_at DESC
      `;
      params = [];
    } else {
      // 普通研究者：只查自己创建的
      sql = `
        SELECT q.*, a.display_name AS creator_name,
          (SELECT COUNT(*) FROM questions WHERE questionnaire_id = q.id) AS question_count
        FROM questionnaires q
        LEFT JOIN admins a ON q.created_by = a.id
        WHERE q.created_by = ?
        ORDER BY q.created_at DESC
      `;
      params = [req.admin.adminId];
    }

    const [rows] = await connection.execute(sql, params);
    await connection.end();

    res.json({ success: true, questionnaires: rows });
  } catch (err) {
    console.error("获取问卷列表失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 新建问卷
app.post("/api/questionnaires", verifyAdminToken, async (req, res) => {
  const { title, description, track_timing, consent_text } = req.body;

  if (!title) {
    return res
      .status(400)
      .json({ success: false, message: "问卷标题不能为空" });
  }

  try {
    const connection = await mysql.createConnection(dbConfig);
    const [result] = await connection.execute(
      "INSERT INTO questionnaires (title, description, track_timing, consent_text, created_by) VALUES (?, ?, ?, ?, ?)",
      [
        title,
        description || "",
        track_timing !== false,
        consent_text || "",
        req.admin.adminId,
      ],
    );
    await connection.end();

    res.json({ success: true, message: "问卷创建成功", id: result.insertId });
  } catch (err) {
    console.error("创建问卷失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});
app.listen(PORT, () => {
  console.log(`后端服务已启动，访问 http://localhost:${PORT}`);
});
