<script setup>
import { ref } from "vue";

const questionnaireId = ref(1); // 暂时手动填，对应要导入到哪份问卷
const selectedFile = ref(null);
const importing = ref(false);
const resultInfo = ref(null);

function handleFileChange(event) {
  selectedFile.value = event.target.files[0];
  resultInfo.value = null; // 重新选文件时清空上次的结果提示
}

async function uploadFile() {
  if (!selectedFile.value) {
    alert("请先选择一个Excel文件");
    return;
  }

  importing.value = true;
  resultInfo.value = null;

  // 文件上传必须用FormData格式，不能像之前那样直接用JSON.stringify
  const formData = new FormData();
  formData.append("file", selectedFile.value);
  formData.append("questionnaire_id", questionnaireId.value);

  try {
    const response = await fetch("http://localhost:3000/api/questions/import", {
      method: "POST",
      body: formData,
      // 注意：用FormData时不要手动设置Content-Type，浏览器会自动处理
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
</script>

<template>
  <div class="container">
    <h2>批量导入题目</h2>

    <div class="form-row">
      <label>目标问卷ID：</label>
      <input type="number" v-model="questionnaireId" />
    </div>

    <div class="form-row">
      <label>选择Excel文件：</label>
      <input type="file" accept=".xlsx,.xls" @change="handleFileChange" />
    </div>

    <button @click="uploadFile" :disabled="importing">
      {{ importing ? "导入中..." : "开始导入" }}
    </button>

    <div
      v-if="resultInfo"
      class="result-box"
      :class="{ error: !resultInfo.success }"
    >
      <p>{{ resultInfo.message }}</p>
      <p v-if="resultInfo.errors && resultInfo.errors.length > 0">
        以下行有问题：<br />
        <span v-for="(e, i) in resultInfo.errors" :key="i">{{ e }}<br /></span>
      </p>
    </div>
  </div>
</template>

<style scoped>
.container {
  max-width: 500px;
  margin: 40px auto;
  padding: 24px;
  font-family: sans-serif;
}
.form-row {
  margin-bottom: 16px;
}
.form-row label {
  display: inline-block;
  width: 110px;
}
.form-row input[type="number"] {
  width: 80px;
}
button {
  padding: 8px 24px;
  font-size: 16px;
  cursor: pointer;
}
.result-box {
  margin-top: 20px;
  padding: 12px;
  background: #e8f5e9;
  border-radius: 4px;
}
.result-box.error {
  background: #ffebee;
}
</style>
