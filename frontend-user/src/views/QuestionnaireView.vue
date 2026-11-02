<script setup>
import {
  ref,
  reactive,
  onMounted,
  onBeforeUnmount,
  computed,
  watch,
  nextTick,
} from "vue";
import { useRoute } from "vue-router";
import { API_BASE } from "../api.js";
import { evaluateLogic, normalizeLogic } from "../logic.js";
import KeyOptions from "../components/KeyOptions.vue";
import {
  PRACTICE_ITEMS,
  CONFIDENCE_LEVELS,
  isKeyCapable,
  letterOf,
  letterIndexFromEvent,
  digitFromEvent,
  eventTime,
  isTouchDevice,
} from "../keyResponse.js";

// 两种入口：/q/问卷编号（单份问卷）、/b/组合编号（问卷组合：依次作答几份问卷）
const route = useRoute();
const isBundle = route.name === "bundle";
const entityId = Number(route.params.id); // 网址里的编号，写错时是 NaN
const groupLabel = route.query.group || null; // 从链接参数读取分组标记

const bundle = ref(null); // 问卷组合的信息（单份问卷时为 null）
const units = ref([]); // 要作答的问卷：[{ questionnaire, questions, sections, infoFields }]
const unitIndex = ref(0); // 正在作答第几份
const unitDone = ref(false); // 组合里一份答完、还没开始下一份（显示过渡页）
const bundleToken = makeToken(); // 同一个人这次作答的几份问卷共用这个标记
const results = ref([]); // 每份问卷提交后的结果：[{ title, subjectReport, dimensionReports, reportChart }]

const unit = computed(() => units.value[unitIndex.value] || null);
const questionnaire = computed(() => unit.value?.questionnaire || null);
const allQuestions = computed(() => unit.value?.questions || []);
const sections = computed(() => unit.value?.sections || []); // 板块引导语

// 知情同意页显示的标题和说明：组合用组合自己的
const cover = computed(() => {
  if (isBundle && bundle.value) {
    return {
      title: bundle.value.title,
      description: bundle.value.description,
      consent_text: bundle.value.consent_text,
    };
  }
  const q = questionnaire.value || {};
  return {
    title: q.title,
    description: q.description,
    consent_text: q.consent_text,
  };
});

const submitted = ref(false);
const consented = ref(false);
const loading = ref(true);
const closedMessage = ref("");
const loadError = ref(""); // 问卷不存在、链接有误、连不上服务器时的提示
const overallStartTime = ref(null);
const trackingCode = ref("");
const showTrackingInput = ref(false);
const submitting = ref(false); // 正在提交（防止连点两次交两份）
const submitError = ref("");
const zoomImage = ref(""); // 点开放大的图片

// 生成一个随机标记（手机用局域网 IP 打开时没有 crypto.randomUUID，用 getRandomValues）
function makeToken() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// 条形长度：分数在这个维度「最低分~最高分」之间的位置（百分比）
function barWidth(value, dim) {
  if (value === null || value === undefined || dim.max === dim.min) return 0;
  const pct = ((value - dim.min) / (dim.max - dim.min)) * 100;
  return Math.max(2, Math.min(100, pct)); // 至少露出一点，看得出有条
}

// 某个维度匹配到的评价（没有就返回 null）
function dimRule(r, name) {
  const found = r.dimensionReports.find((d) => d.name === name);
  return found ? found.matched_rule : null;
}

// 这份问卷有没有要给受测者看的结果
function hasResult(r) {
  return !!(r.subjectReport || r.reportChart || r.dimensionReports.length > 0);
}
const anyResult = computed(() => results.value.some(hasResult));

// 结果图表里有没有常模平均
function chartHasNorm(chart) {
  return (
    !!chart.norm_name && chart.dimensions.some((d) => d.norm_mean !== null)
  );
}

// 需要收集的基本信息：组合里几份问卷的字段合并，同一个字段只问一次
const infoFields = computed(() => {
  const list = [];
  units.value.forEach((u) =>
    u.infoFields.forEach((f) => {
      if (!list.some((x) => x.field_key === f.field_key)) list.push(f);
    }),
  );
  return list;
});
const infoAnswers = ref({}); // 受测者填写的基本信息
const infoSubmitted = ref(false); // 基本信息是否已提交
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

// 作答顺序：学生（和通用）题在前，家长题在后
const flowQuestions = computed(() => [
  ...studentQuestions.value,
  ...parentQuestions.value,
]);

// 答案和计时
const answersMap = ref({});
const questionDurations = ref({});
const currentQuestionStartTime = ref(null);
const currentId = ref(null); // 正在作答的题目 id

// 题目逻辑（题目关联、跳题、选项关联）：按目前的答案算出显示哪些题、哪些选项、在哪一题结束
const logicState = computed(() =>
  evaluateLogic(flowQuestions.value, answersMap.value),
);
// 按逻辑应该显示的题（按作答顺序）
const visibleFlow = computed(() => {
  const shown = new Set(logicState.value.visible);
  return flowQuestions.value.filter((q) => shown.has(q.id));
});
// 有题目逻辑时，总题数会随着作答变化，进度只显示「第 x 题」，不显示「共 n 题」
const hasLogic = computed(() =>
  allQuestions.value.some((q) => {
    const lg = normalizeLogic(q.logic);
    return !!(lg.display || lg.jump || lg.option_link);
  }),
);
// 这份问卷是否被跳题逻辑判为无效答卷（答到了「直接提交为无效答卷」的选项）
const endsInvalid = computed(() => !!logicState.value.end?.invalid);

// 快速作答检测（阈值2秒）
const MIN_DURATION_MS = 2000;
const showSpeedWarning = ref(false);

const currentQuestion = computed(
  () => flowQuestions.value.find((q) => q.id === currentId.value) || null,
);
// 当前阶段：student 或 parent
const currentPhase = computed(() =>
  currentQuestion.value?.role === "parent" ? "parent" : "student",
);
// 当前阶段要显示的题（「第 x 题 / 共 n 题」按它算）
const currentQuestions = computed(() =>
  visibleFlow.value.filter(
    (q) => (q.role === "parent" ? "parent" : "student") === currentPhase.value,
  ),
);
const currentIndex = computed(() =>
  Math.max(
    0,
    currentQuestions.value.findIndex((q) => q.id === currentId.value),
  ),
);
const flowPos = computed(() =>
  visibleFlow.value.findIndex((q) => q.id === currentId.value),
);
// 下一道、上一道要显示的题（跳题、题目关联已经算进去了）
const nextVisible = computed(() => {
  if (logicState.value.end && logicState.value.end.id === currentId.value)
    return null; // 这一题之后结束作答
  return flowPos.value >= 0
    ? visibleFlow.value[flowPos.value + 1] || null
    : null;
});
const prevVisible = computed(() =>
  flowPos.value > 0 ? visibleFlow.value[flowPos.value - 1] : null,
);
const progressPercent = computed(() => {
  const total = visibleFlow.value.length;
  return total > 0 ? Math.round((Math.max(0, flowPos.value) / total) * 100) : 0;
});
// 当前题所属的板块（有的话，题目上方显示板块标题和引导语）
const currentSection = computed(() => {
  const sid = currentQuestion.value?.section_id;
  return sid ? sections.value.find((s) => s.id === sid) || null : null;
});

const isLastQuestion = computed(() => !nextVisible.value);
// 当前题的答案：设了选项关联时，选中的选项被隐藏了就不算
const currentAnswer = computed(() => {
  const q = currentQuestion.value;
  if (!q) return null;
  return logicState.value.optionVisible[q.id]
    ? logicState.value.effective[q.id]
    : answersMap.value[q.id];
});

// 单选、多选题要显示的选项（设了选项关联时只显示符合条件的）
function shownOptions(q) {
  const all = parseOptions(q.options);
  const vis = logicState.value.optionVisible[q.id];
  return vis ? all.filter((o) => vis.includes(o.label)) : all;
}

// 正在答题（知情同意、基本信息都过了，还没交卷）
const inQuiz = computed(
  () =>
    consented.value &&
    (infoFields.value.length === 0 || infoSubmitted.value) &&
    !submitted.value &&
    !unitDone.value &&
    !!unit.value,
);
// 开始答题时才开始给第一题计时（以前从打开页面就开始计，第一题的用时会把读知情同意的时间算进去）
watch(inQuiz, (now) => {
  if (now) currentQuestionStartTime.value = Date.now();
});

// ================= 按键作答模式 =================
// 问卷设置里选了「按键作答」，或者链接里带 ?mode=key（?mode=click 强制点击作答）
const linkMode = ["key", "click"].includes(route.query.mode)
  ? route.query.mode
  : null;
const keyMode = computed(
  () => (linkMode || questionnaire.value?.answer_mode || "click") === "key",
);
const touchDevice = isTouchDevice();
const keyConfidenceOn = computed(() => !!questionnaire.value?.key_confidence);
// 说明和练习：一次作答只做一次（组合里第一份按键作答的问卷之前）
const keyStage = ref("guide"); // guide 说明 → practice 练习 → practiceDone 练习结束 → formal 正式作答
const practiceCount = computed(() =>
  Math.max(
    0,
    Math.min(PRACTICE_ITEMS.length, questionnaire.value?.key_practice ?? 3),
  ),
);
const practiceIndex = ref(0);
// 当前这一个按键试次的状态
const trial = reactive({
  phase: "idle", // idle 还没准备好 / ready 等待按键 / pressed 按着 / done 已作答 / confidence 回答把握程度
  shownAt: 0, // 题目出现的时刻
  downAt: 0, // 按下的时刻
  pressedIndex: -1, // 按下的是第几个选项
  code: "", // 按下的物理按键（松开时对上同一个键）
  pointerId: null, // 触屏按下的手指
  input: "", // key 键盘 / touch 触屏
});
const keyData = ref({}); // 正式作答的按键数据：{ 题目id: { rt_ms, hold_ms, input_method, confidence } }
const keyHint = ref(""); // 临时提示（如用鼠标点了选项）
let hintTimer = null;
let advanceTimer = null;

// 现在显示的是练习题还是正式题；正式题里多选、开放题照常用鼠标/手指作答
const practicing = computed(
  () => keyMode.value && keyStage.value === "practice",
);
const keyTrialOn = computed(
  () =>
    keyMode.value &&
    (practicing.value ||
      (keyStage.value === "formal" && isKeyCapable(currentQuestion.value))),
);
const trialQuestion = computed(() =>
  practicing.value
    ? PRACTICE_ITEMS[practiceIndex.value]
    : currentQuestion.value,
);
// 当前题的选项（按显示顺序，第 i 个对应字母 A、B、C…）：{ value 记录的答案, label, image }
const trialOptions = computed(() => {
  const q = trialQuestion.value;
  if (!q) return [];
  if (practicing.value) return q.options.map((t) => ({ value: t, label: t }));
  const type = q.question_type || "scale";
  if (type === "yes_no")
    return [
      { value: "是", label: "是" },
      { value: "否", label: "否" },
    ];
  if (type === "single_choice") {
    return shownOptions(q).map((o) => ({
      value: o.label,
      label: o.label,
      image: o.image ? mediaUrl(o.image) : null,
    }));
  }
  const imgs = scaleImageOptions(q);
  if (imgs.length > 0)
    return imgs.map((o) => ({
      value: o.score,
      label: o.label || String(o.score),
      image: mediaUrl(o.image),
    }));
  const texts = scaleTextOptions(q);
  if (texts.length > 0)
    return texts.map((o) => ({ value: o.score, label: o.label }));
  const list = [];
  for (let s = q.min_score; s <= q.max_score; s++) {
    let label = String(s);
    if (s === q.min_score) label += `（${scaleEndLabel(q, "min")}）`;
    if (s === q.max_score) label += `（${scaleEndLabel(q, "max")}）`;
    list.push({ value: s, label });
  }
  return list;
});

function showKeyHint(text) {
  keyHint.value = text;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => (keyHint.value = ""), 2500);
}

// 新的一题（或练习题）显示出来以后，开始计时、等待按键
async function startTrial() {
  trial.phase = "idle";
  trial.pressedIndex = -1;
  trial.code = "";
  trial.pointerId = null;
  await nextTick();
  // 等题目真正画到屏幕上（两帧之后）再开始计时
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (!keyTrialOn.value) return;
      trial.shownAt = performance.now();
      trial.phase = "ready";
    }),
  );
}
watch(
  () => [
    keyTrialOn.value,
    inQuiz.value,
    keyStage.value,
    practiceIndex.value,
    currentId.value,
  ],
  () => {
    clearTimeout(advanceTimer);
    if (keyTrialOn.value && inQuiz.value) startTrial();
    else trial.phase = "idle";
  },
);

function pressOption(index, time, input, code = "", pointerId = null) {
  trial.phase = "pressed";
  trial.pressedIndex = index;
  trial.downAt = time;
  trial.input = input;
  trial.code = code;
  trial.pointerId = pointerId;
}

// 松开：记录这次作答
function releaseOption(time) {
  const opt = trialOptions.value[trial.pressedIndex];
  if (!opt) return;
  const rt = Math.max(0, Math.round(trial.downAt - trial.shownAt));
  const hold = Math.max(0, Math.round(time - trial.downAt));
  trial.phase = "done";
  if (practicing.value) {
    advanceTimer = setTimeout(afterTrial, 450);
    return;
  }
  const q = currentQuestion.value;
  answersMap.value[q.id] = opt.value;
  keyData.value[q.id] = { rt_ms: rt, hold_ms: hold, input_method: trial.input };
  questionDurations.value[q.id] = Math.round(time - trial.shownAt);
  advanceTimer = setTimeout(afterTrial, 350);
}

// 一题答完：要问把握程度就先问，否则进入下一题
function afterTrial() {
  if (keyConfidenceOn.value) {
    trial.phase = "confidence";
    return;
  }
  nextTrial();
}

function chooseConfidence(level) {
  if (trial.phase !== "confidence") return;
  if (!practicing.value) {
    const q = currentQuestion.value;
    keyData.value[q.id] = { ...keyData.value[q.id], confidence: level };
  }
  trial.phase = "done";
  advanceTimer = setTimeout(nextTrial, 200);
}

function nextTrial() {
  if (practicing.value) {
    if (practiceIndex.value < practiceCount.value - 1) practiceIndex.value++;
    else keyStage.value = "practiceDone";
    return;
  }
  goNext();
}

// 没按完就切走了（切换窗口、来电话）：这次按键作废，重新按
function cancelPress() {
  if (trial.phase === "pressed") {
    trial.phase = "ready";
    trial.pressedIndex = -1;
  }
}

function onKeyDown(e) {
  if (!keyTrialOn.value || !inQuiz.value) return;
  if (trial.phase === "confidence") {
    const d = digitFromEvent(e);
    if (d && !e.repeat) {
      e.preventDefault();
      chooseConfidence(d);
    }
    return;
  }
  const index = letterIndexFromEvent(e);
  if (index < 0 || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  // 按住不放时浏览器会不断重复发出「按下」，只认第一次
  if (e.repeat || trial.phase !== "ready") return;
  if (index >= trialOptions.value.length) {
    showKeyHint(
      `这道题只有 A–${letterOf(trialOptions.value.length - 1)} 几个选项`,
    );
    return;
  }
  pressOption(index, eventTime(e), "key", e.code);
}

function onKeyUp(e) {
  if (trial.phase !== "pressed" || trial.input !== "key") return;
  if (e.code !== trial.code) return; // 松开的不是按下的那个键
  e.preventDefault();
  releaseOption(eventTime(e));
}

// 触屏：手指按下、抬起选项；鼠标点击不算（电脑上要用键盘）
function onOptionPress(e, index) {
  if (e.pointerType === "mouse") {
    showKeyHint(
      touchDevice
        ? "请直接用手指点选项"
        : "这份问卷用键盘作答：请按选项前面的字母键，不用点鼠标",
    );
    return;
  }
  if (trial.phase !== "ready") return;
  e.preventDefault();
  e.currentTarget.setPointerCapture?.(e.pointerId);
  pressOption(index, eventTime(e), "touch", "", e.pointerId);
}
function onOptionRelease(e) {
  if (trial.phase !== "pressed" || trial.input !== "touch") return;
  if (e.pointerId !== trial.pointerId) return;
  releaseOption(eventTime(e));
}
function onOptionCancel() {
  if (trial.input === "touch") cancelPress();
}
function onVisibility() {
  if (document.hidden) cancelPress();
}

function startPractice() {
  practiceIndex.value = 0;
  keyStage.value = practiceCount.value > 0 ? "practice" : "formal";
}
function startFormal() {
  keyStage.value = "formal";
  currentQuestionStartTime.value = Date.now();
}

onMounted(() => {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", cancelPress);
  document.addEventListener("visibilitychange", onVisibility);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  window.removeEventListener("blur", cancelPress);
  document.removeEventListener("visibilitychange", onVisibility);
  clearTimeout(hintTimer);
  clearTimeout(advanceTimer);
});
// ================= 按键作答模式（结束） =================

// 把选项统一成 [{ label, score, image }] 格式（兼容旧数据：纯文字数组）
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
      ? { label: o, score: null, image: null }
      : {
          label: o.label ?? "",
          score: o.score ?? null,
          image: o.image || null,
        },
  );
}

// 题目的图片 / 视频 / 音频
function parseMedia(raw) {
  let arr = raw;
  if (!arr) return [];
  if (typeof arr === "string") {
    try {
      arr = JSON.parse(arr);
    } catch {
      return [];
    }
  }
  return Array.isArray(arr) ? arr : [];
}
const currentMedia = computed(() =>
  currentQuestion.value ? parseMedia(currentQuestion.value.media) : [],
);
function mediaUrl(url) {
  return url ? API_BASE + url : "";
}

// 量表题：每个分数都配了文字时，受测者只看到文字按钮
function scaleTextOptions(q) {
  const opts = parseOptions(q.options);
  return opts.length > 0 && opts.every((o) => o.label) ? opts : [];
}

// 量表题：每个分数都配了图片时，受测者看到图片选项（如表情量表）
function scaleImageOptions(q) {
  const opts = parseOptions(q.options);
  return opts.length > 0 && opts.every((o) => o.image) ? opts : [];
}

// 图片量表不超过 7 个分数时排成一行
function scaleGridStyle(q) {
  const n = scaleImageOptions(q).length;
  return n > 0 && n <= 7
    ? { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }
    : {};
}

// 单选 / 多选题：有选项配了图片时，用图片卡片显示
function choiceHasImages(q) {
  return parseOptions(q.options).some((o) => o.image);
}

// 量表题两端的提示文字（没配文字时显示「较低 / 较高」）
function scaleEndLabel(q, end) {
  const opts = parseOptions(q.options);
  const score = end === "min" ? q.min_score : q.max_score;
  const found = opts.find((o) => o.score === score && o.label);
  return found ? found.label : end === "min" ? "较低" : "较高";
}

// 打乱顺序（组合设置了随机顺序时用）
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function parseFields(fields) {
  return (fields || []).map((f) => ({
    ...f,
    options: f.options
      ? typeof f.options === "string"
        ? JSON.parse(f.options)
        : f.options
      : [],
  }));
}

// 开始作答某一份问卷：清空上一份的作答状态
function startUnit() {
  answersMap.value = {};
  keyData.value = {};
  questionDurations.value = {};
  allQuestions.value.forEach((q) => {
    questionDurations.value[q.id] = 0;
  });
  currentId.value = visibleFlow.value[0]?.id ?? null;
  showDesc.value = false;
  showSpeedWarning.value = false;
  submitError.value = "";
  overallStartTime.value = Date.now();
  currentQuestionStartTime.value = Date.now();
}

async function loadSingle() {
  const response = await fetch(`${API_BASE}/api/questionnaire/${entityId}`);
  const data = await response.json();
  if (!data.success) return data;
  let infoFieldsList = [];
  try {
    const infoRes = await fetch(
      `${API_BASE}/api/questionnaires/${entityId}/info-fields`,
    );
    const infoData = await infoRes.json();
    if (infoData.success) infoFieldsList = parseFields(infoData.fields);
  } catch (e) {}
  units.value = [
    {
      questionnaire: data.questionnaire,
      questions: data.questions,
      sections: data.sections || [],
      infoFields: infoFieldsList,
    },
  ];
  return data;
}

async function loadBundle() {
  const response = await fetch(`${API_BASE}/api/bundle/${entityId}`);
  const data = await response.json();
  if (!data.success) return data;
  bundle.value = data.bundle;
  let list = data.units.map((u) => ({
    questionnaire: u.questionnaire,
    questions: u.questions,
    sections: u.sections || [],
    infoFields: parseFields(u.info_fields),
  }));
  if (data.bundle.shuffle) list = shuffle(list);
  units.value = list;
  return data;
}

onMounted(async () => {
  // 网址里的编号不是正整数（比如 /q/abc），不用请求后端，直接提示链接有误
  if (!Number.isInteger(entityId) || entityId <= 0) {
    loadError.value = "问卷链接有误";
    loading.value = false;
    return;
  }
  try {
    const data = isBundle ? await loadBundle() : await loadSingle();
    if (data.success) {
      startUnit();
    } else if (data.closed) {
      closedMessage.value = data.message;
    } else {
      loadError.value = data.message || "问卷不存在";
    }
  } catch (err) {
    console.error("获取问卷失败:", err);
    loadError.value = "暂时连不上服务器";
  } finally {
    loading.value = false;
  }
});

function recordCurrentQuestionTime() {
  if (!currentQuestion.value || !currentQuestionStartTime.value) return;
  const elapsed = Date.now() - currentQuestionStartTime.value;
  questionDurations.value[currentQuestion.value.id] =
    (questionDurations.value[currentQuestion.value.id] || 0) + elapsed;
  currentQuestionStartTime.value = Date.now(); // 已经记过的时间不再重复计
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
  if (!hasAnswer() || submitting.value) return;

  recordCurrentQuestionTime();

  // 快速作答检测
  const duration = questionDurations.value[currentQuestion.value.id] || 0;
  if (duration < MIN_DURATION_MS) {
    showSpeedWarning.value = true;
    return;
  }

  goNext();
}

// 下一题：按题目逻辑跳到下一道要显示的题（学生题答完会自动进入家长题）；没有了就提交
function goNext() {
  showSpeedWarning.value = false;
  const next = nextVisible.value;
  if (!next) {
    submitQuestionnaire();
    return;
  }
  currentId.value = next.id;
  currentQuestionStartTime.value = Date.now();
}

// 上一题：回到上一道显示过的题（被跳过的题不会出现）
function prevQuestion() {
  const prev = prevVisible.value;
  if (!prev) return;
  recordCurrentQuestionTime();
  currentId.value = prev.id;
  currentQuestionStartTime.value = Date.now();
}

function confirmExit() {
  const tip =
    isBundle && unitIndex.value > 0
      ? "确认退出？已经完成的问卷已保存，正在作答的这一份不会被保存。"
      : "确认退出？您目前的作答数据将不会被保存。";
  if (confirm(tip)) {
    window.location.href = "about:blank";
  }
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

const toDbTime = (ms) =>
  new Date(ms).toISOString().slice(0, 19).replace("T", " ");

async function submitQuestionnaire() {
  if (submitting.value) return;
  submitting.value = true;
  submitError.value = "";
  const finishedAt = Date.now();
  const invalid = endsInvalid.value;
  // 只提交按逻辑显示了的题（被跳过、被隐藏的题不提交）；答案用逻辑处理后的（隐藏了的选项不算）
  const answers = visibleFlow.value.map((q) => {
    const ans = logicState.value.effective[q.id];
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
      ...(keyData.value[q.id] || {}), // 按键作答：按下用时、按住时长、输入方式、把握程度
    };
  });

  // 基本信息随提交一起保存（组合里每份问卷都记一份，方便各自导出和匹配常模）
  const subjectInfo = infoFields.value.map((f) => ({
    field_key: f.field_key,
    field_label: f.field_label,
    value: infoAnswers.value[f.field_key] ?? "",
  }));

  try {
    const response = await fetch(`${API_BASE}/api/submission`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionnaire_id: questionnaire.value.id,
        tracking_code: trackingCode.value || null,
        group_label: groupLabel,
        started_at: toDbTime(overallStartTime.value),
        finished_at: toDbTime(finishedAt),
        answers,
        subject_info: subjectInfo,
        answer_mode: keyMode.value ? "key" : "click",
        ...(isBundle
          ? {
              bundle_id: entityId,
              bundle_token: bundleToken,
              bundle_position: unitIndex.value + 1,
            }
          : {}),
      }),
    });
    const data = await response.json();
    if (!data.success) throw new Error(data.message);

    // 被跳题逻辑判为无效答卷：不显示结果，组合里后面的问卷也不再作答
    if (invalid || data.is_invalid) {
      submitted.value = true;
      return;
    }

    // 拉取对受测者可见的结果
    const result = {
      title: questionnaire.value.title,
      subjectReport: null,
      dimensionReports: [],
      reportChart: null,
    };
    try {
      const reportRes = await fetch(
        `${API_BASE}/api/submissions/${data.submission_id}/report-public`,
      );
      const reportData = await reportRes.json();
      if (reportData.success) {
        result.subjectReport = reportData.matched_rule; // 总分评价（可能为空）
        result.dimensionReports = reportData.dimension_reports || [];
        result.reportChart = reportData.chart || null;
      }
    } catch (e) {}
    results.value.push(result);

    if (unitIndex.value < units.value.length - 1) {
      unitDone.value = true; // 组合里还有下一份
    } else {
      submitted.value = true;
    }
  } catch (err) {
    console.error("提交失败:", err);
    submitError.value = "提交没有成功，请检查网络后再点一次「提交」。";
  } finally {
    submitting.value = false;
  }
}

// 组合：开始下一份问卷
function nextUnit() {
  unitIndex.value++;
  unitDone.value = false;
  startUnit();
  window.scrollTo(0, 0);
}

const nextUnitInfo = computed(() => units.value[unitIndex.value + 1] || null);
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

      <!-- 问卷不存在 / 链接有误 / 连不上服务器 -->
      <div v-else-if="loadError" class="closed-card">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="#8AAA94" stroke-width="1.5" />
          <path
            d="M12 7.5v5.5M12 16.2v.3"
            stroke="#8AAA94"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        </svg>
        <h2>{{ loadError }}</h2>
        <p class="closed-sub">
          请确认链接是否完整，或联系发放问卷的老师或研究者。
        </p>
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
          <h2>{{ cover.title }}</h2>
          <p class="consent-subtitle">参与前请阅读以下说明</p>
        </div>
        <!-- 问卷说明 -->
        <div v-if="cover.description" class="desc-box">
          <p class="desc-title">{{ isBundle ? "测评说明" : "问卷说明" }}</p>
          <p class="desc-text">{{ cover.description }}</p>
        </div>
        <!-- 组合：列出要答的几份问卷 -->
        <div v-if="isBundle && units.length > 1" class="unit-list">
          <p class="desc-title">
            本次共 {{ units.length }} 份问卷，请按顺序依次完成
          </p>
          <div
            v-for="(u, i) in units"
            :key="u.questionnaire.id"
            class="unit-row"
          >
            <span class="unit-no">{{ i + 1 }}</span>
            <span class="unit-name">{{ u.questionnaire.title }}</span>
            <span class="unit-count">{{ u.questions.length }} 题</span>
          </div>
        </div>
        <div class="consent-body">
          <p class="consent-text">
            {{
              cover.consent_text ||
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

      <!-- 组合：一份答完，准备下一份 -->
      <div v-else-if="unitDone" class="result-card unit-done">
        <div class="result-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
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
        <h2>第 {{ unitIndex + 1 }} 份已完成</h2>
        <p class="result-sub">
          共 {{ units.length }} 份，还剩
          {{ units.length - unitIndex - 1 }} 份。可以稍微休息一下再继续。
        </p>
        <div v-if="nextUnitInfo" class="next-unit">
          <p class="next-label">接下来：第 {{ unitIndex + 2 }} 份</p>
          <p class="next-title">{{ nextUnitInfo.questionnaire.title }}</p>
          <p class="next-count">共 {{ nextUnitInfo.questions.length }} 题</p>
          <p
            v-if="nextUnitInfo.questionnaire.description"
            class="desc-text next-desc"
          >
            {{ nextUnitInfo.questionnaire.description }}
          </p>
        </div>
        <button class="consent-btn" @click="nextUnit">继续作答</button>
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
          <p v-if="isBundle && units.length > 1" class="unit-badge">
            第 {{ unitIndex + 1 }} / {{ units.length }} 份
          </p>
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

        <!-- 按键作答：先看说明、做练习 -->
        <div v-if="keyMode && keyStage !== 'formal'" class="key-intro">
          <template v-if="keyStage === 'guide'">
            <p class="key-intro-title">
              {{ touchDevice ? "本问卷用手指点选项作答" : "本问卷用键盘作答" }}
            </p>
            <ul class="key-intro-list">
              <template v-if="!touchDevice">
                <li>
                  每个选项前面有一个字母（A、B、C……）。看完题目后，直接按对应的字母键作答，松开按键后自动进入下一题。
                </li>
                <li>请把手放在键盘上，不用点鼠标。</li>
              </template>
              <li v-else>
                每个选项前面有一个字母。看完题目后，直接用手指点你选的选项，手指离开屏幕后自动进入下一题。
              </li>
              <li>每道题只能作答一次，不能返回修改。</li>
              <li v-if="keyConfidenceOn">
                每道题答完后，会问你对这个回答有多大把握，{{
                  touchDevice ? "点 1–5 回答" : "按数字键 1–5 回答"
                }}。
              </li>
              <li>
                遇到多选题或需要输入文字的题，照常用{{
                  touchDevice ? "手指" : "鼠标"
                }}作答，再点「下一题」。
              </li>
            </ul>
            <p v-if="practiceCount > 0" class="key-intro-note">
              先做 {{ practiceCount }} 道练习题熟悉一下，练习不计入结果。
            </p>
            <button class="consent-btn" @click="startPractice">
              {{ practiceCount > 0 ? "开始练习" : "开始作答" }}
            </button>
          </template>

          <template v-else-if="keyStage === 'practice'">
            <p class="practice-badge">
              练习 {{ practiceIndex + 1 }} / {{ practiceCount }}
            </p>
            <p class="question-text">{{ trialQuestion.content }}</p>
            <KeyOptions
              :options="trialOptions"
              :pressed-index="trial.pressedIndex"
              :phase="trial.phase"
              :touch="touchDevice"
              :hint="keyHint"
              @press="onOptionPress"
              @release="onOptionRelease"
              @cancel="onOptionCancel"
              @confidence="chooseConfidence"
            />
          </template>

          <template v-else>
            <p class="key-intro-title">练习结束</p>
            <p class="key-intro-note">
              正式作答的操作和刚才一样。每道题只能作答一次，不能返回修改。
            </p>
            <button class="consent-btn" @click="startFormal">
              开始正式作答
            </button>
          </template>
        </div>

        <template v-else>
          <div class="progress-track">
            <div
              class="progress-fill"
              :style="{ width: progressPercent + '%' }"
            ></div>
          </div>
          <p class="progress-label">
            第 {{ currentIndex + 1 }} 题<template v-if="!hasLogic">
              / 共 {{ currentQuestions.length }} 题</template
            >
            <span
              v-if="hasParentSection"
              style="margin-left: 8px; opacity: 0.6"
            >
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

            <!-- 题目的图片 / 视频 / 音频（屏蔽右键另存、拖动保存、下载按钮） -->
            <div
              v-if="currentMedia.length > 0"
              class="q-media no-save"
              @contextmenu.prevent
              @dragstart.prevent
            >
              <template v-for="m in currentMedia" :key="m.url">
                <img
                  v-if="m.type === 'image'"
                  :src="mediaUrl(m.url)"
                  class="q-media-img"
                  alt="题目图片"
                  @click="zoomImage = mediaUrl(m.url)"
                />
                <video
                  v-else-if="m.type === 'video'"
                  :src="mediaUrl(m.url)"
                  class="q-media-video"
                  controls
                  controlslist="nodownload noplaybackrate noremoteplayback"
                  disablepictureinpicture
                  playsinline
                  preload="metadata"
                ></video>
                <audio
                  v-else-if="m.type === 'audio'"
                  :src="mediaUrl(m.url)"
                  class="q-media-audio"
                  controls
                  controlslist="nodownload noplaybackrate"
                  preload="metadata"
                ></audio>
              </template>
              <p
                v-if="currentMedia.some((m) => m.type === 'image')"
                class="media-hint"
              >
                点击图片可以放大
              </p>
            </div>

            <!-- 按键作答：量表、单选、是否题用字母选项 -->
            <KeyOptions
              v-if="keyTrialOn"
              :options="trialOptions"
              :pressed-index="trial.pressedIndex"
              :phase="trial.phase"
              :touch="touchDevice"
              :hint="keyHint"
              @press="onOptionPress"
              @release="onOptionRelease"
              @cancel="onOptionCancel"
              @confidence="chooseConfidence"
            />
            <template v-else>
              <p v-if="keyMode" class="key-other-tip">
                这道题照常用{{
                  touchDevice ? "手指" : "鼠标"
                }}作答，完成后点「下一题」
              </p>
              <!-- 量表题 -->
              <template
                v-if="
                  !currentQuestion.question_type ||
                  currentQuestion.question_type === 'scale'
                "
              >
                <!-- 每个分数都配了图片：显示图片选项（如表情量表） -->
                <div
                  v-if="scaleImageOptions(currentQuestion).length > 0"
                  class="image-options scale-images no-save"
                  @contextmenu.prevent
                  @dragstart.prevent
                  :style="scaleGridStyle(currentQuestion)"
                >
                  <button
                    v-for="opt in scaleImageOptions(currentQuestion)"
                    :key="opt.score"
                    class="image-option"
                    :class="{ active: currentAnswer === opt.score }"
                    @click="selectAnswer(opt.score)"
                  >
                    <img
                      :src="mediaUrl(opt.image)"
                      :alt="opt.label || opt.score"
                    />
                    <span v-if="opt.label" class="image-option-label">{{
                      opt.label
                    }}</span>
                  </button>
                </div>
                <!-- 每个分数都配了文字：只显示文字，选中后记录对应分数 -->
                <div
                  v-else-if="scaleTextOptions(currentQuestion).length > 0"
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
                        active:
                          currentAnswer === currentQuestion.min_score + n - 1,
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

              <!-- 单选题（图片选项） -->
              <div
                v-else-if="
                  currentQuestion.question_type === 'single_choice' &&
                  choiceHasImages(currentQuestion)
                "
                class="image-options no-save"
                @contextmenu.prevent
                @dragstart.prevent
              >
                <button
                  v-for="opt in shownOptions(currentQuestion)"
                  :key="opt.label"
                  class="image-option"
                  :class="{ active: currentAnswer === opt.label }"
                  @click="selectAnswer(opt.label)"
                >
                  <img
                    v-if="opt.image"
                    :src="mediaUrl(opt.image)"
                    :alt="opt.label"
                  />
                  <span class="image-option-label">{{ opt.label }}</span>
                </button>
              </div>

              <!-- 单选题（文字选项） -->
              <div
                v-else-if="currentQuestion.question_type === 'single_choice'"
                class="text-options"
              >
                <button
                  v-for="opt in shownOptions(currentQuestion)"
                  :key="opt.label"
                  class="text-option-btn"
                  :class="{ active: currentAnswer === opt.label }"
                  @click="selectAnswer(opt.label)"
                >
                  {{ opt.label }}
                </button>
              </div>

              <!-- 多选题（图片选项） -->
              <div
                v-else-if="
                  currentQuestion.question_type === 'multiple_choice' &&
                  choiceHasImages(currentQuestion)
                "
              >
                <p class="multi-hint">可多选</p>
                <div
                  class="image-options no-save"
                  @contextmenu.prevent
                  @dragstart.prevent
                >
                  <button
                    v-for="opt in shownOptions(currentQuestion)"
                    :key="opt.label"
                    class="image-option"
                    :class="{ active: isMultiSelected(opt.label) }"
                    @click="toggleMultiAnswer(opt.label)"
                  >
                    <img
                      v-if="opt.image"
                      :src="mediaUrl(opt.image)"
                      :alt="opt.label"
                    />
                    <span class="image-option-label">{{ opt.label }}</span>
                  </button>
                </div>
              </div>

              <!-- 多选题 -->
              <div
                v-else-if="currentQuestion.question_type === 'multiple_choice'"
                class="text-options"
              >
                <p class="multi-hint">可多选</p>
                <button
                  v-for="opt in shownOptions(currentQuestion)"
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
            </template>
          </div>

          <!-- 快速作答警告 -->
          <div v-if="showSpeedWarning" class="speed-warning">
            <p>⚠️ 您的作答速度较快，请认真阅读题目后再作答。</p>
            <button class="warning-confirm-btn" @click="goNext">
              我已认真阅读，继续
            </button>
          </div>

          <div class="nav-buttons" v-if="!showSpeedWarning && !keyTrialOn">
            <button
              v-if="!keyMode"
              class="nav-btn secondary"
              @click="prevQuestion"
              :disabled="!prevVisible"
            >
              上一题
            </button>
            <button
              class="nav-btn primary"
              @click="nextQuestion"
              :disabled="!hasAnswer() || submitting"
            >
              {{
                submitting
                  ? "正在提交…"
                  : isLastQuestion
                    ? isBundle && unitIndex < units.length - 1 && !endsInvalid
                      ? "提交这一份"
                      : "提交问卷"
                    : "下一题"
              }}
            </button>
          </div>
          <!-- 按键作答时没有提交按钮：提交失败了在这里重试 -->
          <div
            v-if="keyTrialOn && (submitting || submitError)"
            class="nav-buttons"
          >
            <button
              class="nav-btn primary"
              :disabled="submitting"
              @click="submitQuestionnaire"
            >
              {{ submitting ? "正在提交…" : "重新提交" }}
            </button>
          </div>
          <p v-if="submitError" class="submit-error">{{ submitError }}</p>
        </template>

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

        <template v-for="(r, ri) in results" :key="ri">
          <template v-if="hasResult(r)">
            <!-- 组合里有几份问卷的结果时，标上是哪一份 -->
            <p v-if="results.length > 1" class="result-unit-title">
              《{{ r.title }}》
            </p>

            <!-- 对受测者可见的评价结果 -->
            <div
              v-if="
                r.subjectReport ||
                (!r.reportChart && r.dimensionReports.length > 0)
              "
              class="subject-report"
            >
              <div class="report-divider"></div>
              <p class="report-title">测评结果</p>
              <template v-if="r.subjectReport">
                <div
                  class="report-label-badge"
                  :style="{
                    background: (r.subjectReport.color || '#4CAF7D') + '22',
                    color: r.subjectReport.color || '#4CAF7D',
                    border:
                      '1.5px solid ' +
                      (r.subjectReport.color || '#4CAF7D') +
                      '88',
                  }"
                >
                  {{ r.subjectReport.label }}
                </div>
                <div v-if="r.subjectReport.description" class="report-desc-box">
                  {{ r.subjectReport.description }}
                </div>
              </template>

              <!-- 各维度评价（有图表时显示在图表里，这里就不重复了） -->
              <div
                v-for="d in r.reportChart ? [] : r.dimensionReports"
                :key="d.name"
                class="dim-report"
              >
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

            <!-- 结果图表：每个维度一条，自己的分 vs 平均分（vs 常模平均） -->
            <div v-if="r.reportChart" class="chart-block">
              <div class="report-divider"></div>
              <p class="report-title">各维度得分</p>
              <div class="chart-legend">
                <span><i class="legend-dot mine"></i>你的得分</span>
                <span
                  ><i class="legend-dot avg"></i>平均分（{{
                    r.reportChart.sample_size
                  }}
                  人）</span
                >
                <span v-if="chartHasNorm(r.reportChart)"
                  ><i class="legend-dot norm"></i>常模平均</span
                >
              </div>

              <div
                v-for="dim in r.reportChart.dimensions"
                :key="dim.id"
                class="chart-dim"
              >
                <div class="chart-dim-head">
                  <span class="chart-dim-name">{{ dim.name }}</span>
                  <span
                    v-if="dimRule(r, dim.name)"
                    class="dim-report-badge"
                    :style="{
                      background:
                        (dimRule(r, dim.name).color || '#4CAF7D') + '22',
                      color: dimRule(r, dim.name).color || '#4CAF7D',
                      borderColor:
                        (dimRule(r, dim.name).color || '#4CAF7D') + '88',
                    }"
                    >{{ dimRule(r, dim.name).label }}</span
                  >
                </div>

                <div class="bar-row">
                  <span class="bar-label">你的得分</span>
                  <div class="bar-track">
                    <div
                      class="bar-fill mine"
                      :style="{ width: barWidth(dim.score, dim) + '%' }"
                    ></div>
                  </div>
                  <span class="bar-value">{{ dim.score ?? "-" }}</span>
                </div>
                <div class="bar-row">
                  <span class="bar-label">平均分</span>
                  <div class="bar-track">
                    <div
                      class="bar-fill avg"
                      :style="{ width: barWidth(dim.average, dim) + '%' }"
                    ></div>
                  </div>
                  <span class="bar-value">{{ dim.average ?? "-" }}</span>
                </div>
                <div
                  v-if="chartHasNorm(r.reportChart) && dim.norm_mean !== null"
                  class="bar-row"
                >
                  <span class="bar-label">常模平均</span>
                  <div class="bar-track">
                    <div
                      class="bar-fill norm"
                      :style="{ width: barWidth(dim.norm_mean, dim) + '%' }"
                    ></div>
                  </div>
                  <span class="bar-value">{{ dim.norm_mean }}</span>
                </div>
                <div class="bar-scale">
                  <span>{{ dim.min }}</span
                  ><span>{{ dim.max }}</span>
                </div>

                <p
                  v-if="dimRule(r, dim.name)?.description"
                  class="dim-report-desc"
                >
                  {{ dimRule(r, dim.name).description }}
                </p>
                <p v-else-if="dim.description" class="dim-report-desc">
                  {{ dim.description }}
                </p>
              </div>
            </div>
          </template>
        </template>
      </div>
    </div>

    <!-- 点开放大的图片 -->
    <div
      v-if="zoomImage"
      class="zoom-mask no-save"
      @click="zoomImage = ''"
      @contextmenu.prevent
      @dragstart.prevent
    >
      <img :src="zoomImage" alt="放大的图片" />
      <span class="zoom-close">点任意处关闭</span>
    </div>
  </div>
</template>

<style scoped>
/* 结果图表 */
.chart-dim {
  text-align: left;
}
.chart-legend {
  display: flex;
  justify-content: center;
  gap: 16px;
  font-size: 12px;
  color: #5a7a64;
  margin-bottom: 8px;
}
.legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  margin-right: 4px;
  vertical-align: -1px;
}
.legend-dot.mine,
.bar-fill.mine {
  background: #3f9e6e;
}
.legend-dot.avg,
.bar-fill.avg {
  background: #2a78d6;
}
.legend-dot.norm,
.bar-fill.norm {
  background: #d9892b;
}
/* 组合：问卷列表、过渡页、结果分份 */
.unit-list {
  background: #f6fbf7;
  border-radius: 12px;
  padding: 12px 14px;
  margin-bottom: 14px;
  text-align: left;
}
.unit-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 14px;
  color: #2e4a38;
}
.unit-no {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #4caf7d;
  color: white;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.unit-name {
  flex: 1;
}
.unit-count {
  font-size: 12px;
  color: #8aaa94;
}
.unit-badge {
  display: inline-block;
  margin: 0 0 6px;
  padding: 2px 10px;
  border-radius: 10px;
  background: #e8f5e9;
  color: #2e7d32;
  font-size: 12px;
  font-weight: 600;
}
.next-unit {
  background: #f6fbf7;
  border-radius: 12px;
  padding: 14px 16px;
  margin: 16px 0 18px;
  text-align: left;
}
.next-label {
  margin: 0;
  font-size: 12px;
  color: #8aaa94;
}
.next-title {
  margin: 4px 0 2px;
  font-size: 16px;
  font-weight: 600;
  color: #2e4a38;
}
.next-count {
  margin: 0;
  font-size: 13px;
  color: #5a7a64;
}
.next-desc {
  margin-top: 8px;
}
.result-unit-title {
  margin: 22px 0 0;
  font-size: 15px;
  font-weight: 600;
  color: #2e4a38;
}
.submit-error {
  margin: 10px 0 0;
  font-size: 13px;
  color: #c0392b;
  text-align: center;
}
/* 题目的图片 / 视频 / 音频 */
.q-media {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin: -8px 0 18px;
}
.q-media-img {
  max-width: 100%;
  max-height: 46vh;
  border-radius: 10px;
  cursor: zoom-in;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
}
.q-media-video {
  width: 100%;
  max-height: 50vh;
  border-radius: 10px;
  background: #000;
}
.q-media-audio {
  width: 100%;
}
.media-hint {
  margin: 0;
  font-size: 11px;
  color: #9cb8a6;
}
/* 图片选项 */
.image-options {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 10px;
}
/* 量表的图片（如表情量表）排成一行 */
.image-options.scale-images {
  grid-template-columns: repeat(auto-fit, minmax(54px, 1fr));
  gap: 6px;
}
.scale-images .image-option {
  padding: 5px 3px;
}
.scale-images .image-option-label {
  font-size: 11px;
}
.image-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border: 2px solid #dcefe0;
  background: #fff;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}
.image-option img {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: contain;
  border-radius: 6px;
  background: #fafafa;
}
.image-option-label {
  font-size: 13px;
  color: #3d5a48;
  line-height: 1.3;
}
.image-option:hover {
  border-color: #9ed9b2;
}
.image-option.active {
  border-color: #4caf7d;
  background: #eaf7ef;
  box-shadow: 0 0 0 3px rgba(76, 175, 125, 0.25);
}
.image-option.active .image-option-label {
  color: #2e7d32;
  font-weight: 600;
}
/* 图片、视频不让长按 / 拖动保存 */
.no-save img,
.no-save video {
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
  -webkit-user-drag: none;
}
/* 放大图片 */
.zoom-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.zoom-mask img {
  max-width: 100%;
  max-height: 88vh;
  border-radius: 6px;
}
.zoom-close {
  margin-top: 10px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}
.chart-dim {
  background: #f9fcfa;
  border-radius: 10px;
  padding: 12px 14px;
  margin-top: 10px;
}
.chart-dim-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.chart-dim-name {
  font-size: 14px;
  font-weight: 600;
  color: #2e4a38;
}
.bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.bar-label {
  width: 52px;
  flex-shrink: 0;
  font-size: 12px;
  color: #5a7a64;
}
.bar-track {
  flex: 1;
  height: 10px;
  background: #e8efea;
  border-radius: 0 4px 4px 0;
}
.bar-fill {
  height: 100%;
  border-radius: 0 4px 4px 0; /* 条的末端圆角 */
  transition: width 0.6s ease;
}
.bar-value {
  width: 40px;
  flex-shrink: 0;
  text-align: right;
  font-size: 13px;
  font-weight: 600;
  color: #2e4a38;
}
.bar-scale {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #9ab0a2;
  margin: 0 48px 0 60px; /* 和条形的起止位置对齐 */
}
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
/* 按键作答：说明、练习 */
.key-intro {
  padding: 16px 0 8px;
}
.key-intro-title {
  margin: 0 0 12px;
  font-size: 17px;
  font-weight: 600;
  color: #2e4a38;
  text-align: center;
}
.key-intro-list {
  margin: 0 0 14px;
  padding-left: 20px;
  font-size: 14px;
  line-height: 1.8;
  color: #3d5a48;
}
.key-intro-note {
  margin: 0 0 16px;
  font-size: 13px;
  color: #6b8a76;
  text-align: center;
  line-height: 1.7;
}
.practice-badge {
  display: inline-block;
  margin: 0 0 12px;
  padding: 3px 10px;
  border-radius: 12px;
  background: #fff6e0;
  color: #b5822a;
  font-size: 12px;
  font-weight: 600;
}
.key-other-tip {
  margin: 0 0 10px;
  font-size: 12px;
  color: #9cb8a6;
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
