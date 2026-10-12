<script setup>
import { API_BASE } from "../api.js";
// 问卷组合列表（显示在左侧菜单「问卷组合」里）
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import ShareLinkDialog from "../components/ShareLinkDialog.vue";

const SERVER = API_BASE;
const router = useRouter();
const bundles = ref([]);
const loading = ref(false);
const showLink = ref(false);
const linkBundle = ref(null);
const exportingId = ref(null);

const token = () => localStorage.getItem("admin_token");

async function fetchBundles() {
  loading.value = true;
  try {
    const res = await fetch(`${SERVER}/api/bundles`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    const data = await res.json();
    if (data.success) bundles.value = data.bundles;
    else ElMessage.error(data.message);
  } catch {
    ElMessage.error("加载问卷组合失败，请检查后端服务");
  } finally {
    loading.value = false;
  }
}

function openLink(b) {
  linkBundle.value = b;
  showLink.value = true;
}

async function exportBundle(b) {
  exportingId.value = b.id;
  try {
    const res = await fetch(`${SERVER}/api/bundles/${b.id}/export`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${b.title}_组合数据.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    ElMessage.error("导出失败，请检查后端服务");
  } finally {
    exportingId.value = null;
  }
}

async function removeBundle(b) {
  try {
    await ElMessageBox.confirm(
      `确认删除组合「${b.title}」？组合里的问卷不会被删除。`,
      "删除组合",
      { type: "warning" },
    );
  } catch {
    return;
  }
  const res = await fetch(`${SERVER}/api/bundles/${b.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token()}` },
  });
  const data = await res.json();
  if (data.success) {
    ElMessage.success("已删除");
    fetchBundles();
  } else {
    ElMessage.warning(data.message);
  }
}

onMounted(fetchBundles);
</script>

<template>
  <div>
    <div class="toolbar">
      <h2>问卷组合</h2>
      <el-button type="primary" @click="router.push('/bundle/new')"
        >新建组合</el-button
      >
    </div>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="intro"
      title="把几份问卷组合成一个链接：受测者只扫一次码、只填一次基本信息，就能依次答完所有问卷。"
      description="每份问卷的数据仍然记在它自己名下，统计分析、导出数据照常使用；在这里还可以导出「每人一行、几份问卷得分并排」的汇总表，方便做相关、回归分析。"
    />

    <el-table :data="bundles" v-loading="loading" style="width: 100%">
      <el-table-column label="组合名称" min-width="160">
        <template #default="{ row }">
          <el-link type="primary" @click="router.push(`/bundle/${row.id}`)">{{
            row.title
          }}</el-link>
          <el-tag v-if="row.shuffle" size="small" type="info" class="ml"
            >随机顺序</el-tag
          >
        </template>
      </el-table-column>
      <el-table-column label="包含的问卷（按作答顺序）" min-width="240">
        <template #default="{ row }">
          <div class="q-tags">
            <el-tag
              v-for="(q, i) in row.questionnaires"
              :key="q.id"
              size="small"
              effect="plain"
              >{{ i + 1 }}. {{ q.title }}（{{ q.question_count }} 题）</el-tag
            >
          </div>
        </template>
      </el-table-column>
      <el-table-column label="参与人数" width="120">
        <template #default="{ row }">
          <span class="count">{{ row.participants }}</span>
          <span class="muted"> 人，{{ row.completed }} 人全部完成</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="80">
        <template #default="{ row }">
          <el-tag :type="row.is_active ? 'success' : 'info'" size="small">{{
            row.is_active ? "开放" : "已关闭"
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="300">
        <template #default="{ row }">
          <div class="actions">
            <el-button size="small" @click="router.push(`/bundle/${row.id}`)"
              >编辑</el-button
            >
            <el-button size="small" type="success" plain @click="openLink(row)"
              >生成链接</el-button
            >
            <el-button
              size="small"
              type="primary"
              plain
              :loading="exportingId === row.id"
              @click="exportBundle(row)"
              >导出数据</el-button
            >
            <el-button
              size="small"
              type="danger"
              text
              @click="removeBundle(row)"
              >删除</el-button
            >
          </div>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty description="还没有问卷组合，点右上角「新建组合」" />
      </template>
    </el-table>

    <ShareLinkDialog
      v-if="linkBundle"
      v-model="showLink"
      :path="`/b/${linkBundle.id}`"
      :file-name="linkBundle.title"
      title="生成组合链接"
    />
  </div>
</template>

<style scoped>
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
.intro {
  margin-bottom: 16px;
}
.q-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.ml {
  margin-left: 6px;
}
.count {
  font-weight: 600;
  color: #3d2b12;
}
.muted {
  font-size: 12px;
  color: #999;
}
.actions {
  display: flex;
  gap: 6px;
  align-items: center;
}
</style>
