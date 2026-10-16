<script setup>
import { ref, onMounted } from "vue";
import { ArrowLeft } from "@element-plus/icons-vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { API_BASE } from "../api.js";

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
const reportDetail = ref(null);
const subjectInfoDetail = ref([]);

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
      `${API_BASE}/api/questionnaires/${questionnaireId}`,
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
      `${API_BASE}/api/questionnaires/${questionnaireId}/submissions`,
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
    show_report_chart: !!questionnaire.value.show_report_chart,
  };
  showEditDialog.value = true;
}

async function viewAnswers(submissionId) {
  subjectInfoDetail.value = [];
  answerLoading.value = true;
  showAnswerDialog.value = true;
  answerDetail.value = null;
  reportDetail.value = null;
  const token = localStorage.getItem("admin_token");
  try {
    const ansRes = await fetch(
      `${API_BASE}/api/submissions/${submissionId}/answers`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const ansData = await ansRes.json();
    if (ansData.success) answerDetail.value = ansData;

    const reportRes = await fetch(
      `${API_BASE}/api/submissions/${submissionId}/report`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    // 同时拉取基本信息
    const infoRes = await fetch(
      `${API_BASE}/api/submissions/${submissionId}/subject-info`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const infoData = await infoRes.json();
    if (infoData.success) subjectInfoDetail.value = infoData.info;
    const reportData = await reportRes.json();
    if (reportData.success) reportDetail.value = reportData;
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
      `${API_BASE}/api/questionnaires/${questionnaireId}`,
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
      `${API_BASE}/api/questionnaires/${questionnaireId}/export`,
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

// 是否答完整：后端按题目逻辑算（被跳过的题不算缺）；旧版后端没有这个字段时按答题数判断
function isComplete(row) {
  return row.is_complete !== undefined
    ? !!row.is_complete
    : row.answer_count >= questions.value.length;
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

// 显示成「完全没有=1 / 轻度=2」
function formatOptions(options) {
  return parseOptions(options)
    .filter((o) => o.label)
    .map((o) => (o.score !== null ? `${o.label}=${o.score}` : o.label))
    .join(" / ");
}

// 题目有没有图片、视频（题干或选项）
function hasMedia(q) {
  let m = q.media;
  if (typeof m === "string") {
    try {
      m = JSON.parse(m);
    } catch {
      m = null;
    }
  }
  if (Array.isArray(m) && m.length > 0) return true;
  let opts = q.options;
  if (typeof opts === "string") {
    try {
      opts = JSON.parse(opts);
    } catch {
      opts = [];
    }
  }
  return Array.isArray(opts) && opts.some((o) => o && o.image);
}

// 和常模比较的一句话，如「T = 63，约高于常模中 90% 的人」
function normText(n) {
  if (!n) return "";
  return `T = ${n.t}，约高于常模中 ${n.percentile}% 的人（常模 ${n.mean} ± ${n.sd}）`;
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
    <!-- 顶部导航栏 -->
    <div class="page-nav">
      <el-button @click="backToList" :icon="ArrowLeft" round size="small"
        >问卷列表</el-button
      >
    </div>

    <template v-if="questionnaire">
      <!-- 标题区域 -->
      <div class="page-header">
        <div class="title-section">
          <h2 class="page-title">{{ questionnaire.title }}</h2>
          <p class="page-desc">{{ questionnaire.description || "暂无说明" }}</p>
        </div>
        <div class="action-section">
          <el-button size="small" plain @click="openEditDialog">
            <span>编辑问卷</span>
          </el-button>
          <el-button
            size="small"
            plain
            @click="
              router.push(`/questionnaire/${questionnaireId}/info-fields`)
            "
          >
            <span>基本信息</span>
          </el-button>
          <el-button
            size="small"
            plain
            @click="
              router.push(`/questionnaire/${questionnaireId}/score-rules`)
            "
          >
            <span>分数段报告</span>
          </el-button>
          <el-button
            size="small"
            plain
            @click="router.push(`/questionnaire/${questionnaireId}/dimensions`)"
          >
            <span>配置维度</span>
          </el-button>
          <el-button
            size="small"
            plain
            @click="router.push(`/questionnaire/${questionnaireId}/norms`)"
          >
            <span>常模</span>
          </el-button>
          <el-divider direction="vertical" />
          <el-button
            size="small"
            type="warning"
            plain
            @click="
              router.push(`/questionnaire/${questionnaireId}/edit-questions`)
            "
          >
            <span>编辑题目</span>
          </el-button>
          <el-button
            size="small"
            type="info"
            plain
            @click="router.push(`/import?qid=${questionnaireId}`)"
          >
            <span>导入题目</span>
          </el-button>
          <el-button
            size="small"
            type="primary"
            plain
            @click="router.push(`/questionnaire/${questionnaireId}/stats`)"
          >
            <span>统计分析</span>
          </el-button>
          <el-button
            size="small"
            type="success"
            @click="exportData"
            :loading="exporting"
          >
            <span>导出数据</span>
          </el-button>
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
            <el-table-column label="题目内容" min-width="180">
              <template #default="scope">
                {{ scope.row.content }}
                <el-tag
                  v-if="hasMedia(scope.row)"
                  size="small"
                  type="success"
                  style="margin-left: 4px"
                  >🖼 有图片/视频</el-tag
                >
              </template>
            </el-table-column>
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
                  <div
                    v-if="formatOptions(scope.row.options)"
                    style="font-size: 12px; color: #666"
                  >
                    {{ formatOptions(scope.row.options) }}
                  </div>
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
                    {{ formatOptions(scope.row.options) }}
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
              <el-table-column label="编号" width="90">
                <template #default="scope">
                  {{ scope.row.id }}
                  <el-tooltip
                    v-if="scope.row.bundle_id"
                    content="通过问卷组合链接作答"
                    placement="top"
                  >
                    <el-tag size="small" type="info">组合</el-tag>
                  </el-tooltip>
                </template>
              </el-table-column>
              <el-table-column label="分组" width="100">
                <template #default="scope">
                  <el-tag
                    v-if="scope.row.group_label"
                    size="small"
                    type="primary"
                  >
                    {{ scope.row.group_label }}
                  </el-tag>
                  <span v-else style="color: #ccc; font-size: 12px">无</span>
                </template>
              </el-table-column>
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
                  <el-tooltip
                    v-if="scope.row.is_invalid"
                    content="答到了跳题逻辑里「直接提交为无效答卷」的选项，不计入统计"
                    placement="top"
                  >
                    <el-tag type="danger" size="small">无效</el-tag>
                  </el-tooltip>
                  <el-tag
                    v-else
                    :type="isComplete(scope.row) ? 'success' : 'warning'"
                    size="small"
                  >
                    {{ isComplete(scope.row) ? "完整" : "部分" }}
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
                        {{ ds.name }}：{{ ds.score ?? "-" }}
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
        <el-form-item label="结果图表">
          <el-switch
            v-model="editForm.show_report_chart"
            active-text="答完后给受测者看维度得分图"
          />
          <div style="font-size: 12px; color: #999; line-height: 1.6">
            显示每个维度的得分、所有人的平均分和对应说明（需要先配置维度）。
          </div>
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

          <div v-if="subjectInfoDetail.length > 0" class="info-section">
            <div class="info-section-title">被试基本信息</div>
            <div class="info-grid">
              <div
                v-for="item in subjectInfoDetail"
                :key="item.field_key"
                class="info-item"
              >
                <span class="info-key">{{ item.field_label }}</span>
                <span class="info-val">{{ item.value || "-" }}</span>
              </div>
            </div>
          </div>
          <div
            v-if="reportDetail && reportDetail.matched_rule"
            class="report-block"
          >
            <div class="report-score">
              总分：<strong>{{ reportDetail.total_score }}</strong> 分
            </div>
            <div class="report-label-row">
              <span
                class="report-label-badge"
                :style="{
                  background:
                    (reportDetail.matched_rule.color || '#4CAF7D') + '22',
                  color: reportDetail.matched_rule.color || '#4CAF7D',
                  borderColor:
                    (reportDetail.matched_rule.color || '#4CAF7D') + '66',
                }"
                >{{ reportDetail.matched_rule.label }}</span
              >
              <el-tag
                :type="
                  reportDetail.matched_rule.visible_to_subject
                    ? 'success'
                    : 'warning'
                "
                size="small"
                >{{
                  reportDetail.matched_rule.visible_to_subject
                    ? "受测者可见"
                    : "仅管理员可见"
                }}</el-tag
              >
            </div>
            <div
              v-if="reportDetail.matched_rule.description"
              class="report-desc-box"
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

          <!-- 和常模比较 -->
          <div v-if="reportDetail && reportDetail.has_norms" class="norm-block">
            <div class="norm-title">
              和常模比较<template v-if="reportDetail.norm_name"
                >（使用「{{ reportDetail.norm_name }}」）</template
              >
            </div>
            <template v-if="reportDetail.norm_name">
              <div v-if="reportDetail.total_norm" class="norm-line">
                <span class="norm-key"
                  >总分 {{ reportDetail.total_score }}</span
                >
                {{ normText(reportDetail.total_norm) }}
              </div>
              <template
                v-for="d in reportDetail.dimension_scores"
                :key="d.name"
              >
                <div v-if="d.norm" class="norm-line">
                  <span class="norm-key">{{ d.name }} {{ d.score }}</span>
                  {{ normText(d.norm) }}
                </div>
              </template>
            </template>
            <div v-else class="norm-line muted">
              按这个人填的基本信息，没有匹配到适用的常模。
            </div>
          </div>

          <!-- 各维度得分和评价 -->
          <div
            v-if="reportDetail && reportDetail.dimension_scores?.length > 0"
            class="dim-report-list"
          >
            <div
              v-for="d in reportDetail.dimension_scores"
              :key="d.name"
              class="dim-report-item"
            >
              <div class="dim-report-head">
                <span class="dim-report-name">{{ d.name }}</span>
                <span class="dim-report-score">{{ d.score ?? "-" }} 分</span>
                <template v-if="d.matched_rule">
                  <span
                    class="dim-report-badge"
                    :style="{
                      background: (d.matched_rule.color || '#4CAF7D') + '22',
                      color: d.matched_rule.color || '#4CAF7D',
                      borderColor: (d.matched_rule.color || '#4CAF7D') + '66',
                    }"
                    >{{ d.matched_rule.label }}</span
                  >
                  <el-tag
                    size="small"
                    :type="
                      d.matched_rule.visible_to_subject ? 'success' : 'warning'
                    "
                    >{{
                      d.matched_rule.visible_to_subject
                        ? "受测者可见"
                        : "仅管理员可见"
                    }}</el-tag
                  >
                </template>
                <span v-else class="dim-report-none">未匹配分数段</span>
              </div>
              <div v-if="d.matched_rule?.description" class="dim-report-desc">
                {{ d.matched_rule.description }}
              </div>
            </div>
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
.dim-report-list {
  margin: 10px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dim-report-item {
  background: #fafafa;
  border-radius: 8px;
  padding: 8px 12px;
}
.dim-report-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.dim-report-name {
  font-weight: 600;
  color: #3d2b12;
}
.dim-report-score {
  font-size: 13px;
  color: #666;
}
.dim-report-badge {
  padding: 1px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid;
}
.dim-report-none {
  font-size: 12px;
  color: #bbb;
}
.dim-report-desc {
  font-size: 12px;
  color: #5a7a64;
  line-height: 1.6;
  margin-top: 4px;
}
.action-section .el-button {
  margin: 0;
}
.action-section .el-divider--vertical {
  height: 24px;
  margin: 0 4px;
}

.info-section {
  margin: 12px 0;
  padding: 12px;
  background: #f9f9f9;
  border-radius: 8px;
}
.info-section-title {
  font-size: 12px;
  color: #999;
  margin-bottom: 10px;
  font-weight: 600;
}
.info-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.info-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 120px;
}
.info-key {
  font-size: 11px;
  color: #aaa;
}
.info-val {
  font-size: 13px;
  color: #3d2b12;
  font-weight: 500;
}
.report-label-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0;
}
.report-label-badge {
  padding: 4px 16px;
  border-radius: 16px;
  font-size: 15px;
  font-weight: 600;
  border: 1px solid;
}
.report-desc-box {
  font-size: 13px;
  color: #5a7a64;
  line-height: 1.7;
  background: #f4fbf6;
  border-radius: 8px;
  padding: 10px 14px;
  margin-top: 8px;
  border-left: 3px solid #4caf7d;
}

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

.header h2 {
  margin: 0 0 4px;
  font-size: 20px;
  color: #3d2b12;
}

.container {
  max-width: 960px;
  margin: 0 auto;
  padding: 16px 24px 24px;
}
.page-nav {
  margin-bottom: 16px;
}
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  background: #fff;
  border-radius: 12px;
  border: 1px solid #f0dcae;
  margin-bottom: 20px;
}
.title-section {
  flex: 1;
  min-width: 0;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
  color: #3d2b12;
  margin: 0 0 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.page-desc {
  font-size: 13px;
  color: #999;
  margin: 0 0 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.action-section {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: 520px;
}

.dim-scores {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.norm-block {
  margin: 10px 0;
  padding: 10px 14px;
  background: #f4f8fd;
  border: 1px solid #dbe7f6;
  border-radius: 8px;
}
.norm-title {
  font-size: 13px;
  font-weight: 600;
  color: #2f5d8a;
  margin-bottom: 6px;
}
.norm-line {
  font-size: 13px;
  color: #444;
  line-height: 1.8;
}
.norm-line.muted {
  color: #999;
}
.norm-key {
  display: inline-block;
  min-width: 110px;
  color: #2f5d8a;
}
</style>
