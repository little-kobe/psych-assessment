// backend/server.js
const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const multer = require("multer");
const XLSX = require("xlsx");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");
const os = require("os");

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

  const result = computeScores(answers, questionMap, dimensions);
  return { ...result, questionMap };
}

// 某个维度理论上的最低分和最高分（画图表时作为刻度范围）
function dimensionRange(dim, questionMap) {
  const qs = (dim.question_ids || [])
    .map((id) => questionMap[id])
    .filter(Boolean);
  if (qs.length === 0) return { min: 0, max: 0 };
  const mins = qs.map((q) => Number(q.min_score));
  const maxs = qs.map((q) => Number(q.max_score));
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  if (dim.score_formula === "mean") {
    return {
      min: Math.round((sum(mins) / qs.length) * 100) / 100,
      max: Math.round((sum(maxs) / qs.length) * 100) / 100,
    };
  }
  return { min: sum(mins), max: sum(maxs) };
}

// 算出这份问卷所有已提交的人在每个维度上的平均分（和受测者自己的分数对比用）
async function calcDimensionAverages(
  connection,
  questionnaireId,
  questionMap,
  dimensions,
) {
  const [allAnswers] = await connection.execute(
    `SELECT a.* FROM answers a
     INNER JOIN submissions s ON a.submission_id = s.id
     WHERE s.questionnaire_id = ?`,
    [questionnaireId],
  );
  // 按提交分组
  const bySubmission = {};
  allAnswers.forEach((ans) => {
    if (!bySubmission[ans.submission_id]) bySubmission[ans.submission_id] = [];
    bySubmission[ans.submission_id].push(ans);
  });
  // 每个维度收集所有人的得分
  const scoreLists = dimensions.map(() => []);
  let sampleSize = 0;
  Object.values(bySubmission).forEach((answers) => {
    const { dimensionScores } = computeScores(answers, questionMap, dimensions);
    if (dimensionScores.some((d) => d.score !== null)) sampleSize++;
    dimensionScores.forEach((d, i) => {
      if (d.score !== null) scoreLists[i].push(d.score);
    });
  });
  const averages = scoreLists.map((list) =>
    list.length > 0
      ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 100) / 100
      : null,
  );
  return { averages, sampleSize };
}

// 给总分和各维度匹配分数段：dimension_id 为空的规则按总分匹配，有值的按对应维度匹配
function matchScoreRules(totalScore, dimensionScores, rules) {
  const inRange = (score, r) =>
    score !== null &&
    score >= Number(r.min_score) &&
    score <= Number(r.max_score);
  const totalRule =
    rules.find((r) => !r.dimension_id && inRange(totalScore, r)) || null;
  const dimensions = dimensionScores.map((d) => ({
    ...d,
    matched_rule:
      rules.find((r) => r.dimension_id === d.id && inRange(d.score, r)) || null,
  }));
  return { totalRule, dimensions };
}

// 统一计分函数（报告、回答记录列表、导出Excel 都用它，保证算法一致）
// answers：某次提交的全部答案；questionMap：{题目id: 题目}；dimensions：维度配置（带 question_ids）
function computeScores(answers, questionMap, dimensions) {
  // 第一步：算出每道题的得分。只要答案里有数值（量表题、带分值的单选题）就参与计分
  const scoredAnswers = {};
  answers.forEach((ans) => {
    const q = questionMap[ans.question_id];
    if (!q) return;
    let score = getAnswerScore(ans, q);
    if (score === null || isNaN(score)) return;
    if (q.is_reverse_scored) {
      // 反向计分：最高分 + 最低分 - 原始分
      score = Number(q.max_score) + Number(q.min_score) - score;
    }
    scoredAnswers[ans.question_id] = score;
  });

  // 第二步：按维度汇总（sum 求和，mean 取均值）
  let totalScore = 0;
  const dimensionScores = dimensions.map((dim) => {
    const scores = (dim.question_ids || [])
      .map((qid) => scoredAnswers[qid])
      .filter((s) => s !== undefined);

    let dimScore = null; // 这个维度一道题都没答时为 null
    if (scores.length > 0) {
      const sum = scores.reduce((a, b) => a + b, 0);
      dimScore =
        dim.score_formula === "mean"
          ? Math.round((sum / scores.length) * 100) / 100
          : sum;
      totalScore += dimScore;
    }
    return {
      id: dim.id,
      name: dim.name,
      score: dimScore,
      formula: dim.score_formula,
    };
  });

  // 没有配置维度时，总分 = 所有计分题相加
  if (dimensions.length === 0) {
    totalScore = Object.values(scoredAnswers).reduce((a, b) => a + b, 0);
  }

  totalScore = Math.round(totalScore * 100) / 100;
  return { totalScore, dimensionScores, scoredAnswers };
}

// 取一道题的原始分：优先用存下来的分数；
// 老数据只存了选项文字的（比如后来才给选项配分值），按当前选项配置换算成分数
function getAnswerScore(ans, q) {
  if (ans.answer_value !== null && ans.answer_value !== undefined) {
    return Number(ans.answer_value);
  }
  if (!q || !ans.answer_text) return null;
  const opt = parseOptionList(q.options).find(
    (o) => o.label === ans.answer_text && o.score !== null,
  );
  return opt ? Number(opt.score) : null;
}

// 把题目选项统一成 [{ label, score }] 格式（兼容旧数据：纯文字数组 ["偶尔","从不"]）
function parseOptionList(raw) {
  let arr = raw;
  if (!arr) return [];
  if (typeof arr === "string") {
    try {
      arr = JSON.parse(arr);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map((o) =>
    typeof o === "string"
      ? { label: o, score: null }
      : { label: o.label ?? "", score: o.score ?? null },
  );
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

    const { totalScore, dimensionScores, questionMap } = await calcScore(
      questionnaireId,
      submissionId,
      connection,
    );

    // 问卷开启了「答完显示结果图表」时，准备每个维度的：自己的分、平均分、分数范围
    const [qRows] = await connection.execute(
      "SELECT show_report_chart FROM questionnaires WHERE id = ?",
      [questionnaireId],
    );
    let chart = null;
    if (qRows[0]?.show_report_chart && dimensionScores.length > 0) {
      const [dims] = await connection.execute(
        "SELECT * FROM dimensions WHERE questionnaire_id = ? ORDER BY id ASC",
        [questionnaireId],
      );
      for (const dim of dims) {
        const [dqs] = await connection.execute(
          "SELECT question_id FROM dimension_questions WHERE dimension_id = ?",
          [dim.id],
        );
        dim.question_ids = dqs.map((d) => d.question_id);
      }
      const { averages, sampleSize } = await calcDimensionAverages(
        connection,
        questionnaireId,
        questionMap,
        dims,
      );
      chart = {
        sample_size: sampleSize,
        dimensions: dims.map((dim, i) => {
          const mine = dimensionScores.find((d) => d.id === dim.id);
          const range = dimensionRange(dim, questionMap);
          return {
            id: dim.id,
            name: dim.name,
            description: dim.description || "",
            score: mine ? mine.score : null,
            average: averages[i],
            min: range.min,
            max: range.max,
          };
        }),
      };
    }

    // 只取「对受测者可见」的分数段
    const [rules] = await connection.execute(
      "SELECT * FROM score_rules WHERE questionnaire_id = ? AND visible_to_subject = 1 ORDER BY min_score ASC",
      [questionnaireId],
    );
    const { totalRule, dimensions } = matchScoreRules(
      totalScore,
      dimensionScores,
      rules,
    );

    await connection.end();
    res.json({
      success: true,
      total_score: totalScore,
      matched_rule: totalRule,
      // 各维度的评价（只返回匹配到可见分数段的维度）
      dimension_reports: dimensions
        .filter((d) => d.matched_rule)
        .map((d) => ({
          name: d.name,
          score: d.score,
          matched_rule: d.matched_rule,
        })),
      chart, // 没开启图表时为 null
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

    // 板块引导语
    const [sectionRows] = await connection.execute(
      "SELECT id, title, intro FROM question_sections WHERE questionnaire_id = ?",
      [questionnaireId],
    );

    await connection.end();

    res.json({
      success: true,
      questionnaire,
      questions: questionRows,
      sections: sectionRows,
    });
  } catch (err) {
    console.error("获取问卷失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 接收整份问卷的提交
app.post("/api/submission", async (req, res) => {
  const {
    questionnaire_id,
    started_at,
    finished_at,
    answers,
    tracking_code,
    group_label,
  } = req.body;

  const connection = await mysql.createConnection(dbConfig);

  try {
    const [submissionResult] = await connection.execute(
      "INSERT INTO submissions (questionnaire_id, started_at, finished_at, tracking_code, group_label) VALUES (?, ?, ?, ?, ?)",
      [
        questionnaire_id,
        started_at,
        finished_at,
        tracking_code || null,
        group_label || null,
      ],
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

// ========== Excel 批量导入题目 ==========

// 表头：每一项可以用这些列名（兼容旧模板，也兼容导出 Excel 里的「题目与选项对照」表）
const IMPORT_COLUMNS = {
  order: ["题号"],
  content: ["题目内容", "题目"],
  type: ["题型"],
  options: ["选项", "选项与分值"],
  min: ["最低分"],
  max: ["最高分"],
  reverse: ["是否反向计分", "反向计分"],
  role: ["填写角色", "角色"],
  section: ["所属板块", "板块"],
  sectionIntro: ["板块引导语"],
};

// 单元格里的写法 → 系统里的值
const TYPE_ALIASES = {
  scale: ["量表", "量表题", "scale"],
  single_choice: ["单选", "单选题", "single_choice"],
  multiple_choice: ["多选", "多选题", "multiple_choice"],
  yes_no: ["是否", "是否题", "是非", "是非题", "判断", "判断题", "yes_no"],
  open_text: ["开放", "开放题", "填空", "填空题", "问答", "open_text"],
};
const ROLE_ALIASES = {
  student: ["学生", "学生填写", "student"],
  parent: ["家长", "家长填写", "parent"],
  both: ["通用", "均可", "都可以", "both"],
};

function findAlias(map, raw) {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  for (const [key, list] of Object.entries(map)) {
    if (list.some((a) => a.toLowerCase() === v)) return key;
  }
  return null;
}

function isYes(raw) {
  return ["是", "y", "yes", "1", "true", "√", "反向"].includes(
    String(raw ?? "")
      .trim()
      .toLowerCase(),
  );
}

// 解析「选项」单元格，支持：
//   完全没有=1；轻度=2；重度=3   （文字=分值）
//   1=完全没有；2=轻度           （分值=文字）
//   偶尔；从不；每天             （只有文字，不计分）
// 选项之间用分号（；或 ;）、竖线 | 或换行分隔
function parseOptionCell(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return [];
  const isNum = (x) => x !== "" && !isNaN(Number(x));
  return text
    .split(/[；;|\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const pos = item.search(/[=＝]/);
      if (pos === -1) return { label: item, score: null };
      const left = item.slice(0, pos).trim();
      const right = item.slice(pos + 1).trim();
      if (right === "不计分" || right === "")
        return { label: left, score: null };
      if (isNum(right)) return { label: left, score: Number(right) };
      if (isNum(left)) return { label: right, score: Number(left) };
      return { label: item, score: null };
    });
}

// 下载导入模板（带示例和填写说明）
app.get(
  "/api/questions/import-template",
  verifyAdminToken,
  async (req, res) => {
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("题目");
      sheet.columns = [
        { header: "题号", width: 8 },
        { header: "题目内容", width: 36 },
        { header: "题型", width: 10 },
        { header: "选项", width: 46 },
        { header: "最低分", width: 9 },
        { header: "最高分", width: 9 },
        { header: "是否反向计分", width: 14 },
        { header: "填写角色", width: 10 },
        { header: "所属板块", width: 18 },
        { header: "板块引导语", width: 36 },
      ];
      const five = "完全没有=1；轻度=2；中度=3；偏重=4；重度=5";
      [
        [
          1,
          "我感到心情低落",
          "量表",
          five,
          "",
          "",
          "否",
          "学生",
          "第一部分 情绪",
          "以下题目请根据你最近一周的真实感受作答。",
        ],
        [
          2,
          "我对什么事都提不起兴趣",
          "量表",
          five,
          "",
          "",
          "否",
          "学生",
          "第一部分 情绪",
          "",
        ],
        [
          3,
          "我能很快入睡",
          "量表",
          "",
          1,
          5,
          "是",
          "学生",
          "第二部分 睡眠",
          "以下题目关于你最近一个月的睡眠情况。",
        ],
        [
          4,
          "你平时最常做的运动是",
          "单选",
          "跑步；游泳；篮球；其他",
          "",
          "",
          "",
          "学生",
          "",
          "",
        ],
        [
          5,
          "你喜欢哪些课外活动（可多选）",
          "多选",
          "阅读；运动；音乐；游戏",
          "",
          "",
          "",
          "学生",
          "",
          "",
        ],
        [6, "过去一周你是否失眠过", "是否", "", "", "", "", "学生", "", ""],
        [
          7,
          "孩子最近在家的情绪表现",
          "单选",
          "很好=3；一般=2；较差=1",
          "",
          "",
          "",
          "家长",
          "",
          "",
        ],
        [8, "你还有什么想说的", "开放题", "", "", "", "", "学生", "", ""],
      ].forEach((r) => sheet.addRow(r));
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE8F5E9" },
      };

      const help = workbook.addWorksheet("填写说明");
      help.columns = [
        { header: "列名", width: 14 },
        { header: "是否必填", width: 10 },
        { header: "怎么填", width: 70 },
      ];
      [
        [
          "题号",
          "必填",
          "第几题，写数字。题号和已有题目相同时会覆盖更新那道题，不会重复添加。",
        ],
        ["题目内容", "必填", "题目文字。"],
        ["题型", "选填", "量表、单选、多选、是否、开放题。不填默认是量表。"],
        [
          "选项",
          "选填",
          "选项之间用分号隔开。要计分就写成「文字=分值」，如：完全没有=1；轻度=2；重度=3。不计分只写文字，如：偶尔；从不；每天。量表题只写文字不写分值时，从「最低分」开始依次给 1、2、3…分。单选、多选题至少要 2 个选项。",
        ],
        [
          "最低分 / 最高分",
          "选填",
          "量表题不写选项文字时用（受测者看到数字按钮），默认 1~5 分。写了带分值的选项时会自动按选项计算，这两列可以不填。",
        ],
        [
          "是否反向计分",
          "选填",
          "填「是」表示反向计分，不填或填「否」表示正向。",
        ],
        ["填写角色", "选填", "学生、家长、通用。不填默认学生。"],
        [
          "所属板块",
          "选填",
          "板块标题。标题相同的题归到同一个板块；这份问卷里还没有这个板块时会自动新建。",
        ],
        ["板块引导语", "选填", "板块的说明文字，写在该板块任意一行即可。"],
        ["", "", ""],
        [
          "小提示",
          "",
          "表里有某一列，就以表里的内容为准（空着就是不设置）；表里没有这一列，已有题目原来的设置保持不变。所以旧版只有「题号、题目内容、最低分、最高分、是否反向计分」的表格照样能用。",
        ],
        [
          "小提示",
          "",
          "导出数据里的「题目与选项对照」工作表也可以直接导入，用来把一份问卷的题目复制到另一份问卷。",
        ],
      ].forEach((r) => help.addRow(r));
      help.getRow(1).font = { bold: true };
      help.getColumn(3).alignment = { wrapText: true, vertical: "top" };

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent("题目导入模板.xlsx")}`,
      );
      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error("生成导入模板失败:", err);
      res.status(500).json({ success: false, message: "服务器错误" });
    }
  },
);

// 批量导入题目
app.post(
  "/api/questions/import",
  verifyAdminToken,
  upload.single("file"),
  async (req, res) => {
    const questionnaireId = Number(req.body.questionnaire_id);

    if (!req.file) {
      return res.status(400).json({ success: false, message: "未收到文件" });
    }
    if (!questionnaireId) {
      return res
        .status(400)
        .json({ success: false, message: "请先选择要导入到哪份问卷" });
    }

    // 读取工作表
    let rows;
    let headers;
    try {
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      // 优先读「题目」或「题目与选项对照」工作表（导出的 Excel 可以直接导入），没有就读第一个
      const sheetName =
        ["题目", "题目与选项对照"].find((n) =>
          workbook.SheetNames.includes(n),
        ) || workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      headers = (XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] || []).map(
        (h) => String(h).trim(),
      );
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: "文件解析失败，请确认上传的是 Excel 文件（.xlsx）",
      });
    }

    // 找出每一项在表里用的列名（没有这一列就是 null）
    const col = {};
    for (const [key, names] of Object.entries(IMPORT_COLUMNS)) {
      col[key] = names.find((n) => headers.includes(n)) || null;
    }
    if (!col.order || !col.content) {
      return res.status(400).json({
        success: false,
        message: "Excel 第一行必须有「题号」和「题目内容」两列",
      });
    }
    if (rows.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Excel 里没有题目" });
    }

    const connection = await mysql.createConnection(dbConfig);
    try {
      const access = await checkQuestionnaireAccess(
        connection,
        questionnaireId,
        req.admin,
      );
      if (access !== "ok") {
        await connection.end();
        return res.status(access === "notfound" ? 404 : 403).json({
          success: false,
          message:
            access === "notfound" ? "问卷不存在" : "没有权限修改这份问卷",
        });
      }

      // 这份问卷已有的板块（按标题找）
      const [sectionRows] = await connection.execute(
        "SELECT id, title, intro FROM question_sections WHERE questionnaire_id = ?",
        [questionnaireId],
      );
      const sectionByTitle = {};
      sectionRows.forEach((s) => (sectionByTitle[s.title] = s));

      let insertCount = 0;
      let updateCount = 0;
      let sectionCount = 0;
      const errors = [];
      const hasCol = (key) => col[key] !== null;
      const cell = (row, key) =>
        hasCol(key) ? String(row[col[key]] ?? "").trim() : "";

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const excelRow = i + 2; // 第 1 行是表头
        const orderNum = parseInt(cell(row, "order").replace(/[^\d]/g, ""), 10);
        const content = cell(row, "content");
        if (!orderNum && !content) continue; // 整行空着，跳过
        if (!orderNum || !content) {
          errors.push(`第 ${excelRow} 行：题号或题目内容为空，已跳过`);
          continue;
        }
        const where = `第 ${excelRow} 行（题号 ${orderNum}）`;

        try {
          const [existingRows] = await connection.execute(
            "SELECT * FROM questions WHERE questionnaire_id = ? AND order_num = ?",
            [questionnaireId, orderNum],
          );
          const existing = existingRows[0] || null;

          // 题型：表里有这一列就用表里的，没有就保留原来的（新题默认量表）
          let type = existing ? existing.question_type || "scale" : "scale";
          if (hasCol("type") && cell(row, "type") !== "") {
            type = findAlias(TYPE_ALIASES, cell(row, "type"));
            if (!type) {
              errors.push(
                `${where}：不认识的题型「${cell(row, "type")}」，已跳过（可以填：量表、单选、多选、是否、开放题）`,
              );
              continue;
            }
          }

          // 分值范围
          const toNum = (v) => (v === "" ? null : Number(v));
          let minScore = hasCol("min")
            ? toNum(cell(row, "min"))
            : existing
              ? Number(existing.min_score)
              : null;
          let maxScore = hasCol("max")
            ? toNum(cell(row, "max"))
            : existing
              ? Number(existing.max_score)
              : null;
          if (minScore === null) minScore = 1;
          if (maxScore === null) maxScore = 5;
          if (isNaN(minScore) || isNaN(maxScore)) {
            errors.push(`${where}：最低分或最高分不是数字，已跳过`);
            continue;
          }

          // 选项：表里有这一列就用表里的，没有就保留原来的
          let options = hasCol("options")
            ? parseOptionCell(row[col.options])
            : existing
              ? parseOptionList(existing.options)
              : [];

          // 「1-5分」这种写法：导出的对照表里，没配文字的量表题就是这样写的
          const rangeMatch = hasCol("options")
            ? cell(row, "options").match(
                /^(-?\d+)\s*[-~～—–至到]\s*(-?\d+)\s*分?$/,
              )
            : null;
          if (rangeMatch) {
            minScore = Number(rangeMatch[1]);
            maxScore = Number(rangeMatch[2]);
            options = [];
          }

          if (type === "scale") {
            if (options.length > 0) {
              const scored = options.filter((o) => o.score !== null);
              if (scored.length === 0) {
                // 只写了文字：从最低分开始依次给分
                options = options.map((o, idx) => ({
                  label: o.label,
                  score: minScore + idx,
                }));
              } else if (scored.length < options.length) {
                errors.push(
                  `${where}：量表题的选项要么都写分值，要么都不写，已跳过`,
                );
                continue;
              }
              const scores = options.map((o) => o.score);
              if (!hasCol("options") && existing) {
                // 沿用原来的选项文字时，分值范围变了就清空文字（对不上了）
                if (
                  Math.min(...scores) !== minScore ||
                  Math.max(...scores) !== maxScore
                ) {
                  options = [];
                }
              } else {
                minScore = Math.min(...scores);
                maxScore = Math.max(...scores);
              }
            }
            if (minScore >= maxScore) {
              errors.push(`${where}：最高分必须大于最低分，已跳过`);
              continue;
            }
          } else if (type === "single_choice" || type === "multiple_choice") {
            if (options.length < 2) {
              errors.push(`${where}：单选/多选题至少要 2 个选项，已跳过`);
              continue;
            }
            if (type === "multiple_choice") {
              options = options.map((o) => ({ label: o.label, score: null }));
            }
            const scores = options
              .map((o) => o.score)
              .filter((s) => s !== null);
            if (scores.length > 0) {
              minScore = Math.min(...scores);
              maxScore = Math.max(...scores);
            }
          } else {
            options = []; // 是否题、开放题没有选项
          }

          // 反向计分：只有量表题和带分值的单选题才有意义
          let reverse = hasCol("reverse")
            ? isYes(cell(row, "reverse"))
            : existing
              ? !!existing.is_reverse_scored
              : false;
          const canReverse =
            type === "scale" ||
            (type === "single_choice" && options.some((o) => o.score !== null));
          if (!canReverse) reverse = false;

          // 填写角色
          let role = existing ? existing.role || "student" : "student";
          if (hasCol("role")) {
            if (cell(row, "role") === "") {
              role = "student";
            } else {
              role = findAlias(ROLE_ALIASES, cell(row, "role"));
              if (!role) {
                errors.push(
                  `${where}：不认识的填写角色「${cell(row, "role")}」，已跳过（可以填：学生、家长、通用）`,
                );
                continue;
              }
            }
          }

          // 所属板块：按标题找，没有就新建
          let sectionId = existing ? existing.section_id : null;
          if (hasCol("section")) {
            const title = cell(row, "section");
            const intro = cell(row, "sectionIntro");
            if (title === "") {
              sectionId = null;
            } else if (sectionByTitle[title]) {
              sectionId = sectionByTitle[title].id;
              if (intro && intro !== sectionByTitle[title].intro) {
                await connection.execute(
                  "UPDATE question_sections SET intro = ? WHERE id = ?",
                  [intro, sectionId],
                );
                sectionByTitle[title].intro = intro;
              }
            } else {
              const [result] = await connection.execute(
                "INSERT INTO question_sections (questionnaire_id, title, intro) VALUES (?, ?, ?)",
                [questionnaireId, title, intro],
              );
              sectionId = result.insertId;
              sectionByTitle[title] = { id: sectionId, title, intro };
              sectionCount++;
            }
          }

          const values = [
            content,
            type,
            options.length > 0 ? JSON.stringify(options) : null,
            minScore,
            maxScore,
            reverse ? 1 : 0,
            role,
            sectionId,
          ];
          if (existing) {
            await connection.execute(
              `UPDATE questions SET content = ?, question_type = ?, options = ?, min_score = ?,
               max_score = ?, is_reverse_scored = ?, role = ?, section_id = ? WHERE id = ?`,
              [...values, existing.id],
            );
            updateCount++;
          } else {
            await connection.execute(
              `INSERT INTO questions (content, question_type, options, min_score, max_score,
               is_reverse_scored, role, section_id, questionnaire_id, order_num)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [...values, questionnaireId, orderNum],
            );
            insertCount++;
          }
        } catch (rowErr) {
          errors.push(`${where}：处理失败（${rowErr.message}）`);
        }
      }

      await connection.end();
      let message = `导入完成：新增 ${insertCount} 道题，更新 ${updateCount} 道题`;
      if (sectionCount > 0) message += `，新建 ${sectionCount} 个板块`;
      if (errors.length > 0)
        message += `；有 ${errors.length} 行没有导入，见下方`;
      res.json({
        success: true,
        message,
        insertCount,
        updateCount,
        sectionCount,
        errors,
      });
    } catch (err) {
      await connection.end();
      console.error("导入题目失败:", err);
      res.status(500).json({ success: false, message: "服务器错误" });
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

    // 板块引导语
    const [sectionRows] = await connection.execute(
      "SELECT * FROM question_sections WHERE questionnaire_id = ? ORDER BY id ASC",
      [questionnaireId],
    );

    await connection.end();

    res.json({
      success: true,
      questionnaire,
      questions: questionRows,
      sections: sectionRows,
    });
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

      // 获取基本信息字段配置
      const [infoFields] = await connection.execute(
        "SELECT * FROM subject_info_fields WHERE questionnaire_id = ? ORDER BY order_num ASC",
        [questionnaireId],
      );

      // 获取所有提交的基本信息
      const [allSubjectInfo] = await connection.execute(
        `SELECT si.* FROM subject_info si
   INNER JOIN submissions s ON si.submission_id = s.id
   WHERE s.questionnaire_id = ?`,
        [questionnaireId],
      );

      // 获取板块（写进「题目与选项对照」表）
      const [codeSections] = await connection.execute(
        "SELECT id, title, intro FROM question_sections WHERE questionnaire_id = ?",
        [questionnaireId],
      );

      await connection.end();

      // 把基本信息按submission_id分组
      const subjectInfoMap = {};
      allSubjectInfo.forEach((item) => {
        if (!subjectInfoMap[item.submission_id])
          subjectInfoMap[item.submission_id] = {};
        subjectInfoMap[item.submission_id][item.field_key] = item.value;
      });

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
      // 基本信息列（放在最前面）
      const infoHeaders = infoFields.map((f) => f.field_label);
      const fixedHeaders = [
        "提交ID",
        "追踪码",
        "分组",
        ...infoHeaders,
        "开始时间",
        "完成时间",
        "总用时(秒)",
      ];

      // 某道题是否计分：量表题，或选项配了分值的单选题
      const isScoredQuestion = (q) =>
        !q.question_type ||
        q.question_type === "scale" ||
        (q.question_type === "single_choice" &&
          parseOptionList(q.options).some((o) => o.score !== null));

      const questionScoreHeaders = questions.map((q) => {
        const typeMap = {
          scale: "得分",
          single_choice: "选项",
          multiple_choice: "选项",
          yes_no: "是否",
          open_text: "回答",
        };
        const typeSuffix = isScoredQuestion(q)
          ? "得分"
          : typeMap[q.question_type] || "得分";
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
        // 基本信息列数据
        const infoCols = infoFields.map((f) => {
          const subInfo = subjectInfoMap[sub.id] || {};
          return subInfo[f.field_key] || "";
        });

        const fixedCols = [
          sub.id,
          sub.tracking_code || "",
          sub.group_label || "",
          ...infoCols,
          sub.started_at
            ? new Date(sub.started_at).toLocaleString("zh-CN")
            : "",
          sub.finished_at
            ? new Date(sub.finished_at).toLocaleString("zh-CN")
            : "",
          totalSeconds,
        ];

        // 每题答案：有分数的显示分数（如「完全没有」显示 1），没有分数的显示文字
        const rawScores = questions.map((q) => {
          const ans = subAnswers[q.id];
          if (!ans) return "";
          const score = getAnswerScore(ans, q);
          if (score !== null) return score;
          // 文字类答案（多选、是否、开放题、不计分的单选）显示 answer_text
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
          // 用统一计分函数
          const result = computeScores(
            Object.values(subAnswers),
            questionMap,
            dimensions,
          );
          dimensionScoreCols = result.dimensionScores.map((d) =>
            d.score === null ? "" : d.score,
          );
          totalScore = result.totalScore;
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
      const fixedColCount = 3 + infoFields.length; // 提交ID + 追踪码 + 基本信息列 + 时间列
      sheet.columns.forEach((col, index) => {
        if (index < fixedColCount) col.width = 16;
        else if (index < fixedColCount + questions.length * 2) col.width = 14;
        else col.width = 16;
      });

      // 第二个工作表：题目与选项对照（说明每个分数对应哪个选项文字）
      const codeSheet = workbook.addWorksheet("题目与选项对照");
      codeSheet.addRow([
        "题号",
        "题目",
        "题型",
        "选项与分值",
        "反向计分",
        "所属维度",
        "填写角色",
        "所属板块",
        "板块引导语",
      ]);
      // 板块（这张表可以直接导入到别的问卷，所以把角色和板块也写上）
      const sectionById = {};
      codeSections.forEach((sec) => (sectionById[sec.id] = sec));
      const introWritten = new Set();
      const roleNames = { student: "学生", parent: "家长", both: "通用" };
      codeSheet.getRow(1).font = { bold: true };
      const typeNames = {
        scale: "量表",
        single_choice: "单选",
        multiple_choice: "多选",
        yes_no: "是否",
        open_text: "开放题",
      };
      questions.forEach((q) => {
        const opts = parseOptionList(q.options);
        let optionText = "";
        if (opts.some((o) => o.score !== null)) {
          optionText = opts
            .map((o) => `${o.label}=${o.score ?? "不计分"}`)
            .join("；");
        } else if (opts.length > 0) {
          optionText = opts.map((o) => o.label).join("；");
        } else if (!q.question_type || q.question_type === "scale") {
          optionText = `${q.min_score}-${q.max_score}分`;
        }
        const dimNames = dimensions
          .filter((d) => d.question_ids.includes(q.id))
          .map((d) => d.name)
          .join("、");
        const sec = q.section_id ? sectionById[q.section_id] : null;
        // 板块引导语只在这个板块的第一道题写一次
        let intro = "";
        if (sec && !introWritten.has(sec.id)) {
          intro = sec.intro || "";
          introWritten.add(sec.id);
        }
        codeSheet.addRow([
          `Q${q.order_num}`,
          q.content,
          typeNames[q.question_type] || "量表",
          optionText,
          q.is_reverse_scored ? "是" : "",
          dimNames,
          roleNames[q.role] || "学生",
          sec ? sec.title : "",
          intro,
        ]);
      });
      codeSheet.getColumn(2).width = 40;
      codeSheet.getColumn(4).width = 50;
      codeSheet.getColumn(6).width = 16;
      codeSheet.getColumn(8).width = 18;
      codeSheet.getColumn(9).width = 30;

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
    show_report_chart,
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
      "UPDATE questionnaires SET title = ?, description = ?, consent_text = ?, track_timing = ?, max_responses = ?, expires_at = ?, is_active = ?, show_report_chart = ? WHERE id = ?",
      [
        title,
        description || "",
        consent_text || "",
        track_timing !== false,
        max_responses || null,
        expires_at || null,
        is_active !== false,
        show_report_chart ? 1 : 0,
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

      // 为每条提交记录计算维度得分（用统一计分函数）
      const submissionsWithScores = submissions.map((sub) => {
        const answers = Object.values(answersBySubmission[sub.id] || {});
        const { totalScore, dimensionScores } = computeScores(
          answers,
          questionMap,
          dimensions,
        );

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

      // 保存时保留原有维度的 id（维度的分数段报告靠 id 关联，不能每次保存都换新 id）
      const [oldDims] = await connection.execute(
        "SELECT id FROM dimensions WHERE questionnaire_id = ?",
        [questionnaireId],
      );
      const oldIds = oldDims.map((d) => d.id);
      const keepIds = dimensions.filter((d) => d.id).map((d) => Number(d.id));

      // 第一步：删掉这次被移除的维度（它的分数段会被数据库自动一起删掉）
      for (const oldId of oldIds) {
        if (!keepIds.includes(oldId)) {
          await connection.execute(
            "DELETE FROM dimension_questions WHERE dimension_id = ?",
            [oldId],
          );
          await connection.execute("DELETE FROM dimensions WHERE id = ?", [
            oldId,
          ]);
        }
      }

      // 第二步：已有的维度更新，新加的维度插入
      for (const dim of dimensions) {
        let dimensionId = Number(dim.id);
        if (dimensionId && oldIds.includes(dimensionId)) {
          await connection.execute(
            "UPDATE dimensions SET name = ?, description = ?, score_formula = ? WHERE id = ?",
            [
              dim.name,
              dim.description || "",
              dim.score_formula || "sum",
              dimensionId,
            ],
          );
          // 题目关联先清空，下面重新写入
          await connection.execute(
            "DELETE FROM dimension_questions WHERE dimension_id = ?",
            [dimensionId],
          );
        } else {
          const [result] = await connection.execute(
            "INSERT INTO dimensions (questionnaire_id, name, description, score_formula) VALUES (?, ?, ?, ?)",
            [
              questionnaireId,
              dim.name,
              dim.description || "",
              dim.score_formula || "sum",
            ],
          );
          dimensionId = result.insertId;
        }
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
      section_id,
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
        (questionnaire_id, content, question_type, options, min_score, max_score, role, order_num, is_reverse_scored, section_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          questionnaireId,
          content,
          question_type || "scale",
          options ? JSON.stringify(options) : null,
          min_score ?? 1, // 用 ?? 而不是 ||，否则最低分设成 0 会被改成 1
          max_score ?? 5,
          role || "student",
          finalOrderNum,
          is_reverse_scored ? 1 : 0,
          section_id || null,
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
    section_id,
  } = req.body;

  try {
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute(
      `UPDATE questions SET
        content = ?, question_type = ?, options = ?,
        min_score = ?, max_score = ?, role = ?, is_reverse_scored = ?, section_id = ?
       WHERE id = ?`,
      [
        content,
        question_type || "scale",
        options ? JSON.stringify(options) : null,
        min_score ?? 1, // 用 ?? 而不是 ||，否则最低分设成 0 会被改成 1
        max_score ?? 5,
        role || "student",
        is_reverse_scored ? 1 : 0,
        section_id || null,
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
      // 选项文字和分数都有时，一起显示，如「完全没有（1分）」
      if (
        ans.answer_value !== null &&
        ans.answer_text !== null &&
        ans.answer_text !== ""
      ) {
        displayValue = `${displayValue}（${ans.answer_value}分）`;
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
    (questionnaire_id, min_score, max_score, label, description, visible_to_subject, color, dimension_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            questionnaireId,
            rule.min_score,
            rule.max_score,
            rule.label,
            rule.description || "",
            rule.visible_to_subject ? 1 : 0,
            rule.color || "#4CAF7D",
            rule.dimension_id || null, // 空 = 按总分；有值 = 按这个维度
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
    const { totalRule, dimensions } = matchScoreRules(
      totalScore,
      dimensionScores,
      rules,
    );

    await connection.end();
    res.json({
      success: true,
      total_score: totalScore,
      dimension_scores: dimensions, // 每个维度带 matched_rule
      matched_rule: totalRule,
    });
  } catch (err) {
    console.error("获取报告失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 获取某份问卷的基本信息字段配置
app.get("/api/questionnaires/:id/info-fields", async (req, res) => {
  const questionnaireId = req.params.id;
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [fields] = await connection.execute(
      "SELECT * FROM subject_info_fields WHERE questionnaire_id = ? ORDER BY order_num ASC",
      [questionnaireId],
    );
    await connection.end();
    res.json({ success: true, fields });
  } catch (err) {
    console.error("获取信息字段失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 保存问卷的基本信息字段配置（管理端，需登录）
app.post(
  "/api/questionnaires/:id/info-fields",
  verifyAdminToken,
  async (req, res) => {
    const questionnaireId = req.params.id;
    const { fields } = req.body;

    if (!Array.isArray(fields)) {
      return res.status(400).json({ success: false, message: "参数格式错误" });
    }

    const connection = await mysql.createConnection(dbConfig);
    try {
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
        return res.status(403).json({ success: false, message: "没有权限" });
      }

      // 全量更新
      await connection.execute(
        "DELETE FROM subject_info_fields WHERE questionnaire_id = ?",
        [questionnaireId],
      );

      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        await connection.execute(
          `INSERT INTO subject_info_fields
          (questionnaire_id, field_key, field_label, field_type, options, is_required, order_num)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            questionnaireId,
            f.field_key,
            f.field_label,
            f.field_type || "text",
            f.options ? JSON.stringify(f.options) : null,
            f.is_required !== false ? 1 : 0,
            i + 1,
          ],
        );
      }

      await connection.end();
      res.json({ success: true, message: "保存成功" });
    } catch (err) {
      await connection.end();
      console.error("保存信息字段失败:", err);
      res.status(500).json({ success: false, message: "服务器错误" });
    }
  },
);

// 提交受测者基本信息（用户端，不需要登录）
app.post("/api/submissions/:id/subject-info", async (req, res) => {
  const submissionId = req.params.id;
  const { info } = req.body; // [{ field_key, field_label, value }]

  if (!Array.isArray(info)) {
    return res.status(400).json({ success: false, message: "参数格式错误" });
  }

  try {
    const connection = await mysql.createConnection(dbConfig);
    for (const item of info) {
      await connection.execute(
        "INSERT INTO subject_info (submission_id, field_key, field_label, value) VALUES (?, ?, ?, ?)",
        [submissionId, item.field_key, item.field_label, item.value || ""],
      );
    }
    await connection.end();
    res.json({ success: true, message: "基本信息已保存" });
  } catch (err) {
    console.error("保存基本信息失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 获取某次提交的基本信息（管理端查看用）
app.get(
  "/api/submissions/:id/subject-info",
  verifyAdminToken,
  async (req, res) => {
    const submissionId = req.params.id;
    try {
      const connection = await mysql.createConnection(dbConfig);
      const [info] = await connection.execute(
        "SELECT * FROM subject_info WHERE submission_id = ? ORDER BY id ASC",
        [submissionId],
      );
      await connection.end();
      res.json({ success: true, info });
    } catch (err) {
      console.error("获取基本信息失败:", err);
      res.status(500).json({ success: false, message: "服务器错误" });
    }
  },
);

// ========== 统计分析 ==========

// 描述统计：人数、平均数、标准差（样本标准差，除以 n-1）、中位数、最小值、最大值
function describe(values) {
  const n = values.length;
  if (n === 0) {
    return { n: 0, mean: null, sd: null, median: null, min: null, max: null };
  }
  const round2 = (x) => Math.round(x * 100) / 100;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd =
    n > 1
      ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1))
      : null;
  const median =
    n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return {
    n,
    mean: round2(mean),
    sd: sd === null ? null : round2(sd),
    median: round2(median),
    min: round2(sorted[0]),
    max: round2(sorted[n - 1]),
  };
}

// 分数分布（直方图）：整数分且范围不大时每个分数一格，否则平均分成 10 格
function histogram(values, lo, hi) {
  if (values.length === 0) return [];
  lo = Math.min(lo, ...values);
  hi = Math.max(hi, ...values);
  const allInt = values.every((v) => Number.isInteger(v));
  if (allInt && Number.isInteger(lo) && Number.isInteger(hi) && hi - lo <= 30) {
    const bins = [];
    for (let s = lo; s <= hi; s++) {
      bins.push({ label: String(s), from: s, to: s, count: 0 });
    }
    values.forEach((v) => bins[v - lo].count++);
    return bins;
  }
  const count = 10;
  const width = (hi - lo) / count || 1;
  const fmt = (x) => String(Math.round(x * 100) / 100);
  const bins = [];
  for (let i = 0; i < count; i++) {
    const from = lo + i * width;
    const to = i === count - 1 ? hi : lo + (i + 1) * width;
    bins.push({ label: `${fmt(from)}~${fmt(to)}`, from, to, count: 0 });
  }
  values.forEach((v) => {
    let idx = Math.floor((v - lo) / width);
    if (idx >= count) idx = count - 1;
    if (idx < 0) idx = 0;
    bins[idx].count++;
  });
  return bins;
}

// 某份问卷的统计分析
// 参数：group（只看某个分组，"__none__" 表示未分组）、complete_only（只统计完整作答，默认是）、
//       exclude_fast（排除作答过快：平均每题不到 2 秒，默认否）
app.get("/api/questionnaires/:id/stats", verifyAdminToken, async (req, res) => {
  const questionnaireId = Number(req.params.id);
  const groupFilter = req.query.group || "";
  const completeOnly = req.query.complete_only !== "0";
  const excludeFast = req.query.exclude_fast === "1";
  const FAST_MS = 2000;
  const NO_GROUP = "__none__";

  const connection = await mysql.createConnection(dbConfig);
  try {
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
        .json({ success: false, message: "没有权限查看这份问卷的数据" });
    }

    const [questions] = await connection.execute(
      "SELECT * FROM questions WHERE questionnaire_id = ? ORDER BY order_num ASC",
      [questionnaireId],
    );
    const questionMap = {};
    questions.forEach((q) => (questionMap[q.id] = q));

    const [dimensions] = await connection.execute(
      "SELECT * FROM dimensions WHERE questionnaire_id = ? ORDER BY id ASC",
      [questionnaireId],
    );
    for (const dim of dimensions) {
      const [dqs] = await connection.execute(
        "SELECT question_id FROM dimension_questions WHERE dimension_id = ?",
        [dim.id],
      );
      dim.question_ids = dqs.map((d) => d.question_id);
    }

    const [rules] = await connection.execute(
      "SELECT * FROM score_rules WHERE questionnaire_id = ? ORDER BY min_score ASC",
      [questionnaireId],
    );
    const [submissions] = await connection.execute(
      "SELECT * FROM submissions WHERE questionnaire_id = ? ORDER BY finished_at ASC",
      [questionnaireId],
    );
    const [allAnswers] = await connection.execute(
      `SELECT a.* FROM answers a
         INNER JOIN submissions s ON a.submission_id = s.id
         WHERE s.questionnaire_id = ?`,
      [questionnaireId],
    );
    await connection.end();

    const answersBySub = {};
    allAnswers.forEach((a) => {
      if (!answersBySub[a.submission_id]) answersBySub[a.submission_id] = [];
      answersBySub[a.submission_id].push(a);
    });

    // ---- 第一步：按条件筛选提交 ----
    const groupKey = (s) => s.group_label || NO_GROUP;
    let emptyCount = 0;
    let incompleteCount = 0;
    let fastCount = 0;
    const kept = []; // 通过「完整 / 过快」筛选的（分组对比用）
    submissions.forEach((s) => {
      const answers = answersBySub[s.id] || [];
      if (answers.length === 0) {
        emptyCount++; // 没有任何答案的提交，一律不统计
        return;
      }
      if (completeOnly && answers.length < questions.length) {
        incompleteCount++;
        return;
      }
      const timed = answers.filter((a) => a.duration_ms > 0);
      if (excludeFast && timed.length > 0) {
        const avg = timed.reduce((t, a) => t + a.duration_ms, 0) / timed.length;
        if (avg < FAST_MS) {
          fastCount++;
          return;
        }
      }
      kept.push({
        sub: s,
        answers,
        ...computeScores(answers, questionMap, dimensions),
      });
    });
    const valid = groupFilter
      ? kept.filter((k) => groupKey(k.sub) === groupFilter)
      : kept;

    // ---- 第二步：回收概况 ----
    const seconds = valid
      .filter((k) => k.sub.started_at && k.sub.finished_at)
      .map(
        (k) =>
          (new Date(k.sub.finished_at) - new Date(k.sub.started_at)) / 1000,
      );
    const dayKey = (d) => {
      const x = new Date(d);
      const pad = (n) => String(n).padStart(2, "0");
      return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
    };
    const dayCounts = {};
    valid.forEach((k) => {
      if (!k.sub.finished_at) return;
      const key = dayKey(k.sub.finished_at);
      dayCounts[key] = (dayCounts[key] || 0) + 1;
    });
    let daily = Object.keys(dayCounts)
      .sort()
      .map((date) => ({ date, count: dayCounts[date] }));
    // 首尾之间不超过 92 天时，把没有提交的日子补成 0，趋势图才连贯
    if (daily.length > 1) {
      const first = new Date(daily[0].date + "T00:00:00");
      const last = new Date(daily[daily.length - 1].date + "T00:00:00");
      const days = Math.round((last - first) / 86400000);
      if (days <= 92) {
        const filled = [];
        for (let i = 0; i <= days; i++) {
          const d = new Date(first.getTime() + i * 86400000);
          const key = dayKey(d);
          filled.push({ date: key, count: dayCounts[key] || 0 });
        }
        daily = filled;
      }
    }
    const groups = [...new Set(submissions.map(groupKey))].map((g) => ({
      value: g,
      label: g === NO_GROUP ? "未分组" : g,
    }));
    const overview = {
      total_with_answers: submissions.length - emptyCount,
      valid: valid.length,
      empty: emptyCount,
      excluded_incomplete: incompleteCount,
      excluded_fast: fastCount,
      duration: describe(seconds),
      first_at: valid.length ? valid[0].sub.finished_at : null,
      last_at: valid.length ? valid[valid.length - 1].sub.finished_at : null,
      daily,
    };

    // ---- 第三步：总分和各维度的得分统计 ----
    const scoredQuestions = questions.filter(
      (q) =>
        !q.question_type ||
        q.question_type === "scale" ||
        (q.question_type === "single_choice" &&
          parseOptionList(q.options).some((o) => o.score !== null)),
    );
    const measures = [];
    const bandsOf = (values, dimensionId) => {
      const list = rules.filter(
        (r) => (r.dimension_id || null) === (dimensionId || null),
      );
      if (list.length === 0) return [];
      const bands = list.map((r) => ({
        label: r.label,
        color: r.color || "#4CAF7D",
        min: Number(r.min_score),
        max: Number(r.max_score),
        count: 0,
      }));
      let unmatched = 0;
      values.forEach((v) => {
        const idx = list.findIndex(
          (r) => v >= Number(r.min_score) && v <= Number(r.max_score),
        );
        if (idx === -1) unmatched++;
        else bands[idx].count++;
      });
      if (unmatched > 0) {
        bands.push({
          label: "未匹配分数段",
          color: "#9E9E9E",
          min: null,
          max: null,
          count: unmatched,
        });
      }
      return bands;
    };
    if (scoredQuestions.length > 0) {
      // 总分：有维度时 = 各维度分相加；没有维度时 = 所有计分题相加
      let lo = 0;
      let hi = 0;
      if (dimensions.length > 0) {
        dimensions.forEach((d) => {
          const r = dimensionRange(d, questionMap);
          lo += r.min;
          hi += r.max;
        });
      } else {
        scoredQuestions.forEach((q) => {
          lo += Number(q.min_score);
          hi += Number(q.max_score);
        });
      }
      const values = valid
        .filter((k) => Object.keys(k.scoredAnswers).length > 0)
        .map((k) => k.totalScore);
      measures.push({
        key: "total",
        name: "总分",
        formula: dimensions.length > 0 ? "各维度相加" : "所有计分题相加",
        range: { min: lo, max: hi },
        ...describe(values),
        histogram: histogram(values, lo, hi),
        bands: bandsOf(values, null),
      });
    }
    dimensions.forEach((dim, i) => {
      const r = dimensionRange(dim, questionMap);
      const values = valid
        .map((k) => k.dimensionScores[i].score)
        .filter((v) => v !== null);
      measures.push({
        key: `dim${dim.id}`,
        name: dim.name,
        formula: dim.score_formula === "mean" ? "均值" : "求和",
        range: r,
        ...describe(values),
        histogram: histogram(values, r.min, r.max),
        bands: bandsOf(values, dim.id),
      });
    });

    // ---- 第四步：分组对比（不受分组筛选影响） ----
    const groupCompare = groups.map((g) => {
      const members = kept.filter((k) => groupKey(k.sub) === g.value);
      const result = {
        value: g.value,
        label: g.label,
        n: members.length,
        measures: {},
      };
      measures.forEach((m) => {
        let values;
        if (m.key === "total") {
          values = members
            .filter((k) => Object.keys(k.scoredAnswers).length > 0)
            .map((k) => k.totalScore);
        } else {
          const i = dimensions.findIndex((d) => `dim${d.id}` === m.key);
          values = members
            .map((k) => k.dimensionScores[i].score)
            .filter((v) => v !== null);
        }
        const d = describe(values);
        result.measures[m.key] = { n: d.n, mean: d.mean, sd: d.sd };
      });
      return result;
    });

    // ---- 第五步：逐题分析（原始作答，反向题没有反转） ----
    const items = questions.map((q) => {
      const type = q.question_type || "scale";
      const opts = parseOptionList(q.options);
      const answers = valid
        .map((k) => k.answers.find((a) => a.question_id === q.id))
        .filter(Boolean);
      const answered = answers.filter(
        (a) =>
          (a.answer_value !== null && a.answer_value !== undefined) ||
          (a.answer_text !== null && a.answer_text !== ""),
      );
      const timed = answered.filter((a) => a.duration_ms > 0);
      const item = {
        id: q.id,
        order_num: q.order_num,
        content: q.content,
        type,
        reverse: !!q.is_reverse_scored,
        n: answered.length,
        avg_seconds: timed.length
          ? Math.round(
              (timed.reduce((t, a) => t + a.duration_ms, 0) /
                timed.length /
                1000) *
                10,
            ) / 10
          : null,
        score: null,
        distribution: [],
        texts: [],
      };
      const pct = (c) =>
        answered.length ? Math.round((c / answered.length) * 1000) / 10 : 0;

      if (type === "scale") {
        const scores = answered
          .map((a) => getAnswerScore(a, q))
          .filter((s) => s !== null);
        item.score = describe(scores);
        const labelOf = (s) => {
          const o = opts.find((x) => x.score === s && x.label);
          return o ? `${o.label}（${s}）` : `${s} 分`;
        };
        for (let s = Number(q.min_score); s <= Number(q.max_score); s++) {
          const c = scores.filter((x) => x === s).length;
          item.distribution.push({ label: labelOf(s), count: c, pct: pct(c) });
        }
      } else if (type === "single_choice" || type === "yes_no") {
        const labels =
          type === "yes_no" ? ["是", "否"] : opts.map((o) => o.label);
        const counts = {};
        let other = 0;
        answered.forEach((a) => {
          if (labels.includes(a.answer_text))
            counts[a.answer_text] = (counts[a.answer_text] || 0) + 1;
          else other++;
        });
        labels.forEach((l) => {
          const o = opts.find((x) => x.label === l);
          const label = o && o.score !== null ? `${l}（${o.score}）` : l;
          item.distribution.push({
            label,
            count: counts[l] || 0,
            pct: pct(counts[l] || 0),
          });
        });
        if (other > 0)
          item.distribution.push({
            label: "其他（选项已修改）",
            count: other,
            pct: pct(other),
          });
        if (type === "single_choice" && opts.some((o) => o.score !== null)) {
          item.score = describe(
            answered.map((a) => getAnswerScore(a, q)).filter((s) => s !== null),
          );
        }
      } else if (type === "multiple_choice") {
        const counts = {};
        answered.forEach((a) => {
          let picked = [];
          try {
            picked = JSON.parse(a.answer_text);
          } catch {
            picked = [];
          }
          (Array.isArray(picked) ? picked : []).forEach(
            (l) => (counts[l] = (counts[l] || 0) + 1),
          );
        });
        opts.forEach((o) =>
          item.distribution.push({
            label: o.label,
            count: counts[o.label] || 0,
            pct: pct(counts[o.label] || 0),
          }),
        );
      } else if (type === "open_text") {
        item.texts = answered
          .map((a) => a.answer_text)
          .filter(Boolean)
          .slice(-50)
          .reverse(); // 最近的在前，最多 50 条
      }
      return item;
    });

    res.json({
      success: true,
      questionnaire: { id: qRows[0].id, title: qRows[0].title },
      filter: {
        group: groupFilter,
        complete_only: completeOnly,
        exclude_fast: excludeFast,
      },
      question_count: questions.length,
      groups,
      overview,
      measures,
      group_compare: groupCompare,
      items,
    });
  } catch (err) {
    await connection.end().catch(() => {});
    console.error("统计分析失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// ========== 板块引导语（一组题共用一个大标题和说明） ==========

// 检查当前账号能不能修改这份问卷：返回 "ok" / "notfound" / "forbidden"
async function checkQuestionnaireAccess(connection, questionnaireId, admin) {
  const [rows] = await connection.execute(
    "SELECT created_by FROM questionnaires WHERE id = ?",
    [questionnaireId],
  );
  if (rows.length === 0) return "notfound";
  if (admin.role !== "supervisor" && rows[0].created_by !== admin.adminId) {
    return "forbidden";
  }
  return "ok";
}

// 把第 from 到第 to 题划进某个板块（先清空这个板块原来的题）
async function assignSectionRange(
  connection,
  questionnaireId,
  sectionId,
  from,
  to,
) {
  await connection.execute(
    "UPDATE questions SET section_id = NULL WHERE section_id = ?",
    [sectionId],
  );
  if (from && to) {
    await connection.execute(
      "UPDATE questions SET section_id = ? WHERE questionnaire_id = ? AND order_num BETWEEN ? AND ?",
      [sectionId, questionnaireId, Math.min(from, to), Math.max(from, to)],
    );
  }
}

// 新建板块：{ title, intro, from, to }，from/to 是题号范围（可不填）
app.post(
  "/api/questionnaires/:id/sections",
  verifyAdminToken,
  async (req, res) => {
    const questionnaireId = req.params.id;
    const { title, intro, from, to } = req.body;
    if (!title) {
      return res
        .status(400)
        .json({ success: false, message: "板块标题不能为空" });
    }
    const connection = await mysql.createConnection(dbConfig);
    try {
      const access = await checkQuestionnaireAccess(
        connection,
        questionnaireId,
        req.admin,
      );
      if (access !== "ok") {
        await connection.end();
        return res.status(access === "notfound" ? 404 : 403).json({
          success: false,
          message: access === "notfound" ? "问卷不存在" : "没有权限修改此问卷",
        });
      }
      const [result] = await connection.execute(
        "INSERT INTO question_sections (questionnaire_id, title, intro) VALUES (?, ?, ?)",
        [questionnaireId, title, intro || ""],
      );
      await assignSectionRange(
        connection,
        questionnaireId,
        result.insertId,
        from,
        to,
      );
      await connection.end();
      res.json({ success: true, message: "板块已创建", id: result.insertId });
    } catch (err) {
      await connection.end();
      console.error("创建板块失败:", err);
      res.status(500).json({ success: false, message: "服务器错误" });
    }
  },
);

// 修改板块（标题、引导语、题号范围）
app.put("/api/sections/:id", verifyAdminToken, async (req, res) => {
  const { title, intro, from, to } = req.body;
  if (!title) {
    return res
      .status(400)
      .json({ success: false, message: "板块标题不能为空" });
  }
  const connection = await mysql.createConnection(dbConfig);
  try {
    const [rows] = await connection.execute(
      "SELECT * FROM question_sections WHERE id = ?",
      [req.params.id],
    );
    if (rows.length === 0) {
      await connection.end();
      return res.status(404).json({ success: false, message: "板块不存在" });
    }
    const questionnaireId = rows[0].questionnaire_id;
    const access = await checkQuestionnaireAccess(
      connection,
      questionnaireId,
      req.admin,
    );
    if (access !== "ok") {
      await connection.end();
      return res
        .status(403)
        .json({ success: false, message: "没有权限修改此问卷" });
    }
    await connection.execute(
      "UPDATE question_sections SET title = ?, intro = ? WHERE id = ?",
      [title, intro || "", req.params.id],
    );
    await assignSectionRange(
      connection,
      questionnaireId,
      req.params.id,
      from,
      to,
    );
    await connection.end();
    res.json({ success: true, message: "板块已更新" });
  } catch (err) {
    await connection.end();
    console.error("修改板块失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 删除板块（题目不会被删，只是不再属于这个板块）
app.delete("/api/sections/:id", verifyAdminToken, async (req, res) => {
  const connection = await mysql.createConnection(dbConfig);
  try {
    const [rows] = await connection.execute(
      "SELECT * FROM question_sections WHERE id = ?",
      [req.params.id],
    );
    if (rows.length === 0) {
      await connection.end();
      return res.status(404).json({ success: false, message: "板块不存在" });
    }
    const access = await checkQuestionnaireAccess(
      connection,
      rows[0].questionnaire_id,
      req.admin,
    );
    if (access !== "ok") {
      await connection.end();
      return res
        .status(403)
        .json({ success: false, message: "没有权限修改此问卷" });
    }
    await connection.execute("DELETE FROM question_sections WHERE id = ?", [
      req.params.id,
    ]);
    await connection.end();
    res.json({ success: true, message: "板块已删除" });
  } catch (err) {
    await connection.end();
    console.error("删除板块失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// ========== 选项模板（常用回答选项，如「完全没有=1 … 重度=5」） ==========

// 获取所有选项模板（课题组共享，所有人都能用）
app.get("/api/option-templates", verifyAdminToken, async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute(
      `SELECT t.*, a.display_name AS creator_name FROM option_templates t
       LEFT JOIN admins a ON t.created_by = a.id ORDER BY t.id ASC`,
    );
    await connection.end();
    res.json({ success: true, templates: rows });
  } catch (err) {
    console.error("获取选项模板失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 保存一个新模板
app.post("/api/option-templates", verifyAdminToken, async (req, res) => {
  const { name, options } = req.body;
  if (!name || !Array.isArray(options) || options.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "模板名称和选项不能为空" });
  }
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [result] = await connection.execute(
      "INSERT INTO option_templates (name, options, created_by) VALUES (?, ?, ?)",
      [name, JSON.stringify(options), req.admin.adminId],
    );
    await connection.end();
    res.json({ success: true, message: "模板已保存", id: result.insertId });
  } catch (err) {
    console.error("保存选项模板失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 删除模板（只能删自己的，导师可以删所有）
app.delete("/api/option-templates/:id", verifyAdminToken, async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute(
      "SELECT * FROM option_templates WHERE id = ?",
      [req.params.id],
    );
    if (rows.length === 0) {
      await connection.end();
      return res.status(404).json({ success: false, message: "模板不存在" });
    }
    if (
      req.admin.role !== "supervisor" &&
      rows[0].created_by !== req.admin.adminId
    ) {
      await connection.end();
      return res
        .status(403)
        .json({ success: false, message: "只能删除自己创建的模板" });
    }
    await connection.execute("DELETE FROM option_templates WHERE id = ?", [
      req.params.id,
    ]);
    await connection.end();
    res.json({ success: true, message: "模板已删除" });
  } catch (err) {
    console.error("删除选项模板失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 获取本机局域网 IP（生成问卷二维码用：手机和电脑连同一个 Wi-Fi 时，手机通过这个 IP 访问）
app.get("/api/server-info", verifyAdminToken, (req, res) => {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const addr of list || []) {
      if (addr.family === "IPv4" && !addr.internal) ips.push(addr.address);
    }
  }
  // 家用/校园 Wi-Fi 常见的 192.168.x.x 排在最前面
  ips.sort((a, b) => b.startsWith("192.168.") - a.startsWith("192.168."));
  res.json({ success: true, lan_ips: ips });
});

app.listen(PORT, () => {
  console.log(`后端服务已启动，访问 http://localhost:${PORT}`);
});
