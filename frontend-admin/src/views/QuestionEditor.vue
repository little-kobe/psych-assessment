<script setup>
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";

const route = useRoute();
const router = useRouter();
const questionnaireId = route.params.id;

const questions = ref([]);
const loading = ref(true);
const showDialog = ref(false);
const saving = ref(false);
const editingId = ref(null); // null表示新增，有值表示编辑
const inheritedFrom = ref(null); // 新增题目时沿用了第几题的设置

const defaultForm = () => ({
  content: "",
  question_type: "scale",
  options: [], // 单选/多选的选项：[{ label: "偶尔", score: 1 }]
  scaleLabels: {}, // 量表题每个分数对应的文字：{ 1: "完全没有", 5: "重度" }
  min_score: 1,
  max_score: 5,
  role: "student",
  is_reverse_scored: false,
});

const form = ref(defaultForm());

// ---------- 选项工具函数 ----------

// 把选项统一成 [{ label, score }] 格式（兼容旧数据：纯文字数组）
function normalizeOptions(raw) {
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

// 量表题的分数列表，如 1-5 分 → [1, 2, 3, 4, 5]
const scaleScores = computed(() => {
  const list = [];
  for (let s = form.value.min_score; s <= form.value.max_score; s++)
    list.push(s);
  return list;
});

// 单选题是否给选项配了分值
const choiceHasScores = computed(() =>
  form.value.options.some(
    (o) => o.score !== null && o.score !== undefined && o.score !== "",
  ),
);

// 把表单里的选项整理成要保存的格式
function buildOptions() {
  const type = form.value.question_type;
  if (type === "scale") {
    const opts = scaleScores.value.map((s) => ({
      label: (form.value.scaleLabels[s] || "").trim(),
      score: s,
    }));
    // 一个文字都没填，就不存选项（受测者看到的是数字按钮）
    return opts.some((o) => o.label) ? opts : null;
  }
  if (type === "single_choice") {
    return form.value.options.map((o) => ({
      label: o.label.trim(),
      score: o.score === "" || o.score === undefined ? null : o.score,
    }));
  }
  if (type === "multiple_choice") {
    return form.value.options.map((o) => ({
      label: o.label.trim(),
      score: null,
    }));
  }
  return null;
}

// 在列表里显示选项，如「完全没有=1 / 轻度=2」
function formatOptions(q) {
  const opts = normalizeOptions(q.options);
  if (opts.length === 0) return "";
  return opts
    .filter((o) => o.label)
    .map((o) => (o.score !== null ? `${o.label}=${o.score}` : o.label))
    .join(" / ");
}

// ---------- 快捷选项模板 ----------

// 内置的常用选项
const builtinTemplates = [
  {
    name: "严重程度（1-5）",
    options: ["完全没有", "轻度", "中度", "偏重", "重度"].map((label, i) => ({
      label,
      score: i + 1,
    })),
  },
  {
    name: "同意程度（1-5）",
    options: ["非常不同意", "不同意", "不确定", "同意", "非常同意"].map(
      (label, i) => ({ label, score: i + 1 }),
    ),
  },
  {
    name: "符合程度（1-5）",
    options: ["完全不符合", "比较不符合", "不确定", "比较符合", "完全符合"].map(
      (label, i) => ({ label, score: i + 1 }),
    ),
  },
  {
    name: "频率（1-5）",
    options: ["从不", "很少", "有时", "经常", "总是"].map((label, i) => ({
      label,
      score: i + 1,
    })),
  },
  {
    name: "频率（0-3，PHQ/GAD）",
    options: ["完全不会", "好几天", "一半以上的天数", "几乎每天"].map(
      (label, i) => ({ label, score: i }),
    ),
  },
  {
    name: "是否（是=1，否=0）",
    options: [
      { label: "是", score: 1 },
      { label: "否", score: 0 },
    ],
  },
];
const customTemplates = ref([]); // 自己保存的模板（存在数据库里）

async function fetchTemplates() {
  const token = localStorage.getItem("admin_token");
  try {
    const res = await fetch("http://localhost:3000/api/option-templates", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.success) {
      customTemplates.value = data.templates.map((t) => ({
        ...t,
        options: normalizeOptions(t.options),
      }));
    }
  } catch (err) {
    console.error("加载选项模板失败:", err);
  }
}

// 点击模板：把选项填进表单
function applyTemplate(tpl) {
  const opts = tpl.options.map((o) => ({ ...o }));
  if (form.value.question_type === "scale") {
    const scores = opts.map((o) => o.score).filter((s) => s !== null);
    if (scores.length === 0) {
      ElMessage.warning("这个模板没有分值，不能用于量表题");
      return;
    }
    form.value.min_score = Math.min(...scores);
    form.value.max_score = Math.max(...scores);
    form.value.scaleLabels = {};
    opts.forEach((o) => {
      if (o.score !== null) form.value.scaleLabels[o.score] = o.label;
    });
  } else {
    // 是否题、开放题用模板时，自动切换成单选题
    if (
      !["single_choice", "multiple_choice"].includes(form.value.question_type)
    ) {
      form.value.question_type = "single_choice";
    }
    form.value.options = opts;
  }
}

// 把当前填好的选项存成模板，以后一键使用
async function saveAsTemplate() {
  const options = buildOptions();
  if (!options || options.length === 0 || options.some((o) => !o.label)) {
    ElMessage.warning("请先把选项文字填完整，再保存为模板");
    return;
  }
  let name;
  try {
    const result = await ElMessageBox.prompt(
      "给这个模板起个名字",
      "保存为模板",
      {
        inputPlaceholder: "例如：SCL-90 五级评分",
        inputValidator: (v) => (v && v.trim() ? true : "名称不能为空"),
      },
    );
    name = result.value.trim();
  } catch {
    return; // 点了取消
  }
  const token = localStorage.getItem("admin_token");
  const res = await fetch("http://localhost:3000/api/option-templates", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name, options }),
  });
  const data = await res.json();
  if (data.success) {
    ElMessage.success("模板已保存");
    fetchTemplates();
  } else {
    ElMessage.error(data.message);
  }
}

async function deleteTemplate(tpl) {
  try {
    await ElMessageBox.confirm(`确认删除模板「${tpl.name}」？`, "删除模板", {
      type: "warning",
    });
  } catch {
    return;
  }
  const token = localStorage.getItem("admin_token");
  const res = await fetch(
    `http://localhost:3000/api/option-templates/${tpl.id}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const data = await res.json();
  if (data.success) {
    ElMessage.success("模板已删除");
    fetchTemplates();
  } else {
    ElMessage.error(data.message);
  }
}

const typeOptions = [
  { value: "scale", label: "量表题（按分值计分，可给每个分数配文字）" },
  { value: "single_choice", label: "单选题（文字选项，可给选项配分值）" },
  { value: "multiple_choice", label: "多选题" },
  { value: "yes_no", label: "是否题" },
  { value: "open_text", label: "开放题（文字输入）" },
];

const roleOptions = [
  { value: "student", label: "学生填写" },
  { value: "parent", label: "家长填写" },
  { value: "both", label: "通用（均可填）" },
];

async function fetchQuestions() {
  const token = localStorage.getItem("admin_token");
  try {
    const res = await fetch(
      `http://localhost:3000/api/questionnaires/${questionnaireId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const data = await res.json();
    if (data.success) questions.value = data.questions;
  } catch (err) {
    ElMessage.error("加载题目失败");
  } finally {
    loading.value = false;
  }
}

// 把一道已有题目的设置填进表单（编辑、沿用上一题都用它）
function formFromQuestion(q) {
  const type = q.question_type || "scale";
  const opts = normalizeOptions(q.options);
  const scaleLabels = {};
  if (type === "scale") {
    opts.forEach((o) => {
      if (o.score !== null) scaleLabels[o.score] = o.label;
    });
  }
  return {
    content: q.content,
    question_type: type,
    options: type === "scale" ? [] : opts,
    scaleLabels,
    min_score: q.min_score,
    max_score: q.max_score,
    role: q.role || "student",
    is_reverse_scored: !!q.is_reverse_scored,
  };
}

function openAdd() {
  editingId.value = null;
  const last = questions.value[questions.value.length - 1];
  if (last) {
    // 默认沿用上一题的题型、选项、分值和填写角色，只需要填题目内容
    form.value = {
      ...formFromQuestion(last),
      content: "",
      is_reverse_scored: false,
    };
    inheritedFrom.value = last.order_num;
  } else {
    form.value = defaultForm();
    inheritedFrom.value = null;
  }
  showDialog.value = true;
}

// 不想沿用上一题时，清空成默认设置
function resetForm() {
  const content = form.value.content;
  form.value = { ...defaultForm(), content };
  inheritedFrom.value = null;
}

function openEdit(q) {
  editingId.value = q.id;
  inheritedFrom.value = null;
  form.value = formFromQuestion(q);
  showDialog.value = true;
}

async function saveQuestion() {
  if (!form.value.content) {
    ElMessage.warning("题目内容不能为空");
    return;
  }
  const isChoice = ["single_choice", "multiple_choice"].includes(
    form.value.question_type,
  );
  if (isChoice && form.value.options.length < 2) {
    ElMessage.warning("单选/多选题至少需要2个选项");
    return;
  }
  if (isChoice && form.value.options.some((o) => !o.label.trim())) {
    ElMessage.warning("选项文字不能为空");
    return;
  }
  if (
    form.value.min_score >= form.value.max_score &&
    form.value.question_type === "scale"
  ) {
    ElMessage.warning("最高分必须大于最低分");
    return;
  }

  const options = buildOptions();
  const payload = {
    content: form.value.content,
    question_type: form.value.question_type,
    options,
    min_score: form.value.min_score,
    max_score: form.value.max_score,
    role: form.value.role,
    is_reverse_scored: form.value.is_reverse_scored,
  };
  // 带分值的单选题：分值范围取选项里的最低分和最高分（反向计分要用）
  if (form.value.question_type === "single_choice") {
    const scores = (options || [])
      .map((o) => o.score)
      .filter((s) => s !== null);
    if (scores.length > 0) {
      payload.min_score = Math.min(...scores);
      payload.max_score = Math.max(...scores);
    } else {
      payload.is_reverse_scored = false; // 没有分值就谈不上反向计分
    }
  }
  if (
    ["multiple_choice", "yes_no", "open_text"].includes(
      form.value.question_type,
    )
  ) {
    payload.is_reverse_scored = false;
  }

  saving.value = true;
  const token = localStorage.getItem("admin_token");

  try {
    let res;
    if (editingId.value) {
      res = await fetch(
        `http://localhost:3000/api/questions/${editingId.value}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        },
      );
    } else {
      res = await fetch(
        `http://localhost:3000/api/questionnaires/${questionnaireId}/questions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        },
      );
    }
    const data = await res.json();
    if (data.success) {
      ElMessage.success(editingId.value ? "题目已更新" : "题目已添加");
      showDialog.value = false;
      fetchQuestions();
    } else {
      ElMessage.error(data.message);
    }
  } catch (err) {
    ElMessage.error("保存失败");
  } finally {
    saving.value = false;
  }
}

async function deleteQuestion(q) {
  try {
    await ElMessageBox.confirm(
      `确认删除第${q.order_num}题："${q.content}"？相关答案数据也会一并删除。`,
      "删除确认",
      {
        type: "warning",
        confirmButtonText: "确认删除",
        cancelButtonText: "取消",
      },
    );
  } catch {
    return;
  }

  const token = localStorage.getItem("admin_token");
  try {
    const res = await fetch(`http://localhost:3000/api/questions/${q.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.success) {
      ElMessage.success("题目已删除");
      fetchQuestions();
    }
  } catch (err) {
    ElMessage.error("删除失败");
  }
}

async function moveUp(index) {
  if (index === 0) return;
  const arr = [...questions.value];
  [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
  await saveOrder(arr);
}

async function moveDown(index) {
  if (index === questions.value.length - 1) return;
  const arr = [...questions.value];
  [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
  await saveOrder(arr);
}

// 把第 index 个题目移动到第 targetPos 位（targetPos 从 1 开始）
async function moveTo(index, targetPos) {
  const total = questions.value.length;
  let pos = Math.round(Number(targetPos));
  if (!pos || pos < 1) pos = 1;
  if (pos > total) pos = total;
  if (pos - 1 === index) return; // 位置没变

  const arr = [...questions.value];
  const [moved] = arr.splice(index, 1); // 先取出
  arr.splice(pos - 1, 0, moved); // 再插到目标位置
  await saveOrder(arr);
  ElMessage.success(`已移到第 ${pos} 位`);
}

// 一键置顶
function moveToTop(index) {
  moveTo(index, 1);
}

async function saveOrder(arr) {
  const token = localStorage.getItem("admin_token");
  const orders = arr.map((q, i) => ({ id: q.id, order_num: i + 1 }));
  try {
    const res = await fetch(
      `http://localhost:3000/api/questionnaires/${questionnaireId}/questions/reorder`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ orders }),
      },
    );
    const data = await res.json();
    if (data.success) {
      questions.value = arr.map((q, i) => ({ ...q, order_num: i + 1 }));
    }
  } catch (err) {
    ElMessage.error("排序保存失败");
  }
}

function addOption() {
  form.value.options.push({ label: "", score: null });
}

function removeOption(index) {
  form.value.options.splice(index, 1);
}

function typeLabel(type) {
  const map = {
    scale: "量表",
    single_choice: "单选",
    multiple_choice: "多选",
    yes_no: "是否",
    open_text: "开放题",
  };
  return map[type] || type;
}

function roleLabel(role) {
  const map = { student: "学生", parent: "家长", both: "通用" };
  return map[role] || role;
}

function roleTagType(role) {
  return role === "parent" ? "warning" : role === "both" ? "success" : "info";
}

onMounted(() => {
  fetchQuestions();
  fetchTemplates();
});
</script>

<template>
  <div class="container" v-loading="loading">
    <el-button @click="router.push(`/questionnaire/${questionnaireId}`)" text
      >← 返回问卷详情</el-button
    >

    <div class="header">
      <h2>题目编辑</h2>
      <el-button type="primary" @click="openAdd">添加题目</el-button>
    </div>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom: 16px"
      description="可以在线添加、编辑、删除题目。调整顺序：在序号框输入目标位置后按回车，或点「置顶」，或用上下箭头微调。Excel批量导入功能仍然可用。"
    />

    <div v-if="questions.length === 0 && !loading">
      <el-empty description="还没有题目，点击右上角添加第一道题" />
    </div>

    <div class="question-list">
      <el-card v-for="(q, index) in questions" :key="q.id" class="q-card">
        <div class="q-row">
          <div class="q-order">{{ q.order_num }}</div>
          <div class="q-main">
            <div class="q-content">{{ q.content }}</div>
            <div class="q-tags">
              <el-tag size="small" type="primary">{{
                typeLabel(q.question_type || "scale")
              }}</el-tag>
              <el-tag size="small" :type="roleTagType(q.role || 'student')">{{
                roleLabel(q.role || "student")
              }}</el-tag>
              <el-tag v-if="q.is_reverse_scored" size="small" type="warning"
                >反向计分</el-tag
              >
              <span v-if="q.question_type === 'scale'" class="q-range"
                >{{ q.min_score }}-{{ q.max_score }}分</span
              >
              <span v-if="formatOptions(q)" class="q-range">
                {{ formatOptions(q) }}
              </span>
            </div>
          </div>
          <div class="q-actions">
            <!-- 直接输入序号调整位置 -->
            <el-tooltip
              content="输入序号后按回车，题目移到该位置"
              placement="top"
            >
              <el-input-number
                :model-value="index + 1"
                :min="1"
                :max="questions.length"
                size="small"
                controls-position="right"
                style="width: 80px"
                @change="(val) => moveTo(index, val)"
                @keyup.enter="$event.target.blur()"
              />
            </el-tooltip>
            <el-button
              size="small"
              :disabled="index === 0"
              @click="moveToTop(index)"
              >置顶</el-button
            >
            <el-button-group>
              <el-button
                size="small"
                :disabled="index === 0"
                @click="moveUp(index)"
                >↑</el-button
              >
              <el-button
                size="small"
                :disabled="index === questions.length - 1"
                @click="moveDown(index)"
                >↓</el-button
              >
            </el-button-group>
            <el-button size="small" @click="openEdit(q)">编辑</el-button>
            <el-button size="small" type="danger" @click="deleteQuestion(q)"
              >删除</el-button
            >
          </div>
        </div>
      </el-card>
    </div>

    <!-- 新增/编辑弹窗 -->
    <el-dialog
      v-model="showDialog"
      :title="editingId ? '编辑题目' : '添加题目'"
      width="620px"
    >
      <el-form :model="form" label-width="90px">
        <!-- 新增题目时提示：已沿用上一题的设置 -->
        <div v-if="!editingId && inheritedFrom" class="inherit-hint">
          已沿用第 {{ inheritedFrom }} 题的题型、选项和分值，只需填写题目内容。
          <el-button text type="primary" size="small" @click="resetForm"
            >不沿用，恢复默认</el-button
          >
        </div>

        <el-form-item label="题目内容">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="2"
            placeholder="请输入题目文字"
          />
        </el-form-item>

        <el-form-item label="题型">
          <el-select v-model="form.question_type" style="width: 100%">
            <el-option
              v-for="t in typeOptions"
              :key="t.value"
              :value="t.value"
              :label="t.label"
            />
          </el-select>
        </el-form-item>

        <!-- 快捷选项：内置模板 + 自己保存的模板 -->
        <el-form-item
          v-if="
            ['scale', 'single_choice', 'multiple_choice'].includes(
              form.question_type,
            )
          "
          label="快捷选项"
        >
          <div class="template-area">
            <div class="template-tags">
              <el-tag
                v-for="tpl in builtinTemplates"
                :key="tpl.name"
                class="template-tag"
                effect="plain"
                @click="applyTemplate(tpl)"
                >{{ tpl.name }}</el-tag
              >
              <el-tag
                v-for="tpl in customTemplates"
                :key="'c' + tpl.id"
                class="template-tag"
                type="success"
                effect="plain"
                closable
                @click="applyTemplate(tpl)"
                @close="deleteTemplate(tpl)"
                >{{ tpl.name }}</el-tag
              >
            </div>
            <el-button size="small" text type="primary" @click="saveAsTemplate"
              >+ 把当前选项保存为模板</el-button
            >
          </div>
        </el-form-item>

        <!-- 量表题：分值范围 + 每个分数对应的文字 -->
        <template v-if="form.question_type === 'scale'">
          <el-form-item label="分值范围">
            <div style="display: flex; align-items: center; gap: 8px">
              <el-input-number
                v-model="form.min_score"
                :min="0"
                :max="10"
                style="width: 100px"
              />
              <span>至</span>
              <el-input-number
                v-model="form.max_score"
                :min="1"
                :max="10"
                style="width: 100px"
              />
              <span>分</span>
            </div>
          </el-form-item>
          <el-form-item label="选项文字">
            <div class="options-editor">
              <div v-for="s in scaleScores" :key="s" class="option-row">
                <span class="score-badge">{{ s }} 分</span>
                <el-input
                  v-model="form.scaleLabels[s]"
                  :placeholder="`${s} 分显示的文字（可不填）`"
                />
              </div>
              <div class="field-tip">
                全部填写：受测者只看到文字，导出时自动换成分数。<br />
                只填两端或不填：受测者看到数字按钮，两端显示文字。
              </div>
            </div>
          </el-form-item>
          <el-form-item label="反向计分">
            <el-switch v-model="form.is_reverse_scored" />
          </el-form-item>
        </template>

        <!-- 单选/多选题：配置选项（单选可以给每个选项配分值） -->
        <template
          v-if="
            ['single_choice', 'multiple_choice'].includes(form.question_type)
          "
        >
          <el-form-item label="选项内容">
            <div class="options-editor">
              <div v-for="(opt, i) in form.options" :key="i" class="option-row">
                <el-input v-model="opt.label" :placeholder="`选项${i + 1}`" />
                <el-input-number
                  v-if="form.question_type === 'single_choice'"
                  v-model="opt.score"
                  :controls="false"
                  :value-on-clear="null"
                  placeholder="分值"
                  style="width: 80px; flex-shrink: 0"
                />
                <el-button type="danger" text @click="removeOption(i)"
                  >删除</el-button
                >
              </div>
              <el-button @click="addOption" size="small">+ 添加选项</el-button>
              <div
                v-if="form.question_type === 'single_choice'"
                class="field-tip"
              >
                填了分值的单选题会参与计分，导出时显示分数；不填分值则只记录文字。
              </div>
            </div>
          </el-form-item>
          <el-form-item
            v-if="form.question_type === 'single_choice' && choiceHasScores"
            label="反向计分"
          >
            <el-switch v-model="form.is_reverse_scored" />
          </el-form-item>
        </template>

        <!-- 是否题：自动选项，不需要配置 -->
        <template v-if="form.question_type === 'yes_no'">
          <el-form-item label="选项">
            <span style="color: var(--el-color-info); font-size: 13px"
              >固定为「是」和「否」两个选项</span
            >
          </el-form-item>
        </template>

        <!-- 开放题：无需额外配置 -->
        <template v-if="form.question_type === 'open_text'">
          <el-form-item label="说明">
            <span style="color: var(--el-color-info); font-size: 13px"
              >受测者可自由输入文字回答</span
            >
          </el-form-item>
        </template>

        <el-form-item label="填写角色">
          <el-radio-group v-model="form.role">
            <el-radio
              v-for="r in roleOptions"
              :key="r.value"
              :value="r.value"
              >{{ r.label }}</el-radio
            >
          </el-radio-group>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" @click="saveQuestion" :loading="saving"
          >保存</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.container {
  max-width: 860px;
  margin: 20px auto;
  padding: 24px;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 16px 0 20px;
}
.header h2 {
  margin: 0;
  font-size: 20px;
  color: #3d2b12;
}
.question-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.q-card {
  border: 1px solid #f0dcae;
}
.q-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}
.q-order {
  min-width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, #fbb034, #f4844c);
  color: white;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
}
.q-main {
  flex: 1;
}
.q-content {
  font-size: 14px;
  color: #3d2b12;
  margin-bottom: 8px;
  line-height: 1.5;
}
.q-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.q-range {
  font-size: 12px;
  color: #999;
}
.q-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  align-items: center;
}
.options-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.option-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.inherit-hint {
  font-size: 12px;
  color: #8b6b2e;
  background: #fff8e7;
  border-radius: 6px;
  padding: 6px 10px;
  margin-bottom: 14px;
}
.template-area {
  width: 100%;
}
.template-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.template-tag {
  cursor: pointer;
}
.score-badge {
  width: 44px;
  flex-shrink: 0;
  font-size: 12px;
  color: #8b5a2b;
  text-align: right;
}
.field-tip {
  font-size: 12px;
  color: #999;
  line-height: 1.6;
}
</style>
