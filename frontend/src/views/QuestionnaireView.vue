<script setup>
import { ref, onMounted } from "vue";

const questionnaireId = 1; // 暂时写死，对应你在Navicat里插入的那份测试问卷id
const questionnaire = ref(null); // 问卷基本信息
const questions = ref([]); // 题目列表
const answersMap = ref({}); // 存每道题当前选的分数，key是题目id
const questionStartTimes = ref({}); // 存每道题"开始看到"的时间戳，key是题目id
const submitted = ref(false);
const resultMessage = ref("");
const loading = ref(true);
const overallStartTime = ref(null); // 整份问卷开始作答的时间

// 页面一加载，就去后端请求这份问卷的题目
onMounted(async () => {
  try {
    const response = await fetch(
      `http://localhost:3000/api/questionnaire/${questionnaireId}`,
    );
    const data = await response.json();

    if (data.success) {
      questionnaire.value = data.questionnaire;
      questions.value = data.questions;
      overallStartTime.value = Date.now();

      // 给每道题都记录一个初始的"开始时间"，等用户真正点击选项时再更新成更精确的值
      data.questions.forEach((q) => {
        questionStartTimes.value[q.id] = Date.now();
      });
    }
  } catch (err) {
    console.error("获取问卷失败:", err);
  } finally {
    loading.value = false;
  }
});

// 用户选择某道题的分数时触发
function selectAnswer(questionId, value) {
  answersMap.value[questionId] = value;
}

async function submitQuestionnaire() {
  // 检查是否所有题目都已作答
  const unanswered = questions.value.filter((q) => !answersMap.value[q.id]);
  if (unanswered.length > 0) {
    alert("还有题目未作答，请完成全部题目");
    return;
  }

  const finishedAt = Date.now();

  // 组装每道题的答案和耗时
  const answers = questions.value.map((q) => {
    const startTime = questionStartTimes.value[q.id];
    return {
      question_id: q.id,
      answer_value: answersMap.value[q.id],
      duration_ms: finishedAt - startTime, // 简化处理：从问卷整体开始到提交的耗时，按单题区分需要更精细的埋点，后续可优化
    };
  });

  const response = await fetch("http://localhost:3000/api/submission", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      questionnaire_id: questionnaireId,
      started_at: new Date(overallStartTime.value)
        .toISOString()
        .slice(0, 19)
        .replace("T", " "),
      finished_at: new Date(finishedAt)
        .toISOString()
        .slice(0, 19)
        .replace("T", " "),
      answers: answers,
    }),
  });

  const data = await response.json();
  if (data.success) {
    submitted.value = true;
    resultMessage.value = `提交成功！本次提交编号：${data.submission_id}`;
  } else {
    alert("提交失败，请重试");
  }
}
</script>

<template>
  <div class="container">
    <div v-if="loading">加载中...</div>

    <div v-else-if="!questionnaire">问卷加载失败，请检查后端是否启动</div>

    <div v-else-if="!submitted">
      <h2>{{ questionnaire.title }}</h2>
      <p class="desc">{{ questionnaire.description }}</p>

      <div v-for="(q, index) in questions" :key="q.id" class="question-block">
        <p class="question">{{ index + 1 }}. {{ q.content }}</p>
        <div class="options">
          <label v-for="n in q.max_score - q.min_score + 1" :key="n">
            <input
              type="radio"
              :name="'q_' + q.id"
              :value="q.min_score + n - 1"
              :checked="answersMap[q.id] === q.min_score + n - 1"
              @change="selectAnswer(q.id, q.min_score + n - 1)"
            />
            {{ q.min_score + n - 1 }} 分
          </label>
        </div>
      </div>

      <button @click="submitQuestionnaire">提交问卷</button>
    </div>

    <p v-else class="result">{{ resultMessage }}</p>
  </div>
</template>

<style scoped>
.container {
  max-width: 600px;
  margin: 40px auto;
  padding: 24px;
  font-family: sans-serif;
}
.desc {
  color: #666;
  margin-bottom: 24px;
}
.question-block {
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid #eee;
}
.question {
  font-size: 16px;
  margin-bottom: 12px;
  font-weight: bold;
}
.options label {
  display: inline-block;
  margin-right: 16px;
  font-size: 14px;
}
button {
  margin-top: 16px;
  padding: 10px 32px;
  font-size: 16px;
  cursor: pointer;
}
.result {
  text-align: center;
  margin-top: 60px;
  color: green;
  font-weight: bold;
  font-size: 18px;
}
</style>
