// backend/server.js
const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const multer = require("multer");
const XLSX = require("xlsx");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");

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

// 公共计分函数，所有报告接口复用这一个
async function calcScore(questionnaireId, submissionId, connection) {
  const [questions] = await connection.execute(
    "SELECT * FROM questions WHERE questionnaire_id = ?",
    [questionnaireId],
  );
  const questionMap = {};
  questions.forEach((q) => {
    questionMap[q.id] = q;
  });

  const [dimensions] = await connection.execute(
    "SELECT * FROM dimensions WHERE questionnaire_id = ?",
    [questionnaireId],
  );
  for (const dim of dimensions) {
    const [dqs] = await connection.execute(
      "SELECT question_id FROM dimension_questions WHERE dimension_id = ?",
      [dim.id],
    );
    dim.question_ids = dqs.map((d) => d.question_id);
  }

  const [answers] = await connection.execute(
    "SELECT * FROM answers WHERE submission_id = ?",
    [submissionId],
  );

  // 第一步：处理反向计分，只处理量表题
  const scoredAnswers = {};
  answers.forEach((ans) => {
    const q = questionMap[ans.question_id];
    if (!q) return;
    // 非量表题不参与计分
    if (q.question_type && q.question_type !== "scale") return;
    if (ans.answer_value === null || ans.answer_value === undefined) return;
    let score = Number(ans.answer_value);
    if (q.is_reverse_scored) {
      score = Number(q.max_score) + Number(q.min_score) - score;
    }
    scoredAnswers[ans.question_id] = score;
  });

  // 第二步：按维度汇总
  let totalScore = 0;
  const dimensionScores = dimensions.map((dim) => {
    const scores = dim.question_ids
      .map((qid) => scoredAnswers[qid])
      .filter((s) => s !== undefined && !isNaN(s));

    let dimScore = 0;
    if (scores.length > 0) {
      if (dim.score_formula === "mean") {
        dimScore =
          Math.round(
            (scores.reduce((a, b) => a + b, 0) / scores.length) * 100,
          ) / 100;
      } else {
        dimScore = scores.reduce((a, b) => a + b, 0);
      }
    }
    totalScore += dimScore;
    return { name: dim.name, score: dimScore, formula: dim.score_formula };
  });

  // 如果没有配置维度，直接把所有量表题分数加总
  if (dimensions.length === 0) {
    totalScore = Object.values(scoredAnswers).reduce((a, b) => a + b, 0);
  }

  totalScore = Math.round(totalScore * 100) / 100;

  return { totalScore, dimensionScores, questionMap, scoredAnswers };
}

// 公开报告接口：只返回对受测者可见的分数段评价
app.get("/api/submissions/:id/report-public", async (req, res) => {
  const submissionId = req.params.id;
  try {
    const connection = await mysql.createConnection(dbConfig);

    const [subRows] = await connection.execute(
      "SELECT * FROM submissions WHERE id = ?",
      [submissionId],
    );
    if (subRows.length === 0) {
      await connection.end();
      return res.status(404).json({ success: false, message: "不存在" });
    }
    const questionnaireId = subRows[0].questionnaire_id;

    const { totalScore } = await calcScore(
      questionnaireId,
      submissionId,
      connection,
    );

    const [rules] = await connection.execute(
      "SELECT * FROM score_rules WHERE questionnaire_id = ? AND visible_to_subject = 1 ORDER BY min_score ASC",
      [questionnaireId],
    );
    const matchedRule =
      rules.find(
        (r) =>
          totalScore >= Number(r.min_score) &&
          totalScore <= Number(r.max_score),
      ) || null;

    await connection.end();
    res.json({
      success: true,
      total_score: totalScore,
      matched_rule: matchedRule,
    });
  } catch (err) {
    console.error("获取公开报告失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
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

    const questionnaire = questionnaireRows[0];

    // 检查问卷是否已关闭
    if (!questionnaire.is_active) {
      await connection.end();
      return res.status(403).json({
        success: false,
        closed: true,
        message: "问卷已关闭，感谢您的关注",
      });
    }

    // 检查是否已过截止时间
    if (
      questionnaire.expires_at &&
      new Date() > new Date(questionnaire.expires_at)
    ) {
      await connection.end();
      return res.status(403).json({
        success: false,
        closed: true,
        message: "问卷已过截止时间，感谢您的关注",
      });
    }

    // 检查是否已达到最大回收数量
    if (questionnaire.max_responses) {
      const [countRows] = await connection.execute(
        "SELECT COUNT(*) AS total FROM submissions WHERE questionnaire_id = ?",
        [questionnaireId],
      );
      if (countRows[0].total >= questionnaire.max_responses) {
        await connection.end();
        return res.status(403).json({
          success: false,
          closed: true,
          message: "问卷已达到最大回收数量，感谢您的参与",
        });
      }
    }

    const [questionRows] = await connection.execute(
      "SELECT * FROM questions WHERE questionnaire_id = ? ORDER BY order_num ASC",
      [questionnaireId],
    );

    await connection.end();

    res.json({
      success: true,
      questionnaire,
      questions: questionRows,
    });
  } catch (err) {
    console.error("获取问卷失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 接收整份问卷的提交
app.post("/api/submission", async (req, res) => {
  const { questionnaire_id, started_at, finished_at, answers, tracking_code } =
    req.body;

  const connection = await mysql.createConnection(dbConfig);

  try {
    const [submissionResult] = await connection.execute(
      "INSERT INTO submissions (questionnaire_id, started_at, finished_at, tracking_code) VALUES (?, ?, ?, ?)",
      [questionnaire_id, started_at, finished_at, tracking_code || null],
    );
    const submissionId = submissionResult.insertId;

    for (const ans of answers) {
      await connection.execute(
        "INSERT INTO answers (submission_id, question_id, answer_value, answer_text, duration_ms) VALUES (?, ?, ?, ?, ?)",
        [
          submissionId,
          ans.question_id,
          ans.answer_value !== undefined ? ans.answer_value : null,
          ans.answer_text || null,
          ans.duration_ms,
        ],
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
app.post(
  "/api/questions/import",
  verifyAdminToken,
  upload.single("file"),
  async (req, res) => {
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
        return res
          .status(400)
          .json({ success: false, message: "Excel文件为空" });
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

      let insertCount = 0;
      let updateCount = 0;
      const errors = [];

      for (const row of rows) {
        try {
          const orderNum = row["题号"];
          const content = row["题目内容"];
          const minScore = row["最低分"];
          const maxScore = row["最高分"];
          const isReverse = row["是否反向计分"] === "是" ? 1 : 0;

          if (!content || orderNum === undefined) {
            errors.push(
              `第${orderNum || "未知"}题：题号或题目内容为空，已跳过`,
            );
            continue;
          }

          // 检查这份问卷里这个题号是否已存在
          const [existing] = await connection.execute(
            "SELECT id FROM questions WHERE questionnaire_id = ? AND order_num = ?",
            [questionnaireId, orderNum],
          );

          if (existing.length > 0) {
            // 题号已存在：覆盖更新
            await connection.execute(
              "UPDATE questions SET content = ?, min_score = ?, max_score = ?, is_reverse_scored = ? WHERE questionnaire_id = ? AND order_num = ?",
              [
                content,
                minScore,
                maxScore,
                isReverse,
                questionnaireId,
                orderNum,
              ],
            );
            updateCount++;
          } else {
            // 题号不存在：新增插入
            await connection.execute(
              "INSERT INTO questions (questionnaire_id, content, order_num, min_score, max_score, is_reverse_scored) VALUES (?, ?, ?, ?, ?, ?)",
              [
                questionnaireId,
                content,
                orderNum,
                minScore,
                maxScore,
                isReverse,
              ],
            );
            insertCount++;
          }
        } catch (rowErr) {
          errors.push(
            `第${row["题号"] || "未知"}题处理失败：${rowErr.message}`,
          );
        }
      }

      await connection.end();

      res.json({
        success: true,
        message: `导入完成：新增 ${insertCount} 道题，更新 ${updateCount} 道题`,
        insertCount,
        updateCount,
        errors,
      });
    } catch (err) {
      console.error("导入题目失败:", err);
      res
        .status(500)
        .json({ success: false, message: "文件解析失败，请检查Excel格式" });
    }
  },
);

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

// 获取单份问卷详情（含题目列表），带权限校验：研究者只能看自己的
app.get("/api/questionnaires/:id", verifyAdminToken, async (req, res) => {
  const questionnaireId = req.params.id;

  try {
    const connection = await mysql.createConnection(dbConfig);

    const [qRows] = await connection.execute(
      "SELECT q.*, a.display_name AS creator_name FROM questionnaires q LEFT JOIN admins a ON q.created_by = a.id WHERE q.id = ?",
      [questionnaireId],
    );

    if (qRows.length === 0) {
      await connection.end();
      return res.status(404).json({ success: false, message: "问卷不存在" });
    }

    const questionnaire = qRows[0];

    // 权限检查：普通研究者只能看自己创建的问卷详情
    if (
      req.admin.role !== "supervisor" &&
      questionnaire.created_by !== req.admin.adminId
    ) {
      await connection.end();
      return res
        .status(403)
        .json({ success: false, message: "没有权限查看这份问卷" });
    }

    const [questionRows] = await connection.execute(
      "SELECT * FROM questions WHERE questionnaire_id = ? ORDER BY order_num ASC",
      [questionnaireId],
    );

    await connection.end();

    res.json({ success: true, questionnaire, questions: questionRows });
  } catch (err) {
    console.error("获取问卷详情失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 导出某份问卷的所有作答数据为Excel
app.get(
  "/api/questionnaires/:id/export",
  verifyAdminToken,
  async (req, res) => {
    const questionnaireId = req.params.id;

    try {
      const connection = await mysql.createConnection(dbConfig);

      const [qRows] = await connection.execute(
        "SELECT * FROM questionnaires WHERE id = ?",
        [questionnaireId],
      );
      if (qRows.length === 0) {
        await connection.end();
        return res.status(404).json({ success: false, message: "问卷不存在" });
      }
      const questionnaire = qRows[0];
      if (
        req.admin.role !== "supervisor" &&
        questionnaire.created_by !== req.admin.adminId
      ) {
        await connection.end();
        return res
          .status(403)
          .json({ success: false, message: "没有权限导出此问卷数据" });
      }

      // 获取题目
      const [questions] = await connection.execute(
        "SELECT * FROM questions WHERE questionnaire_id = ? ORDER BY order_num ASC",
        [questionnaireId],
      );
      const questionMap = {};
      questions.forEach((q) => {
        questionMap[q.id] = q;
      });

      // 获取维度配置
      const [dimensions] = await connection.execute(
        "SELECT * FROM dimensions WHERE questionnaire_id = ?",
        [questionnaireId],
      );
      for (const dim of dimensions) {
        const [dqs] = await connection.execute(
          "SELECT question_id FROM dimension_questions WHERE dimension_id = ?",
          [dim.id],
        );
        dim.question_ids = dqs.map((d) => d.question_id);
      }

      // 获取提交记录
      const [submissions] = await connection.execute(
        "SELECT * FROM submissions WHERE questionnaire_id = ? ORDER BY started_at ASC",
        [questionnaireId],
      );

      // 获取所有答案
      const [answers] = await connection.execute(
        `SELECT a.* FROM answers a
       INNER JOIN submissions s ON a.submission_id = s.id
       WHERE s.questionnaire_id = ?`,
        [questionnaireId],
      );

      await connection.end();

      // 按submission_id分组答案
      const answerMap = {};
      answers.forEach((ans) => {
        if (!answerMap[ans.submission_id]) answerMap[ans.submission_id] = {};
        answerMap[ans.submission_id][ans.question_id] = ans;
      });

      // 创建Excel
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("作答数据");

      // 构建表头
      const fixedHeaders = [
        "提交ID",
        "追踪码",
        "开始时间",
        "完成时间",
        "总用时(秒)",
      ];
      const questionScoreHeaders = questions.map((q) => {
        const typeMap = {
          scale: "得分",
          single_choice: "选项",
          multiple_choice: "选项",
          yes_no: "是否",
          open_text: "回答",
        };
        const typeSuffix = typeMap[q.question_type] || "得分";
        // 题目内容超过12个字截断，避免列名过长
        const shortContent =
          q.content.length > 12 ? q.content.slice(0, 12) + "…" : q.content;
        return `Q${q.order_num}_${shortContent}(${typeSuffix})`;
      });
      const questionTimeHeaders = questions.map(
        (q) => `Q${q.order_num}_用时(秒)`,
      );
      const dimensionHeaders = dimensions.map(
        (d) => `${d.name}(${d.score_formula === "mean" ? "均值" : "求和"})`,
      );
      const totalHeader = dimensions.length > 0 ? ["总分"] : [];

      const allHeaders = [
        ...fixedHeaders,
        ...questionScoreHeaders,
        ...questionTimeHeaders,
        ...(dimensions.length > 0 ? ["--- 计分结果 ---"] : []),
        ...dimensionHeaders,
        ...totalHeader,
      ];

      sheet.addRow(allHeaders);

      // 表头样式
      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE8F5E9" },
      };

      // 如果有维度，给计分结果那几列加不同背景色
      if (dimensions.length > 0) {
        const scoreStartCol =
          fixedHeaders.length +
          questionScoreHeaders.length +
          questionTimeHeaders.length +
          2;
        for (let c = scoreStartCol; c <= allHeaders.length; c++) {
          const cell = headerRow.getCell(c);
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFFF3CD" },
          };
        }
      }

      // 填数据行
      submissions.forEach((sub) => {
        const subAnswers = answerMap[sub.id] || {};
        const totalSeconds =
          sub.started_at && sub.finished_at
            ? Math.round(
                (new Date(sub.finished_at) - new Date(sub.started_at)) / 1000,
              )
            : "";

        // 固定列
        const fixedCols = [
          sub.id,
          sub.tracking_code || "",
          sub.started_at
            ? new Date(sub.started_at).toLocaleString("zh-CN")
            : "",
          sub.finished_at
            ? new Date(sub.finished_at).toLocaleString("zh-CN")
            : "",
          totalSeconds,
        ];

        // 每题原始分
        const rawScores = questions.map((q) => {
          const ans = subAnswers[q.id];
          if (!ans) return "";
          // 文字类答案（多选、是否、开放题、文字单选）优先显示answer_text
          if (
            ans.answer_text !== null &&
            ans.answer_text !== undefined &&
            ans.answer_text !== ""
          ) {
            try {
              // 多选题存的是JSON数组，解析后用逗号连接
              const parsed = JSON.parse(ans.answer_text);
              if (Array.isArray(parsed)) return parsed.join("、");
              return ans.answer_text;
            } catch {
              return ans.answer_text;
            }
          }
          return ans.answer_value !== null && ans.answer_value !== undefined
            ? ans.answer_value
            : "";
        });

        // 每题用时
        const timings = questions.map((q) => {
          const ans = subAnswers[q.id];
          return ans && ans.duration_ms
            ? Math.round(ans.duration_ms / 1000)
            : "";
        });

        // 计分结果
        let dimensionScoreCols = [];
        let totalScore = "";

        if (dimensions.length > 0) {
          // 先处理反向计分
          const scoredAnswers = {};
          Object.values(subAnswers).forEach((ans) => {
            const q = questionMap[ans.question_id];
            if (!q) return;
            // 只有量表题才参与计分
            if (q.question_type && q.question_type !== "scale") return;
            if (ans.answer_value === null || ans.answer_value === undefined)
              return;
            let score = ans.answer_value;
            if (q.is_reverse_scored) {
              score = q.max_score + q.min_score - ans.answer_value;
            }
            scoredAnswers[ans.question_id] = score;
          });

          // 按维度汇总
          let total = 0;
          dimensionScoreCols = dimensions.map((dim) => {
            const scores = dim.question_ids
              .map((qid) => scoredAnswers[qid])
              .filter((s) => s !== undefined);
            if (scores.length === 0) return "";
            let dimScore;
            if (dim.score_formula === "mean") {
              dimScore =
                Math.round(
                  (scores.reduce((a, b) => a + b, 0) / scores.length) * 100,
                ) / 100;
            } else {
              dimScore = scores.reduce((a, b) => a + b, 0);
            }
            total += dimScore;
            return dimScore;
          });
          totalScore = Math.round(total * 100) / 100;
        }

        const row = [
          ...fixedCols,
          ...rawScores,
          ...timings,
          ...(dimensions.length > 0 ? [""] : []),
          ...dimensionScoreCols,
          ...(dimensions.length > 0 ? [totalScore] : []),
        ];

        const dataRow = sheet.addRow(row);

        // 计分结果列加黄色背景
        if (dimensions.length > 0) {
          const scoreStartCol =
            fixedHeaders.length + rawScores.length + timings.length + 2;
          for (let c = scoreStartCol; c <= row.length; c++) {
            dataRow.getCell(c).fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFFFFBF0" },
            };
          }
        }
      });

      // 设置列宽
      sheet.columns.forEach((col, index) => {
        if (index < 4) col.width = 18;
        else if (index < 4 + questions.length * 2) col.width = 14;
        else col.width = 16;
      });

      const filename = encodeURIComponent(
        `${questionnaire.title}_作答数据.xlsx`,
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${filename}`,
      );

      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error("导出失败:", err);
      res.status(500).json({ success: false, message: "导出失败，请稍后重试" });
    }
  },
);

// 编辑问卷基本信息
app.put("/api/questionnaires/:id", verifyAdminToken, async (req, res) => {
  const questionnaireId = req.params.id;
  const {
    title,
    description,
    consent_text,
    track_timing,
    max_responses,
    expires_at,
    is_active,
  } = req.body;

  if (!title) {
    return res
      .status(400)
      .json({ success: false, message: "问卷标题不能为空" });
  }

  try {
    const connection = await mysql.createConnection(dbConfig);

    // 权限检查：普通研究者只能编辑自己的问卷
    const [qRows] = await connection.execute(
      "SELECT * FROM questionnaires WHERE id = ?",
      [questionnaireId],
    );
    if (qRows.length === 0) {
      await connection.end();
      return res.status(404).json({ success: false, message: "问卷不存在" });
    }
    if (
      req.admin.role !== "supervisor" &&
      qRows[0].created_by !== req.admin.adminId
    ) {
      await connection.end();
      return res
        .status(403)
        .json({ success: false, message: "没有权限编辑此问卷" });
    }

    await connection.execute(
      "UPDATE questionnaires SET title = ?, description = ?, consent_text = ?, track_timing = ?, max_responses = ?, expires_at = ?, is_active = ? WHERE id = ?",
      [
        title,
        description || "",
        consent_text || "",
        track_timing !== false,
        max_responses || null,
        expires_at || null,
        is_active !== false,
        questionnaireId,
      ],
    );
    await connection.end();

    res.json({ success: true, message: "问卷更新成功" });
  } catch (err) {
    console.error("编辑问卷失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 获取某份问卷的所有提交记录
app.get(
  "/api/questionnaires/:id/submissions",
  verifyAdminToken,
  async (req, res) => {
    const questionnaireId = req.params.id;

    try {
      const connection = await mysql.createConnection(dbConfig);

      const [qRows] = await connection.execute(
        "SELECT * FROM questionnaires WHERE id = ?",
        [questionnaireId],
      );
      if (qRows.length === 0) {
        await connection.end();
        return res.status(404).json({ success: false, message: "问卷不存在" });
      }
      if (
        req.admin.role !== "supervisor" &&
        qRows[0].created_by !== req.admin.adminId
      ) {
        await connection.end();
        return res
          .status(403)
          .json({ success: false, message: "没有权限查看此问卷数据" });
      }

      // 获取题目信息（用于反向计分）
      const [questions] = await connection.execute(
        "SELECT * FROM questions WHERE questionnaire_id = ?",
        [questionnaireId],
      );
      const questionMap = {};
      questions.forEach((q) => {
        questionMap[q.id] = q;
      });

      // 获取维度配置
      const [dimensions] = await connection.execute(
        "SELECT * FROM dimensions WHERE questionnaire_id = ?",
        [questionnaireId],
      );
      for (const dim of dimensions) {
        const [dqs] = await connection.execute(
          "SELECT question_id FROM dimension_questions WHERE dimension_id = ?",
          [dim.id],
        );
        dim.question_ids = dqs.map((d) => d.question_id);
      }

      // 获取所有提交记录
      const [submissions] = await connection.execute(
        `SELECT s.*,
        TIMESTAMPDIFF(SECOND, s.started_at, s.finished_at) AS duration_seconds,
        COUNT(a.id) AS answer_count
       FROM submissions s
       LEFT JOIN answers a ON a.submission_id = s.id
       WHERE s.questionnaire_id = ?
       GROUP BY s.id
       ORDER BY s.finished_at DESC`,
        [questionnaireId],
      );

      // 获取所有答案
      const [allAnswers] = await connection.execute(
        `SELECT a.* FROM answers a
       INNER JOIN submissions s ON a.submission_id = s.id
       WHERE s.questionnaire_id = ?`,
        [questionnaireId],
      );

      // 按submission_id分组答案
      const answersBySubmission = {};
      allAnswers.forEach((ans) => {
        if (!answersBySubmission[ans.submission_id]) {
          answersBySubmission[ans.submission_id] = {};
        }
        answersBySubmission[ans.submission_id][ans.question_id] = ans;
      });

      // 为每条提交记录计算维度得分
      const submissionsWithScores = submissions.map((sub) => {
        const answers = answersBySubmission[sub.id] || {};

        // 处理反向计分
        const scoredAnswers = {};
        Object.values(answers).forEach((ans) => {
          const q = questionMap[ans.question_id];
          if (!q) return;
          let score = ans.answer_value;
          if (q.is_reverse_scored) {
            score = q.max_score + q.min_score - ans.answer_value;
          }
          scoredAnswers[ans.question_id] = score;
        });

        // 按维度汇总
        let totalScore = 0;
        const dimensionScores = dimensions.map((dim) => {
          const scores = dim.question_ids
            .map((qid) => scoredAnswers[qid])
            .filter((s) => s !== undefined);

          let dimScore = 0;
          if (scores.length > 0) {
            if (dim.score_formula === "mean") {
              dimScore =
                Math.round(
                  (scores.reduce((a, b) => a + b, 0) / scores.length) * 100,
                ) / 100;
            } else {
              dimScore = scores.reduce((a, b) => a + b, 0);
            }
          }
          totalScore += dimScore;

          return {
            name: dim.name,
            score: dimScore,
            formula: dim.score_formula,
          };
        });

        return {
          ...sub,
          total_score: dimensions.length > 0 ? totalScore : null,
          dimension_scores: dimensionScores,
        };
      });

      await connection.end();
      res.json({
        success: true,
        submissions: submissionsWithScores,
        total: submissionsWithScores.length,
        has_dimensions: dimensions.length > 0,
      });
    } catch (err) {
      console.error("获取提交记录失败:", err);
      res.status(500).json({ success: false, message: "服务器错误" });
    }
  },
);

// 获取某份问卷的维度配置
app.get(
  "/api/questionnaires/:id/dimensions",
  verifyAdminToken,
  async (req, res) => {
    const questionnaireId = req.params.id;
    try {
      const connection = await mysql.createConnection(dbConfig);
      const [dimensions] = await connection.execute(
        "SELECT * FROM dimensions WHERE questionnaire_id = ? ORDER BY id ASC",
        [questionnaireId],
      );
      for (const dim of dimensions) {
        const [questions] = await connection.execute(
          `SELECT q.id, q.content, q.order_num FROM dimension_questions dq
         JOIN questions q ON dq.question_id = q.id
         WHERE dq.dimension_id = ? ORDER BY q.order_num ASC`,
          [dim.id],
        );
        dim.questions = questions;
      }
      await connection.end();
      res.json({ success: true, dimensions });
    } catch (err) {
      console.error("获取维度配置失败:", err);
      res.status(500).json({ success: false, message: "服务器错误" });
    }
  },
);

// 保存维度配置（整份问卷的维度全量更新）
app.post(
  "/api/questionnaires/:id/dimensions",
  verifyAdminToken,
  async (req, res) => {
    const questionnaireId = req.params.id;
    const { dimensions } = req.body;

    if (!Array.isArray(dimensions)) {
      return res
        .status(400)
        .json({ success: false, message: "维度数据格式错误" });
    }

    const connection = await mysql.createConnection(dbConfig);
    try {
      // 权限检查
      const [qRows] = await connection.execute(
        "SELECT * FROM questionnaires WHERE id = ?",
        [questionnaireId],
      );
      if (qRows.length === 0) {
        await connection.end();
        return res.status(404).json({ success: false, message: "问卷不存在" });
      }
      if (
        req.admin.role !== "supervisor" &&
        qRows[0].created_by !== req.admin.adminId
      ) {
        await connection.end();
        return res
          .status(403)
          .json({ success: false, message: "没有权限修改此问卷" });
      }

      // 全量更新：先删除这份问卷所有旧维度配置，再重新插入
      const [oldDims] = await connection.execute(
        "SELECT id FROM dimensions WHERE questionnaire_id = ?",
        [questionnaireId],
      );
      for (const dim of oldDims) {
        await connection.execute(
          "DELETE FROM dimension_questions WHERE dimension_id = ?",
          [dim.id],
        );
      }
      await connection.execute(
        "DELETE FROM dimensions WHERE questionnaire_id = ?",
        [questionnaireId],
      );

      // 插入新维度配置
      for (const dim of dimensions) {
        const [result] = await connection.execute(
          "INSERT INTO dimensions (questionnaire_id, name, description, score_formula) VALUES (?, ?, ?, ?)",
          [
            questionnaireId,
            dim.name,
            dim.description || "",
            dim.score_formula || "sum",
          ],
        );
        const dimensionId = result.insertId;
        for (const qid of dim.question_ids || []) {
          await connection.execute(
            "INSERT INTO dimension_questions (dimension_id, question_id) VALUES (?, ?)",
            [dimensionId, qid],
          );
        }
      }

      await connection.end();
      res.json({ success: true, message: "维度配置保存成功" });
    } catch (err) {
      await connection.end();
      console.error("保存维度配置失败:", err);
      res.status(500).json({ success: false, message: "服务器错误" });
    }
  },
);

// 计算某次提交的得分（按维度）
app.get("/api/submissions/:id/score", verifyAdminToken, async (req, res) => {
  const submissionId = req.params.id;
  try {
    const connection = await mysql.createConnection(dbConfig);

    // 获取这次提交对应的问卷id
    const [subRows] = await connection.execute(
      "SELECT * FROM submissions WHERE id = ?",
      [submissionId],
    );
    if (subRows.length === 0) {
      await connection.end();
      return res
        .status(404)
        .json({ success: false, message: "提交记录不存在" });
    }
    const questionnaireId = subRows[0].questionnaire_id;

    // 获取这次提交的所有作答
    const [answers] = await connection.execute(
      "SELECT * FROM answers WHERE submission_id = ?",
      [submissionId],
    );

    // 获取所有题目信息（为了知道反向计分和分值范围）
    const [questions] = await connection.execute(
      "SELECT * FROM questions WHERE questionnaire_id = ?",
      [questionnaireId],
    );
    const questionMap = {};
    questions.forEach((q) => {
      questionMap[q.id] = q;
    });

    // 第一步：处理反向计分，得到每道题的实际得分
    const scoredAnswers = {};
    answers.forEach((ans) => {
      const q = questionMap[ans.question_id];
      if (!q) return;
      let score = ans.answer_value;
      if (q.is_reverse_scored) {
        // 反向计分公式：最高分 + 最低分 - 原始分
        score = q.max_score + q.min_score - ans.answer_value;
      }
      scoredAnswers[ans.question_id] = score;
    });

    // 第二步：获取维度配置，按维度汇总得分
    const [dimensions] = await connection.execute(
      "SELECT * FROM dimensions WHERE questionnaire_id = ?",
      [questionnaireId],
    );

    const dimensionScores = [];
    let totalScore = 0;

    for (const dim of dimensions) {
      const [dimQuestions] = await connection.execute(
        "SELECT question_id FROM dimension_questions WHERE dimension_id = ?",
        [dim.id],
      );
      const scores = dimQuestions
        .map((dq) => scoredAnswers[dq.question_id])
        .filter((s) => s !== undefined);

      let dimScore = 0;
      if (scores.length > 0) {
        if (dim.score_formula === "mean") {
          dimScore = scores.reduce((a, b) => a + b, 0) / scores.length;
          dimScore = Math.round(dimScore * 100) / 100; // 保留两位小数
        } else {
          dimScore = scores.reduce((a, b) => a + b, 0);
        }
      }

      totalScore += dim.score_formula === "mean" ? dimScore : dimScore;
      dimensionScores.push({
        dimension_name: dim.name,
        score_formula: dim.score_formula,
        question_count: scores.length,
        score: dimScore,
      });
    }

    await connection.end();
    res.json({
      success: true,
      submission_id: submissionId,
      total_score: totalScore,
      dimension_scores: dimensionScores,
    });
  } catch (err) {
    console.error("计算得分失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 获取所有研究者账号列表（仅导师可用）
app.get("/api/admins", verifyAdminToken, async (req, res) => {
  if (req.admin.role !== "supervisor") {
    return res
      .status(403)
      .json({ success: false, message: "仅导师账号可以管理研究者" });
  }
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute(
      "SELECT id, username, display_name, role, created_at FROM admins ORDER BY created_at ASC",
    );
    await connection.end();
    res.json({ success: true, admins: rows });
  } catch (err) {
    console.error("获取账号列表失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 新建研究者账号（仅导师可用）
app.post("/api/admins", verifyAdminToken, async (req, res) => {
  if (req.admin.role !== "supervisor") {
    return res
      .status(403)
      .json({ success: false, message: "仅导师账号可以新建研究者" });
  }
  const { username, password, display_name, role } = req.body;
  if (!username || !password || !display_name) {
    return res
      .status(400)
      .json({ success: false, message: "账号、密码、姓名不能为空" });
  }
  if (password.length < 6) {
    return res.status(400).json({ success: false, message: "密码不能少于6位" });
  }
  try {
    const connection = await mysql.createConnection(dbConfig);

    // 检查账号是否已存在
    const [existing] = await connection.execute(
      "SELECT id FROM admins WHERE username = ?",
      [username],
    );
    if (existing.length > 0) {
      await connection.end();
      return res
        .status(400)
        .json({ success: false, message: "账号名已存在，请换一个" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await connection.execute(
      "INSERT INTO admins (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)",
      [username, passwordHash, display_name, role || "researcher"],
    );
    await connection.end();
    res.json({ success: true, message: "账号创建成功" });
  } catch (err) {
    console.error("创建账号失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 重置某个账号的密码（仅导师可用）
app.put("/api/admins/:id/password", verifyAdminToken, async (req, res) => {
  if (req.admin.role !== "supervisor") {
    return res
      .status(403)
      .json({ success: false, message: "仅导师账号可以重置密码" });
  }
  const { new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res
      .status(400)
      .json({ success: false, message: "新密码不能少于6位" });
  }
  try {
    const connection = await mysql.createConnection(dbConfig);
    const passwordHash = await bcrypt.hash(new_password, 10);
    await connection.execute(
      "UPDATE admins SET password_hash = ? WHERE id = ?",
      [passwordHash, req.params.id],
    );
    await connection.end();
    res.json({ success: true, message: "密码重置成功" });
  } catch (err) {
    console.error("重置密码失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 删除研究者账号（仅导师可用，不能删自己）
app.delete("/api/admins/:id", verifyAdminToken, async (req, res) => {
  if (req.admin.role !== "supervisor") {
    return res
      .status(403)
      .json({ success: false, message: "仅导师账号可以删除研究者" });
  }
  if (Number(req.params.id) === req.admin.adminId) {
    return res
      .status(400)
      .json({ success: false, message: "不能删除自己的账号" });
  }
  try {
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute("DELETE FROM admins WHERE id = ?", [
      req.params.id,
    ]);
    await connection.end();
    res.json({ success: true, message: "账号已删除" });
  } catch (err) {
    console.error("删除账号失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 新增单道题目（管理端在线添加，不依赖Excel导入）
app.post(
  "/api/questionnaires/:id/questions",
  verifyAdminToken,
  async (req, res) => {
    const questionnaireId = req.params.id;
    const {
      content,
      question_type,
      options,
      min_score,
      max_score,
      role,
      order_num,
      is_reverse_scored,
    } = req.body;

    if (!content) {
      return res
        .status(400)
        .json({ success: false, message: "题目内容不能为空" });
    }

    try {
      const connection = await mysql.createConnection(dbConfig);

      // 权限检查
      const [qRows] = await connection.execute(
        "SELECT * FROM questionnaires WHERE id = ?",
        [questionnaireId],
      );
      if (qRows.length === 0) {
        await connection.end();
        return res.status(404).json({ success: false, message: "问卷不存在" });
      }
      if (
        req.admin.role !== "supervisor" &&
        qRows[0].created_by !== req.admin.adminId
      ) {
        await connection.end();
        return res
          .status(403)
          .json({ success: false, message: "没有权限编辑此问卷" });
      }

      // 如果没有指定题号，自动排到最后
      let finalOrderNum = order_num;
      if (!finalOrderNum) {
        const [maxRow] = await connection.execute(
          "SELECT MAX(order_num) AS max_num FROM questions WHERE questionnaire_id = ?",
          [questionnaireId],
        );
        finalOrderNum = (maxRow[0].max_num || 0) + 1;
      }

      const [result] = await connection.execute(
        `INSERT INTO questions
        (questionnaire_id, content, question_type, options, min_score, max_score, role, order_num, is_reverse_scored)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          questionnaireId,
          content,
          question_type || "scale",
          options ? JSON.stringify(options) : null,
          min_score || 1,
          max_score || 5,
          role || "student",
          finalOrderNum,
          is_reverse_scored ? 1 : 0,
        ],
      );
      await connection.end();
      res.json({ success: true, message: "题目添加成功", id: result.insertId });
    } catch (err) {
      console.error("添加题目失败:", err);
      res.status(500).json({ success: false, message: "服务器错误" });
    }
  },
);

// 编辑单道题目
app.put("/api/questions/:id", verifyAdminToken, async (req, res) => {
  const questionId = req.params.id;
  const {
    content,
    question_type,
    options,
    min_score,
    max_score,
    role,
    is_reverse_scored,
  } = req.body;

  try {
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute(
      `UPDATE questions SET
        content = ?, question_type = ?, options = ?,
        min_score = ?, max_score = ?, role = ?, is_reverse_scored = ?
       WHERE id = ?`,
      [
        content,
        question_type || "scale",
        options ? JSON.stringify(options) : null,
        min_score || 1,
        max_score || 5,
        role || "student",
        is_reverse_scored ? 1 : 0,
        questionId,
      ],
    );
    await connection.end();
    res.json({ success: true, message: "题目更新成功" });
  } catch (err) {
    console.error("编辑题目失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 删除单道题目
app.delete("/api/questions/:id", verifyAdminToken, async (req, res) => {
  const questionId = req.params.id;
  try {
    const connection = await mysql.createConnection(dbConfig);
    // 先删关联答案，再删题目
    await connection.execute("DELETE FROM answers WHERE question_id = ?", [
      questionId,
    ]);
    await connection.execute(
      "DELETE FROM dimension_questions WHERE question_id = ?",
      [questionId],
    );
    await connection.execute("DELETE FROM questions WHERE id = ?", [
      questionId,
    ]);
    await connection.end();
    res.json({ success: true, message: "题目已删除" });
  } catch (err) {
    console.error("删除题目失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 批量更新题目顺序（拖拽排序用）
app.put(
  "/api/questionnaires/:id/questions/reorder",
  verifyAdminToken,
  async (req, res) => {
    const { orders } = req.body; // [{ id: 1, order_num: 1 }, { id: 3, order_num: 2 }, ...]

    if (!Array.isArray(orders)) {
      return res.status(400).json({ success: false, message: "参数格式错误" });
    }

    try {
      const connection = await mysql.createConnection(dbConfig);
      for (const item of orders) {
        await connection.execute(
          "UPDATE questions SET order_num = ? WHERE id = ?",
          [item.order_num, item.id],
        );
      }
      await connection.end();
      res.json({ success: true, message: "顺序更新成功" });
    } catch (err) {
      console.error("更新顺序失败:", err);
      res.status(500).json({ success: false, message: "服务器错误" });
    }
  },
);

// 获取某条提交记录的逐题答案详情
app.get("/api/submissions/:id/answers", verifyAdminToken, async (req, res) => {
  const submissionId = req.params.id;
  try {
    const connection = await mysql.createConnection(dbConfig);

    // 获取提交记录和问卷信息
    const [subRows] = await connection.execute(
      "SELECT s.*, q.title AS questionnaire_title FROM submissions s JOIN questionnaires q ON s.questionnaire_id = q.id WHERE s.id = ?",
      [submissionId],
    );
    if (subRows.length === 0) {
      await connection.end();
      return res
        .status(404)
        .json({ success: false, message: "提交记录不存在" });
    }

    // 获取逐题答案，连接题目信息
    const [answers] = await connection.execute(
      `SELECT a.*, q.content, q.question_type, q.order_num, q.min_score, q.max_score,
              q.is_reverse_scored, q.options, q.role
       FROM answers a
       JOIN questions q ON a.question_id = q.id
       WHERE a.submission_id = ?
       ORDER BY q.order_num ASC`,
      [submissionId],
    );

    await connection.end();

    // 格式化答案显示
    const formattedAnswers = answers.map((ans) => {
      let displayValue = "";
      if (
        ans.answer_text !== null &&
        ans.answer_text !== undefined &&
        ans.answer_text !== ""
      ) {
        try {
          const parsed = JSON.parse(ans.answer_text);
          displayValue = Array.isArray(parsed)
            ? parsed.join("、")
            : ans.answer_text;
        } catch {
          displayValue = ans.answer_text;
        }
      } else if (ans.answer_value !== null) {
        displayValue = String(ans.answer_value);
      }

      return {
        order_num: ans.order_num,
        content: ans.content,
        question_type: ans.question_type || "scale",
        role: ans.role || "student",
        display_value: displayValue,
        answer_value: ans.answer_value,
        answer_text: ans.answer_text,
        duration_ms: ans.duration_ms,
      };
    });

    res.json({
      success: true,
      submission: subRows[0],
      answers: formattedAnswers,
    });
  } catch (err) {
    console.error("获取答案详情失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 获取某份问卷的分数段配置
app.get(
  "/api/questionnaires/:id/score-rules",
  verifyAdminToken,
  async (req, res) => {
    const questionnaireId = req.params.id;
    try {
      const connection = await mysql.createConnection(dbConfig);
      const [rules] = await connection.execute(
        "SELECT * FROM score_rules WHERE questionnaire_id = ? ORDER BY min_score ASC",
        [questionnaireId],
      );
      await connection.end();
      res.json({ success: true, rules });
    } catch (err) {
      console.error("获取分数段配置失败:", err);
      res.status(500).json({ success: false, message: "服务器错误" });
    }
  },
);

// 保存分数段配置（全量更新）
app.post(
  "/api/questionnaires/:id/score-rules",
  verifyAdminToken,
  async (req, res) => {
    const questionnaireId = req.params.id;
    const { rules } = req.body;

    if (!Array.isArray(rules)) {
      return res.status(400).json({ success: false, message: "参数格式错误" });
    }

    const connection = await mysql.createConnection(dbConfig);
    try {
      // 权限检查
      const [qRows] = await connection.execute(
        "SELECT * FROM questionnaires WHERE id = ?",
        [questionnaireId],
      );
      if (qRows.length === 0) {
        await connection.end();
        return res.status(404).json({ success: false, message: "问卷不存在" });
      }
      if (
        req.admin.role !== "supervisor" &&
        qRows[0].created_by !== req.admin.adminId
      ) {
        await connection.end();
        return res
          .status(403)
          .json({ success: false, message: "没有权限修改此问卷" });
      }

      // 全量更新：先删旧的再插新的
      await connection.execute(
        "DELETE FROM score_rules WHERE questionnaire_id = ?",
        [questionnaireId],
      );
      for (const rule of rules) {
        await connection.execute(
          `INSERT INTO score_rules
          (questionnaire_id, min_score, max_score, label, description, visible_to_subject)
         VALUES (?, ?, ?, ?, ?, ?)`,
          [
            questionnaireId,
            rule.min_score,
            rule.max_score,
            rule.label,
            rule.description || "",
            rule.visible_to_subject ? 1 : 0,
          ],
        );
      }
      await connection.end();
      res.json({ success: true, message: "分数段配置保存成功" });
    } catch (err) {
      await connection.end();
      console.error("保存分数段配置失败:", err);
      res.status(500).json({ success: false, message: "服务器错误" });
    }
  },
);

// 计算某次提交的分数段评价（用于回答记录详情展示）
app.get("/api/submissions/:id/report", verifyAdminToken, async (req, res) => {
  const submissionId = req.params.id;
  try {
    const connection = await mysql.createConnection(dbConfig);

    const [subRows] = await connection.execute(
      "SELECT * FROM submissions WHERE id = ?",
      [submissionId],
    );
    if (subRows.length === 0) {
      await connection.end();
      return res
        .status(404)
        .json({ success: false, message: "提交记录不存在" });
    }
    const questionnaireId = subRows[0].questionnaire_id;

    const { totalScore, dimensionScores } = await calcScore(
      questionnaireId,
      submissionId,
      connection,
    );

    const [rules] = await connection.execute(
      "SELECT * FROM score_rules WHERE questionnaire_id = ? ORDER BY min_score ASC",
      [questionnaireId],
    );
    const matchedRule =
      rules.find(
        (r) =>
          totalScore >= Number(r.min_score) &&
          totalScore <= Number(r.max_score),
      ) || null;

    await connection.end();
    res.json({
      success: true,
      total_score: totalScore,
      dimension_scores: dimensionScores,
      matched_rule: matchedRule,
    });
  } catch (err) {
    console.error("获取报告失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

app.listen(PORT, () => {
  console.log(`后端服务已启动，访问 http://localhost:${PORT}`);
});
