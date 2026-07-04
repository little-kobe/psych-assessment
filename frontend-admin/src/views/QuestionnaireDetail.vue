<script setup>
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";

const route = useRoute();
const router = useRouter();
const questionnaireId = route.params.id;
const showAnswerDialog = ref(false);
const answerDetail = ref(null);
const answerLoading = ref(false);
const questionnaire = ref(null);
const questions = ref([]);
const submissions = ref([]);
const loading = ref(true);
const submissionsLoading = ref(false);
const exporting = ref(false);
const showEditDialog = ref(false);
const saving = ref(false);
const activeTab = ref("questions"); // questions 或 submissions

const editForm = ref({
  title: "",
  description: "",
  consent_text: "",
  track_timing: true,
});

async function fetchDetail() {
  const token = localStorage.getItem("admin_token");
  try {
    const response = await fetch(
      `http://localhost:3000/api/questionnaires/${questionnaireId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const data = await response.json();
    if (data.success) {
      questionnaire.value = data.questionnaire;
      questions.value = data.questions;
    } else {
      ElMessage.error(data.message);
      router.push("/");
    }
  } catch (err) {
    console.error("获取问卷详情失败:", err);
  } finally {
    loading.value = false;
  }
}

const hasDimensions = ref(false);

async function fetchSubmissions() {
  submissionsLoading.value = true;
  const token = localStorage.getItem("admin_token");
  try {
    const response = await fetch(
      `http://localhost:3000/api/questionnaires/${questionnaireId}/submissions`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await response.json();
    if (data.success) {
      submissions.value = data.submissions;
      hasDimensions.value = data.has_dimensions;
    }
  } catch (err) {
    console.error("获取提交记录失败:", err);
  } finally {
    submissionsLoading.value = false;
  }
}

function handleTabChange(tab) {
  if (tab === "submissions" && submissions.value.length === 0) {
    fetchSubmissions();
  }
}

function openEditDialog() {
  editForm.value = {
    title: questionnaire.value.title,
    description: questionnaire.value.description || "",
    consent_text: questionnaire.value.consent_text || "",
    track_timing: !!questionnaire.value.track_timing,
    is_active: questionnaire.value.is_active !== false,
    max_responses: questionnaire.value.max_responses || null,
    expires_at: questionnaire.value.expires_at || null,
  };
  showEditDialog.value = true;
}

async function viewAnswers(submissionId) {
  answerLoading.value = true;
  showAnswerDialog.value = true;
  answerDetail.value = null;
  const token = localStorage.getItem("admin_token");
  const reportDetail = ref(null);
  try {
    const token = localStorage.getItem("admin_token");
    const [ansRes, reportRes] = await Promise.all([
      fetch(`http://localhost:3000/api/submissions/${submissionId}/answers`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`http://localhost:3000/api/submissions/${submissionId}/report`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);
    const ansData = await ansRes.json();
    const reportData = await reportRes.json();
    if (ansData.success) answerDetail.value = ansData;
    if (reportData.success) reportDetail.value = reportData;
    else reportDetail.value = null;
  } catch (err) {
    ElMessage.error("加载失败");
  } finally {
    answerLoading.value = false;
  }
}

async function saveEdit() {
  if (!editForm.value.title) {
    ElMessage.warning("问卷标题不能为空");
    return;
  }
  saving.value = true;
  const token = localStorage.getItem("admin_token");
  try {
    const response = await fetch(
      `http://localhost:3000/api/questionnaires/${questionnaireId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(editForm.value),
      },
    );
    const data = await response.json();
    if (data.success) {
      ElMessage.success("保存成功");
      showEditDialog.value = false;
      fetchDetail();
    } else {
      ElMessage.error(data.message);
    }
  } catch (err) {
    ElMessage.error("保存失败，请检查后端服务");
  } finally {
    saving.value = false;
  }
}

async function exportData() {
  exporting.value = true;
  const token = localStorage.getItem("admin_token");
  try {
    const response = await fetch(
      `http://localhost:3000/api/questionnaires/${questionnaireId}/export`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) {
      ElMessage.error("导出失败，请检查是否有作答数据");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${questionnaire.value.title}_作答数据.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    ElMessage.success("导出成功");
  } catch (err) {
    ElMessage.error("导出失败，请检查后端服务");
  } finally {
    exporting.value = false;
  }
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return "-";
  if (seconds < 60) return `${seconds}秒`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}分${s}秒`;
}

function formatTime(timeStr) {
  if (!timeStr) return "-";
  return new Date(timeStr).toLocaleString("zh-CN");
}

function typeLabel(type) {
  const map = {
    scale: "量表",
    single_choice: "单选",
    multiple_choice: "多选",
    yes_no: "是否",
    open_text: "开放题",
  };
  return map[type] || "量表";
}

function roleLabel(role) {
  const map = { student: "学生", parent: "家长", both: "通用" };
  return map[role] || "通用";
}

function roleTagType(role) {
  return role === "parent" ? "warning" : role === "both" ? "success" : "info";
}

function parseOptions(options) {
  if (!options) return [];
  try {
    return typeof options === "string" ? JSON.parse(options) : options;
  } catch {
    return [];
  }
}

function goImport() {
  router.push(`/import?qid=${questionnaireId}`);
}
function backToList() {
  router.push("/");
}

onMounted(fetchDetail);
</script>

<template>
  <div class="container" v-loading="loading">
    <el-button @click="backToList" text>← 返回问卷列表</el-button>

    <template v-if="questionnaire">
      <div class="header">
        <div>
          <h2>{{ questionnaire.title }}</h2>
          <p class="desc">{{ questionnaire.description || "暂无说明" }}</p>
        </div>
        <div class="header-btns">
          <el-button
            @click="
              router.push(`/questionnaire/${questionnaireId}/score-rules`)
            "
            >分数段报告</el-button
          >
          <el-button @click="openEditDialog">编辑问卷</el-button>
          <el-button
            @click="router.push(`/questionnaire/${questionnaireId}/dimensions`)"
            >配置维度</el-button
          >
          <el-button type="success" @click="exportData" :loading="exporting"
            >导出数据</el-button
          >
          <el-button type="primary" @click="goImport">导入题目</el-button
          ><el-button
            type="primary"
            @click="
              router.push(`/questionnaire/${questionnaireId}/edit-questions`)
            "
            >编辑题目</el-button
          >
        </div>
      </div>

      <div class="meta">
        <el-tag size="small"
          >创建人：{{ questionnaire.creator_name || "未知" }}</el-tag
        >
        <el-tag
          size="small"
          :type="questionnaire.track_timing ? 'success' : 'info'"
        >
          {{ questionnaire.track_timing ? "已开启时长记录" : "未开启时长记录" }}
        </el-tag>
        <el-tag size="small" type="info">共 {{ questions.length }} 道题</el-tag>
      </div>

      <el-tabs
        v-model="activeTab"
        style="margin-top: 24px"
        @tab-change="handleTabChange"
      >
        <el-tab-pane label="题目列表" name="questions">
          <el-table :data="questions" v-if="questions.length > 0">
            <el-table-column prop="order_num" label="序号" width="70" />
            <el-table-column prop="content" label="题目内容" min-width="180" />
            <el-table-column label="题型" width="100">
              <template #default="scope">
                <el-tag size="small" type="primary">
                  {{ typeLabel(scope.row.question_type) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="填写角色" width="90">
              <template #default="scope">
                <el-tag size="small" :type="roleTagType(scope.row.role)">
                  {{ roleLabel(scope.row.role) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="选项/分值" min-width="160">
              <template #default="scope">
                <span
                  v-if="
                    scope.row.question_type === 'scale' ||
                    !scope.row.question_type
                  "
                >
                  {{ scope.row.min_score }} - {{ scope.row.max_score }} 分
                  <el-tag
                    v-if="scope.row.is_reverse_scored"
                    size="small"
                    type="warning"
                    style="margin-left: 4px"
                    >反向</el-tag
                  >
                </span>
                <span
                  v-else-if="scope.row.question_type === 'yes_no'"
                  style="color: #999; font-size: 12px"
                >
                  是 / 否
                </span>
                <span
                  v-else-if="scope.row.question_type === 'open_text'"
                  style="color: #999; font-size: 12px"
                >
                  文字输入
                </span>
                <span
                  v-else-if="
                    ['single_choice', 'multiple_choice'].includes(
                      scope.row.question_type,
                    ) && scope.row.options
                  "
                >
                  <span style="font-size: 12px; color: #666">
                    {{ parseOptions(scope.row.options).join(" / ") }}
                  </span>
                </span>
                <span v-else style="color: #ccc; font-size: 12px">—</span>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="还没有题目，点击右上角导入题目" />
        </el-tab-pane>

        <el-tab-pane name="submissions">
          <template #label>
            回答记录
            <el-badge
              v-if="submissions.length > 0"
              :value="submissions.length"
              style="margin-left: 4px"
            />
          </template>

          <div v-loading="submissionsLoading">
            <el-table :data="submissions" v-if="submissions.length > 0">
              <el-table-column prop="id" label="编号" width="70" />
              <el-table-column label="提交时间" width="170">
                <template #default="scope">
                  {{ formatTime(scope.row.finished_at) }}
                </template>
              </el-table-column>
              <el-table-column label="总用时" width="100">
                <template #default="scope">
                  {{ formatDuration(scope.row.duration_seconds) }}
                </template>
              </el-table-column>
              <el-table-column label="状态" width="80">
                <template #default="scope">
                  <el-tag
                    :type="
                      scope.row.answer_count >= questions.length
                        ? 'success'
                        : 'warning'
                    "
                    size="small"
                  >
                    {{
                      scope.row.answer_count >= questions.length
                        ? "完整"
                        : "部分"
                    }}
                  </el-tag>
                </template>
              </el-table-column>

              <el-table-column label="查看" width="90">
                <template #default="scope">
                  <el-button size="small" @click="viewAnswers(scope.row.id)"
                    >详情</el-button
                  >
                </template>
              </el-table-column>

              <!-- 有维度配置时显示总分和各维度得分 -->
              <template v-if="hasDimensions">
                <el-table-column label="总分" width="80">
                  <template #default="scope">
                    <span style="font-weight: 600; color: #3d2b12">
                      {{ scope.row.total_score ?? "-" }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column label="各维度得分" min-width="200">
                  <template #default="scope">
                    <div class="dim-scores">
                      <el-tag
                        v-for="ds in scope.row.dimension_scores"
                        :key="ds.name"
                        size="small"
                        type="info"
                        style="margin: 2px"
                      >
                        {{ ds.name }}：{{ ds.score }}
                      </el-tag>
                    </div>
                  </template>
                </el-table-column>
              </template>

              <template v-else>
                <el-table-column label="得分" width="180">
                  <template #default>
                    <span style="color: #aaa; font-size: 12px"
                      >请先配置维度计分规则</span
                    >
                  </template>
                </el-table-column>
              </template>
            </el-table>
            <el-empty
              v-else-if="!submissionsLoading"
              description="还没有人提交这份问卷"
            />
          </div>
        </el-tab-pane>
      </el-tabs>
    </template>

    <el-dialog v-model="showEditDialog" title="编辑问卷" width="480px">
      <el-form :model="editForm" label-width="90px">
        <el-form-item label="问卷标题">
          <el-input v-model="editForm.title" />
        </el-form-item>
        <el-form-item label="问卷说明">
          <el-input v-model="editForm.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="知情同意">
          <el-input
            v-model="editForm.consent_text"
            type="textarea"
            :rows="4"
            placeholder="受测者答题前会看到这段说明"
          />
        </el-form-item>
        <el-form-item label="记录时长">
          <el-switch v-model="editForm.track_timing" />
        </el-form-item>
        <el-divider>回收控制</el-divider>
        <el-form-item label="问卷状态">
          <el-switch
            v-model="editForm.is_active"
            active-text="开放填写"
            inactive-text="已关闭"
          />
        </el-form-item>
        <el-form-item label="最大回收数">
          <el-input-number
            v-model="editForm.max_responses"
            :min="1"
            :max="99999"
            placeholder="不填表示不限制"
            controls-position="right"
            style="width: 180px"
          />
          <span style="margin-left: 8px; font-size: 12px; color: #999"
            >份，不填表示不限制</span
          >
        </el-form-item>
        <el-form-item label="截止时间">
          <el-date-picker
            v-model="editForm.expires_at"
            type="datetime"
            placeholder="不选表示不限制"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DD HH:mm:ss"
            style="width: 220px"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditDialog = false">取消</el-button>
        <el-button type="primary" @click="saveEdit" :loading="saving"
          >保存</el-button
        >
      </template>
    </el-dialog>

    <!-- 答案详情弹窗 -->
    <el-dialog v-model="showAnswerDialog" title="作答详情" width="600px">
      <div v-loading="answerLoading">
        <div v-if="answerDetail">
          <div class="answer-meta">
            <span>提交编号：{{ answerDetail.submission.id }}</span>
            <span
              >提交时间：{{
                formatTime(answerDetail.submission.finished_at)
              }}</span
            >
            <span v-if="answerDetail.submission.tracking_code">
              追踪码：{{ answerDetail.submission.tracking_code }}
            </span>
          </div>
          <div
            v-if="reportDetail && reportDetail.matched_rule"
            class="report-block"
          >
            <div class="report-score">
              总分：<strong>{{ reportDetail.total_score }}</strong> 分
            </div>
            <div
              class="report-label"
              :class="
                reportDetail.matched_rule.visible_to_subject
                  ? 'visible'
                  : 'admin-only'
              "
            >
              <el-tag
                :type="
                  reportDetail.matched_rule.visible_to_subject
                    ? 'success'
                    : 'warning'
                "
                size="small"
              >
                {{
                  reportDetail.matched_rule.visible_to_subject
                    ? "受测者可见"
                    : "仅管理员可见"
                }}
              </el-tag>
              <span class="label-text">{{
                reportDetail.matched_rule.label
              }}</span>
            </div>
            <div
              v-if="reportDetail.matched_rule.description"
              class="report-desc"
            >
              {{ reportDetail.matched_rule.description }}
            </div>
          </div>
          <div
            v-else-if="reportDetail && !reportDetail.matched_rule"
            class="report-block no-match"
          >
            总分 {{ reportDetail.total_score }} 分，未匹配到任何分数段配置
          </div>

          <el-table
            :data="answerDetail.answers"
            size="small"
            style="margin-top: 12px"
          >
            <el-table-column prop="order_num" label="题号" width="60" />
            <el-table-column
              prop="content"
              label="题目"
              min-width="160"
              show-overflow-tooltip
            />
            <el-table-column label="题型" width="70">
              <template #default="scope">
                <el-tag size="small" type="info">{{
                  typeLabel(scope.row.question_type)
                }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="角色" width="70">
              <template #default="scope">
                <el-tag
                  size="small"
                  :type="scope.row.role === 'parent' ? 'warning' : 'info'"
                >
                  {{ roleLabel(scope.row.role) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="答案" min-width="120">
              <template #default="scope">
                <span
                  v-if="scope.row.display_value"
                  style="color: #3d2b12; font-weight: 500"
                >
                  {{ scope.row.display_value }}
                </span>
                <span v-else style="color: #ccc">未作答</span>
              </template>
            </el-table-column>
            <el-table-column label="用时" width="80">
              <template #default="scope">
                {{
                  scope.row.duration_ms
                    ? Math.round(scope.row.duration_ms / 1000) + "s"
                    : "-"
                }}
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.answer-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 13px;
  color: #888;
  padding: 8px 0;
  border-bottom: 1px solid #f0f0f0;
}

.report-block {
  margin: 12px 0;
  padding: 12px 16px;
  background: #f4fbf6;
  border-radius: 8px;
  border-left: 3px solid #4caf7d;
}
.report-score {
  font-size: 14px;
  color: #3d2b12;
  margin-bottom: 8px;
}
.report-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.label-text {
  font-size: 15px;
  font-weight: 600;
  color: #2e4a38;
}
.report-desc {
  font-size: 13px;
  color: #5a7a64;
  line-height: 1.6;
}
.no-match {
  color: #999;
  font-size: 13px;
  border-left-color: #ddd;
  background: #fafafa;
}
.admin-only .label-text {
  color: #8b5a2b;
}

.container {
  max-width: 860px;
  margin: 20px auto;
  padding: 24px;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-top: 16px;
  gap: 16px;
}
.header h2 {
  margin: 0 0 4px;
  font-size: 20px;
  color: #3d2b12;
}
.header-btns {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.desc {
  color: #888;
  font-size: 13px;
  margin: 0 0 12px;
}
.meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.dim-scores {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
</style>
