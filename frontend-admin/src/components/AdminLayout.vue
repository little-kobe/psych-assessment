<script setup>
// 后台的整体布局：左侧菜单（问卷管理、问卷组合、账号管理）+ 右侧内容。登录页不用这个布局。
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Document, Files, User, SwitchButton } from "@element-plus/icons-vue";

const route = useRoute();
const router = useRouter();

const displayName = computed(() => localStorage.getItem("admin_name") || "");
const role = computed(() => localStorage.getItem("admin_role") || "");

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
  ...(role.value === "supervisor"
    ? [
        {
          key: "admins",
          label: "账号管理",
          icon: User,
          to: "/admin-manage",
          match: (p) => p.startsWith("/admin-manage"),
        },
      ]
    : []),
]);

function logout() {
  localStorage.removeItem("admin_token");
  localStorage.removeItem("admin_role");
  localStorage.removeItem("admin_name");
  router.push("/login");
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

      <div class="user">
        <div class="avatar">{{ (displayName || "我").slice(0, 1) }}</div>
        <div class="user-text">
          <div class="user-name">{{ displayName || "未命名账号" }}</div>
          <div class="user-role">
            {{ role === "supervisor" ? "导师" : "研究者" }}
          </div>
        </div>
        <el-tooltip content="退出登录" placement="top">
          <button class="logout" type="button" @click="logout">
            <el-icon :size="16"><SwitchButton /></el-icon>
          </button>
        </el-tooltip>
      </div>
    </aside>

    <main class="main">
      <slot />
    </main>
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
.user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 8px 4px;
  border-top: 1px solid #f0e2c4;
}
.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #f4d9b0;
  color: #8b5a2b;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;
}
.user-text {
  flex: 1;
  min-width: 0;
}
.user-name {
  font-size: 13px;
  color: var(--app-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.user-role {
  font-size: 11px;
  color: var(--app-text-3);
}
.logout {
  border: none;
  background: transparent;
  color: var(--app-text-3);
  width: 30px;
  height: 30px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.logout:hover {
  background: rgba(200, 90, 34, 0.1);
  color: var(--el-color-primary);
}
.main {
  flex: 1;
  min-width: 0;
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
  .user {
    border-top: none;
    padding: 0;
  }
  .user-text {
    display: none;
  }
  .main {
    padding: 16px 16px 40px;
  }
}
@media (max-width: 560px) {
  .brand-text {
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
