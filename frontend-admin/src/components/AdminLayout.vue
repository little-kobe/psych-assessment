<script setup>
// 后台的整体布局：左侧菜单（问卷管理、问卷组合、账号管理）+ 右侧（顶栏 + 内容）。登录页不用这个布局。
// 顶栏左边一句话说明「当前账号能看到什么」，右边是账号菜单（修改密码、账号管理、退出登录）。
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { API_BASE } from "../api.js";
import {
  Document,
  Files,
  User,
  Lock,
  EditPen,
  SwitchButton,
  ArrowDown,
} from "@element-plus/icons-vue";
import ChangePasswordDialog from "./ChangePasswordDialog.vue";
import {
  me,
  ROLE_NAMES,
  currentRole,
  currentName,
  clearSession,
  loadMe,
} from "../session.js";

const route = useRoute();
const router = useRouter();

const role = computed(() => currentRole());
const displayName = computed(() => currentName());

onMounted(async () => {
  // 读一次服务器上的账号信息（角色可能被总账号改过）；登录过期就回登录页
  if ((await loadMe()) === "unauthorized") {
    router.push({ path: "/login", query: { redirect: route.fullPath } });
  }
});

const menu = computed(() => [
  {
    key: "questionnaires",
    label: "问卷管理",
    icon: Document,
    to: "/",
    // 问卷列表、某份问卷的各个页面、导入题目都算「问卷管理」
    match: (p) =>
      p === "/" || p.startsWith("/questionnaire") || p === "/import",
  },
  {
    key: "bundles",
    label: "问卷组合",
    icon: Files,
    to: "/bundles",
    match: (p) => p.startsWith("/bundle"),
  },
  ...(role.value === "admin" || role.value === "supervisor"
    ? [
        {
          key: "admins",
          label: role.value === "admin" ? "账号管理" : "我的研究者",
          icon: User,
          to: "/admin-manage",
          match: (p) => p.startsWith("/admin-manage"),
        },
      ]
    : []),
]);

// 顶栏左边：这个账号能看到哪些数据
const scopeText = computed(() => {
  const m = me.value;
  if (role.value === "admin") return "可以看到所有问卷，管理所有账号";
  if (role.value === "supervisor") {
    return m
      ? `可以看到自己和名下 ${m.member_count} 位研究者的问卷`
      : "可以看到自己和名下研究者的问卷";
  }
  if (role.value === "researcher") {
    return m?.supervisor_name
      ? `可以看到自己的问卷 · 导师：${m.supervisor_name}`
      : "可以看到自己的问卷";
  }
  return "";
});

const showPassword = ref(false);

async function editName() {
  let value;
  try {
    ({ value } = await ElMessageBox.prompt(
      "显示在页面右上角和问卷「创建人」里",
      "修改姓名",
      {
        inputValue: displayName.value,
        inputValidator: (v) => (!!v && !!v.trim()) || "姓名不能为空",
        confirmButtonText: "保存",
        cancelButtonText: "取消",
      },
    ));
  } catch {
    return; // 取消
  }
  try {
    const res = await fetch(`${API_BASE}/api/admin/me`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
      },
      body: JSON.stringify({ display_name: value.trim() }),
    });
    const data = await res.json();
    if (data.success) {
      ElMessage.success("已保存");
      loadMe();
    } else ElMessage.error(data.message || "保存失败");
  } catch {
    ElMessage.error("保存失败，请检查后端服务");
  }
}

function onUserCommand(cmd) {
  if (cmd === "name") editName();
  if (cmd === "password") showPassword.value = true;
  if (cmd === "admins") router.push("/admin-manage");
  if (cmd === "logout") {
    clearSession();
    router.push("/login");
  }
}
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <router-link to="/" class="brand">
        <span class="brand-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="5" r="2.2" fill="white" />
            <path
              d="M12 7.2v4M12 11.2c-3 0-5 2-5 5v2h10v-2c0-3-2-5-5-5Z"
              stroke="white"
              stroke-width="1.4"
              stroke-linejoin="round"
              fill="none"
            />
            <circle cx="6.5" cy="13" r="1.4" fill="white" opacity="0.9" />
            <circle cx="17.5" cy="13" r="1.4" fill="white" opacity="0.9" />
          </svg>
        </span>
        <span class="brand-text">
          <b>管理平台</b>
          <small>心理测评研究</small>
        </span>
      </router-link>

      <nav class="menu">
        <router-link
          v-for="m in menu"
          :key="m.key"
          :to="m.to"
          class="menu-item"
          :class="{ active: m.match(route.path) }"
        >
          <el-icon :size="17"><component :is="m.icon" /></el-icon>
          <span>{{ m.label }}</span>
        </router-link>
      </nav>
    </aside>

    <div class="right">
      <header class="topbar">
        <div class="scope" v-if="role">
          <span class="role-badge" :class="role">{{
            ROLE_NAMES[role] || role
          }}</span>
          <span class="scope-text">{{ scopeText }}</span>
        </div>
        <el-dropdown
          trigger="click"
          placement="bottom-end"
          @command="onUserCommand"
        >
          <button type="button" class="user-chip">
            <span class="avatar">{{ (displayName || "我").slice(0, 1) }}</span>
            <span class="user-name">{{ displayName || "我的账号" }}</span>
            <el-icon class="caret"><ArrowDown /></el-icon>
          </button>
          <template #dropdown>
            <div class="user-card">
              <span class="avatar big">{{
                (displayName || "我").slice(0, 1)
              }}</span>
              <div class="user-card-text">
                <div class="user-card-name">{{ displayName }}</div>
                <div class="user-card-sub">
                  {{ me?.username ? `账号 ${me.username}` : "" }}
                  <span class="role-badge small" :class="role">{{
                    ROLE_NAMES[role] || role
                  }}</span>
                </div>
                <div v-if="role === 'researcher'" class="user-card-sub">
                  导师：{{ me?.supervisor_name || "未分配" }}
                </div>
              </div>
            </div>
            <el-dropdown-menu>
              <el-dropdown-item command="name" :icon="EditPen"
                >修改姓名</el-dropdown-item
              >
              <el-dropdown-item command="password" :icon="Lock"
                >修改密码</el-dropdown-item
              >
              <el-dropdown-item
                v-if="role === 'admin' || role === 'supervisor'"
                command="admins"
                :icon="User"
                >{{
                  role === "admin" ? "账号管理" : "我的研究者"
                }}</el-dropdown-item
              >
              <el-dropdown-item
                command="logout"
                :icon="SwitchButton"
                divided
                class="logout-item"
                >退出登录</el-dropdown-item
              >
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </header>

      <main class="main">
        <slot />
      </main>
    </div>

    <ChangePasswordDialog v-model="showPassword" />
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  min-height: 100vh;
}
.sidebar {
  width: 216px;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #fff9ec 0%, #fdf1dc 100%);
  border-right: 1px solid #f0e2c4;
  padding: 18px 12px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px 22px;
  text-decoration: none;
}
.brand-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, #fbb034, #f4844c);
  box-shadow: 0 4px 12px rgba(244, 132, 76, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}
.brand-text b {
  font-size: 15px;
  color: var(--app-text);
}
.brand-text small {
  font-size: 11px;
  color: #a87c3f;
}
.menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  color: #6b5b45;
  font-size: 14px;
  text-decoration: none;
  transition:
    background 0.15s,
    color 0.15s;
}
.menu-item:hover {
  background: rgba(244, 169, 59, 0.12);
  color: var(--app-text);
}
.menu-item.active {
  background: #fff;
  color: var(--el-color-primary);
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(184, 130, 30, 0.12);
}

.right {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 32px;
  background: rgba(247, 244, 238, 0.88);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--app-border);
}
.scope {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 13px;
  color: var(--app-text-3);
}
.scope-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.role-badge {
  flex-shrink: 0;
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 999px;
  font-weight: 600;
  background: #f3ede3;
  color: var(--app-text-2);
}
.role-badge.admin {
  background: #fdebd9;
  color: #a0481b;
}
.role-badge.supervisor {
  background: #e7f0fb;
  color: #2f5d8a;
}
.role-badge.researcher {
  background: #e8f5ec;
  color: #2f7d4f;
}
.role-badge.small {
  font-size: 11px;
  padding: 0 8px;
  margin-left: 6px;
}
.user-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 10px 0 4px;
  border: 1px solid var(--app-border);
  border-radius: 999px;
  background: #fff;
  cursor: pointer;
  font: inherit;
  color: var(--app-text);
  transition:
    box-shadow 0.15s,
    border-color 0.15s;
  flex-shrink: 0;
}
.user-chip:hover {
  border-color: #e4cfae;
  box-shadow: 0 2px 8px rgba(184, 130, 30, 0.12);
}
.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #fbb034, #f4844c);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;
}
.avatar.big {
  width: 42px;
  height: 42px;
  font-size: 17px;
}
.user-name {
  font-size: 14px;
  max-width: 140px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.caret {
  color: var(--app-text-3);
  font-size: 12px;
}
.user-card {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 14px 16px 12px;
  min-width: 230px;
  border-bottom: 1px solid #f0ebe2;
}
.user-card-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--app-text);
}
.user-card-sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--app-text-3);
}
:deep(.logout-item) {
  color: #c0392b;
}
.main {
  flex: 1;
  padding: 24px 32px 48px;
}

/* 窄屏：菜单移到顶部横排 */
@media (max-width: 900px) {
  .layout {
    flex-direction: column;
  }
  .sidebar {
    position: static;
    width: auto;
    height: auto;
    flex-direction: row;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px 12px;
    border-right: none;
    border-bottom: 1px solid #f0e2c4;
  }
  .brand {
    padding: 0 8px 0 0;
  }
  .menu {
    flex-direction: row;
    flex: 1;
    flex-wrap: wrap;
  }
  .menu-item {
    padding: 8px 10px;
  }
  .topbar {
    padding: 0 16px;
  }
  .main {
    padding: 16px 16px 40px;
  }
}
@media (max-width: 560px) {
  .brand-text,
  .user-name,
  .scope-text {
    display: none;
  }
  .menu {
    gap: 2px;
  }
  .menu-item {
    padding: 6px 8px;
    font-size: 13px;
    gap: 4px;
  }
}
</style>
