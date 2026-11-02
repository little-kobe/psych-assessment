<script setup>
// 问卷列表（后台首页）：搜索、新建、进入问卷、生成链接、导入题目、统计、删除
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import {
  Plus,
  Search,
  Link,
  MoreFilled,
  Upload,
  DataAnalysis,
  Delete,
} from "@element-plus/icons-vue";
import ShareLinkDialog from "../components/ShareLinkDialog.vue";
import DeleteQuestionnaireDialog from "../components/DeleteQuestionnaireDialog.vue";
import { API_BASE } from "../api.js";

const router = useRouter();

const questionnaires = ref([]);
const loading = ref(false);
const keyword = ref("");

const emptyForm = () => ({
  title: "",
  description: "",
  consent_text: "",
  track_timing: true,
  is_active: true,
  max_responses: null,
  expires_at: null,
});
const showCreateDialog = ref(false);
const creating = ref(false);
const newQuestionnaire = ref(emptyForm());

async function fetchQuestionnaires() {
  loading.value = true;
  const token = localStorage.getItem("admin_token");
  try {
    const response = await fetch(`${API_BASE}/api/questionnaires`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    if (data.success) {
      questionnaires.value = data.questionnaires;
    } else {
      ElMessage.error(data.message || "获取问卷列表失败");
    }
  } catch (err) {
    ElMessage.error("获取问卷列表失败，请检查后端服务");
  } finally {
    loading.value = false;
  }
}

// 按创建人筛选（总账号、导师能看到几个人的问卷时才显示）
const creatorFilter = ref("");
const creators = computed(() => {
  const map = new Map();
  questionnaires.value.forEach((q) => {
    const key = String(q.created_by ?? "");
    if (!map.has(key))
      map.set(key, { value: key, label: q.creator_name || "未知", count: 0 });
    map.get(key).count++;
  });
  return [...map.values()];
});

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase();
  return questionnaires.value.filter((q) => {
    if (
      creatorFilter.value &&
      String(q.created_by ?? "") !== creatorFilter.value
    )
      return false;
    if (!k) return true;
    return (
      q.title.toLowerCase().includes(k) ||
      (q.description || "").toLowerCase().includes(k) ||
      String(q.id) === k
    );
  });
});

function openCreate() {
  newQuestionnaire.value = emptyForm();
  showCreateDialog.value = true;
}

async function createQuestionnaire() {
  if (!newQuestionnaire.value.title.trim()) {
    ElMessage.warning("请填写问卷标题");
    return;
  }
  creating.value = true;
  const token = localStorage.getItem("admin_token");
  try {
    const response = await fetch(`${API_BASE}/api/questionnaires`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(newQuestionnaire.value),
    });
    const data = await response.json();
    if (data.success) {
      showCreateDialog.value = false;
      ElMessage.success("问卷已创建");
      fetchQuestionnaires();
    } else {
      ElMessage.error(data.message || "创建失败");
    }
  } catch (err) {
    ElMessage.error("创建失败，请检查后端服务");
  } finally {
    creating.value = false;
  }
}

// 生成链接和二维码
const showLinkDialog = ref(false);
const linkQid = ref(null);
function openLink(id) {
  linkQid.value = id;
  showLinkDialog.value = true;
}

// 删除
const showDelete = ref(false);
const deleteQid = ref(null);

function onMore(cmd, row) {
  if (cmd === "import") router.push(`/import?qid=${row.id}`);
  if (cmd === "stats") router.push(`/questionnaire/${row.id}/stats`);
  if (cmd === "delete") {
    deleteQid.value = row.id;
    showDelete.value = true;
  }
}

function openQuestionnaire(row) {
  router.push(`/questionnaire/${row.id}`);
}

function statusOf(q) {
  if (!q.is_active) return { text: "已关闭", cls: "off" };
  if (q.expires_at && new Date(q.expires_at) < new Date())
    return { text: "已截止", cls: "off" };
  if (q.max_responses && q.submission_count >= q.max_responses)
    return { text: "已收满", cls: "warn" };
  return { text: "开放中", cls: "on" };
}

function fmtDate(t) {
  if (!t) return "-";
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

onMounted(fetchQuestionnaires);
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>问卷管理</h1>
        <p class="sub">
          共
          {{ questionnaires.length }}
          份问卷，点问卷名进入编辑题目、查看回答和统计
        </p>
      </div>
      <div class="head-actions">
        <el-select
          v-if="creators.length > 1"
          v-model="creatorFilter"
          placeholder="全部创建人"
          clearable
          style="width: 160px"
        >
          <el-option
            v-for="c in creators"
            :key="c.value"
            :value="c.value"
            :label="`${c.label}（${c.count}）`"
          />
        </el-select>
        <el-input
          v-model="keyword"
          :prefix-icon="Search"
          placeholder="搜索问卷标题"
          clearable
          style="width: 220px"
        />
        <el-button type="primary" :icon="Plus" @click="openCreate"
          >新建问卷</el-button
        >
      </div>
    </div>

    <div class="card" v-loading="loading">
      <el-table
        v-if="filtered.length > 0"
        :data="filtered"
        row-class-name="q-row"
        @row-click="openQuestionnaire"
      >
        <el-table-column label="问卷" min-width="260">
          <template #default="{ row }">
            <div class="q-title">{{ row.title }}</div>
            <div class="q-desc">
              {{ row.description || `ID ${row.id}` }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="96">
          <template #default="{ row }">
            <span class="status" :class="statusOf(row).cls"
              ><i></i>{{ statusOf(row).text }}</span
            >
          </template>
        </el-table-column>
        <el-table-column label="作答方式" width="96">
          <template #default="{ row }">
            <span class="mode">{{
              row.answer_mode === "key" ? "按键" : "点击"
            }}</span>
          </template>
        </el-table-column>
        <el-table-column label="题目" width="70" align="right">
          <template #default="{ row }">
            <span class="num">{{ row.question_count }}</span>
          </template>
        </el-table-column>
        <el-table-column label="答卷" width="80" align="right">
          <template #default="{ row }">
            <span class="num">{{ row.submission_count ?? "-" }}</span>
          </template>
        </el-table-column>
        <el-table-column label="创建" width="130">
          <template #default="{ row }">
            <div class="creator">{{ row.creator_name || "-" }}</div>
            <div class="q-desc">{{ fmtDate(row.created_at) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="" width="150" align="right">
          <template #default="{ row }">
            <div class="row-actions" @click.stop>
              <el-button
                size="small"
                type="primary"
                plain
                :icon="Link"
                @click="openLink(row.id)"
                >链接</el-button
              >
              <el-dropdown trigger="click" @command="(cmd) => onMore(cmd, row)">
                <el-button size="small" :icon="MoreFilled" class="more-btn" />
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="stats" :icon="DataAnalysis"
                      >统计分析</el-dropdown-item
                    >
                    <el-dropdown-item command="import" :icon="Upload"
                      >从 Excel 导入题目</el-dropdown-item
                    >
                    <el-dropdown-item
                      command="delete"
                      :icon="Delete"
                      divided
                      class="danger-item"
                      >删除问卷</el-dropdown-item
                    >
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div v-else-if="!loading" class="empty">
        <template v-if="questionnaires.length === 0">
          <div class="empty-title">还没有问卷</div>
          <div class="empty-sub">新建一份问卷，再添加题目或从 Excel 导入</div>
          <el-button type="primary" :icon="Plus" @click="openCreate"
            >新建问卷</el-button
          >
        </template>
        <template v-else>
          <div class="empty-title">没有符合条件的问卷</div>
          <div class="empty-sub">换个关键词试试</div>
        </template>
      </div>
    </div>

    <el-dialog v-model="showCreateDialog" title="新建问卷" width="480px">
      <el-form :model="newQuestionnaire" label-width="80px">
        <el-form-item label="问卷标题" required>
          <el-input
            v-model="newQuestionnaire.title"
            placeholder="例如：SCL-90症状自评量表"
          />
        </el-form-item>
        <el-form-item label="问卷说明">
          <el-input
            v-model="newQuestionnaire.description"
            type="textarea"
            :rows="2"
            placeholder="简要说明本问卷的用途"
          />
        </el-form-item>
        <el-form-item label="知情同意">
          <el-input
            v-model="newQuestionnaire.consent_text"
            type="textarea"
            :rows="4"
            placeholder="填写受测者答题前需阅读的知情同意说明，例如：本问卷用于学术研究，所有数据匿名保存，参与完全自愿..."
          />
        </el-form-item>
        <el-form-item label="记录时长">
          <el-switch v-model="newQuestionnaire.track_timing" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button
          type="primary"
          :loading="creating"
          @click="createQuestionnaire"
          >确认创建</el-button
        >
      </template>
    </el-dialog>

    <ShareLinkDialog
      v-model="showLinkDialog"
      :path="`/q/${linkQid}`"
      :file-name="`问卷${linkQid}`"
    />
    <DeleteQuestionnaireDialog
      v-model="showDelete"
      :questionnaire-id="deleteQid"
      @deleted="fetchQuestionnaires"
    />
  </div>
</template>

<style scoped>
.page {
  max-width: 1080px;
  margin: 0 auto;
}
.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}
.page-head h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
  color: var(--app-text);
}
.sub {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--app-text-3);
}
.head-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}
.card {
  background: var(--app-card);
  border: 1px solid var(--app-border);
  border-radius: 12px;
  padding: 4px 8px 8px;
  min-height: 160px;
}
:deep(.q-row) {
  cursor: pointer;
}
.q-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text);
  line-height: 1.5;
}
:deep(.q-row:hover) .q-title {
  color: var(--el-color-primary);
}
.q-desc {
  font-size: 12px;
  color: var(--app-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.creator {
  font-size: 13px;
  color: var(--app-text-2);
}
.num {
  font-variant-numeric: tabular-nums;
  color: var(--app-text);
}
.mode {
  font-size: 12px;
  color: var(--app-text-2);
  background: #f3ede3;
  padding: 2px 8px;
  border-radius: 999px;
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  white-space: nowrap;
}
.status i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}
.status.on {
  color: #2f7d4f;
}
.status.off {
  color: #9a9a9a;
}
.status.warn {
  color: #a96a14;
}
.row-actions {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}
.row-actions .el-button + .el-button {
  margin-left: 0;
}
.more-btn {
  width: 30px;
}
:deep(.danger-item) {
  color: #c0392b;
}
.empty {
  text-align: center;
  padding: 56px 0 48px;
}
.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--app-text);
}
.empty-sub {
  margin: 6px 0 16px;
  font-size: 13px;
  color: var(--app-text-3);
}
</style>
