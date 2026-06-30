<script setup>
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();
const displayName = ref("");
const role = ref("");

const questionnaires = ref([]);
const loading = ref(false);
const showCreateDialog = ref(false);
const newQuestionnaire = ref({
  title: "",
  description: "",
  track_timing: true,
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
        default-active="1"
        class="menu"
        background-color="transparent"
        text-color="#5a4a2e"
        active-text-color="#F4844C"
      >
        <el-menu-item index="1">
          <el-icon><i class="el-icon-document"></i></el-icon>
          <span>问卷管理</span>
        </el-menu-item>
        <el-menu-item index="2">
          <span>导入题目</span>
        </el-menu-item>
        <el-menu-item index="3">
          <span>数据导出</span>
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
          <el-table-column prop="title" label="问卷标题" />
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
          <el-table-column label="操作" width="160">
            <template #default="scope">
              <el-button size="small" @click="goImport(scope.row.id)"
                >导入题目</el-button
              >
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
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
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
}
</style>
