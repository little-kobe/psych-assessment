<script setup>
import { ref } from "vue";

const answerValue = ref(null); // 用户选择的分数
const startTime = ref(null); // 题目展示时的时间戳
const submitted = ref(false); // 是否已提交
const resultMessage = ref("");

// 页面一加载就记录开始时间（相当于"看到题目"的那一刻）
startTime.value = Date.now();

async function submitAnswer() {
  if (!answerValue.value) {
    alert("请先选择一个答案");
    return;
  }

  const endTime = Date.now(); // 点击提交那一刻的时间戳

  const response = await fetch("http://localhost:3000/api/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      answer_value: answerValue.value,
      start_time: startTime.value,
      end_time: endTime,
    }),
  });

  const data = await response.json();
  submitted.value = true;
  resultMessage.value = `提交成功！本次作答用时 ${data.duration_ms} 毫秒`;
}
</script>

<template>
  <div class="container">
    <h2>心理测评 Demo</h2>
    <p class="question">你今天的心情如何？</p>

    <div class="options" v-if="!submitted">
      <label v-for="n in 5" :key="n">
        <input type="radio" :value="n" v-model="answerValue" />
        {{ n }} 分
      </label>
    </div>

    <button v-if="!submitted" @click="submitAnswer">提交</button>

    <p v-if="submitted" class="result">{{ resultMessage }}</p>
  </div>
</template>

<style scoped>
.container {
  max-width: 500px;
  margin: 60px auto;
  padding: 24px;
  font-family: sans-serif;
  text-align: center;
}
.question {
  font-size: 18px;
  margin-bottom: 20px;
}
.options label {
  display: block;
  margin: 10px 0;
  font-size: 16px;
}
button {
  margin-top: 20px;
  padding: 8px 24px;
  font-size: 16px;
  cursor: pointer;
}
.result {
  margin-top: 20px;
  color: green;
  font-weight: bold;
}
</style>
