<script setup>
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();

const questionnaireId = ref(Number(route.query.qid) || 1);
const selectedFile = ref(null);
const importing = ref(false);
const resultInfo = ref(null);

function handleFileChange(event) {
  selectedFile.value = event.target.files[0];
  resultInfo.value = null;
}

async function uploadFile() {
  if (!selectedFile.value) {
    alert("请先选择一个Excel文件");
    return;
  }

  importing.value = true;
  resultInfo.value = null;

  const formData = new FormData();
  formData.append("file", selectedFile.value);
  formData.append("questionnaire_id", questionnaireId.value);

  try {
    const response = await fetch("http://localhost:3000/api/questions/import", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    resultInfo.value = data;
  } catch (err) {
    resultInfo.value = {
      success: false,
      message: "上传失败，请检查后端服务是否启动",
    };
  } finally {
    importing.value = false;
  }
}

function backToList() {
  router.push("/");
}
</script>

<template>
  <div class="container">
    <el-button @click="backToList" text>← 返回问卷列表</el-button>

    <h2>批量导入题目</h2>

    <div class="form-row">
      <label>目标问卷ID：</label>
      <el-input-number v-model="questionnaireId" :min="1" />
    </div>

    <div class="form-row">
      <label>选择Excel文件：</label>
      <input type="file" accept=".xlsx,.xls" @change="handleFileChange" />
    </div>

    <el-button type="primary" @click="uploadFile" :loading="importing">
      {{ importing ? "导入中..." : "开始导入" }}
    </el-button>

    <el-alert
      v-if="resultInfo"
      :title="resultInfo.message"
      :type="resultInfo.success ? 'success' : 'error'"
      :closable="false"
      show-icon
      style="margin-top: 20px"
    >
      <div v-if="resultInfo.errors && resultInfo.errors.length > 0">
        以下行有问题：
        <div v-for="(e, i) in resultInfo.errors" :key="i">{{ e }}</div>
      </div>
    </el-alert>
  </div>
</template>

<style scoped>
.container {
  max-width: 500px;
  margin: 20px auto;
  padding: 24px;
}
.form-row {
  margin: 20px 0;
  display: flex;
  align-items: center;
  gap: 12px;
}
.form-row label {
  width: 110px;
}
</style>
