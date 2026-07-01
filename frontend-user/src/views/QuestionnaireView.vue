<script setup>
import { ref, onMounted, computed } from "vue";

import { useRoute } from "vue-router";
const route = useRoute();
const questionnaireId = Number(route.params.id) || 1;
const questionnaire = ref(null);
const questions = ref([]);
const answersMap = ref({});
const questionStartTimes = ref({});
const consented = ref(false); // 是否已阅读并同意知情同意书
const submitted = ref(false);
const resultMessage = ref("");
const loading = ref(true);
const overallStartTime = ref(null);
const currentIndex = ref(0); // 当前展示第几题，逐题展示

const currentQuestion = computed(() => questions.value[currentIndex.value]);
const progressPercent = computed(() => {
  if (questions.value.length === 0) return 0;
  return Math.round((currentIndex.value / questions.value.length) * 100);
});
const isLastQuestion = computed(
  () => currentIndex.value === questions.value.length - 1,
);
const currentAnswer = computed(() =>
  currentQuestion.value ? answersMap.value[currentQuestion.value.id] : null,
);

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
      if (data.questions.length > 0) {
        questionStartTimes.value[data.questions[0].id] = Date.now();
      }
    }
  } catch (err) {
    console.error("获取问卷失败:", err);
  } finally {
    loading.value = false;
  }
});

function selectAnswer(value) {
  answersMap.value[currentQuestion.value.id] = value;
}

function nextQuestion() {
  if (currentAnswer.value === undefined || currentAnswer.value === null) return;

  if (isLastQuestion.value) {
    submitQuestionnaire();
  } else {
    currentIndex.value++;
    const nextQ = questions.value[currentIndex.value];
    questionStartTimes.value[nextQ.id] = Date.now();
  }
}

function prevQuestion() {
  if (currentIndex.value > 0) currentIndex.value--;
}

async function submitQuestionnaire() {
  const finishedAt = Date.now();

  const answers = questions.value.map((q) => {
    const startTime = questionStartTimes.value[q.id] || overallStartTime.value;
    return {
      question_id: q.id,
      answer_value: answersMap.value[q.id],
      duration_ms: finishedAt - startTime,
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
    resultMessage.value = "感谢你完成本次测评";
  }
}
</script>

<template>
  <div class="page">
    <svg
      class="bg-art"
      viewBox="0 0 800 600"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#EAF6F0" />
          <stop offset="100%" stop-color="#F4FBF6" />
        </linearGradient>
      </defs>
      <rect width="800" height="600" fill="url(#skyGrad)" />
      <!-- gentle hill silhouette -->
      <path
        d="M0,460 C150,400 300,440 450,400 C600,360 700,420 800,390 L800,600 L0,600 Z"
        fill="#DCEFE0"
      />
      <path
        d="M0,510 C180,470 350,500 500,470 C650,440 720,480 800,460 L800,600 L0,600 Z"
        fill="#CDE8D4"
      />
      <!-- floating leaves -->
      <g fill="#8FC9A0" opacity="0.5">
        <ellipse cx="90" cy="90" rx="10" ry="5" transform="rotate(30 90 90)" />
        <ellipse
          cx="720"
          cy="130"
          rx="12"
          ry="6"
          transform="rotate(-20 720 130)"
        />
        <ellipse cx="660" cy="60" rx="8" ry="4" transform="rotate(50 660 60)" />
      </g>
    </svg>

    <div class="content" v-loading="loading">
      <div v-if="loading" class="loading">正在加载问卷...</div>

      <div v-else-if="!questionnaire" class="error-state">
        问卷加载失败，请检查后端服务
      </div>

      <div v-else-if="!consented" class="consent-card">
        <div class="consent-header">
          <div class="consent-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path
                d="M9 12l2 2 4-4"
                stroke="#4CAF7D"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <circle
                cx="12"
                cy="12"
                r="9"
                stroke="#4CAF7D"
                stroke-width="1.5"
              />
            </svg>
          </div>
          <h2>{{ questionnaire.title }}</h2>
          <p class="consent-subtitle">参与前请阅读以下说明</p>
        </div>

        <div class="consent-body">
          <p v-if="questionnaire.consent_text" class="consent-text">
            {{ questionnaire.consent_text }}
          </p>
          <p v-else class="consent-text default-text">
            本问卷用于学术研究目的，所有回答数据将严格保密，仅用于统计分析，不会与您的个人身份挂钩。参与本问卷完全出于自愿，您可以随时退出。
          </p>

          <div class="consent-points">
            <div class="point">
              <span class="point-dot"></span>
              <span>数据匿名保存，不记录个人身份</span>
            </div>
            <div class="point">
              <span class="point-dot"></span>
              <span>仅用于学术统计分析</span>
            </div>
            <div class="point">
              <span class="point-dot"></span>
              <span>参与完全自愿，可随时退出</span>
            </div>
          </div>
        </div>

        <button class="consent-btn" @click="consented = true">
          我已阅读并同意，开始作答
        </button>
      </div>

      <div v-else-if="!submitted" class="quiz-card">
        <div class="quiz-header">
          <h1>{{ questionnaire.title }}</h1>
          <p v-if="questionnaire.description" class="quiz-desc">
            {{ questionnaire.description }}
          </p>
        </div>

        <div class="progress-track">
          <div
            class="progress-fill"
            :style="{ width: progressPercent + '%' }"
          ></div>
        </div>
        <p class="progress-label">
          第 {{ currentIndex + 1 }} 题 / 共 {{ questions.length }} 题
        </p>

        <div class="question-area" v-if="currentQuestion">
          <p class="question-text">{{ currentQuestion.content }}</p>

          <div class="options">
            <button
              v-for="n in currentQuestion.max_score -
              currentQuestion.min_score +
              1"
              :key="n"
              class="option-btn"
              :class="{
                active: currentAnswer === currentQuestion.min_score + n - 1,
              }"
              @click="selectAnswer(currentQuestion.min_score + n - 1)"
            >
              {{ currentQuestion.min_score + n - 1 }}
            </button>
          </div>
          <div class="option-labels">
            <span>较低</span>
            <span>较高</span>
          </div>
        </div>

        <div class="nav-buttons">
          <button
            class="nav-btn secondary"
            @click="prevQuestion"
            :disabled="currentIndex === 0"
          >
            上一题
          </button>
          <button
            class="nav-btn primary"
            @click="nextQuestion"
            :disabled="currentAnswer === undefined || currentAnswer === null"
          >
            {{ isLastQuestion ? "提交问卷" : "下一题" }}
          </button>
        </div>
      </div>

      <div v-else class="result-card">
        <div class="result-icon">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="#4CAF7D"
              stroke-width="1.5"
            />
            <path
              d="M7 12l3 3 7-7"
              stroke="#4CAF7D"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              fill="none"
            />
          </svg>
        </div>
        <h2>{{ resultMessage }}</h2>
        <p class="result-sub">你的回答已安全提交，所有信息将匿名保存。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.bg-art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
}
.content {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 520px;
  padding: 24px;
}
.loading,
.error-state {
  text-align: center;
  color: #5a7a64;
  font-size: 15px;
}

.quiz-card {
  background: rgba(255, 255, 255, 0.9);
  border-radius: 20px;
  padding: 32px 28px;
  box-shadow: 0 16px 40px rgba(76, 175, 125, 0.12);
}
.quiz-header h1 {
  font-size: 19px;
  font-weight: 600;
  color: #2e4a38;
  margin: 0 0 6px;
}
.quiz-desc {
  font-size: 13px;
  color: #7a9685;
  margin: 0 0 20px;
}

.progress-track {
  height: 6px;
  background: #e3f1e6;
  border-radius: 4px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #6fcf97, #4caf7d);
  border-radius: 4px;
  transition: width 0.3s ease;
}
.progress-label {
  font-size: 12px;
  color: #8aaa94;
  margin: 8px 0 28px;
}

.question-area {
  margin-bottom: 32px;
}
.question-text {
  font-size: 17px;
  font-weight: 500;
  color: #2e4a38;
  line-height: 1.6;
  margin: 0 0 24px;
  min-height: 52px;
}

.options {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.option-btn {
  flex: 1;
  height: 52px;
  border: 1.5px solid #dcefe0;
  background: #fff;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 500;
  color: #5a7a64;
  cursor: pointer;
  transition: all 0.15s ease;
}
.option-btn:hover {
  border-color: #9ed9b2;
}
.option-btn.active {
  background: linear-gradient(135deg, #6fcf97, #4caf7d);
  border-color: #4caf7d;
  color: white;
  transform: scale(1.05);
}
.option-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 12px;
  color: #9cb8a6;
}

.nav-buttons {
  display: flex;
  gap: 12px;
}
.nav-btn {
  flex: 1;
  height: 46px;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: opacity 0.2s;
}
.nav-btn.secondary {
  background: #f0f7f2;
  color: #5a7a64;
}
.nav-btn.primary {
  background: linear-gradient(135deg, #6fcf97, #4caf7d);
  color: white;
}
.nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.result-card {
  background: rgba(255, 255, 255, 0.92);
  border-radius: 20px;
  padding: 48px 32px;
  text-align: center;
  box-shadow: 0 16px 40px rgba(76, 175, 125, 0.12);
}
.result-icon {
  margin-bottom: 16px;
}
.result-card h2 {
  font-size: 18px;
  color: #2e4a38;
  margin: 0 0 8px;
}
.result-sub {
  font-size: 13px;
  color: #8aaa94;
  margin: 0;
}

.consent-card {
  background: rgba(255, 255, 255, 0.92);
  border-radius: 20px;
  padding: 36px 28px;
  box-shadow: 0 16px 40px rgba(76, 175, 125, 0.12);
}
.consent-header {
  text-align: center;
  margin-bottom: 24px;
}
.consent-icon {
  margin-bottom: 12px;
}
.consent-header h2 {
  font-size: 20px;
  font-weight: 600;
  color: #2e4a38;
  margin: 0 0 4px;
}
.consent-subtitle {
  font-size: 13px;
  color: #8aaa94;
  margin: 0;
}
.consent-body {
  background: #f4fbf6;
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 24px;
}
.consent-text {
  font-size: 14px;
  color: #3d5a48;
  line-height: 1.8;
  margin: 0 0 16px;
}
.default-text {
  font-style: italic;
}
.consent-points {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.point {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #5a7a64;
}
.point-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #4caf7d;
  flex-shrink: 0;
}
.consent-btn {
  width: 100%;
  height: 48px;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, #6fcf97, #4caf7d);
  color: white;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}
.consent-btn:hover {
  opacity: 0.9;
}
</style>
