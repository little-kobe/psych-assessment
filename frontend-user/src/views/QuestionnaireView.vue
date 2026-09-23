<script setup>
import { ref, onMounted, computed } from "vue";
import { useRoute } from "vue-router";
import { API_BASE } from "../api.js";

const route = useRoute();
const questionnaireId = Number(route.params.id) || 1;
const groupLabel = route.query.group || null; // 从链接参数读取分组标记
const questionnaire = ref(null);
const allQuestions = ref([]);
const sections = ref([]); // 板块引导语
const submitted = ref(false);
const consented = ref(false);
const loading = ref(true);
const closedMessage = ref("");
const overallStartTime = ref(null);
const trackingCode = ref("");
const showTrackingInput = ref(false);
const subjectReport = ref(null); // 提交后对受测者可见的报告
const dimensionReports = ref([]); // 各维度对受测者可见的评价
const infoFields = ref([]); // 需要收集的字段配置
const infoAnswers = ref({}); // 受测者填写的基本信息
const infoSubmitted = ref(false); // 基本信息是否已提交
const submissionId = ref(null); // 提交后拿到的submission_id，用于关联基本信息
const showDesc = ref(false); // 答题页是否展开问卷说明

// 分角色分组
const studentQuestions = computed(() =>
  allQuestions.value.filter(
    (q) => q.role === "student" || q.role === "both" || !q.role,
  ),
);
const parentQuestions = computed(() =>
  allQuestions.value.filter((q) => q.role === "parent"),
);
const hasParentSection = computed(() => parentQuestions.value.length > 0);

// 当前阶段：student 或 parent
const currentPhase = ref("student");
const currentQuestions = computed(() =>
  currentPhase.value === "student"
    ? studentQuestions.value
    : parentQuestions.value,
);

// 答案和计时
const answersMap = ref({});
const questionDurations = ref({});
const currentQuestionStartTime = ref(null);
const currentIndex = ref(0);

// 快速作答检测（阈值2秒）
const MIN_DURATION_MS = 2000;
const showSpeedWarning = ref(false);

const currentQuestion = computed(
  () => currentQuestions.value[currentIndex.value],
);
const progressPercent = computed(() => {
  const total = hasParentSection.value
    ? allQuestions.value.length
    : studentQuestions.value.length;
  const done =
    currentPhase.value === "student"
      ? currentIndex.value
      : studentQuestions.value.length + currentIndex.value;
  return Math.round((done / total) * 100);
});
// 当前题所属的板块（有的话，题目上方显示板块标题和引导语）
const currentSection = computed(() => {
  const sid = currentQuestion.value?.section_id;
  return sid ? sections.value.find((s) => s.id === sid) || null : null;
});

const isLastQuestion = computed(
  () => currentIndex.value === currentQuestions.value.length - 1,
);
const currentAnswer = computed(() =>
  currentQuestion.value ? answersMap.value[currentQuestion.value.id] : null,
);

// 把选项统一成 [{ label, score }] 格式（兼容旧数据：纯文字数组）
function parseOptions(options) {
  let arr = options;
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

// 量表题：每个分数都配了文字时，受测者只看到文字按钮
function scaleTextOptions(q) {
  const opts = parseOptions(q.options);
  return opts.length > 0 && opts.every((o) => o.label) ? opts : [];
}

// 量表题两端的提示文字（没配文字时显示「较低 / 较高」）
function scaleEndLabel(q, end) {
  const opts = parseOptions(q.options);
  const score = end === "min" ? q.min_score : q.max_score;
  const found = opts.find((o) => o.score === score && o.label);
  return found ? found.label : end === "min" ? "较低" : "较高";
}

onMounted(async () => {
  try {
    const response = await fetch(
      `${API_BASE}/api/questionnaire/${questionnaireId}`,
    );
    const data = await response.json();
    if (data.success) {
      questionnaire.value = data.questionnaire;
      allQuestions.value = data.questions;
      sections.value = data.sections || [];
      // 拉取基本信息字段配置
      try {
        const infoRes = await fetch(
          `${API_BASE}/api/questionnaires/${questionnaireId}/info-fields`,
        );
        const infoData = await infoRes.json();
        if (infoData.success) {
          infoFields.value = infoData.fields.map((f) => ({
            ...f,
            options: f.options
              ? typeof f.options === "string"
                ? JSON.parse(f.options)
                : f.options
              : [],
          }));
        }
      } catch (e) {}
      overallStartTime.value = Date.now();
      allQuestions.value.forEach((q) => {
        questionDurations.value[q.id] = 0;
      });
      if (currentQuestions.value.length > 0) {
        currentQuestionStartTime.value = Date.now();
      }
    } else if (data.closed) {
      closedMessage.value = data.message;
    }
  } catch (err) {
    console.error("获取问卷失败:", err);
  } finally {
    loading.value = false;
  }
});

function recordCurrentQuestionTime() {
  if (!currentQuestion.value || !currentQuestionStartTime.value) return;
  const elapsed = Date.now() - currentQuestionStartTime.value;
  questionDurations.value[currentQuestion.value.id] =
    (questionDurations.value[currentQuestion.value.id] || 0) + elapsed;
}

function selectAnswer(value) {
  answersMap.value[currentQuestion.value.id] = value;
}

function toggleMultiAnswer(value) {
  const qid = currentQuestion.value.id;
  if (!answersMap.value[qid]) answersMap.value[qid] = [];
  const arr = [...answersMap.value[qid]];
  const idx = arr.indexOf(value);
  if (idx === -1) arr.push(value);
  else arr.splice(idx, 1);
  answersMap.value[qid] = arr;
}

function isMultiSelected(value) {
  const ans = answersMap.value[currentQuestion.value?.id];
  return Array.isArray(ans) && ans.includes(value);
}

function hasAnswer() {
  const ans = currentAnswer.value;
  if (ans === undefined || ans === null) return false;
  if (Array.isArray(ans)) return ans.length > 0;
  if (typeof ans === "string") return ans.trim().length > 0;
  return true;
}

function nextQuestion() {
  if (!hasAnswer()) return;

  recordCurrentQuestionTime();

  // 快速作答检测
  const duration = questionDurations.value[currentQuestion.value.id] || 0;
  if (duration < MIN_DURATION_MS) {
    showSpeedWarning.value = true;
    return;
  }

  goNext();
}

function goNext() {
  showSpeedWarning.value = false;
  if (isLastQuestion.value) {
    if (currentPhase.value === "student" && hasParentSection.value) {
      // 学生填完，进入家长阶段
      currentPhase.value = "parent";
      currentIndex.value = 0;
      currentQuestionStartTime.value = Date.now();
    } else {
      submitQuestionnaire();
    }
  } else {
    currentIndex.value++;
    currentQuestionStartTime.value = Date.now();
  }
}

function prevQuestion() {
  if (currentIndex.value === 0 && currentPhase.value === "parent") {
    // 家长阶段返回到学生最后一题
    currentPhase.value = "student";
    currentIndex.value = studentQuestions.value.length - 1;
    currentQuestionStartTime.value = Date.now();
    return;
  }
  if (currentIndex.value === 0) return;
  recordCurrentQuestionTime();
  currentIndex.value--;
  currentQuestionStartTime.value = Date.now();
}

function confirmExit() {
  if (confirm("确认退出？您目前的作答数据将不会被保存。")) {
    window.location.href = "about:blank";
  }
}

async function submitSubjectInfo(subId) {
  const info = infoFields.value.map((f) => ({
    field_key: f.field_key,
    field_label: f.field_label,
    value: infoAnswers.value[f.field_key] || "",
  }));
  try {
    await fetch(`${API_BASE}/api/submissions/${subId}/subject-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ info }),
    });
  } catch (e) {}
}

function hasInfoAnswered() {
  return infoFields.value
    .filter((f) => f.is_required)
    .every(
      (f) =>
        infoAnswers.value[f.field_key] &&
        String(infoAnswers.value[f.field_key]).trim(),
    );
}

async function submitQuestionnaire() {
  const finishedAt = Date.now();
  const answers = allQuestions.value.map((q) => {
    const ans = answersMap.value[q.id];
    const type = q.question_type || "scale";
    const opts = parseOptions(q.options);

    let answerValue = null; // 分数（参与计分、导出显示）
    let answerText = null; // 文字（选项文字、开放题内容）

    if (type === "scale") {
      // 量表题：存分数；配了文字的顺便存文字
      answerValue = typeof ans === "number" ? ans : null;
      const opt = opts.find((o) => o.score === answerValue && o.label);
      answerText = opt ? opt.label : null;
    } else if (type === "single_choice") {
      // 单选题：存选项文字；选项配了分值的同时存分数
      answerText = ans !== undefined && ans !== null ? String(ans) : null;
      const opt = opts.find((o) => o.label === ans);
      answerValue = opt && opt.score !== null ? Number(opt.score) : null;
    } else if (Array.isArray(ans)) {
      answerText = JSON.stringify(ans); // 多选题
    } else if (ans !== undefined && ans !== null) {
      answerText = String(ans); // 是否题、开放题
    }

    return {
      question_id: q.id,
      answer_value: answerValue,
      answer_text: answerText,
      duration_ms: questionDurations.value[q.id] || 0,
    };
  });

  const response = await fetch(`${API_BASE}/api/submission`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      questionnaire_id: questionnaireId,
      tracking_code: trackingCode.value || null,
      group_label: groupLabel,
      started_at: new Date(overallStartTime.value)
        .toISOString()
        .slice(0, 19)
        .replace("T", " "),
      finished_at: new Date(finishedAt)
        .toISOString()
        .slice(0, 19)
        .replace("T", " "),
      answers,
    }),
  });

  const data = await response.json();
  if (data.success) {
    submissionId.value = data.submission_id;
    // 如果有基本信息字段需要填，先提交基本信息
    if (infoFields.value.length > 0) {
      await submitSubjectInfo(data.submission_id);
    }
    submitted.value = true;
    // 拉取报告
    try {
      const reportRes = await fetch(
        `${API_BASE}/api/submissions/${data.submission_id}/report-public`,
      );
      const reportData = await reportRes.json();
      if (reportData.success && reportData.matched_rule) {
        subjectReport.value = reportData.matched_rule;
      }
    } catch (e) {}
  }
}
</script>

<template>
  <div class="page">
    <svg
      class="bg-art"
      viewBox="0 0 800 600"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#EAF6F0" />
          <stop offset="100%" stop-color="#F4FBF6" />
        </linearGradient>
      </defs>
      <rect width="800" height="600" fill="url(#skyGrad)" />
      <path
        d="M0,460 C150,400 300,440 450,400 C600,360 700,420 800,390 L800,600 L0,600 Z"
        fill="#DCEFE0"
      />
      <path
        d="M0,510 C180,470 350,500 500,470 C650,440 720,480 800,460 L800,600 L0,600 Z"
        fill="#CDE8D4"
      />
      <g fill="#8FC9A0" opacity="0.5">
        <ellipse cx="90" cy="90" rx="10" ry="5" transform="rotate(30 90 90)" />
        <ellipse
          cx="720"
          cy="130"
          rx="12"
          ry="6"
          transform="rotate(-20 720 130)"
        />
        <ellipse cx="660" cy="60" rx="8" ry="4" transform="rotate(50 660 60)" />
      </g>
    </svg>

    <div class="content">
      <div v-if="loading" class="loading">正在加载问卷...</div>

      <div v-else-if="closedMessage" class="closed-card">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="#8AAA94" stroke-width="1.5" />
          <path
            d="M8 12h8"
            stroke="#8AAA94"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        </svg>
        <h2>{{ closedMessage }}</h2>
        <p class="closed-sub">本次调研已结束，感谢您的关注。</p>
      </div>

      <div v-else-if="!consented" class="consent-card">
        <div class="consent-header">
          <div class="consent-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path
                d="M9 12l2 2 4-4"
                stroke="#4CAF7D"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <circle
                cx="12"
                cy="12"
                r="9"
                stroke="#4CAF7D"
                stroke-width="1.5"
              />
            </svg>
          </div>
          <h2>{{ questionnaire.title }}</h2>
          <p class="consent-subtitle">参与前请阅读以下说明</p>
        </div>
        <!-- 问卷说明 -->
        <div v-if="questionnaire.description" class="desc-box">
          <p class="desc-title">问卷说明</p>
          <p class="desc-text">{{ questionnaire.description }}</p>
        </div>
        <div class="consent-body">
          <p class="consent-text">
            {{
              questionnaire.consent_text ||
              "本问卷用于学术研究目的，所有回答数据将严格保密，仅用于统计分析，不会与您的个人身份挂钩。参与本问卷完全出于自愿，您可以随时退出。"
            }}
          </p>
          <div class="consent-points">
            <div class="point">
              <span class="point-dot"></span
              ><span>数据匿名保存，不记录个人身份</span>
            </div>
            <div class="point">
              <span class="point-dot"></span><span>仅用于学术统计分析</span>
            </div>
            <div class="point">
              <span class="point-dot"></span
              ><span>参与完全自愿，可随时退出</span>
            </div>
          </div>
        </div>

        <!-- 追踪码（可选） -->
        <div class="tracking-section">
          <button
            class="tracking-toggle"
            @click="showTrackingInput = !showTrackingInput"
          >
            {{
              showTrackingInput
                ? "▾ 不需要追踪码"
                : "▸ 我有追踪码（用于多次测评关联）"
            }}
          </button>
          <div v-if="showTrackingInput" class="tracking-input">
            <input
              v-model="trackingCode"
              placeholder="请输入您的追踪码（如学号或自编代码）"
            />
          </div>
        </div>

        <button class="consent-btn" @click="consented = true">
          我已阅读并同意，开始作答
        </button>
      </div>

      <!-- 基本信息填写（知情同意后、答题前） -->
      <div
        v-else-if="infoFields.length > 0 && !infoSubmitted"
        class="info-card"
      >
        <h2>基本信息</h2>
        <p class="info-subtitle">请先填写以下基本信息，所有信息将匿名保存</p>

        <div class="info-form">
          <div
            v-for="field in infoFields"
            :key="field.field_key"
            class="info-field"
          >
            <label class="info-label">
              {{ field.field_label }}
              <span v-if="field.is_required" class="required">*</span>
            </label>

            <!-- 文本输入 -->
            <input
              v-if="field.field_type === 'text'"
              v-model="infoAnswers[field.field_key]"
              type="text"
              class="info-input"
              :placeholder="`请输入${field.field_label}`"
            />

            <!-- 数字输入 -->
            <input
              v-else-if="field.field_type === 'number'"
              v-model="infoAnswers[field.field_key]"
              type="number"
              class="info-input"
              :placeholder="`请输入${field.field_label}`"
            />

            <!-- 单选按钮 -->
            <div v-else-if="field.field_type === 'radio'" class="radio-group">
              <label
                v-for="opt in field.options"
                :key="opt"
                class="radio-item"
                :class="{ active: infoAnswers[field.field_key] === opt }"
              >
                <input
                  type="radio"
                  :name="field.field_key"
                  :value="opt"
                  v-model="infoAnswers[field.field_key]"
                  style="display: none"
                />
                {{ opt }}
              </label>
            </div>

            <!-- 下拉选择 -->
            <select
              v-else-if="field.field_type === 'select'"
              v-model="infoAnswers[field.field_key]"
              class="info-select"
            >
              <option value="" disabled>请选择</option>
              <option v-for="opt in field.options" :key="opt" :value="opt">
                {{ opt }}
              </option>
            </select>
          </div>
        </div>

        <button
          class="consent-btn"
          @click="infoSubmitted = true"
          :disabled="!hasInfoAnswered()"
          :style="!hasInfoAnswered() ? 'opacity:0.4;cursor:not-allowed;' : ''"
        >
          确认，开始作答
        </button>
      </div>

      <div
        v-else-if="(infoFields.length === 0 || infoSubmitted) && !submitted"
        class="quiz-card"
      >
        <!-- 阶段提示（有家长题时显示） -->
        <div v-if="hasParentSection" class="phase-banner" :class="currentPhase">
          {{
            currentPhase === "student" ? "👤 学生填写部分" : "👨‍👩‍👧 家长填写部分"
          }}
        </div>

        <div class="quiz-header">
          <h1>{{ questionnaire.title }}</h1>
          <!-- 答题过程中也能随时查看问卷说明 -->
          <button
            v-if="questionnaire.description"
            class="desc-toggle"
            @click="showDesc = !showDesc"
          >
            {{ showDesc ? "收起作答说明 ▴" : "查看作答说明 ▾" }}
          </button>
          <p v-if="showDesc" class="desc-text quiz-desc">
            {{ questionnaire.description }}
          </p>
        </div>

        <div class="progress-track">
          <div
            class="progress-fill"
            :style="{ width: progressPercent + '%' }"
          ></div>
        </div>
        <p class="progress-label">
          第 {{ currentIndex + 1 }} 题 / 共 {{ currentQuestions.length }} 题
          <span v-if="hasParentSection" style="margin-left: 8px; opacity: 0.6">
            （总进度 {{ progressPercent }}%）
          </span>
        </p>

        <div class="question-area" v-if="currentQuestion">
          <!-- 板块标题和引导语 -->
          <div v-if="currentSection" class="section-box">
            <p class="section-title">{{ currentSection.title }}</p>
            <p v-if="currentSection.intro" class="section-intro">
              {{ currentSection.intro }}
            </p>
          </div>
          <p class="question-text">{{ currentQuestion.content }}</p>

          <!-- 量表题 -->
          <template
            v-if="
              !currentQuestion.question_type ||
              currentQuestion.question_type === 'scale'
            "
          >
            <!-- 每个分数都配了文字：只显示文字，选中后记录对应分数 -->
            <div
              v-if="scaleTextOptions(currentQuestion).length > 0"
              class="text-options"
            >
              <button
                v-for="opt in scaleTextOptions(currentQuestion)"
                :key="opt.score"
                class="text-option-btn"
                :class="{ active: currentAnswer === opt.score }"
                @click="selectAnswer(opt.score)"
              >
                {{ opt.label }}
              </button>
            </div>
            <!-- 没配文字：显示数字按钮 -->
            <template v-else>
              <div class="options">
                <button
                  v-for="n in currentQuestion.max_score -
                  currentQuestion.min_score +
                  1"
                  :key="n"
                  class="option-btn"
                  :class="{
                    active: currentAnswer === currentQuestion.min_score + n - 1,
                  }"
                  @click="selectAnswer(currentQuestion.min_score + n - 1)"
                >
                  {{ currentQuestion.min_score + n - 1 }}
                </button>
              </div>
              <div class="option-labels">
                <span>{{ scaleEndLabel(currentQuestion, "min") }}</span
                ><span>{{ scaleEndLabel(currentQuestion, "max") }}</span>
              </div>
            </template>
          </template>

          <!-- 单选题（文字选项） -->
          <div
            v-else-if="currentQuestion.question_type === 'single_choice'"
            class="text-options"
          >
            <button
              v-for="opt in parseOptions(currentQuestion.options)"
              :key="opt.label"
              class="text-option-btn"
              :class="{ active: currentAnswer === opt.label }"
              @click="selectAnswer(opt.label)"
            >
              {{ opt.label }}
            </button>
          </div>

          <!-- 多选题 -->
          <div
            v-else-if="currentQuestion.question_type === 'multiple_choice'"
            class="text-options"
          >
            <p class="multi-hint">可多选</p>
            <button
              v-for="opt in parseOptions(currentQuestion.options)"
              :key="opt.label"
              class="text-option-btn"
              :class="{ active: isMultiSelected(opt.label) }"
              @click="toggleMultiAnswer(opt.label)"
            >
              {{ opt.label }}
            </button>
          </div>

          <!-- 是否题 -->
          <div
            v-else-if="currentQuestion.question_type === 'yes_no'"
            class="options yn-options"
          >
            <button
              class="option-btn yn-btn"
              :class="{ active: currentAnswer === '是' }"
              @click="selectAnswer('是')"
            >
              是
            </button>
            <button
              class="option-btn yn-btn"
              :class="{ active: currentAnswer === '否' }"
              @click="selectAnswer('否')"
            >
              否
            </button>
          </div>

          <!-- 开放题 -->
          <div
            v-else-if="currentQuestion.question_type === 'open_text'"
            class="open-text"
          >
            <textarea
              v-model="answersMap[currentQuestion.id]"
              placeholder="请在此输入您的回答..."
              rows="4"
            ></textarea>
          </div>
        </div>

        <!-- 快速作答警告 -->
        <div v-if="showSpeedWarning" class="speed-warning">
          <p>⚠️ 您的作答速度较快，请认真阅读题目后再作答。</p>
          <button class="warning-confirm-btn" @click="goNext">
            我已认真阅读，继续
          </button>
        </div>

        <div class="nav-buttons" v-if="!showSpeedWarning">
          <button
            class="nav-btn secondary"
            @click="prevQuestion"
            :disabled="currentIndex === 0 && currentPhase === 'student'"
          >
            上一题
          </button>
          <button
            class="nav-btn primary"
            @click="nextQuestion"
            :disabled="!hasAnswer()"
          >
            {{
              isLastQuestion &&
              !(currentPhase === "student" && hasParentSection)
                ? "提交问卷"
                : "下一题"
            }}
          </button>
        </div>

        <div class="exit-row">
          <button class="exit-btn" @click="confirmExit">退出作答</button>
        </div>
      </div>

      <div v-else class="result-card">
        <div class="result-icon">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="#4CAF7D"
              stroke-width="1.5"
            />
            <path
              d="M7 12l3 3 7-7"
              stroke="#4CAF7D"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              fill="none"
            />
          </svg>
        </div>
        <h2>感谢您完成本次测评</h2>
        <p class="result-sub">您的回答已安全提交，所有信息将匿名保存。</p>
        <!-- 对受测者可见的评价结果 -->
        <div
          v-if="subjectReport || dimensionReports.length > 0"
          class="subject-report"
        >
          <div class="report-divider"></div>
          <p class="report-title">测评结果</p>
          <template v-if="subjectReport">
            <div
              class="report-label-badge"
              :style="{
                background: (subjectReport.color || '#4CAF7D') + '22',
                color: subjectReport.color || '#4CAF7D',
                border:
                  '1.5px solid ' + (subjectReport.color || '#4CAF7D') + '88',
              }"
            >
              {{ subjectReport.label }}
            </div>
            <div v-if="subjectReport.description" class="report-desc-box">
              {{ subjectReport.description }}
            </div>
          </template>

          <!-- 各维度评价 -->
          <div v-for="d in dimensionReports" :key="d.name" class="dim-report">
            <div class="dim-report-head">
              <span class="dim-report-name">{{ d.name }}</span>
              <span
                class="dim-report-badge"
                :style="{
                  background: (d.matched_rule.color || '#4CAF7D') + '22',
                  color: d.matched_rule.color || '#4CAF7D',
                  borderColor: (d.matched_rule.color || '#4CAF7D') + '88',
                }"
                >{{ d.matched_rule.label }}</span
              >
            </div>
            <p v-if="d.matched_rule.description" class="dim-report-desc">
              {{ d.matched_rule.description }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 各维度评价 */
.dim-report {
  text-align: left;
  background: #f9fcfa;
  border-radius: 10px;
  padding: 10px 14px;
  margin-top: 10px;
}
.dim-report-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.dim-report-name {
  font-size: 14px;
  font-weight: 600;
  color: #2e4a38;
}
.dim-report-badge {
  padding: 2px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid;
}
.dim-report-desc {
  font-size: 13px;
  color: #5a7a64;
  line-height: 1.7;
  margin: 6px 0 0;
  white-space: pre-wrap;
}
/* 板块引导语 */
.section-box {
  background: #f4fbf6;
  border-left: 3px solid #4caf7d;
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 14px;
}
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #2e4a38;
  margin: 0;
}
.section-intro {
  font-size: 13px;
  color: #5a7a64;
  line-height: 1.7;
  margin: 4px 0 0;
  white-space: pre-wrap;
}
/* 问卷说明 */
.desc-box {
  background: #fffdf5;
  border: 1px solid #f3e6c4;
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 16px;
}
.desc-title {
  font-size: 13px;
  font-weight: 600;
  color: #8b6b2e;
  margin: 0 0 6px;
}
.desc-text {
  font-size: 13px;
  color: #5a4a2e;
  line-height: 1.8;
  margin: 0;
  white-space: pre-wrap; /* 保留说明里的换行 */
}
.desc-toggle {
  background: none;
  border: none;
  padding: 4px 0;
  font-size: 12px;
  color: #4caf7d;
  cursor: pointer;
}
.quiz-desc {
  background: #fffdf5;
  border-radius: 10px;
  padding: 10px 12px;
  margin: 6px 0 10px;
  text-align: left;
}
.report-label-badge {
  display: block;
  text-align: center;
  padding: 8px 24px;
  border-radius: 20px;
  font-size: 17px;
  font-weight: 600;
  margin: 0 auto 14px;
  width: fit-content;
}
.report-desc-box {
  font-size: 13px;
  color: #5a7a64;
  line-height: 1.7;
  background: #f4fbf6;
  border-radius: 10px;
  padding: 12px 14px;
  margin: 0;
  border-left: 3px solid #4caf7d;
}

.page {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.bg-art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
}
.content {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 540px;
  padding: 24px;
}
.loading,
.error-state {
  text-align: center;
  color: #5a7a64;
  font-size: 15px;
}
.closed-card {
  background: rgba(255, 255, 255, 0.92);
  border-radius: 20px;
  padding: 48px 32px;
  text-align: center;
  box-shadow: 0 16px 40px rgba(76, 175, 125, 0.12);
}
.closed-card h2 {
  font-size: 17px;
  color: #5a7a64;
  margin: 12px 0 8px;
  font-weight: 500;
}
.closed-sub {
  font-size: 13px;
  color: #8aaa94;
  margin: 0;
}

.consent-card {
  background: rgba(255, 255, 255, 0.92);
  border-radius: 20px;
  padding: 36px 28px;
  box-shadow: 0 16px 40px rgba(76, 175, 125, 0.12);
}
.consent-header {
  text-align: center;
  margin-bottom: 20px;
}
.consent-icon {
  margin-bottom: 12px;
}
.consent-header h2 {
  font-size: 20px;
  font-weight: 600;
  color: #2e4a38;
  margin: 0 0 4px;
}
.consent-subtitle {
  font-size: 13px;
  color: #8aaa94;
  margin: 0;
}
.consent-body {
  background: #f4fbf6;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
}
.consent-text {
  font-size: 13px;
  color: #3d5a48;
  line-height: 1.8;
  margin: 0 0 12px;
}
.consent-points {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.point {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #5a7a64;
}
.point-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #4caf7d;
  flex-shrink: 0;
}

.tracking-section {
  margin-bottom: 16px;
}
.tracking-toggle {
  background: none;
  border: none;
  color: #7a9685;
  font-size: 13px;
  cursor: pointer;
  padding: 0;
}
.tracking-input {
  margin-top: 8px;
}
.tracking-input input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #dcefe0;
  border-radius: 8px;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}
.tracking-input input:focus {
  border-color: #4caf7d;
}
.consent-btn {
  width: 100%;
  height: 48px;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, #6fcf97, #4caf7d);
  color: white;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.quiz-card {
  background: rgba(255, 255, 255, 0.9);
  border-radius: 20px;
  padding: 28px 28px 20px;
  box-shadow: 0 16px 40px rgba(76, 175, 125, 0.12);
}
.phase-banner {
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  padding: 6px 14px;
  border-radius: 20px;
  margin-bottom: 16px;
  display: inline-block;
}
.phase-banner.student {
  background: #e8f5e9;
  color: #2e7d32;
}
.phase-banner.parent {
  background: #fff3e0;
  color: #e65100;
}
.quiz-header h1 {
  font-size: 17px;
  font-weight: 600;
  color: #2e4a38;
  margin: 0 0 14px;
}
.progress-track {
  height: 6px;
  background: #e3f1e6;
  border-radius: 4px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #6fcf97, #4caf7d);
  border-radius: 4px;
  transition: width 0.3s;
}
.progress-label {
  font-size: 12px;
  color: #8aaa94;
  margin: 6px 0 24px;
}
.question-text {
  font-size: 16px;
  font-weight: 500;
  color: #2e4a38;
  line-height: 1.6;
  margin: 0 0 20px;
  min-height: 48px;
}

.options {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.option-btn {
  flex: 1;
  height: 50px;
  border: 1.5px solid #dcefe0;
  background: #fff;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 500;
  color: #5a7a64;
  cursor: pointer;
  transition: all 0.15s;
}
.option-btn:hover {
  border-color: #9ed9b2;
}
.option-btn.active {
  background: linear-gradient(135deg, #6fcf97, #4caf7d);
  border-color: #4caf7d;
  color: white;
  transform: scale(1.05);
}
.option-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 12px;
  color: #9cb8a6;
}

.yn-options {
  justify-content: center;
  gap: 24px;
}
.yn-btn {
  flex: none;
  width: 120px;
  font-size: 15px;
}

.text-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.multi-hint {
  font-size: 12px;
  color: #9cb8a6;
  margin: 0 0 4px;
}
.text-option-btn {
  width: 100%;
  padding: 12px 16px;
  border: 1.5px solid #dcefe0;
  background: #fff;
  border-radius: 10px;
  font-size: 14px;
  color: #3d5a48;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s;
}
.text-option-btn:hover {
  border-color: #9ed9b2;
  background: #f4fbf6;
}
.text-option-btn.active {
  background: linear-gradient(135deg, #6fcf97, #4caf7d);
  border-color: #4caf7d;
  color: white;
}

.open-text textarea {
  width: 100%;
  padding: 12px;
  border: 1.5px solid #dcefe0;
  border-radius: 10px;
  font-size: 14px;
  color: #3d5a48;
  resize: vertical;
  outline: none;
  font-family: inherit;
  box-sizing: border-box;
  line-height: 1.6;
}
.open-text textarea:focus {
  border-color: #4caf7d;
}

.speed-warning {
  background: #fff8e1;
  border: 1px solid #ffd54f;
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 16px;
  text-align: center;
}
.speed-warning p {
  font-size: 14px;
  color: #8b6914;
  margin: 0 0 10px;
}
.warning-confirm-btn {
  padding: 8px 20px;
  border: none;
  border-radius: 8px;
  background: #ffb300;
  color: white;
  font-size: 13px;
  cursor: pointer;
}

.nav-buttons {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}
.nav-btn {
  flex: 1;
  height: 46px;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: opacity 0.2s;
}
.nav-btn.secondary {
  background: #f0f7f2;
  color: #5a7a64;
}
.nav-btn.primary {
  background: linear-gradient(135deg, #6fcf97, #4caf7d);
  color: white;
}
.nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.exit-row {
  text-align: center;
  margin-top: 12px;
}
.exit-btn {
  background: none;
  border: none;
  color: #aaa;
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
}
.exit-btn:hover {
  color: #888;
}

.result-card {
  background: rgba(255, 255, 255, 0.92);
  border-radius: 20px;
  padding: 48px 32px;
  text-align: center;
  box-shadow: 0 16px 40px rgba(76, 175, 125, 0.12);
}
.result-icon {
  margin-bottom: 16px;
}
.result-card h2 {
  font-size: 18px;
  color: #2e4a38;
  margin: 0 0 8px;
}
.result-sub {
  font-size: 13px;
  color: #8aaa94;
  margin: 0;
}

.info-card {
  background: rgba(255, 255, 255, 0.92);
  border-radius: 20px;
  padding: 32px 28px;
  box-shadow: 0 16px 40px rgba(76, 175, 125, 0.12);
}
.info-card h2 {
  font-size: 19px;
  font-weight: 600;
  color: #2e4a38;
  margin: 0 0 6px;
}
.info-subtitle {
  font-size: 13px;
  color: #8aaa94;
  margin: 0 0 24px;
}
.info-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-bottom: 24px;
}
.info-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.info-label {
  font-size: 14px;
  font-weight: 500;
  color: #2e4a38;
}
.required {
  color: #f44336;
  margin-left: 2px;
}
.info-input {
  height: 40px;
  padding: 0 12px;
  border: 1.5px solid #dcefe0;
  border-radius: 10px;
  font-size: 14px;
  color: #3d5a48;
  outline: none;
}
.info-input:focus {
  border-color: #4caf7d;
}
.info-select {
  height: 40px;
  padding: 0 12px;
  border: 1.5px solid #dcefe0;
  border-radius: 10px;
  font-size: 14px;
  color: #3d5a48;
  outline: none;
  background: white;
}
.radio-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.radio-item {
  padding: 6px 16px;
  border-radius: 20px;
  border: 1.5px solid #dcefe0;
  background: white;
  font-size: 13px;
  color: #5a7a64;
  cursor: pointer;
  transition: all 0.15s;
}
.radio-item.active {
  background: linear-gradient(135deg, #6fcf97, #4caf7d);
  border-color: #4caf7d;
  color: white;
}
</style>
