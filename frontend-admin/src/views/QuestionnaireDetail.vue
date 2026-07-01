<script setup>
import { ElMessage } from "element-plus";
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();
const questionnaireId = route.params.id;

const questionnaire = ref(null);
const questions = ref([]);
const loading = ref(true);

const exporting = ref(false);

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

    // 把响应转成blob，触发浏览器下载
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `作答数据.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    ElMessage.success("导出成功");
  } catch (err) {
    ElMessage.error("导出失败，请检查后端服务");
  } finally {
    exporting.value = false;
  }
}

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

onMounted(fetchDetail);

function goImport() {
  router.push(`/import?qid=${questionnaireId}`);
}
function backToList() {
  router.push("/");
}
</script>

<template>
  <div class="container" v-loading="loading">
    <el-button @click="backToList" text>← 返回问卷列表</el-button>

    <template v-if="questionnaire">
      <div class="header">
        <h2>{{ questionnaire.title }}</h2>
        <div style="display: flex; gap: 10px">
          <el-button type="success" @click="exportData" :loading="exporting"
            >导出作答数据</el-button
          >
          <el-button type="primary" @click="goImport">导入更多题目</el-button>
        </div>
      </div>
      <p class="desc">{{ questionnaire.description || "暂无说明" }}</p>

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

      <el-table
        :data="questions"
        style="margin-top: 20px"
        v-if="questions.length > 0"
      >
        <el-table-column prop="order_num" label="序号" width="70" />
        <el-table-column prop="content" label="题目内容" />
        <el-table-column label="分值范围" width="110">
          <template #default="scope"
            >{{ scope.row.min_score }} - {{ scope.row.max_score }}</template
          >
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

      <el-empty v-else description="这份问卷还没有题目，点击右上角导入题目" />
    </template>
  </div>
</template>

<style scoped>
.container {
  max-width: 800px;
  margin: 20px auto;
  padding: 24px;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
}
.desc {
  color: #777;
  margin: 8px 0 16px;
}
.meta {
  display: flex;
  gap: 8px;
}
</style>
