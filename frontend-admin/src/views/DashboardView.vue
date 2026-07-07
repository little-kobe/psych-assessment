<script setup>
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";

const router = useRouter();
const displayName = ref("");
const role = ref("");

const questionnaires = ref([]);
const loading = ref(false);
const showCreateDialog = ref(false);
const newQuestionnaire = ref({
  title: "",
  description: "",
  consent_text: "",
  track_timing: true,
  is_active: true,
  max_responses: null,
  expires_at: null,
});

async function fetchQuestionnaires() {
  loading.value = true;
  const token = localStorage.getItem("admin_token");
  try {
    const response = await fetch("http://localhost:3000/api/questionnaires", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    if (data.success) {
      questionnaires.value = data.questionnaires;
    }
  } catch (err) {
    console.error("获取问卷列表失败:", err);
  } finally {
    loading.value = false;
  }
}

async function createQuestionnaire() {
  const token = localStorage.getItem("admin_token");
  try {
    const response = await fetch("http://localhost:3000/api/questionnaires", {
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
      newQuestionnaire.value = {
        title: "",
        description: "",
        track_timing: true,
      };
      fetchQuestionnaires(); // 创建成功后刷新列表
    }
  } catch (err) {
    console.error("创建问卷失败:", err);
  }
}

const showGroupDialog = ref(false);
const currentLinkQid = ref(null);
const groupName = ref("");
const generatedLink = ref("");

function openGroupLink(questionnaireId) {
  currentLinkQid.value = questionnaireId;
  groupName.value = "";
  generatedLink.value = `http://localhost:5173/q/${questionnaireId}`;
  showGroupDialog.value = true;
}

function generateGroupLink() {
  const base = `http://localhost:5173/q/${currentLinkQid.value}`;
  generatedLink.value = groupName.value
    ? `${base}?group=${encodeURIComponent(groupName.value)}`
    : base;
}

function copyGeneratedLink() {
  navigator.clipboard
    .writeText(generatedLink.value)
    .then(() => {
      ElMessage.success("链接已复制");
    })
    .catch(() => {
      ElMessage.error("复制失败，请手动复制");
    });
}

function goImport(questionnaireId) {
  router.push(`/import?qid=${questionnaireId}`);
}

onMounted(() => {
  const token = localStorage.getItem("admin_token");
  if (!token) {
    router.push("/login");
    return;
  }
  displayName.value = localStorage.getItem("admin_name") || "";
  role.value = localStorage.getItem("admin_role") || "";
  fetchQuestionnaires(); // 登录检查通过后，加载问卷列表
});

function handleLogout() {
  localStorage.removeItem("admin_token");
  localStorage.removeItem("admin_role");
  localStorage.removeItem("admin_name");
  router.push("/login");
}

const roleLabel = () => (role.value === "supervisor" ? "导师" : "研究者");
</script>

<template>
  <el-container class="layout">
    <el-aside width="220px" class="sidebar">
      <div class="logo">
        <div class="logo-icon">心</div>
        <span>测评管理平台</span>
      </div>
      <el-menu
        :default-active="$route.path"
        class="menu"
        background-color="transparent"
        text-color="#5a4a2e"
        active-text-color="#F4844C"
        router
      >
        <el-menu-item index="/">
          <span>问卷管理</span>
        </el-menu-item>
        <el-menu-item v-if="role === 'supervisor'" index="/admin-manage">
          <span>账号管理</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="header">
        <span class="welcome">欢迎回来，{{ displayName }}</span>
        <div class="user-info">
          <el-tag
            :type="role === 'supervisor' ? 'warning' : 'info'"
            size="small"
            >{{ roleLabel() }}</el-tag
          >
          <el-button size="small" @click="handleLogout">退出登录</el-button>
        </div>
      </el-header>

      <el-main class="main">
        <div class="toolbar">
          <h2>问卷列表</h2>
          <el-button type="primary" @click="showCreateDialog = true"
            >新建问卷</el-button
          >
        </div>

        <el-table
          :data="questionnaires"
          v-loading="loading"
          style="width: 100%"
        >
          <el-table-column label="问卷标题">
            <template #default="scope">
              <el-link
                type="primary"
                @click="$router.push(`/questionnaire/${scope.row.id}`)"
                >{{ scope.row.title }}</el-link
              >
            </template>
          </el-table-column>
          <el-table-column prop="creator_name" label="创建人" width="120" />
          <el-table-column prop="question_count" label="题目数" width="90" />
          <el-table-column label="记录时长" width="100">
            <template #default="scope">
              <el-tag
                :type="scope.row.track_timing ? 'success' : 'info'"
                size="small"
              >
                {{ scope.row.track_timing ? "已开启" : "未开启" }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="280">
            <template #default="scope">
              <div class="action-btns">
                <el-button
                  size="small"
                  type="primary"
                  plain
                  @click="$router.push(`/questionnaire/${scope.row.id}`)"
                  >详情</el-button
                >
                <el-button
                  size="small"
                  type="success"
                  plain
                  @click="openGroupLink(scope.row.id)"
                  >生成链接</el-button
                >
                >
                <el-button size="small" @click="goImport(scope.row.id)"
                  >导入题目</el-button
                >
              </div>
            </template>
          </el-table-column>
        </el-table>

        <el-dialog v-model="showCreateDialog" title="新建问卷" width="420px">
          <el-form :model="newQuestionnaire" label-width="90px">
            <el-form-item label="问卷标题">
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
            <el-button type="primary" @click="createQuestionnaire"
              >确认创建</el-button
            >
          </template>
        </el-dialog>
        <!-- 生成分组链接弹窗 -->
        <el-dialog v-model="showGroupDialog" title="生成问卷链接" width="460px">
          <div class="link-dialog">
            <p class="link-hint">
              可以为不同群体生成带分组标记的链接，方便数据分析时做组间比较。
            </p>

            <el-form label-width="80px">
              <el-form-item label="分组名称">
                <el-input
                  v-model="groupName"
                  placeholder="如：A班、实验组、男生组（不填则为无分组）"
                  @input="generateGroupLink"
                  clearable
                />
              </el-form-item>
            </el-form>

            <div class="link-preview">
              <div class="link-label">生成的链接：</div>
              <div class="link-text">{{ generatedLink }}</div>
              <el-button size="small" type="primary" @click="copyGeneratedLink"
                >复制链接</el-button
              >
            </div>

            <div class="link-tips">
              <p>💡 使用建议：</p>
              <ul>
                <li>给A班同学发：<code>...?group=A班</code></li>
                <li>给B班同学发：<code>...?group=B班</code></li>
                <li>导出数据时，每条记录会自动带上对应的分组标签</li>
              </ul>
            </div>
          </div>

          <template #footer>
            <el-button @click="showGroupDialog = false">关闭</el-button>
          </template>
        </el-dialog>
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.action-btns {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  align-items: center;
}
.layout {
  height: 100vh;
}
.sidebar {
  background: #fff8e7;
  border-right: 1px solid #f0dcae;
  padding: 20px 12px;
}
.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px 24px;
  font-weight: 600;
  color: #3d2b12;
}
.logo-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: linear-gradient(135deg, #fbb034, #f4844c);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}
.menu {
  border: none;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #eee;
}
.welcome {
  font-size: 14px;
  color: #555;
}
.user-info {
  display: flex;
  align-items: center;
  gap: 12px;
}
.main {
  background: #fafafa;
  padding: 24px;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid #f0dcae;
}
.toolbar h2 {
  margin: 0;
  font-size: 18px;
  color: #3d2b12;
}
.link-dialog {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.link-hint {
  font-size: 13px;
  color: #888;
  margin: 0;
}
.link-preview {
  background: #f9f9f9;
  border-radius: 8px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.link-label {
  font-size: 12px;
  color: #999;
}
.link-text {
  font-size: 13px;
  color: #3d2b12;
  word-break: break-all;
  background: white;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid #eee;
}
.link-tips {
  font-size: 12px;
  color: #999;
}
.link-tips p {
  margin: 0 0 4px;
}
.link-tips ul {
  margin: 0;
  padding-left: 16px;
}
.link-tips li {
  margin-bottom: 4px;
}
.link-tips code {
  background: #f0f0f0;
  padding: 1px 6px;
  border-radius: 4px;
  color: #666;
}
</style>
