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
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const statsMath = require("./stats-math");
const video = require("./video");

// 配置：上线时写在 backend/.env 文件里（数据库密码、JWT 密钥等），本地没有这个文件就用下面的默认值
const ENV_FILE = path.join(__dirname, ".env");
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const app = express();
app.set("trust proxy", "loopback"); // 上线后前面有 nginx，按 nginx 转来的真实 IP 记录
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const upload = multer({ storage: multer.memoryStorage() });

// ---------- 题目里的图片、视频、音频 ----------
// 上传的文件存在 backend/uploads 文件夹，通过 http://localhost:3000/uploads/文件名 访问
const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use(
  "/uploads",
  express.static(UPLOAD_DIR, {
    maxAge: "7d",
    // 转换过格式的 .mov / .m4v 实际是 mp4，按 mp4 返回浏览器才能播
    setHeaders: (res, filePath) => {
      if (/\.(mov|m4v)$/i.test(filePath))
        res.setHeader("Content-Type", "video/mp4");
    },
  }),
);

const MEDIA_TYPES = {
  image: [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"],
  video: [".mp4", ".webm", ".m4v", ".mov"],
  audio: [".mp3", ".wav", ".m4a", ".aac", ".ogg"],
};
function mediaTypeOf(filename) {
  const ext = path.extname(filename || "").toLowerCase();
  return Object.keys(MEDIA_TYPES).find((t) => MEDIA_TYPES[t].includes(ext));
}
const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    // 文件名用时间 + 随机串，避免重名和中文文件名的问题
    filename: (req, file, cb) =>
      cb(
        null,
        `${Date.now()}_${crypto.randomBytes(4).toString("hex")}${path
          .extname(file.originalname)
          .toLowerCase()}`,
      ),
  }),
  limits: { fileSize: 200 * 1024 * 1024 }, // 单个文件最大 200MB
  fileFilter: (req, file, cb) => cb(null, !!mediaTypeOf(file.originalname)),
});

const JWT_SECRET = process.env.JWT_SECRET || "woshilanqiuzhishen"; // 用于加密令牌，上线必须在 .env 里换掉
if (IS_PRODUCTION && !process.env.JWT_SECRET) {
  console.error("上线环境必须在 .env 里设置 JWT_SECRET");
  process.exit(1);
}
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
// 权限检查中间件：研究者只能操作自己创建的问卷（以及其中的题目、提交记录），导师不受限制
// kind：questionnaire（地址里的 :id 是问卷）、question（:id 是题目）、submission（:id 是提交记录）
function requireAccess(kind) {
  return async (req, res, next) => {
    let connection;
    try {
      connection = await mysql.createConnection(dbConfig);
      let questionnaireId = null;
      if (kind === "questionnaire") {
        questionnaireId = req.params.id;
      } else {
        const table = kind === "question" ? "questions" : "submissions";
        const [rows] = await connection.execute(
          `SELECT questionnaire_id FROM ${table} WHERE id = ?`,
          [req.params.id],
        );
        questionnaireId = rows.length ? rows[0].questionnaire_id : null;
      }
      const access =
        questionnaireId === null
          ? "notfound"
          : await checkQuestionnaireAccess(
              connection,
              questionnaireId,
              req.admin,
            );
      await connection.end();
      if (access !== "ok") {
        const what = {
          questionnaire: "问卷",
          question: "题目",
          submission: "提交记录",
        }[kind];
        return res.status(access === "notfound" ? 404 : 403).json({
          success: false,
          message: access === "notfound" ? `${what}不存在` : "没有权限操作",
        });
      }
      next();
    } catch (err) {
      if (connection) await connection.end().catch(() => {});
      console.error("权限检查失败:", err);
      res.status(500).json({ success: false, message: "服务器错误" });
    }
  };
}

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "xinli0824",
  database: process.env.DB_NAME || "psych_assessment",
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

  const dimensions = await loadDimensions(connection, questionnaireId);
  const totalFormula = await getTotalFormula(connection, questionnaireId);

  const [answers] = await connection.execute(
    "SELECT * FROM answers WHERE submission_id = ?",
    [submissionId],
  );

  const result = computeScores(answers, questionMap, dimensions, totalFormula);
  return { ...result, questionMap, dimensions, totalFormula };
}

// 读取某份问卷的维度配置（每个维度带上 question_ids），按 id 排序
async function loadDimensions(connection, questionnaireId) {
  const [dimensions] = await connection.execute(
    "SELECT * FROM dimensions WHERE questionnaire_id = ? ORDER BY id ASC",
    [questionnaireId],
  );
  if (dimensions.length === 0) return dimensions;
  const [links] = await connection.execute(
    `SELECT dq.dimension_id, dq.question_id FROM dimension_questions dq
     JOIN dimensions d ON dq.dimension_id = d.id
     WHERE d.questionnaire_id = ? ORDER BY dq.id ASC`,
    [questionnaireId],
  );
  dimensions.forEach((dim) => {
    dim.question_ids = links
      .filter((l) => l.dimension_id === dim.id)
      .map((l) => l.question_id);
  });
  return dimensions;
}

// 总分算法（第8轮新增，默认「各维度得分相加」，和以前一样）
const TOTAL_FORMULAS = {
  dimensions: "各维度得分相加",
  items_sum: "维度里的题每题只算一次，相加",
  items_mean: "维度里的题每题只算一次，取平均",
};
async function getTotalFormula(connection, questionnaireId) {
  const [rows] = await connection.execute(
    "SELECT total_formula FROM questionnaires WHERE id = ?",
    [questionnaireId],
  );
  return rows[0]?.total_formula || "dimensions";
}

// 参与总分的题目 id：没有维度时是所有题；有维度时是各维度里的题（同一道题只算一次）
function totalQuestionIds(dimensions, questionMap) {
  if (dimensions.length === 0) return Object.keys(questionMap).map(Number);
  const ids = [];
  dimensions.forEach((d) =>
    (d.question_ids || []).forEach((id) => {
      if (!ids.includes(id)) ids.push(id);
    }),
  );
  return ids;
}

// 总分理论上的最低分和最高分
function totalRange(dimensions, questionMap, totalFormula) {
  if (
    dimensions.length > 0 &&
    (totalFormula || "dimensions") === "dimensions"
  ) {
    let lo = 0;
    let hi = 0;
    dimensions.forEach((d) => {
      const r = dimensionRange(d, questionMap);
      lo += r.min;
      hi += r.max;
    });
    return { min: Math.round(lo * 100) / 100, max: Math.round(hi * 100) / 100 };
  }
  const qs = totalQuestionIds(dimensions, questionMap)
    .map((id) => questionMap[id])
    .filter((q) => q && isScoredQuestion(q));
  return dimensionRange(
    {
      question_ids: qs.map((q) => q.id),
      score_formula: totalFormula === "items_mean" ? "mean" : "sum",
    },
    questionMap,
  );
}

// 某道题是否计分：量表题，或选项配了分值的单选题
function isScoredQuestion(q) {
  return (
    !q.question_type ||
    q.question_type === "scale" ||
    (q.question_type === "single_choice" &&
      parseOptionList(q.options).some((o) => o.score !== null))
  );
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
// totalFormula：总分算法，见 TOTAL_FORMULAS，不传就是「各维度得分相加」
function computeScores(answers, questionMap, dimensions, totalFormula) {
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
  } else if (totalFormula === "items_sum" || totalFormula === "items_mean") {
    // 维度里的题每题只算一次（一道题属于多个维度时不会重复计入总分）
    const scores = totalQuestionIds(dimensions, questionMap)
      .map((qid) => scoredAnswers[qid])
      .filter((s) => s !== undefined);
    const sum = scores.reduce((a, b) => a + b, 0);
    totalScore =
      totalFormula === "items_mean" && scores.length > 0
        ? sum / scores.length
        : sum;
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

// 导出 Excel 时每道题显示什么：有分数的显示分数（如「完全没有」显示 1），没有分数的显示文字
function exportAnswerCell(ans, q) {
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
      // 多选题存的是JSON数组，解析后用顿号连接
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

    const {
      totalScore,
      dimensionScores,
      questionMap,
      dimensions: dims,
    } = await calcScore(questionnaireId, submissionId, connection);

    // 问卷开启了「答完显示结果图表」时，准备每个维度的：自己的分、平均分、分数范围
    const [qRows] = await connection.execute(
      "SELECT show_report_chart, norm_in_report FROM questionnaires WHERE id = ?",
      [questionnaireId],
    );
    let chart = null;
    if (qRows[0]?.show_report_chart && dimensionScores.length > 0) {
      const { averages, sampleSize } = await calcDimensionAverages(
        connection,
        questionnaireId,
        questionMap,
        dims,
      );
      // 开启了「结果图表显示常模平均」时，按受测者的基本信息匹配一套常模
      let norm = null;
      if (qRows[0].norm_in_report) {
        const norms = await loadNorms(connection, questionnaireId);
        if (norms.length > 0) {
          norm = matchNorm(norms, await loadInfoMap(connection, submissionId));
        }
      }
      chart = {
        sample_size: sampleSize,
        norm_name: norm ? norm.name : null,
        dimensions: dims.map((dim, i) => {
          const mine = dimensionScores.find((d) => d.id === dim.id);
          const range = dimensionRange(dim, questionMap);
          const nv = norm ? norm.values[`dim${dim.id}`] : null;
          return {
            id: dim.id,
            name: dim.name,
            description: dim.description || "",
            score: mine ? mine.score : null,
            average: averages[i],
            norm_mean: nv ? Number(nv.mean) : null,
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
// 通过问卷组合作答时，还会带上 bundle_id、bundle_token（同一个人这次作答的几份问卷共用）、bundle_position（第几份）
// subject_info：基本信息 [{ field_key, field_label, value }]，可以随提交一起保存（旧版前端是提交后再单独保存）
app.post("/api/submission", async (req, res) => {
  const {
    questionnaire_id,
    started_at,
    finished_at,
    answers,
    tracking_code,
    group_label,
    bundle_id,
    bundle_token,
    bundle_position,
    subject_info,
  } = req.body;

  const connection = await mysql.createConnection(dbConfig);

  try {
    // 组合信息：组合里确实有这份问卷、标记格式正确才记录
    let bundleId = null;
    let bundleToken = null;
    let bundlePosition = null;
    if (
      bundle_id &&
      typeof bundle_token === "string" &&
      /^[A-Za-z0-9_-]{8,40}$/.test(bundle_token)
    ) {
      const [link] = await connection.execute(
        "SELECT id FROM bundle_questionnaires WHERE bundle_id = ? AND questionnaire_id = ?",
        [bundle_id, questionnaire_id],
      );
      if (link.length > 0) {
        bundleId = Number(bundle_id);
        bundleToken = bundle_token;
        bundlePosition = Number(bundle_position) || null;
      }
    }

    // 提交时间用服务器时间（以前直接存手机发来的 UTC 时间，显示出来差 8 小时）；
    // 开始时间 = 提交时间 − 作答时长（时长按手机发来的开始、结束时间算）
    const toMs = (t) =>
      typeof t === "string" ? Date.parse(t.replace(" ", "T") + "Z") : NaN;
    let durationSec = Math.round((toMs(finished_at) - toMs(started_at)) / 1000);
    if (
      !Number.isFinite(durationSec) ||
      durationSec < 0 ||
      durationSec > 7 * 86400
    )
      durationSec = 0;

    const [submissionResult] = await connection.execute(
      "INSERT INTO submissions (questionnaire_id, started_at, finished_at, tracking_code, group_label, bundle_id, bundle_token, bundle_position) VALUES (?, DATE_SUB(NOW(), INTERVAL ? SECOND), NOW(), ?, ?, ?, ?, ?)",
      [
        questionnaire_id,
        durationSec,
        tracking_code || null,
        group_label || null,
        bundleId,
        bundleToken,
        bundlePosition,
      ],
    );
    const submissionId = submissionResult.insertId;

    if (Array.isArray(subject_info)) {
      for (const item of subject_info) {
        if (!item || !item.field_key) continue;
        await connection.execute(
          "INSERT INTO subject_info (submission_id, field_key, field_label, value) VALUES (?, ?, ?, ?)",
          [
            submissionId,
            String(item.field_key),
            String(item.field_label || item.field_key),
            item.value === null || item.value === undefined
              ? ""
              : String(item.value),
          ],
        );
      }
    }

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

          // 选项图片在 Excel 里写不了：覆盖更新时，文字相同的选项保留原来的图片
          if (existing) {
            let oldOpts = existing.options;
            if (typeof oldOpts === "string") {
              try {
                oldOpts = JSON.parse(oldOpts);
              } catch {
                oldOpts = [];
              }
            }
            const imageByLabel = {};
            (Array.isArray(oldOpts) ? oldOpts : []).forEach((o) => {
              if (o && o.image) imageByLabel[o.label] = o.image;
            });
            options = options.map((o) =>
              imageByLabel[o.label]
                ? { ...o, image: imageByLabel[o.label] }
                : o,
            );
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
// 登录失败次数限制：同一个 IP 15 分钟内输错 10 次就暂时不让登录（防止被人反复猜密码）
const loginFails = new Map(); // ip -> { count, first }
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 10;
function loginBlocked(ip) {
  const r = loginFails.get(ip);
  if (!r) return false;
  if (Date.now() - r.first > LOGIN_WINDOW_MS) {
    loginFails.delete(ip);
    return false;
  }
  return r.count >= LOGIN_MAX_FAILS;
}
function recordLoginFail(ip) {
  const r = loginFails.get(ip);
  if (!r || Date.now() - r.first > LOGIN_WINDOW_MS) {
    loginFails.set(ip, { count: 1, first: Date.now() });
  } else {
    r.count++;
  }
}

app.post("/api/admin/login", async (req, res) => {
  const { username, password } = req.body;
  if (loginBlocked(req.ip)) {
    return res.status(429).json({
      success: false,
      message: "密码输错次数太多，请 15 分钟后再试",
    });
  }

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
      recordLoginFail(req.ip);
      return res
        .status(401)
        .json({ success: false, message: "账号或密码错误" });
    }

    const admin = rows[0];
    const isMatch = await bcrypt.compare(password, admin.password_hash);

    if (!isMatch) {
      recordLoginFail(req.ip);
      return res
        .status(401)
        .json({ success: false, message: "账号或密码错误" });
    }
    loginFails.delete(req.ip);

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

const PORT = Number(process.env.PORT) || 3000;
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

      // 常模（配置了的话，导出时附上 T 分）
      const norms = await loadNorms(connection, questionnaireId);

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
      // 有维度又配了常模时：匹配到的常模 + 总分和各维度的 T 分
      const useNorms = dimensions.length > 0 && norms.length > 0;
      const normHeaders = useNorms
        ? ["匹配的常模", "总分T分", ...dimensions.map((d) => `${d.name}T分`)]
        : [];

      const allHeaders = [
        ...fixedHeaders,
        ...questionScoreHeaders,
        ...questionTimeHeaders,
        ...(dimensions.length > 0 ? ["--- 计分结果 ---"] : []),
        ...dimensionHeaders,
        ...totalHeader,
        ...normHeaders,
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
        const rawScores = questions.map((q) =>
          exportAnswerCell(subAnswers[q.id], q),
        );

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
        let normCols = [];

        if (dimensions.length > 0) {
          // 用统一计分函数
          const result = computeScores(
            Object.values(subAnswers),
            questionMap,
            dimensions,
            questionnaire.total_formula,
          );
          dimensionScoreCols = result.dimensionScores.map((d) =>
            d.score === null ? "" : d.score,
          );
          totalScore = result.totalScore;
          if (useNorms) {
            const norm = matchNorm(norms, subjectInfoMap[sub.id] || {});
            const tOf = (key, x) => normCompare(norm, key, x)?.t ?? "";
            normCols = [
              norm ? norm.name : "未匹配",
              tOf("total", result.totalScore),
              ...result.dimensionScores.map((d) => tOf(`dim${d.id}`, d.score)),
            ];
          }
        }

        const row = [
          ...fixedCols,
          ...rawScores,
          ...timings,
          ...(dimensions.length > 0 ? [""] : []),
          ...dimensionScoreCols,
          ...(dimensions.length > 0 ? [totalScore] : []),
          ...normCols,
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
          qRows[0].total_formula,
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
  requireAccess("questionnaire"),
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
  requireAccess("questionnaire"),
  async (req, res) => {
    const questionnaireId = req.params.id;
    const { dimensions, total_formula } = req.body;

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

      // 总分算法（前端传了才改）
      if (total_formula && TOTAL_FORMULAS[total_formula]) {
        await connection.execute(
          "UPDATE questionnaires SET total_formula = ? WHERE id = ?",
          [total_formula, questionnaireId],
        );
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
app.get(
  "/api/submissions/:id/score",
  verifyAdminToken,
  requireAccess("submission"),
  async (req, res) => {
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
  },
);

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
      media,
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

      const cleanedMedia = cleanMedia(media);
      const [result] = await connection.execute(
        `INSERT INTO questions
        (questionnaire_id, content, question_type, options, min_score, max_score, role, order_num, is_reverse_scored, section_id, media)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          cleanedMedia ? JSON.stringify(cleanedMedia) : null,
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
app.put(
  "/api/questions/:id",
  verifyAdminToken,
  requireAccess("question"),
  async (req, res) => {
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
      media,
    } = req.body;

    try {
      const connection = await mysql.createConnection(dbConfig);
      const cleanedMedia = cleanMedia(media);
      await connection.execute(
        `UPDATE questions SET
        content = ?, question_type = ?, options = ?,
        min_score = ?, max_score = ?, role = ?, is_reverse_scored = ?, section_id = ?,
        media = ?
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
          cleanedMedia ? JSON.stringify(cleanedMedia) : null,
          questionId,
        ],
      );
      await connection.end();
      res.json({ success: true, message: "题目更新成功" });
    } catch (err) {
      console.error("编辑题目失败:", err);
      res.status(500).json({ success: false, message: "服务器错误" });
    }
  },
);

// 删除单道题目
app.delete(
  "/api/questions/:id",
  verifyAdminToken,
  requireAccess("question"),
  async (req, res) => {
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
  },
);

// 批量更新题目顺序（拖拽排序用）
app.put(
  "/api/questionnaires/:id/questions/reorder",
  verifyAdminToken,
  requireAccess("questionnaire"),
  async (req, res) => {
    const { orders } = req.body; // [{ id: 1, order_num: 1 }, { id: 3, order_num: 2 }, ...]

    if (!Array.isArray(orders)) {
      return res.status(400).json({ success: false, message: "参数格式错误" });
    }

    try {
      const connection = await mysql.createConnection(dbConfig);
      for (const item of orders) {
        await connection.execute(
          "UPDATE questions SET order_num = ? WHERE id = ? AND questionnaire_id = ?",
          [item.order_num, item.id, req.params.id],
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
app.get(
  "/api/submissions/:id/answers",
  verifyAdminToken,
  requireAccess("submission"),
  async (req, res) => {
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
  },
);

// 获取某份问卷的分数段配置
app.get(
  "/api/questionnaires/:id/score-rules",
  verifyAdminToken,
  requireAccess("questionnaire"),
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
  requireAccess("questionnaire"),
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
app.get(
  "/api/submissions/:id/report",
  verifyAdminToken,
  requireAccess("submission"),
  async (req, res) => {
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

      // 和常模比较（配置了常模、并且按基本信息匹配到了才有）
      const norms = await loadNorms(connection, questionnaireId);
      let norm = null;
      if (norms.length > 0) {
        norm = matchNorm(norms, await loadInfoMap(connection, submissionId));
      }

      await connection.end();
      res.json({
        success: true,
        total_score: totalScore,
        dimension_scores: dimensions.map((d) => ({
          ...d,
          norm: normCompare(norm, `dim${d.id}`, d.score),
        })), // 每个维度带 matched_rule
        matched_rule: totalRule,
        has_norms: norms.length > 0,
        norm_name: norm ? norm.name : null,
        total_norm: normCompare(norm, "total", totalScore),
      });
    } catch (err) {
      console.error("获取报告失败:", err);
      res.status(500).json({ success: false, message: "服务器错误" });
    }
  },
);

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
    // 只能给还没有基本信息的提交保存一次，防止别人改写已有记录
    const [exist] = await connection.execute(
      "SELECT COUNT(*) AS n FROM subject_info WHERE submission_id = ?",
      [submissionId],
    );
    if (exist[0].n > 0) {
      await connection.end();
      return res
        .status(409)
        .json({ success: false, message: "这次提交已经有基本信息了" });
    }
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
  requireAccess("submission"),
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

// 某份问卷的统计分析（统计页面和「导出统计结果」共用）
// opts：group（只看某个分组，"__none__" 表示未分组）、completeOnly（只统计完整作答）、
//       excludeFast（排除作答过快：平均每题不到 2 秒）、compareGroups（参与差异检验的分组，不传就自动选）
// 返回 { error: { status, message } } 或统计结果
async function computeStats(connection, questionnaireId, admin, opts) {
  const groupFilter = opts.group || "";
  const completeOnly = opts.completeOnly !== false;
  const excludeFast = !!opts.excludeFast;
  const FAST_MS = 2000;
  const NO_GROUP = "__none__";
  const round = (x, d) =>
    x === null || x === undefined || !Number.isFinite(x)
      ? null
      : Math.round(x * 10 ** d) / 10 ** d;

  const [qRows] = await connection.execute(
    "SELECT * FROM questionnaires WHERE id = ?",
    [questionnaireId],
  );
  if (qRows.length === 0)
    return { error: { status: 404, message: "问卷不存在" } };
  if (admin.role !== "supervisor" && qRows[0].created_by !== admin.adminId) {
    return { error: { status: 403, message: "没有权限查看这份问卷的数据" } };
  }
  const totalFormula = qRows[0].total_formula || "dimensions";

  const [questions] = await connection.execute(
    "SELECT * FROM questions WHERE questionnaire_id = ? ORDER BY order_num ASC",
    [questionnaireId],
  );
  const questionMap = {};
  questions.forEach((q) => (questionMap[q.id] = q));
  const dimensions = await loadDimensions(connection, questionnaireId);

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
  const norms = await loadNorms(connection, questionnaireId);
  const [allInfo] = await connection.execute(
    `SELECT si.submission_id, si.field_key, si.value FROM subject_info si
       INNER JOIN submissions s ON si.submission_id = s.id
       WHERE s.questionnaire_id = ?`,
    [questionnaireId],
  );
  const [infoFields] = await connection.execute(
    "SELECT field_key, field_label FROM subject_info_fields WHERE questionnaire_id = ?",
    [questionnaireId],
  );

  const answersBySub = {};
  allAnswers.forEach((a) => {
    if (!answersBySub[a.submission_id]) answersBySub[a.submission_id] = [];
    answersBySub[a.submission_id].push(a);
  });
  const infoBySub = {};
  allInfo.forEach((i) => {
    if (!infoBySub[i.submission_id]) infoBySub[i.submission_id] = {};
    infoBySub[i.submission_id][i.field_key] = i.value;
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
      ...computeScores(answers, questionMap, dimensions, totalFormula),
    });
  });
  const valid = groupFilter
    ? kept.filter((k) => groupKey(k.sub) === groupFilter)
    : kept;

  // ---- 第二步：回收概况 ----
  const seconds = valid
    .filter((k) => k.sub.started_at && k.sub.finished_at)
    .map(
      (k) => (new Date(k.sub.finished_at) - new Date(k.sub.started_at)) / 1000,
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
  const scoredQuestions = questions.filter(isScoredQuestion);
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
  // 每个指标在每份作答里的得分（没有得分时为 null）
  const scoreOf = (k, key) => {
    if (key === "total") {
      return Object.keys(k.scoredAnswers).length > 0 ? k.totalScore : null;
    }
    const d = k.dimensionScores.find((x) => `dim${x.id}` === key);
    return d ? d.score : null;
  };
  const scoredIds = (ids) =>
    ids.filter((id) => questionMap[id] && isScoredQuestion(questionMap[id]));
  if (scoredQuestions.length > 0) {
    const r = totalRange(dimensions, questionMap, totalFormula);
    const values = valid
      .map((k) => scoreOf(k, "total"))
      .filter((v) => v !== null);
    measures.push({
      key: "total",
      name: "总分",
      formula:
        dimensions.length > 0 ? TOTAL_FORMULAS[totalFormula] : "所有计分题相加",
      range: r,
      item_ids: scoredIds(totalQuestionIds(dimensions, questionMap)),
      ...describe(values),
      histogram: histogram(values, r.min, r.max),
      bands: bandsOf(values, null),
    });
  }
  dimensions.forEach((dim) => {
    const r = dimensionRange(dim, questionMap);
    const key = `dim${dim.id}`;
    const values = valid.map((k) => scoreOf(k, key)).filter((v) => v !== null);
    measures.push({
      key,
      name: dim.name,
      formula: dim.score_formula === "mean" ? "均值" : "求和",
      range: r,
      item_ids: scoredIds(dim.question_ids),
      ...describe(values),
      histogram: histogram(values, r.min, r.max),
      bands: bandsOf(values, dim.id),
    });
  });

  // ---- 第四步：分组对比（不受分组筛选影响）+ 差异检验 ----
  const groupCompare = groups.map((g) => {
    const members = kept.filter((k) => groupKey(k.sub) === g.value);
    const result = {
      value: g.value,
      label: g.label,
      n: members.length,
      measures: {},
    };
    measures.forEach((m) => {
      const d = describe(
        members.map((k) => scoreOf(k, m.key)).filter((v) => v !== null),
      );
      result.measures[m.key] = { n: d.n, mean: d.mean, sd: d.sd };
    });
    return result;
  });
  // 参与检验的分组：指定了就用指定的；没指定时用有名字的分组（至少 2 个），不够再把「未分组」算上
  const testable = groupCompare.filter((g) => g.n >= 2);
  let compareValues;
  if (Array.isArray(opts.compareGroups) && opts.compareGroups.length > 0) {
    compareValues = testable
      .filter((g) => opts.compareGroups.includes(g.value))
      .map((g) => g.value);
  } else {
    const named = testable.filter((g) => g.value !== NO_GROUP);
    compareValues = (named.length >= 2 ? named : testable).map((g) => g.value);
  }
  const groupTests = { groups: compareValues, results: {} };
  measures.forEach((m) => {
    const samples = compareValues
      .map((gv) =>
        kept
          .filter((k) => groupKey(k.sub) === gv)
          .map((k) => scoreOf(k, m.key))
          .filter((v) => v !== null),
      )
      .filter((arr) => arr.length >= 2);
    let result = null;
    if (samples.length === 2) {
      const r = statsMath.welchT(samples[0], samples[1]);
      if (r) {
        result = {
          method: "t",
          stat: round(r.t, 2),
          df1: round(r.df, 2),
          df2: null,
          p: round(r.p, 4),
          effect_name: "d",
          effect: round(r.d, 2),
        };
      }
    } else if (samples.length >= 3) {
      const r = statsMath.anovaOneWay(samples);
      if (r) {
        result = {
          method: "anova",
          stat: round(r.f, 2),
          df1: r.df1,
          df2: r.df2,
          p: round(r.p, 4),
          effect_name: "η²",
          effect: round(r.eta2, 3),
        };
      }
    }
    groupTests.results[m.key] = result
      ? { ...result, group_count: samples.length }
      : null;
  });

  // ---- 第五步：信度分析（Cronbach's α）和项目分析 ----
  // 用反向计分之后的分数；只用这个指标里每道题都有得分的作答
  const reliability = measures.map((m) => {
    const ids = m.item_ids;
    const rows = [];
    valid.forEach((k) => {
      const row = ids.map((id) => k.scoredAnswers[id]);
      if (row.every((v) => v !== undefined)) rows.push(row);
    });
    let note = "";
    if (ids.length < 2) note = "计分题少于 2 道，无法计算";
    else if (rows.length < 3) note = "有效人数太少（至少需要 3 人）";
    const alpha = note ? null : statsMath.cronbachAlpha(rows);
    if (!note && alpha === null) note = "所有人得分完全相同，无法计算";
    const items =
      ids.length >= 2 && rows.length >= 3
        ? statsMath.itemAnalysis(rows).map((it, j) => {
            const q = questionMap[ids[j]];
            return {
              id: q.id,
              order_num: q.order_num,
              content: q.content,
              reverse: !!q.is_reverse_scored,
              mean: round(it.mean, 2),
              sd: round(it.sd, 2),
              citc: round(it.citc, 3),
              alpha_if_deleted: round(it.alpha_if_deleted, 3),
            };
          })
        : [];
    return {
      key: m.key,
      name: m.name,
      k: ids.length,
      n: rows.length,
      alpha: round(alpha, 3),
      note,
      items,
    };
  });

  // ---- 第六步：和常模比较 ----
  const labelOfField = {};
  infoFields.forEach((f) => (labelOfField[f.field_key] = f.field_label));
  const conditionText = (n) =>
    (n.conditions || []).length === 0
      ? "所有人"
      : n.conditions
          .map((c) => {
            const label = labelOfField[c.field_key] || c.field_key;
            if (c.op === "range") {
              const lo = c.min ?? "";
              const hi = c.max ?? "";
              return `${label} ${lo}~${hi}`;
            }
            return `${label}=${c.value}`;
          })
          .join("，");
  const normCompareResult = {
    has_norms: norms.length > 0,
    unmatched: 0,
    rows: [],
  };
  if (norms.length > 0) {
    const matched = new Map(); // norm.id -> 作答列表
    valid.forEach((k) => {
      const n = matchNorm(norms, infoBySub[k.sub.id] || {});
      if (!n) {
        normCompareResult.unmatched++;
        return;
      }
      if (!matched.has(n.id)) matched.set(n.id, []);
      matched.get(n.id).push(k);
    });
    norms.forEach((n) => {
      const members = matched.get(n.id) || [];
      measures.forEach((m) => {
        const nv = n.values[m.key];
        if (!nv) return;
        const values = members
          .map((k) => scoreOf(k, m.key))
          .filter((v) => v !== null);
        const d = describe(values);
        const test = statsMath.oneSampleT(values, Number(nv.mean));
        const zs = values.map((v) => (v - Number(nv.mean)) / Number(nv.sd));
        normCompareResult.rows.push({
          norm_id: n.id,
          norm_name: n.name,
          source: n.source,
          condition_text: conditionText(n),
          measure_key: m.key,
          measure_name: m.name,
          n: d.n,
          mean: d.mean,
          sd: d.sd,
          norm_mean: Number(nv.mean),
          norm_sd: Number(nv.sd),
          diff: d.n > 0 ? round(d.mean - Number(nv.mean), 2) : null,
          t: test ? round(test.t, 2) : null,
          df: test ? test.df : null,
          p: test ? round(test.p, 4) : null,
          d: test ? round(test.d, 2) : null,
          high: zs.filter((z) => z >= 1).length, // T ≥ 60
          low: zs.filter((z) => z <= -1).length, // T ≤ 40
        });
      });
    });
  }

  // ---- 第七步：逐题分析（原始作答，反向题没有反转） ----
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

  return {
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
    group_tests: groupTests,
    reliability,
    norm_compare: normCompareResult,
    items,
  };
}

// 统计页面上的筛选条件 → computeStats 的参数
function statsOptsFromQuery(query) {
  return {
    group: query.group || "",
    completeOnly: query.complete_only !== "0",
    excludeFast: query.exclude_fast === "1",
    compareGroups: query.compare_groups
      ? String(query.compare_groups).split(",").filter(Boolean)
      : null,
  };
}

app.get("/api/questionnaires/:id/stats", verifyAdminToken, async (req, res) => {
  const connection = await mysql.createConnection(dbConfig);
  try {
    const stats = await computeStats(
      connection,
      Number(req.params.id),
      req.admin,
      statsOptsFromQuery(req.query),
    );
    await connection.end();
    if (stats.error) {
      return res
        .status(stats.error.status)
        .json({ success: false, message: stats.error.message });
    }
    res.json({ success: true, ...stats });
  } catch (err) {
    await connection.end().catch(() => {});
    console.error("统计分析失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// p 值显示成论文里常见的写法
function formatP(p) {
  if (p === null || p === undefined) return "";
  if (p < 0.001) return "< .001";
  return p.toFixed(3).replace(/^0/, "");
}

// α 系数的常用评价标准
function alphaLevel(alpha) {
  if (alpha === null || alpha === undefined) return "";
  if (alpha < 0) return "为负数，可能有题漏设反向计分";
  if (alpha >= 0.9) return "很好";
  if (alpha >= 0.8) return "良好";
  if (alpha >= 0.7) return "可以接受";
  if (alpha >= 0.6) return "勉强可用";
  return "偏低";
}

// 导出统计结果（和统计页面一样的筛选条件），每块内容一个工作表
app.get(
  "/api/questionnaires/:id/stats/export",
  verifyAdminToken,
  async (req, res) => {
    const connection = await mysql.createConnection(dbConfig);
    try {
      const opts = statsOptsFromQuery(req.query);
      const st = await computeStats(
        connection,
        Number(req.params.id),
        req.admin,
        opts,
      );
      await connection.end();
      if (st.error) {
        return res
          .status(st.error.status)
          .json({ success: false, message: st.error.message });
      }

      const wb = new ExcelJS.Workbook();
      const head = (sheet, cols) => {
        const row = sheet.addRow(cols);
        row.font = { bold: true };
        row.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE8F5E9" },
        };
      };
      const v = (x) => (x === null || x === undefined ? "" : x);
      const groupLabel = (val) =>
        st.groups.find((g) => g.value === val)?.label || val;

      // 说明
      const info = wb.addWorksheet("说明");
      info.addRow(["问卷", st.questionnaire.title]);
      info.addRow(["导出时间", new Date().toLocaleString("zh-CN")]);
      info.addRow([
        "筛选条件",
        [
          st.filter.group
            ? `只看分组「${groupLabel(st.filter.group)}」`
            : "全部分组",
          st.filter.complete_only ? "只统计完整作答" : "包含不完整作答",
          st.filter.exclude_fast ? "排除作答过快（平均每题不到 2 秒）" : "",
        ]
          .filter(Boolean)
          .join("；"),
      ]);
      info.addRow(["有效作答", `${st.overview.valid} 份`]);
      info.addRow([
        "作答用时",
        st.overview.duration.n > 0
          ? `中位数 ${Math.round(st.overview.duration.median)} 秒`
          : "",
      ]);
      info.getColumn(1).width = 14;
      info.getColumn(2).width = 60;

      // 得分统计
      const ms = wb.addWorksheet("得分统计");
      head(ms, [
        "指标",
        "计分方式",
        "人数",
        "平均分",
        "标准差",
        "中位数",
        "最低分",
        "最高分",
        "理论范围",
      ]);
      st.measures.forEach((m) =>
        ms.addRow([
          m.name,
          m.formula,
          m.n,
          v(m.mean),
          v(m.sd),
          v(m.median),
          v(m.min),
          v(m.max),
          `${m.range.min}~${m.range.max}`,
        ]),
      );
      ms.columns.forEach((c) => (c.width = 12));
      ms.getColumn(2).width = 28;

      // 分数段人数
      const bs = wb.addWorksheet("分数段人数");
      head(bs, ["指标", "分数段", "分数范围", "人数", "百分比(%)"]);
      st.measures.forEach((m) =>
        m.bands.forEach((b) =>
          bs.addRow([
            m.name,
            b.label,
            b.min === null ? "" : `${b.min}~${b.max}`,
            b.count,
            m.n ? Math.round((b.count / m.n) * 1000) / 10 : 0,
          ]),
        ),
      );
      bs.columns.forEach((c) => (c.width = 14));

      // 分组对比 + 差异检验
      const groupRows = st.group_compare.filter((g) => g.n > 0);
      if (groupRows.length >= 2 && st.measures.length > 0) {
        const gs = wb.addWorksheet("分组对比");
        head(gs, [
          "分组",
          "人数",
          ...st.measures.flatMap((m) => [
            `${m.name}_平均分`,
            `${m.name}_标准差`,
          ]),
        ]);
        groupRows.forEach((g) =>
          gs.addRow([
            g.label,
            g.n,
            ...st.measures.flatMap((m) => [
              v(g.measures[m.key].mean),
              v(g.measures[m.key].sd),
            ]),
          ]),
        );
        gs.addRow([]);
        gs.addRow([
          `差异检验（参与比较的分组：${st.group_tests.groups.map(groupLabel).join("、")}）`,
        ]).font = { bold: true };
        head(gs, [
          "指标",
          "方法",
          "统计量",
          "自由度",
          "p 值",
          "效应量",
          "是否显著(p<.05)",
        ]);
        st.measures.forEach((m) => {
          const r = st.group_tests.results[m.key];
          if (!r) {
            gs.addRow([m.name, "人数不足，无法检验"]);
            return;
          }
          gs.addRow([
            m.name,
            r.method === "t" ? "t 检验（Welch）" : "单因素方差分析",
            r.method === "t" ? `t = ${r.stat}` : `F = ${r.stat}`,
            r.method === "t" ? r.df1 : `${r.df1}, ${r.df2}`,
            formatP(r.p),
            `${r.effect_name} = ${r.effect}`,
            r.p < 0.05 ? "显著" : "不显著",
          ]);
        });
        gs.columns.forEach((c) => (c.width = 14));
        gs.getColumn(1).width = 18;
      }

      // 信度分析 + 项目分析
      if (st.reliability.length > 0) {
        const rs = wb.addWorksheet("信度分析");
        head(rs, ["指标", "题数", "有效人数", "Cronbach's α", "评价", "备注"]);
        st.reliability.forEach((r) =>
          rs.addRow([
            r.name,
            r.k,
            r.n,
            v(r.alpha),
            alphaLevel(r.alpha),
            r.note,
          ]),
        );
        rs.addRow([]);
        rs.addRow([
          "说明：用反向计分后的分数计算；只用该指标每道题都有得分的作答。α ≥ 0.9 很好，0.8~0.9 良好，0.7~0.8 可以接受，0.6~0.7 勉强可用，低于 0.6 偏低。",
        ]);
        rs.columns.forEach((c) => (c.width = 14));

        const is = wb.addWorksheet("项目分析");
        head(is, [
          "指标",
          "题号",
          "题目",
          "平均分",
          "标准差",
          "校正题总相关",
          "删除该题后的 α",
          "提示",
        ]);
        st.reliability.forEach((r) =>
          r.items.forEach((it) => {
            let tip = "";
            if (it.citc !== null && it.citc < 0)
              tip = "与其他题负相关，检查是否漏设反向计分";
            else if (it.citc !== null && it.citc < 0.3)
              tip = "与其他题相关偏低";
            if (
              it.alpha_if_deleted !== null &&
              r.alpha !== null &&
              it.alpha_if_deleted > r.alpha + 0.01
            )
              tip += (tip ? "；" : "") + "删去后 α 会提高";
            is.addRow([
              r.name,
              `Q${it.order_num}`,
              it.content,
              v(it.mean),
              v(it.sd),
              v(it.citc),
              v(it.alpha_if_deleted),
              tip,
            ]);
          }),
        );
        is.columns.forEach((c) => (c.width = 12));
        is.getColumn(3).width = 40;
        is.getColumn(8).width = 30;
      }

      // 常模比较
      if (st.norm_compare.rows.length > 0) {
        const ns = wb.addWorksheet("常模比较");
        head(ns, [
          "常模",
          "适用人群",
          "指标",
          "样本人数",
          "样本平均分",
          "样本标准差",
          "常模平均分",
          "常模标准差",
          "差值",
          "t",
          "自由度",
          "p 值",
          "d",
          "T≥60 人数",
          "T≤40 人数",
        ]);
        st.norm_compare.rows.forEach((r) =>
          ns.addRow([
            r.norm_name,
            r.condition_text,
            r.measure_name,
            r.n,
            v(r.mean),
            v(r.sd),
            r.norm_mean,
            r.norm_sd,
            v(r.diff),
            v(r.t),
            v(r.df),
            formatP(r.p),
            v(r.d),
            r.high,
            r.low,
          ]),
        );
        if (st.norm_compare.unmatched > 0) {
          ns.addRow([]);
          ns.addRow([
            `另有 ${st.norm_compare.unmatched} 份作答按基本信息没有匹配到常模，未计入。`,
          ]);
        }
        ns.columns.forEach((c) => (c.width = 12));
      }

      // 逐题分布
      const ds = wb.addWorksheet("逐题分布");
      head(ds, [
        "题号",
        "题目",
        "作答人数",
        "平均分",
        "标准差",
        "选项",
        "人数",
        "百分比(%)",
      ]);
      st.items.forEach((it) => {
        const base = [
          `Q${it.order_num}`,
          it.content,
          it.n,
          it.score ? v(it.score.mean) : "",
          it.score ? v(it.score.sd) : "",
        ];
        if (it.distribution.length === 0) {
          ds.addRow([...base, it.type === "open_text" ? "（开放题）" : ""]);
        }
        it.distribution.forEach((d, i) =>
          ds.addRow([
            ...(i === 0 ? base : ["", "", "", "", ""]),
            d.label,
            d.count,
            d.pct,
          ]),
        );
      });
      ds.getColumn(2).width = 40;
      ds.getColumn(6).width = 20;

      const filename = encodeURIComponent(
        `${st.questionnaire.title}_统计结果.xlsx`,
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${filename}`,
      );
      await wb.xlsx.write(res);
      res.end();
    } catch (err) {
      await connection.end().catch(() => {});
      console.error("导出统计结果失败:", err);
      res.status(500).json({ success: false, message: "导出失败" });
    }
  },
);

// ========== 常模 ==========
// 一份问卷可以有多套常模（如 全国常模、男生、女生），每套带适用条件和各指标（总分、各维度）的均值、标准差。
// 受测者匹配常模：所有条件都满足的常模里，选条件最多的那套（最具体）；条件为空的那套适用所有人。

async function loadNorms(connection, questionnaireId) {
  const [rows] = await connection.execute(
    "SELECT * FROM norms WHERE questionnaire_id = ? ORDER BY order_num ASC, id ASC",
    [questionnaireId],
  );
  const parse = (v, fallback) => {
    if (v === null || v === undefined) return fallback;
    if (typeof v === "string") {
      try {
        return JSON.parse(v);
      } catch {
        return fallback;
      }
    }
    return v;
  };
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    source: r.source || "",
    conditions: parse(r.conditions, []) || [],
    values: parse(r.norm_values, {}) || {},
  }));
}

// infoMap：{ 字段标识: 填写的值 }
function normMatches(norm, infoMap) {
  return (norm.conditions || []).every((c) => {
    const raw = infoMap[c.field_key];
    if (raw === undefined || raw === null || String(raw).trim() === "")
      return false;
    if (c.op === "range") {
      const v = Number(raw);
      if (!Number.isFinite(v)) return false;
      if (
        c.min !== null &&
        c.min !== undefined &&
        c.min !== "" &&
        v < Number(c.min)
      )
        return false;
      if (
        c.max !== null &&
        c.max !== undefined &&
        c.max !== "" &&
        v > Number(c.max)
      )
        return false;
      return true;
    }
    return String(raw).trim() === String(c.value ?? "").trim();
  });
}

function matchNorm(norms, infoMap) {
  let best = null;
  for (const n of norms) {
    if (!normMatches(n, infoMap || {})) continue;
    if (!best || (n.conditions || []).length > (best.conditions || []).length)
      best = n;
  }
  return best;
}

// 得分换算成 z 分数；这套常模没填这个指标、或没有得分时返回 null
function normZ(norm, key, score) {
  if (!norm || score === null || score === undefined || score === "")
    return null;
  const v = norm.values[key];
  if (!v || !(Number(v.sd) > 0) || !Number.isFinite(Number(v.mean)))
    return null;
  return (Number(score) - Number(v.mean)) / Number(v.sd);
}

// 和常模比较的结果：T 分、百分位（按正态分布估计）
function normCompare(norm, key, score) {
  const z = normZ(norm, key, score);
  if (z === null) return null;
  const v = norm.values[key];
  const pctile = Math.round(statsMath.normalCdf(z) * 100);
  return {
    norm_name: norm.name,
    mean: Number(v.mean),
    sd: Number(v.sd),
    z: Math.round(z * 100) / 100,
    t: Math.round((50 + 10 * z) * 10) / 10,
    percentile: Math.min(99, Math.max(1, pctile)),
  };
}

// 某次提交的基本信息 { 字段标识: 值 }
async function loadInfoMap(connection, submissionId) {
  const [rows] = await connection.execute(
    "SELECT field_key, value FROM subject_info WHERE submission_id = ?",
    [submissionId],
  );
  const map = {};
  rows.forEach((r) => (map[r.field_key] = r.value));
  return map;
}

// 读取常模配置（同时返回可以设置常模的指标和基本信息字段，配置页面要用）
app.get("/api/questionnaires/:id/norms", verifyAdminToken, async (req, res) => {
  const connection = await mysql.createConnection(dbConfig);
  try {
    const access = await checkQuestionnaireAccess(
      connection,
      req.params.id,
      req.admin,
    );
    if (access !== "ok") {
      await connection.end();
      return sendAccessError(res, access, "问卷");
    }
    const [qRows] = await connection.execute(
      "SELECT id, title, norm_in_report, show_report_chart, total_formula FROM questionnaires WHERE id = ?",
      [req.params.id],
    );
    const dimensions = await loadDimensions(connection, req.params.id);
    const [fields] = await connection.execute(
      "SELECT field_key, field_label, field_type, options FROM subject_info_fields WHERE questionnaire_id = ? ORDER BY order_num ASC",
      [req.params.id],
    );
    const norms = await loadNorms(connection, req.params.id);
    await connection.end();
    res.json({
      success: true,
      questionnaire: qRows[0],
      measures: [
        { key: "total", name: "总分" },
        ...dimensions.map((d) => ({
          key: `dim${d.id}`,
          name: d.name,
          formula: d.score_formula,
        })),
      ],
      info_fields: fields.map((f) => ({
        ...f,
        options:
          typeof f.options === "string"
            ? JSON.parse(f.options || "[]")
            : f.options || [],
      })),
      norms,
    });
  } catch (err) {
    await connection.end().catch(() => {});
    console.error("读取常模失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 保存常模配置（全量更新）：{ norms: [{ name, source, conditions, values }], norm_in_report }
app.post(
  "/api/questionnaires/:id/norms",
  verifyAdminToken,
  async (req, res) => {
    const list = req.body.norms;
    if (!Array.isArray(list)) {
      return res.status(400).json({ success: false, message: "参数格式错误" });
    }
    // 整理并检查
    const cleaned = [];
    for (let i = 0; i < list.length; i++) {
      const n = list[i] || {};
      const name = String(n.name || "").trim();
      if (!name) {
        return res
          .status(400)
          .json({ success: false, message: `第 ${i + 1} 套常模还没有填名称` });
      }
      const values = {};
      for (const [key, v] of Object.entries(n.values || {})) {
        const blank = (x) => x === null || x === undefined || x === "";
        if (!v || (blank(v.mean) && blank(v.sd))) continue; // 这个指标没填
        const mean = Number(v.mean);
        const sd = Number(v.sd);
        if (
          blank(v.mean) ||
          blank(v.sd) ||
          !Number.isFinite(mean) ||
          !(sd > 0)
        ) {
          return res.status(400).json({
            success: false,
            message: `「${name}」有指标只填了一半，或标准差不大于 0`,
          });
        }
        values[key] = { mean, sd };
      }
      const conditions = (Array.isArray(n.conditions) ? n.conditions : [])
        .filter((c) => c && c.field_key)
        .map((c) =>
          c.op === "range"
            ? {
                field_key: c.field_key,
                op: "range",
                min: c.min === "" || c.min === undefined ? null : Number(c.min),
                max: c.max === "" || c.max === undefined ? null : Number(c.max),
              }
            : {
                field_key: c.field_key,
                op: "eq",
                value: String(c.value ?? ""),
              },
        );
      cleaned.push({
        name,
        source: String(n.source || ""),
        conditions,
        values,
      });
    }

    const connection = await mysql.createConnection(dbConfig);
    try {
      const access = await checkQuestionnaireAccess(
        connection,
        req.params.id,
        req.admin,
      );
      if (access !== "ok") {
        await connection.end();
        return sendAccessError(res, access, "问卷");
      }
      await connection.beginTransaction();
      await connection.execute("DELETE FROM norms WHERE questionnaire_id = ?", [
        req.params.id,
      ]);
      for (let i = 0; i < cleaned.length; i++) {
        const n = cleaned[i];
        await connection.execute(
          "INSERT INTO norms (questionnaire_id, name, source, conditions, norm_values, order_num) VALUES (?, ?, ?, ?, ?, ?)",
          [
            req.params.id,
            n.name,
            n.source,
            JSON.stringify(n.conditions),
            JSON.stringify(n.values),
            i + 1,
          ],
        );
      }
      if (req.body.norm_in_report !== undefined) {
        await connection.execute(
          "UPDATE questionnaires SET norm_in_report = ? WHERE id = ?",
          [req.body.norm_in_report ? 1 : 0, req.params.id],
        );
      }
      await connection.commit();
      await connection.end();
      res.json({ success: true, message: "常模已保存" });
    } catch (err) {
      await connection.rollback().catch(() => {});
      await connection.end().catch(() => {});
      console.error("保存常模失败:", err);
      res.status(500).json({ success: false, message: "服务器错误" });
    }
  },
);

// ========== 问卷组合：一个链接依次作答多份问卷 ==========

// 当前账号能不能管理这个组合：返回 "ok" / "notfound" / "forbidden"
async function checkBundleAccess(connection, bundleId, admin) {
  const [rows] = await connection.execute(
    "SELECT created_by FROM bundles WHERE id = ?",
    [bundleId],
  );
  if (rows.length === 0) return "notfound";
  if (admin.role !== "supervisor" && rows[0].created_by !== admin.adminId) {
    return "forbidden";
  }
  return "ok";
}

function sendAccessError(res, access, what = "问卷组合") {
  return res.status(access === "notfound" ? 404 : 403).json({
    success: false,
    message: access === "notfound" ? `${what}不存在` : "没有权限操作",
  });
}

// 组合里的问卷（按顺序），带题目数
async function loadBundleQuestionnaires(connection, bundleId) {
  const [rows] = await connection.execute(
    `SELECT q.id, q.title, q.is_active, bq.order_num,
       (SELECT COUNT(*) FROM questions WHERE questionnaire_id = q.id) AS question_count
     FROM bundle_questionnaires bq JOIN questionnaires q ON bq.questionnaire_id = q.id
     WHERE bq.bundle_id = ? ORDER BY bq.order_num ASC, bq.id ASC`,
    [bundleId],
  );
  return rows;
}

// 组合列表
app.get("/api/bundles", verifyAdminToken, async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const isSup = req.admin.role === "supervisor";
    const [bundles] = await connection.execute(
      `SELECT b.*, a.display_name AS creator_name FROM bundles b
       LEFT JOIN admins a ON b.created_by = a.id
       ${isSup ? "" : "WHERE b.created_by = ?"}
       ORDER BY b.created_at DESC`,
      isSup ? [] : [req.admin.adminId],
    );
    for (const b of bundles) {
      b.questionnaires = await loadBundleQuestionnaires(connection, b.id);
      // 参与人数：按 bundle_token 计；全部问卷都交了才算完成
      const [cnt] = await connection.execute(
        `SELECT bundle_token, COUNT(DISTINCT questionnaire_id) AS done
         FROM submissions WHERE bundle_id = ? AND bundle_token IS NOT NULL
         GROUP BY bundle_token`,
        [b.id],
      );
      b.participants = cnt.length;
      b.completed = cnt.filter((c) => c.done >= b.questionnaires.length).length;
    }
    await connection.end();
    res.json({ success: true, bundles });
  } catch (err) {
    console.error("获取问卷组合失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 单个组合详情
app.get("/api/bundles/:id", verifyAdminToken, async (req, res) => {
  const connection = await mysql.createConnection(dbConfig);
  try {
    const access = await checkBundleAccess(
      connection,
      req.params.id,
      req.admin,
    );
    if (access !== "ok") {
      await connection.end();
      return sendAccessError(res, access);
    }
    const [rows] = await connection.execute(
      "SELECT * FROM bundles WHERE id = ?",
      [req.params.id],
    );
    const bundle = rows[0];
    bundle.questionnaires = await loadBundleQuestionnaires(
      connection,
      bundle.id,
    );
    const [cnt] = await connection.execute(
      "SELECT COUNT(DISTINCT bundle_token) AS n FROM submissions WHERE bundle_id = ?",
      [bundle.id],
    );
    bundle.participants = cnt[0].n;
    await connection.end();
    res.json({ success: true, bundle });
  } catch (err) {
    await connection.end().catch(() => {});
    console.error("获取问卷组合失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 保存组合（新建和修改共用）：{ title, description, consent_text, shuffle, is_active, questionnaire_ids: [按顺序] }
async function saveBundle(connection, bundleId, body, admin) {
  const ids = [
    ...new Set((body.questionnaire_ids || []).map(Number).filter((x) => x > 0)),
  ];
  if (!body.title || !String(body.title).trim()) return "组合名称不能为空";
  if (ids.length === 0) return "请至少选择一份问卷";
  for (const qid of ids) {
    if ((await checkQuestionnaireAccess(connection, qid, admin)) !== "ok") {
      return "只能选择自己有权限的问卷";
    }
  }
  const fields = [
    String(body.title).trim(),
    body.description || "",
    body.consent_text || "",
    body.shuffle ? 1 : 0,
    body.is_active === false ? 0 : 1,
  ];
  if (bundleId) {
    await connection.execute(
      "UPDATE bundles SET title = ?, description = ?, consent_text = ?, shuffle = ?, is_active = ? WHERE id = ?",
      [...fields, bundleId],
    );
    await connection.execute(
      "DELETE FROM bundle_questionnaires WHERE bundle_id = ?",
      [bundleId],
    );
  } else {
    const [r] = await connection.execute(
      "INSERT INTO bundles (title, description, consent_text, shuffle, is_active, created_by) VALUES (?, ?, ?, ?, ?, ?)",
      [...fields, admin.adminId],
    );
    bundleId = r.insertId;
  }
  for (let i = 0; i < ids.length; i++) {
    await connection.execute(
      "INSERT INTO bundle_questionnaires (bundle_id, questionnaire_id, order_num) VALUES (?, ?, ?)",
      [bundleId, ids[i], i + 1],
    );
  }
  return { id: bundleId };
}

app.post("/api/bundles", verifyAdminToken, async (req, res) => {
  const connection = await mysql.createConnection(dbConfig);
  try {
    await connection.beginTransaction();
    const result = await saveBundle(connection, null, req.body, req.admin);
    if (typeof result === "string") {
      await connection.rollback();
      await connection.end();
      return res.status(400).json({ success: false, message: result });
    }
    await connection.commit();
    await connection.end();
    res.json({ success: true, message: "问卷组合已创建", id: result.id });
  } catch (err) {
    await connection.rollback().catch(() => {});
    await connection.end().catch(() => {});
    console.error("创建问卷组合失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

app.put("/api/bundles/:id", verifyAdminToken, async (req, res) => {
  const connection = await mysql.createConnection(dbConfig);
  try {
    const access = await checkBundleAccess(
      connection,
      req.params.id,
      req.admin,
    );
    if (access !== "ok") {
      await connection.end();
      return sendAccessError(res, access);
    }
    await connection.beginTransaction();
    const result = await saveBundle(
      connection,
      Number(req.params.id),
      req.body,
      req.admin,
    );
    if (typeof result === "string") {
      await connection.rollback();
      await connection.end();
      return res.status(400).json({ success: false, message: result });
    }
    await connection.commit();
    await connection.end();
    res.json({ success: true, message: "已保存" });
  } catch (err) {
    await connection.rollback().catch(() => {});
    await connection.end().catch(() => {});
    console.error("保存问卷组合失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 删除组合：已经有人通过它作答的不能删（数据会对不上），可以改成「关闭」
app.delete("/api/bundles/:id", verifyAdminToken, async (req, res) => {
  const connection = await mysql.createConnection(dbConfig);
  try {
    const access = await checkBundleAccess(
      connection,
      req.params.id,
      req.admin,
    );
    if (access !== "ok") {
      await connection.end();
      return sendAccessError(res, access);
    }
    const [cnt] = await connection.execute(
      "SELECT COUNT(*) AS n FROM submissions WHERE bundle_id = ?",
      [req.params.id],
    );
    if (cnt[0].n > 0) {
      await connection.end();
      return res.status(400).json({
        success: false,
        message:
          "已经有人通过这个组合作答，不能删除。不想再收数据的话，把它关闭即可。",
      });
    }
    await connection.execute(
      "DELETE FROM bundle_questionnaires WHERE bundle_id = ?",
      [req.params.id],
    );
    await connection.execute("DELETE FROM bundles WHERE id = ?", [
      req.params.id,
    ]);
    await connection.end();
    res.json({ success: true, message: "已删除" });
  } catch (err) {
    await connection.end().catch(() => {});
    console.error("删除问卷组合失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 答题端：获取组合里的全部问卷（题目、板块、基本信息字段）
// 组合是否开放只看组合自己的开关；单份问卷的开关、截止时间、回收上限只管它自己的单独链接
app.get("/api/bundle/:id", async (req, res) => {
  const bundleId = Number(req.params.id);
  if (!Number.isInteger(bundleId) || bundleId <= 0) {
    return res.status(404).json({ success: false, message: "链接有误" });
  }
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute(
      "SELECT * FROM bundles WHERE id = ?",
      [bundleId],
    );
    if (rows.length === 0) {
      await connection.end();
      return res.status(404).json({ success: false, message: "问卷不存在" });
    }
    const bundle = rows[0];
    if (!bundle.is_active) {
      await connection.end();
      return res.status(403).json({
        success: false,
        closed: true,
        message: "本次测评已关闭，感谢您的关注",
      });
    }
    const list = await loadBundleQuestionnaires(connection, bundleId);
    const units = [];
    for (const item of list) {
      const [qRows] = await connection.execute(
        "SELECT * FROM questionnaires WHERE id = ?",
        [item.id],
      );
      const [questions] = await connection.execute(
        "SELECT * FROM questions WHERE questionnaire_id = ? ORDER BY order_num ASC",
        [item.id],
      );
      if (questions.length === 0) continue; // 没有题目的问卷跳过
      const [sections] = await connection.execute(
        "SELECT id, title, intro FROM question_sections WHERE questionnaire_id = ?",
        [item.id],
      );
      const [fields] = await connection.execute(
        "SELECT * FROM subject_info_fields WHERE questionnaire_id = ? ORDER BY order_num ASC",
        [item.id],
      );
      units.push({
        questionnaire: qRows[0],
        questions,
        sections,
        info_fields: fields,
      });
    }
    await connection.end();
    if (units.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "这个测评还没有添加题目" });
    }
    res.json({
      success: true,
      bundle: {
        id: bundle.id,
        title: bundle.title,
        description: bundle.description || "",
        consent_text: bundle.consent_text || "",
        shuffle: !!bundle.shuffle,
      },
      units,
    });
  } catch (err) {
    console.error("获取问卷组合失败:", err);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// 导出组合数据：每人一行，几份问卷的得分并排（方便直接导入 SPSS 做相关、回归）
app.get("/api/bundles/:id/export", verifyAdminToken, async (req, res) => {
  const connection = await mysql.createConnection(dbConfig);
  try {
    const access = await checkBundleAccess(
      connection,
      req.params.id,
      req.admin,
    );
    if (access !== "ok") {
      await connection.end();
      return sendAccessError(res, access);
    }
    const [bRows] = await connection.execute(
      "SELECT * FROM bundles WHERE id = ?",
      [req.params.id],
    );
    const bundle = bRows[0];
    const list = await loadBundleQuestionnaires(connection, bundle.id);

    // 每份问卷的计分配置
    const units = [];
    for (const item of list) {
      const [qRows] = await connection.execute(
        "SELECT * FROM questionnaires WHERE id = ?",
        [item.id],
      );
      const [questions] = await connection.execute(
        "SELECT * FROM questions WHERE questionnaire_id = ? ORDER BY order_num ASC",
        [item.id],
      );
      const questionMap = {};
      questions.forEach((q) => (questionMap[q.id] = q));
      const dimensions = await loadDimensions(connection, item.id);
      const norms = await loadNorms(connection, item.id);
      units.push({ q: qRows[0], questions, questionMap, dimensions, norms });
    }

    const [subs] = await connection.execute(
      "SELECT * FROM submissions WHERE bundle_id = ? AND bundle_token IS NOT NULL ORDER BY started_at ASC, id ASC",
      [bundle.id],
    );
    const subIds = subs.map((s) => s.id);
    let answers = [];
    let infos = [];
    if (subIds.length > 0) {
      [answers] = await connection.query(
        "SELECT * FROM answers WHERE submission_id IN (?)",
        [subIds],
      );
      [infos] = await connection.query(
        "SELECT * FROM subject_info WHERE submission_id IN (?) ORDER BY id ASC",
        [subIds],
      );
    }
    await connection.end();

    const answersBySub = {};
    answers.forEach((a) => {
      (answersBySub[a.submission_id] ||= []).push(a);
    });
    const infoBySub = {};
    infos.forEach((i) => {
      (infoBySub[i.submission_id] ||= {})[i.field_key] = i;
    });

    // 按 bundle_token 把同一个人的几份问卷归到一起
    const people = [];
    const byToken = {};
    subs.forEach((s) => {
      let p = byToken[s.bundle_token];
      if (!p) {
        p = { token: s.bundle_token, subs: {}, first: s, info: {} };
        byToken[s.bundle_token] = p;
        people.push(p);
      }
      if (!p.subs[s.questionnaire_id]) p.subs[s.questionnaire_id] = s;
      Object.assign(p.info, infoBySub[s.id] || {});
    });

    // 基本信息列：所有出现过的字段（按第一次出现的顺序）
    const infoCols = [];
    infos.forEach((i) => {
      if (!infoCols.find((c) => c.key === i.field_key))
        infoCols.push({ key: i.field_key, label: i.field_label });
    });

    // 列名里用的问卷简称
    const shortName = (u, idx) => {
      const t = u.q.title || `问卷${idx + 1}`;
      return t.length > 10 ? t.slice(0, 10) : t;
    };

    const workbook = new ExcelJS.Workbook();
    const headStyle = (row) => {
      row.font = { bold: true };
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE8F5E9" },
      };
    };

    // 表1：得分汇总
    const sheet = workbook.addWorksheet("得分汇总");
    const scoreHeaders = [];
    units.forEach((u, idx) => {
      const sn = shortName(u, idx);
      if (u.dimensions.length > 0 || u.questions.some(isScoredQuestion)) {
        scoreHeaders.push(`${sn}_总分`);
        u.dimensions.forEach((d) => scoreHeaders.push(`${sn}_${d.name}`));
        if (u.norms.length > 0) {
          scoreHeaders.push(`${sn}_总分T分`);
          u.dimensions.forEach((d) => scoreHeaders.push(`${sn}_${d.name}T分`));
        }
      }
    });
    const baseHeaders = [
      "序号",
      "追踪码",
      "分组",
      ...infoCols.map((c) => c.label),
      "开始时间",
      "完成份数",
      "作答顺序",
    ];
    headStyle(sheet.addRow([...baseHeaders, ...scoreHeaders]));

    // 表2：逐题得分
    const itemSheet = workbook.addWorksheet("逐题得分");
    const itemHeaders = [];
    units.forEach((u, idx) => {
      const sn = shortName(u, idx);
      u.questions.forEach((q) => itemHeaders.push(`${sn}_Q${q.order_num}`));
    });
    headStyle(
      itemSheet.addRow([
        "序号",
        "追踪码",
        "分组",
        ...infoCols.map((c) => c.label),
        ...itemHeaders,
      ]),
    );

    people.forEach((p, i) => {
      const infoValues = infoCols.map((c) => p.info[c.key]?.value ?? "");
      const infoMap = {};
      Object.values(p.info).forEach((it) => (infoMap[it.field_key] = it.value));
      const done = units.filter((u) => p.subs[u.q.id]);
      const order = Object.values(p.subs)
        .sort((a, b) => (a.bundle_position || 0) - (b.bundle_position || 0))
        .map((s) => {
          const idx = units.findIndex((u) => u.q.id === s.questionnaire_id);
          return idx >= 0 ? shortName(units[idx], idx) : "";
        })
        .join(" → ");
      const scoreCells = [];
      units.forEach((u) => {
        if (!(u.dimensions.length > 0 || u.questions.some(isScoredQuestion)))
          return;
        const s = p.subs[u.q.id];
        const cols = 1 + u.dimensions.length;
        if (!s) {
          for (let c = 0; c < cols * (u.norms.length > 0 ? 2 : 1); c++)
            scoreCells.push("");
          return;
        }
        const r = computeScores(
          answersBySub[s.id] || [],
          u.questionMap,
          u.dimensions,
          u.q.total_formula,
        );
        scoreCells.push(r.totalScore);
        r.dimensionScores.forEach((d) => scoreCells.push(d.score ?? ""));
        if (u.norms.length > 0) {
          const norm = matchNorm(u.norms, infoMap);
          const tOf = (key, x) => {
            const z = normZ(norm, key, x);
            return z === null ? "" : Math.round((50 + 10 * z) * 10) / 10;
          };
          scoreCells.push(tOf("total", r.totalScore));
          r.dimensionScores.forEach((d) =>
            scoreCells.push(tOf(`dim${d.id}`, d.score)),
          );
        }
      });
      sheet.addRow([
        i + 1,
        p.first.tracking_code || "",
        p.first.group_label || "",
        ...infoValues,
        p.first.started_at
          ? new Date(p.first.started_at).toLocaleString("zh-CN")
          : "",
        `${done.length}/${units.length}`,
        order,
        ...scoreCells,
      ]);

      const itemCells = [];
      units.forEach((u) => {
        const s = p.subs[u.q.id];
        const byQ = {};
        (s ? answersBySub[s.id] || [] : []).forEach(
          (a) => (byQ[a.question_id] = a),
        );
        u.questions.forEach((q) =>
          itemCells.push(exportAnswerCell(byQ[q.id], q)),
        );
      });
      itemSheet.addRow([
        i + 1,
        p.first.tracking_code || "",
        p.first.group_label || "",
        ...infoValues,
        ...itemCells,
      ]);
    });
    sheet.columns.forEach((c) => (c.width = 14));
    itemSheet.columns.forEach((c) => (c.width = 12));

    // 表3：说明
    const note = workbook.addWorksheet("说明");
    note.addRow(["问卷组合", bundle.title]);
    note.addRow(["参与人数", people.length]);
    note.addRow([]);
    headStyle(note.addRow(["列名里的简称", "问卷全称", "题目数", "总分算法"]));
    units.forEach((u, idx) =>
      note.addRow([
        shortName(u, idx),
        u.q.title,
        u.questions.length,
        u.dimensions.length > 0
          ? TOTAL_FORMULAS[u.q.total_formula || "dimensions"]
          : "所有计分题相加",
      ]),
    );
    note.addRow([]);
    note.addRow([
      "说明",
      "每人一行；没做完的问卷那几列是空的。逐题得分：有分值的显示分数（反向题未反转），其他显示文字。",
    ]);
    note.addRow([
      "",
      "T 分 = 50 + 10 × (得分 − 常模均值) ÷ 常模标准差，按受测者填写的基本信息匹配常模；只有配置了常模的问卷才有。",
    ]);
    note.getColumn(1).width = 16;
    note.getColumn(2).width = 40;

    const filename = encodeURIComponent(`${bundle.title}_组合数据.xlsx`);
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
    await connection.end().catch(() => {});
    console.error("导出组合数据失败:", err);
    res.status(500).json({ success: false, message: "导出失败" });
  }
});

// ========== 从其他问卷复制题目 ==========
// body：{ question_ids: [按顺序], with_sections: 是否连同板块, with_dimensions: 是否连同维度 }
// 复制的题目接在本问卷最后；板块按标题、维度按名称合并到本问卷已有的同名板块 / 维度，没有就新建
app.post(
  "/api/questionnaires/:id/copy-questions",
  verifyAdminToken,
  async (req, res) => {
    const targetId = Number(req.params.id);
    const ids = (req.body.question_ids || [])
      .map(Number)
      .filter((x) => Number.isInteger(x) && x > 0);
    const withSections = req.body.with_sections !== false;
    const withDimensions = req.body.with_dimensions !== false;
    if (ids.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "请先勾选要复制的题目" });
    }

    const connection = await mysql.createConnection(dbConfig);
    try {
      const access = await checkQuestionnaireAccess(
        connection,
        targetId,
        req.admin,
      );
      if (access !== "ok") {
        await connection.end();
        return res.status(access === "notfound" ? 404 : 403).json({
          success: false,
          message: access === "notfound" ? "问卷不存在" : "没有权限修改此问卷",
        });
      }

      const [srcRows] = await connection.query(
        "SELECT * FROM questions WHERE id IN (?)",
        [ids],
      );
      const byId = {};
      srcRows.forEach((q) => (byId[q.id] = q));
      const sources = ids.map((id) => byId[id]).filter(Boolean);
      // 来源问卷也要有权限（研究者只能复制自己的问卷）
      const srcQids = [...new Set(sources.map((q) => q.questionnaire_id))];
      for (const qid of srcQids) {
        if (
          (await checkQuestionnaireAccess(connection, qid, req.admin)) !== "ok"
        ) {
          await connection.end();
          return res.status(403).json({
            success: false,
            message: "没有权限复制其中某份问卷的题目",
          });
        }
      }

      await connection.beginTransaction();

      // 板块：本问卷已有的按标题对应
      const sectionMap = {}; // 来源板块 id -> 本问卷板块 id
      let newSections = 0;
      if (withSections) {
        const srcSectionIds = [
          ...new Set(sources.map((q) => q.section_id).filter(Boolean)),
        ];
        if (srcSectionIds.length > 0) {
          const [srcSecs] = await connection.query(
            "SELECT * FROM question_sections WHERE id IN (?)",
            [srcSectionIds],
          );
          const [targetSecs] = await connection.execute(
            "SELECT * FROM question_sections WHERE questionnaire_id = ?",
            [targetId],
          );
          for (const sec of srcSecs) {
            const same = targetSecs.find((t) => t.title === sec.title);
            if (same) {
              sectionMap[sec.id] = same.id;
            } else {
              const [r] = await connection.execute(
                "INSERT INTO question_sections (questionnaire_id, title, intro) VALUES (?, ?, ?)",
                [targetId, sec.title, sec.intro || ""],
              );
              sectionMap[sec.id] = r.insertId;
              targetSecs.push({ id: r.insertId, title: sec.title });
              newSections++;
            }
          }
        }
      }

      // 复制题目，接在最后
      const [maxRow] = await connection.execute(
        "SELECT MAX(order_num) AS max_num FROM questions WHERE questionnaire_id = ?",
        [targetId],
      );
      let orderNum = maxRow[0].max_num || 0;
      const newIdOf = {}; // 来源题目 id -> 新题目 id
      const asJson = (v) =>
        v === null || v === undefined
          ? null
          : typeof v === "string"
            ? v
            : JSON.stringify(v);
      for (const q of sources) {
        orderNum++;
        const [r] = await connection.execute(
          `INSERT INTO questions (questionnaire_id, content, order_num, min_score, max_score,
           is_reverse_scored, question_type, options, role, section_id, media)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            targetId,
            q.content,
            orderNum,
            q.min_score,
            q.max_score,
            q.is_reverse_scored ? 1 : 0,
            q.question_type || "scale",
            asJson(q.options),
            q.role || "student",
            withSections && q.section_id
              ? sectionMap[q.section_id] || null
              : null,
            asJson(q.media),
          ],
        );
        newIdOf[q.id] = r.insertId;
      }

      // 维度：按名称并入本问卷已有的同名维度，没有就新建（连同计分方式和说明）
      let newDims = 0;
      const mergedDims = [];
      if (withDimensions) {
        const targetDims = await loadDimensions(connection, targetId);
        for (const qid of srcQids) {
          const srcDims = await loadDimensions(connection, qid);
          for (const dim of srcDims) {
            const copied = dim.question_ids.filter((id) => newIdOf[id]);
            if (copied.length === 0) continue;
            let target = targetDims.find((d) => d.name === dim.name);
            let created = false;
            if (!target) {
              const [r] = await connection.execute(
                "INSERT INTO dimensions (questionnaire_id, name, description, score_formula) VALUES (?, ?, ?, ?)",
                [
                  targetId,
                  dim.name,
                  dim.description || "",
                  dim.score_formula || "sum",
                ],
              );
              target = { id: r.insertId, name: dim.name, question_ids: [] };
              targetDims.push(target);
              created = true;
              newDims++;
            } else if (!mergedDims.includes(dim.name)) {
              mergedDims.push(dim.name);
            }
            for (const id of copied) {
              await connection.execute(
                "INSERT INTO dimension_questions (dimension_id, question_id) VALUES (?, ?)",
                [target.id, newIdOf[id]],
              );
              target.question_ids.push(newIdOf[id]);
            }
            // 整个维度的题都复制过来、而且是新建的维度时，把它的分数段也带过来
            if (created && copied.length === dim.question_ids.length) {
              const [rules] = await connection.execute(
                "SELECT * FROM score_rules WHERE dimension_id = ?",
                [dim.id],
              );
              for (const r of rules) {
                await connection.execute(
                  `INSERT INTO score_rules (questionnaire_id, min_score, max_score, label, description,
                   visible_to_subject, color, dimension_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                  [
                    targetId,
                    r.min_score,
                    r.max_score,
                    r.label,
                    r.description || "",
                    r.visible_to_subject ? 1 : 0,
                    r.color || "#4CAF7D",
                    target.id,
                  ],
                );
              }
            }
          }
        }
      }

      await connection.commit();
      await connection.end();

      const parts = [`已复制 ${sources.length} 道题，接在原有题目后面`];
      if (newSections > 0) parts.push(`新建 ${newSections} 个板块`);
      if (newDims > 0) parts.push(`新建 ${newDims} 个维度`);
      let message = parts.join("，");
      if (mergedDims.length > 0) {
        message += `；维度「${mergedDims.join("」「")}」本问卷里已有同名的，题目已并入`;
      }
      res.json({
        success: true,
        message,
        count: sources.length,
        new_sections: newSections,
        new_dimensions: newDims,
        merged_dimensions: mergedDims,
      });
    } catch (err) {
      await connection.rollback().catch(() => {});
      await connection.end().catch(() => {});
      console.error("复制题目失败:", err);
      res.status(500).json({ success: false, message: "服务器错误" });
    }
  },
);

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

// 上传题目用的图片 / 视频 / 音频，返回文件地址
app.post("/api/media", verifyAdminToken, (req, res) => {
  mediaUpload.single("file")(req, res, async (err) => {
    if (err) {
      const tooLarge = err.code === "LIMIT_FILE_SIZE";
      return res.status(400).json({
        success: false,
        message: tooLarge ? "文件太大，单个文件不能超过 200MB" : "上传失败",
      });
    }
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message:
          "不支持这种文件。图片支持 jpg/png/gif/webp，视频支持 mp4/webm/mov，音频支持 mp3/wav/m4a",
      });
    }
    let filename = req.file.filename;
    let warning = "";
    // 视频：服务器有 ffmpeg 就转成所有浏览器都能播的 H.264 mp4；没有就检查是不是 H.265 并提醒
    if (mediaTypeOf(filename) === "video") {
      try {
        if (await video.hasFfmpeg()) {
          const out = await video.toWebMp4(req.file.path);
          if (out) filename = path.basename(out);
          else
            warning =
              "视频格式转换失败，部分浏览器可能放不了，建议换一个视频文件。";
        } else if (video.looksLikeHevc(req.file.path)) {
          warning =
            "这个视频是 H.265（HEVC）编码：手机能播，但很多电脑浏览器只有声音没有画面。上线到服务器后会自动转换；本地测试可以先用剪映等软件导出为 H.264 格式再上传。";
        }
      } catch (e) {
        console.error("处理视频失败:", e);
      }
    }
    const full = path.join(UPLOAD_DIR, filename);
    res.json({
      success: true,
      url: `/uploads/${filename}`,
      type: mediaTypeOf(filename),
      size: fs.existsSync(full) ? fs.statSync(full).size : req.file.size,
      warning,
    });
  });
});

// 整理题目的媒体列表，只保留合法的条目
function cleanMedia(media) {
  if (!Array.isArray(media)) return null;
  const list = media
    .filter(
      (m) =>
        m &&
        typeof m.url === "string" &&
        m.url.startsWith("/uploads/") &&
        MEDIA_TYPES[m.type],
    )
    .map((m) => ({ type: m.type, url: m.url, name: String(m.name || "") }));
  return list.length > 0 ? list : null;
}

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

// 上线时只监听本机（HOST=127.0.0.1），外面只能通过 nginx 访问
const HOST = process.env.HOST || undefined;
app.listen(PORT, HOST, () => {
  console.log(`后端服务已启动，访问 http://${HOST || "localhost"}:${PORT}`);
});
