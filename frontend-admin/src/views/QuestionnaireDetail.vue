<script setup>
// 问卷「概览」：几个关键数字、题目列表、回答记录（点「详情」看某个人的作答）。
// 问卷标题、设置、生成链接、导出、删除在外框（QuestionnaireShell.vue）里。
import { ref, computed, inject, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { Edit, Upload, Plus } from "@element-plus/icons-vue";
import { API_BASE } from "../api.js";

const route = useRoute();
const router = useRouter();
const questionnaireId = route.params.id;
const shell = inject("questionnaireShell");
const questionnaire = computed(() => shell.questionnaire.value);
const questions = computed(() => shell.questions.value);

const showAnswerDialog = ref(false);
const answerDetail = ref(null);
const answerLoading = ref(false);
const submissions = ref([]);
const submissionsLoaded = ref(false);
const submissionsLoading = ref(false);
const activeTab = ref(
  route.query.tab === "submissions" ? "submissions" : "questions",
);
const reportDetail = ref(null);
const subjectInfoDetail = ref([]);
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
      submissionsLoaded.value = true;
    }
  } catch (err) {
    console.error("获取提交记录失败:", err);
  } finally {
    submissionsLoading.value = false;
  }
}

function handleTabChange(tab) {
  router.replace({ query: tab === "submissions" ? { tab } : {} });
  if (tab === "submissions" && !submissionsLoaded.value) fetchSubmissions();
}

onMounted(() => {
  // 从别的标签页（如「题目」）切回来时刷新一下题目和份数；第一次打开时外框已经在加载了
  if (shell.questionnaire.value) shell.reload();
  if (activeTab.value === "submissions") fetchSubmissions();
});

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

// ---------- 顶部几个数字 ----------
const typeCounts = computed(() => {
  const counts = {};
  questions.value.forEach((q) => {
    const t = typeLabel(q.question_type);
    counts[t] = (counts[t] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([t, n]) => `${t} ${n}`)
    .join(" · ");
});

function fmtDate(t, withTime = true) {
  if (!t) return "";
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, "0");
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return withTime ? `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}` : day;
}

// 最近提交：今天的显示「今天 14:05」，其他显示日期
function fmtRecent(t) {
  if (!t) return "还没有";
  const d = new Date(t);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  if (d.toDateString() === now.toDateString())
    return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return fmtDate(t, false);
}

// 作答详情里有没有按键作答的数据（有才显示那几列）
const detailHasKey = computed(() =>
  (answerDetail.value?.answers || []).some(
    (a) => a.hold_ms !== null && a.hold_ms !== undefined,
  ),
);
const detailHasConfidence = computed(() =>
  (answerDetail.value?.answers || []).some(
    (a) => a.confidence !== null && a.confidence !== undefined,
  ),
);

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
</script>

<template>
  <div class="overview">
    <template v-if="questionnaire">
      <!-- 关键数字 -->
      <div class="tiles">
        <div class="tile">
          <div class="tile-label">题目</div>
          <div class="tile-value">{{ questions.length }}<small> 道</small></div>
          <div class="tile-sub">{{ typeCounts || "还没有题目" }}</div>
        </div>
        <div class="tile">
          <div class="tile-label">收到答卷</div>
          <div class="tile-value">
            {{ questionnaire.submission_count ?? 0 }}<small> 份</small>
          </div>
          <div class="tile-sub">
            {{
              questionnaire.max_responses
                ? `最多收 ${questionnaire.max_responses} 份`
                : "不限份数"
            }}
          </div>
        </div>
        <div class="tile">
          <div class="tile-label">最近提交</div>
          <div class="tile-value text">
            {{ fmtRecent(questionnaire.last_submitted_at) }}
          </div>
          <div class="tile-sub">
            {{
              questionnaire.expires_at
                ? `截止 ${fmtDate(questionnaire.expires_at)}`
                : "没有截止时间"
            }}
          </div>
        </div>
        <div class="tile">
          <div class="tile-label">创建</div>
          <div class="tile-value text">
            {{ questionnaire.creator_name || "未知" }}
          </div>
          <div class="tile-sub">
            {{ fmtDate(questionnaire.created_at, false) }} ·
            {{ questionnaire.track_timing ? "记录每题用时" : "不记录用时" }}
          </div>
        </div>
      </div>

      <div v-if="questionnaire.description" class="desc">
        {{ questionnaire.description }}
      </div>

      <!-- 题目列表 / 回答记录 -->
      <div class="panel">
        <el-tabs v-model="activeTab" @tab-change="handleTabChange">
          <el-tab-pane name="questions">
            <template #label>
              题目列表
              <span class="tab-count">{{ questions.length }}</span>
            </template>
            <div class="panel-tools" v-if="questions.length > 0">
              <span class="muted"
                >只读预览，修改题目、调整顺序、设置题目逻辑请到「题目」页</span
              >
              <el-button
                size="small"
                type="primary"
                plain
                :icon="Edit"
                @click="
                  router.push(
                    `/questionnaire/${questionnaireId}/edit-questions`,
                  )
                "
                >编辑题目</el-button
              >
            </div>
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
                    >有图片/视频</el-tag
                  >
                </template>
              </el-table-column>
              <el-table-column label="题型" width="90">
                <template #default="scope">
                  <el-tag size="small" type="primary" effect="plain">
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
                      class="opt-text"
                    >
                      {{ formatOptions(scope.row.options) }}
                    </div>
                  </span>
                  <span
                    v-else-if="scope.row.question_type === 'yes_no'"
                    class="opt-text"
                    >是 / 否</span
                  >
                  <span
                    v-else-if="scope.row.question_type === 'open_text'"
                    class="opt-text"
                    >文字输入</span
                  >
                  <span
                    v-else-if="
                      ['single_choice', 'multiple_choice'].includes(
                        scope.row.question_type,
                      ) && scope.row.options
                    "
                    class="opt-text"
                    >{{ formatOptions(scope.row.options) }}</span
                  >
                  <span v-else style="color: #ccc; font-size: 12px">—</span>
                </template>
              </el-table-column>
            </el-table>
            <div v-else class="empty">
              <div class="empty-title">还没有题目</div>
              <div class="empty-sub">
                可以一道一道添加，也可以用 Excel 模板一次导入
              </div>
              <div class="empty-actions">
                <el-button
                  type="primary"
                  :icon="Plus"
                  @click="
                    router.push(
                      `/questionnaire/${questionnaireId}/edit-questions`,
                    )
                  "
                  >添加题目</el-button
                >
                <el-button
                  :icon="Upload"
                  @click="router.push(`/import?qid=${questionnaireId}`)"
                  >从 Excel 导入</el-button
                >
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane name="submissions">
            <template #label>
              回答记录
              <span class="tab-count">{{
                submissionsLoaded
                  ? submissions.length
                  : (questionnaire.submission_count ?? 0)
              }}</span>
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
                      effect="plain"
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
                  <el-table-column label="得分" min-width="180">
                    <template #default>
                      <span style="color: #aaa; font-size: 12px"
                        >在「维度计分」里配置后显示得分</span
                      >
                    </template>
                  </el-table-column>
                </template>
              </el-table>
              <div v-else-if="!submissionsLoading" class="empty">
                <div class="empty-title">还没有人提交这份问卷</div>
                <div class="empty-sub">
                  点右上角「生成链接」，把链接或二维码发给受测者
                </div>
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>
    </template>
    <div v-else class="loading-box" v-loading="true"></div>

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
            <!-- 按键作答：按下用时、按住时长、把握程度 -->
            <template v-if="detailHasKey">
              <el-table-column label="按下用时" width="88">
                <template #default="scope">
                  {{ scope.row.rt_ms !== null ? scope.row.rt_ms + "ms" : "-" }}
                </template>
              </el-table-column>
              <el-table-column label="按住时长" width="88">
                <template #default="scope">
                  {{
                    scope.row.hold_ms !== null ? scope.row.hold_ms + "ms" : "-"
                  }}
                </template>
              </el-table-column>
              <el-table-column
                v-if="detailHasConfidence"
                label="把握"
                width="60"
              >
                <template #default="scope">
                  {{ scope.row.confidence ?? "-" }}
                </template>
              </el-table-column>
            </template>
          </el-table>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}
.tile {
  background: var(--app-card);
  border: 1px solid var(--app-border);
  border-radius: 12px;
  padding: 14px 16px;
}
.tile-label {
  font-size: 12px;
  color: var(--app-text-3);
}
.tile-value {
  margin-top: 4px;
  font-size: 26px;
  font-weight: 650;
  color: var(--app-text);
  font-variant-numeric: tabular-nums;
  line-height: 1.25;
}
.tile-value small {
  font-size: 13px;
  font-weight: 400;
  color: var(--app-text-3);
}
.tile-value.text {
  font-size: 17px;
  padding: 5px 0 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tile-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--app-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.desc {
  margin-top: 12px;
  padding: 10px 14px;
  background: var(--app-accent-soft);
  border-radius: 10px;
  font-size: 13px;
  color: var(--app-text-2);
  line-height: 1.7;
  white-space: pre-wrap;
}
.panel {
  margin-top: 16px;
  background: var(--app-card);
  border: 1px solid var(--app-border);
  border-radius: 12px;
  padding: 4px 18px 16px;
}
.tab-count {
  display: inline-block;
  margin-left: 6px;
  min-width: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background: #f3ede3;
  color: var(--app-text-2);
  font-size: 12px;
  line-height: 18px;
  text-align: center;
}
.panel-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.muted {
  font-size: 12px;
  color: var(--app-text-3);
}
.opt-text {
  font-size: 12px;
  color: #777;
}
.empty {
  text-align: center;
  padding: 40px 0 32px;
}
.empty-title {
  font-size: 15px;
  color: var(--app-text);
  font-weight: 600;
}
.empty-sub {
  margin-top: 6px;
  font-size: 13px;
  color: var(--app-text-3);
}
.empty-actions {
  margin-top: 16px;
}
.loading-box {
  height: 240px;
}
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
