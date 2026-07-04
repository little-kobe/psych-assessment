<script setup>
import { ref, onMounted } from "vue";
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

const defaultForm = () => ({
  content: "",
  question_type: "scale",
  options: [],
  min_score: 1,
  max_score: 5,
  role: "student",
  is_reverse_scored: false,
});

const form = ref(defaultForm());

const typeOptions = [
  { value: "scale", label: "量表单选（数字评分，如1-5分）" },
  { value: "single_choice", label: "单选题（文字选项）" },
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

function openAdd() {
  editingId.value = null;
  form.value = defaultForm();
  showDialog.value = true;
}

function openEdit(q) {
  editingId.value = q.id;
  form.value = {
    content: q.content,
    question_type: q.question_type || "scale",
    options: q.options
      ? typeof q.options === "string"
        ? JSON.parse(q.options)
        : q.options
      : [],
    min_score: q.min_score,
    max_score: q.max_score,
    role: q.role || "student",
    is_reverse_scored: !!q.is_reverse_scored,
  };
  showDialog.value = true;
}

async function saveQuestion() {
  if (!form.value.content) {
    ElMessage.warning("题目内容不能为空");
    return;
  }
  if (
    ["single_choice", "multiple_choice"].includes(form.value.question_type) &&
    form.value.options.length < 2
  ) {
    ElMessage.warning("单选/多选题至少需要2个选项");
    return;
  }

  saving.value = true;
  const token = localStorage.getItem("admin_token");
  const payload = { ...form.value };

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
  form.value.options.push("");
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

onMounted(fetchQuestions);
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
      description="可以在线添加、编辑、删除题目，也可以用上下箭头调整题目顺序。Excel批量导入功能仍然可用。"
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
              <span
                v-if="
                  ['single_choice', 'multiple_choice'].includes(
                    q.question_type,
                  ) && q.options
                "
                class="q-range"
              >
                {{
                  (typeof q.options === "string"
                    ? JSON.parse(q.options)
                    : q.options
                  ).join(" / ")
                }}
              </span>
            </div>
          </div>
          <div class="q-actions">
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
      width="540px"
    >
      <el-form :model="form" label-width="90px">
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

        <!-- 量表题：设置分值范围 -->
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
          <el-form-item label="反向计分">
            <el-switch v-model="form.is_reverse_scored" />
          </el-form-item>
        </template>

        <!-- 单选/多选题：配置选项 -->
        <template
          v-if="
            ['single_choice', 'multiple_choice'].includes(form.question_type)
          "
        >
          <el-form-item label="选项内容">
            <div class="options-editor">
              <div v-for="(opt, i) in form.options" :key="i" class="option-row">
                <el-input
                  v-model="form.options[i]"
                  :placeholder="`选项${i + 1}`"
                />
                <el-button type="danger" text @click="removeOption(i)"
                  >删除</el-button
                >
              </div>
              <el-button @click="addOption" size="small">+ 添加选项</el-button>
            </div>
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
</style>
