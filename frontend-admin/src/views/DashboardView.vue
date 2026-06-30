<script setup>
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();
const displayName = ref("");
const role = ref("");

onMounted(() => {
  // 检查是否已登录，没登录就踢回登录页
  const token = localStorage.getItem("admin_token");
  if (!token) {
    router.push("/login");
    return;
  }
  displayName.value = localStorage.getItem("admin_name") || "";
  role.value = localStorage.getItem("admin_role") || "";
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
        <el-empty description="这里以后会显示问卷列表，下一步我们就来做这个" />
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
