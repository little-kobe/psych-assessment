<script setup>
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";

const route = useRoute();
const router = useRouter();
const questionnaireId = route.params.id;

const questions = ref([]);
const dimensions = ref([]);
const loading = ref(true);
const saving = ref(false);

async function fetchData() {
  const token = localStorage.getItem("admin_token");
  try {
    // 获取题目列表
    const qRes = await fetch(
      `http://localhost:3000/api/questionnaires/${questionnaireId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const qData = await qRes.json();
    if (qData.success) questions.value = qData.questions;

    // 获取现有维度配置
    const dRes = await fetch(
      `http://localhost:3000/api/questionnaires/${questionnaireId}/dimensions`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const dData = await dRes.json();
    if (dData.success) {
      dimensions.value = dData.dimensions.map((d) => ({
        name: d.name,
        description: d.description || "",
        score_formula: d.score_formula || "sum",
        question_ids: d.questions.map((q) => q.id),
      }));
    }
  } catch (err) {
    ElMessage.error("加载数据失败");
  } finally {
    loading.value = false;
  }
}

function addDimension() {
  dimensions.value.push({
    name: "",
    description: "",
    score_formula: "sum",
    question_ids: [],
  });
}

function removeDimension(index) {
  dimensions.value.splice(index, 1);
}

async function saveDimensions() {
  // 验证每个维度都有名称
  for (const dim of dimensions.value) {
    if (!dim.name) {
      ElMessage.warning("维度名称不能为空");
      return;
    }
    if (dim.question_ids.length === 0) {
      ElMessage.warning(`维度"${dim.name}"还没有选择题目`);
      return;
    }
  }

  saving.value = true;
  const token = localStorage.getItem("admin_token");
  try {
    const response = await fetch(
      `http://localhost:3000/api/questionnaires/${questionnaireId}/dimensions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ dimensions: dimensions.value }),
      },
    );
    const data = await response.json();
    if (data.success) {
      ElMessage.success("维度配置保存成功");
    } else {
      ElMessage.error(data.message);
    }
  } catch (err) {
    ElMessage.error("保存失败，请检查后端服务");
  } finally {
    saving.value = false;
  }
}

function goBack() {
  router.push(`/questionnaire/${questionnaireId}`);
}

onMounted(fetchData);
</script>

<template>
  <div class="container" v-loading="loading">
    <el-button @click="goBack" text>← 返回问卷详情</el-button>

    <div class="header">
      <h2>维度计分配置</h2>
      <div style="display: flex; gap: 8px">
        <el-button @click="addDimension">添加维度</el-button>
        <el-button type="primary" @click="saveDimensions" :loading="saving"
          >保存配置</el-button
        >
      </div>
    </div>

    <el-alert
      title="配置说明"
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom: 20px"
      description="为每个维度选择对应的题目，系统会自动处理反向计分并按选择的公式计算维度得分。反向计分在题目导入时已标记，无需在这里重复设置。"
    />

    <div v-if="dimensions.length === 0" style="margin: 40px 0">
      <el-empty description="还没有配置维度，点击右上角「添加维度」开始配置">
        <el-button type="primary" @click="addDimension"
          >添加第一个维度</el-button
        >
      </el-empty>
    </div>

    <div class="dimensions-list">
      <el-card
        v-for="(dim, index) in dimensions"
        :key="index"
        class="dimension-card"
      >
        <div class="dim-header">
          <span class="dim-index">维度 {{ index + 1 }}</span>
          <el-button
            type="danger"
            size="small"
            text
            @click="removeDimension(index)"
            >删除</el-button
          >
        </div>

        <el-form label-width="80px">
          <el-form-item label="维度名称">
            <el-input v-model="dim.name" placeholder="如：躯体化、焦虑、抑郁" />
          </el-form-item>
          <el-form-item label="计分方式">
            <el-radio-group v-model="dim.score_formula">
              <el-radio value="sum">求和（各题分数相加）</el-radio>
              <el-radio value="mean">取均值（各题分数取平均）</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="包含题目">
            <el-checkbox-group v-model="dim.question_ids">
              <div class="question-list">
                <el-checkbox
                  v-for="q in questions"
                  :key="q.id"
                  :value="q.id"
                  class="question-item"
                >
                  第{{ q.order_num }}题：{{ q.content }}
                  <el-tag
                    v-if="q.is_reverse_scored"
                    type="warning"
                    size="small"
                    style="margin-left: 6px"
                    >反向</el-tag
                  >
                </el-checkbox>
              </div>
            </el-checkbox-group>
          </el-form-item>
        </el-form>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.container {
  max-width: 860px;
  margin: 20px auto;
  padding: 24px;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 16px 0 20px;
}
.header h2 {
  margin: 0;
  font-size: 20px;
  color: #3d2b12;
}
.dimensions-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.dimension-card {
  border: 1px solid #f0dcae;
}
.dim-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.dim-index {
  font-weight: 600;
  color: #8b5a2b;
  font-size: 14px;
}
.question-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 280px;
  overflow-y: auto;
  padding: 8px;
  background: #fafafa;
  border-radius: 6px;
  border: 1px solid #eeeeee;
}
.question-item {
  align-items: flex-start;
  line-height: 1.5;
  white-space: normal;
  height: auto;
}
</style>
