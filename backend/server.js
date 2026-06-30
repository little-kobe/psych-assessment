// backend/server.js
const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const multer = require("multer");
const XLSX = require("xlsx");

const upload = multer({ storage: multer.memoryStorage() }); // 文件先存内存，不落盘

const app = express();
app.use(cors());
app.use(express.json());

const dbConfig = {
  host: "localhost",
  user: "root",
  password: "xinli0824",
  database: "psych_assessment",
};

app.get("/", (req, res) => {
  res.send("心理测评后端服务运行中");
});

// 旧的单题demo接口，保留不动
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

// 新接口一：根据问卷id获取问卷信息和所有题目
app.get("/api/questionnaire/:id", async (req, res) => {
  const questionnaireId = req.params.id;

  try {
    const connection = await mysql.createConnection(dbConfig);

    // 查问卷基本信息
    const [questionnaireRows] = await connection.execute(
      "SELECT * FROM questionnaires WHERE id = ?",
      [questionnaireId],
    );

    if (questionnaireRows.length === 0) {
      await connection.end();
      return res.status(404).json({ success: false, message: "问卷不存在" });
    }

    // 查这份问卷下的所有题目，按顺序排好
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

// 新接口二：接收整份问卷的提交
app.post("/api/submission", async (req, res) => {
  // 前端会传来：questionnaire_id, started_at, finished_at, answers（数组）
  const { questionnaire_id, started_at, finished_at, answers } = req.body;

  const connection = await mysql.createConnection(dbConfig);

  try {
    // 第一步：插入一条提交记录，拿到这次提交的id
    const [submissionResult] = await connection.execute(
      "INSERT INTO submissions (questionnaire_id, started_at, finished_at) VALUES (?, ?, ?)",
      [questionnaire_id, started_at, finished_at],
    );
    const submissionId = submissionResult.insertId;

    // 第二步：循环把每道题的答案插入answers表，关联到这个submissionId
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

const PORT = 3000;
// 批量导入题目接口：接收Excel文件，解析后批量插入questions表
app.post("/api/questions/import", upload.single("file"), async (req, res) => {
  // upload.single('file') 是multer的中间件，会把上传的文件解析出来挂在req.file上

  const questionnaireId = req.body.questionnaire_id; // 前端需要同时告诉后端，这些题目归属哪份问卷

  if (!req.file) {
    return res.status(400).json({ success: false, message: "未收到文件" });
  }
  if (!questionnaireId) {
    return res
      .status(400)
      .json({ success: false, message: "缺少questionnaire_id参数" });
  }

  try {
    // 用xlsx库解析上传的Excel文件（此时文件内容在内存里，是个Buffer）
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0]; // 默认读第一个工作表
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet); // 转换成JSON数组，每行Excel变成一个对象

    // 校验：检查必要的列是否存在（用第一行数据做样本检查）
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

    // 逐行插入，遇到某一行格式错误就记录但不中断整个流程
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
app.listen(PORT, () => {
  console.log(`后端服务已启动，访问 http://localhost:${PORT}`);
});
