<script setup>
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";

const route = useRoute();
const router = useRouter();
const questionnaireId = route.params.id;

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
  };
  showEditDialog.value = true;
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
          <el-button @click="openEditDialog">编辑问卷</el-button>
          <el-button
            @click="router.push(`/questionnaire/${questionnaireId}/dimensions`)"
            >配置维度</el-button
          >
          <el-button type="success" @click="exportData" :loading="exporting"
            >导出数据</el-button
          >
          <el-button type="primary" @click="goImport">导入题目</el-button>
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
            <el-table-column prop="content" label="题目内容" />
            <el-table-column label="分值范围" width="110">
              <template #default="scope">
                {{ scope.row.min_score }} - {{ scope.row.max_score }}
              </template>
            </el-table-column>
            <el-table-column label="反向计分" width="90">
              <template #default="scope">
                <el-tag
                  :type="scope.row.is_reverse_scored ? 'warning' : 'info'"
                  size="small"
                >
                  {{ scope.row.is_reverse_scored ? "是" : "否" }}
                </el-tag>
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
      </el-form>
      <template #footer>
        <el-button @click="showEditDialog = false">取消</el-button>
        <el-button type="primary" @click="saveEdit" :loading="saving"
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
