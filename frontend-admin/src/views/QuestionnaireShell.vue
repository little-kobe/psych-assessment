<script setup>
// 一份问卷的外框：面包屑、标题和状态、常用操作（生成链接、导出数据、设置、导入题目、删除），
// 下面一排标签页切换「概览 / 题目 / 维度计分 / 分数段报告 / 基本信息 / 常模 / 统计分析」。
// 具体内容由子页面显示；子页面可以 inject("questionnaireShell") 拿到问卷信息、刷新。
import { ref, computed, provide, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import {
  Link,
  Download,
  Setting,
  MoreFilled,
  Upload,
  Delete,
} from "@element-plus/icons-vue";
import { API_BASE } from "../api.js";
import { downloadQuestionnaireData } from "../exportData.js";
import ShareLinkDialog from "../components/ShareLinkDialog.vue";
import QuestionnaireSettingsDialog from "../components/QuestionnaireSettingsDialog.vue";
import DeleteQuestionnaireDialog from "../components/DeleteQuestionnaireDialog.vue";

const route = useRoute();
const router = useRouter();
const id = computed(() => route.params.id);

const questionnaire = ref(null);
const questions = ref([]);
const loading = ref(false);

async function reload() {
  loading.value = true;
  const token = localStorage.getItem("admin_token");
  try {
    const res = await fetch(`${API_BASE}/api/questionnaires/${id.value}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.success) {
      questionnaire.value = data.questionnaire;
      questions.value = data.questions;
    } else {
      ElMessage.error(data.message || "问卷不存在");
      router.push("/");
    }
  } catch {
    ElMessage.error("加载问卷失败，请检查后端服务");
  } finally {
    loading.value = false;
  }
}

watch(
  id,
  () => {
    questionnaire.value = null;
    questions.value = [];
    reload();
  },
  { immediate: true },
);

provide("questionnaireShell", { questionnaire, questions, loading, reload });

const tabs = [
  { name: "questionnaireDetail", label: "概览", path: "" },
  { name: "questionEditor", label: "题目", path: "/edit-questions" },
  { name: "dimensionConfig", label: "维度计分", path: "/dimensions" },
  { name: "scoreRuleConfig", label: "分数段报告", path: "/score-rules" },
  { name: "subjectInfoConfig", label: "基本信息", path: "/info-fields" },
  { name: "normConfig", label: "常模", path: "/norms" },
  { name: "questionnaireStats", label: "统计分析", path: "/stats" },
];

// 现在能不能填写
const status = computed(() => {
  const q = questionnaire.value;
  if (!q) return null;
  if (!q.is_active) return { text: "已关闭", cls: "off" };
  if (q.expires_at && new Date(q.expires_at) < new Date())
    return { text: "已截止", cls: "off" };
  if (q.max_responses && q.submission_count >= q.max_responses)
    return { text: "已收满", cls: "warn" };
  return { text: "开放填写中", cls: "on" };
});

const showLink = ref(false);
const showSettings = ref(false);
const showDelete = ref(false);
const exporting = ref(false);

async function exportData() {
  exporting.value = true;
  await downloadQuestionnaireData(id.value, questionnaire.value?.title);
  exporting.value = false;
}

function onMore(cmd) {
  if (cmd === "import") router.push(`/import?qid=${id.value}`);
  if (cmd === "delete") showDelete.value = true;
}
</script>

<template>
  <div class="shell">
    <div class="crumbs">
      <router-link to="/">问卷管理</router-link>
      <span class="sep">/</span>
      <span class="current">{{ questionnaire?.title || "…" }}</span>
    </div>

    <div class="head">
      <div class="head-main">
        <h1 v-if="questionnaire">{{ questionnaire.title }}</h1>
        <el-skeleton v-else :rows="0" animated style="width: 260px" />
        <div v-if="questionnaire" class="chips">
          <span class="status" :class="status.cls">
            <i></i>{{ status.text }}
          </span>
          <span class="chip">
            {{
              questionnaire.answer_mode === "key"
                ? `按键作答${questionnaire.key_confidence ? " · 问把握程度" : ""}`
                : "点击作答"
            }}
          </span>
          <span class="chip">ID {{ questionnaire.id }}</span>
        </div>
      </div>
      <div class="head-actions">
        <el-button type="primary" :icon="Link" @click="showLink = true"
          >生成链接</el-button
        >
        <el-button :icon="Download" :loading="exporting" @click="exportData"
          >导出数据</el-button
        >
        <el-button
          :icon="Setting"
          :disabled="!questionnaire"
          @click="showSettings = true"
          >设置</el-button
        >
        <el-dropdown trigger="click" @command="onMore">
          <el-button :icon="MoreFilled" class="more-btn" />
          <template #dropdown>
            <el-dropdown-menu>
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
    </div>

    <nav class="tabs">
      <router-link
        v-for="t in tabs"
        :key="t.name"
        :to="`/questionnaire/${id}${t.path}`"
        class="tab"
        :class="{ active: route.name === t.name }"
        >{{ t.label }}</router-link
      >
    </nav>

    <div class="content">
      <router-view v-slot="{ Component }">
        <component :is="Component" :key="id" />
      </router-view>
    </div>

    <ShareLinkDialog
      v-model="showLink"
      :path="`/q/${id}`"
      :file-name="`问卷${id}`"
    />
    <QuestionnaireSettingsDialog
      v-model="showSettings"
      :questionnaire="questionnaire"
      @saved="reload"
    />
    <DeleteQuestionnaireDialog
      v-model="showDelete"
      :questionnaire-id="id"
      @deleted="router.push('/')"
    />
  </div>
</template>

<style scoped>
.shell {
  max-width: 1080px;
  margin: 0 auto;
}
.crumbs {
  font-size: 13px;
  color: var(--app-text-3);
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.crumbs a {
  color: var(--app-text-2);
  text-decoration: none;
}
.crumbs a:hover {
  color: var(--el-color-primary);
}
.crumbs .sep {
  color: #d6cbb8;
}
.crumbs .current {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin: 10px 0 14px;
  flex-wrap: wrap;
}
.head-main {
  min-width: 0;
  /* 宽度不够 320px 时，操作按钮换到下一行，标题不被挤窄 */
  flex: 1 1 320px;
}
.head-main h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
  color: var(--app-text);
  line-height: 1.35;
  word-break: break-all;
}
.chips {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 999px;
  font-weight: 500;
}
.status i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.status.on {
  color: #2f7d4f;
  background: #e8f5ec;
}
.status.off {
  color: #8a8a8a;
  background: #f0eeea;
}
.status.warn {
  color: #a96a14;
  background: #fdf2dc;
}
.chip {
  font-size: 12px;
  color: var(--app-text-2);
  background: #f3ede3;
  padding: 2px 10px;
  border-radius: 999px;
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.head-actions .el-button + .el-button {
  margin-left: 0;
}
.more-btn {
  width: 34px;
}
:deep(.danger-item) {
  color: #c0392b;
}
.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--app-border);
  overflow-x: auto;
  scrollbar-width: none;
}
.tab {
  position: relative;
  padding: 10px 14px;
  font-size: 14px;
  color: var(--app-text-2);
  text-decoration: none;
  white-space: nowrap;
  transition: color 0.15s;
}
.tab:hover {
  color: var(--app-text);
}
.tab.active {
  color: var(--el-color-primary);
  font-weight: 600;
}
.tab.active::after {
  content: "";
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--el-color-primary);
}
.content {
  padding-top: 20px;
}
</style>
