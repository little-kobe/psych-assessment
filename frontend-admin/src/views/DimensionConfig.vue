<script setup>
import { ref, onMounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";

const route = useRoute();
const router = useRouter();
const questionnaireId = route.params.id;

const questions = ref([]);
const dimensions = ref([]);
const loading = ref(true);
const saving = ref(false);
const searchKeyword = ref("");

const filteredQuestions = computed(() => {
  if (!searchKeyword.value) return questions.value;
  return questions.value.filter(
    (q) =>
      q.content.includes(searchKeyword.value) ||
      String(q.order_num).includes(searchKeyword.value),
  );
});

async function fetchData() {
  const token = localStorage.getItem("admin_token");
  try {
    const qRes = await fetch(
      `http://localhost:3000/api/questionnaires/${questionnaireId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const qData = await qRes.json();
    if (qData.success) questions.value = qData.questions;

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

// 全选：把当前搜索结果里所有题目都加进这个维度
function selectAll(dim) {
  const filtered = filteredQuestions.value.map((q) => q.id);
  const existing = new Set(dim.question_ids);
  filtered.forEach((id) => existing.add(id));
  dim.question_ids = Array.from(existing);
}

// 全不选：把当前搜索结果里的题目从这个维度里移除
function selectNone(dim) {
  const filtered = new Set(filteredQuestions.value.map((q) => q.id));
  dim.question_ids = dim.question_ids.filter((id) => !filtered.has(id));
}

// 反选：搜索结果里已选的取消、未选的添加
function invertSelection(dim) {
  const filtered = filteredQuestions.value.map((q) => q.id);
  const selected = new Set(dim.question_ids);
  filtered.forEach((id) => {
    if (selected.has(id)) {
      selected.delete(id);
    } else {
      selected.add(id);
    }
  });
  dim.question_ids = Array.from(selected);
}

// 某个维度的已选数量（基于当前搜索结果）
function selectedCount(dim) {
  const filtered = new Set(filteredQuestions.value.map((q) => q.id));
  return dim.question_ids.filter((id) => filtered.has(id)).length;
}

async function saveDimensions() {
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
      description="为每个维度选择对应的题目，系统会自动处理反向计分并按选择的公式计算维度得分。可以用搜索框快速筛选题目，再用全选/反选批量操作。"
    />

    <!-- 全局题目搜索框 -->
    <div class="search-bar">
      <el-input
        v-model="searchKeyword"
        placeholder="搜索题目内容或题号，快速定位"
        clearable
        prefix-icon="Search"
        style="max-width: 360px"
      />
      <span class="search-hint">
        显示 {{ filteredQuestions.length }} / {{ questions.length }} 道题
      </span>
    </div>

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
            <!-- 批量操作工具栏 -->
            <div class="batch-toolbar">
              <span class="selected-hint">
                已选 {{ selectedCount(dim) }} /
                {{ filteredQuestions.length }} 道
                <template
                  v-if="dim.question_ids.length > filteredQuestions.length"
                >
                  （含搜索范围外
                  {{ dim.question_ids.length - selectedCount(dim) }} 道）
                </template>
              </span>
              <div class="batch-btns">
                <el-button size="small" @click="selectAll(dim)">全选</el-button>
                <el-button size="small" @click="selectNone(dim)"
                  >全不选</el-button
                >
                <el-button size="small" @click="invertSelection(dim)"
                  >反选</el-button
                >
              </div>
            </div>

            <el-checkbox-group v-model="dim.question_ids">
              <div class="question-list">
                <el-checkbox
                  v-for="q in filteredQuestions"
                  :key="q.id"
                  :value="q.id"
                  class="question-item"
                >
                  <span class="q-num">第{{ q.order_num }}题</span>
                  <span class="q-content">{{ q.content }}</span>
                  <el-tag
                    v-if="q.is_reverse_scored"
                    type="warning"
                    size="small"
                    style="margin-left: 6px; flex-shrink: 0"
                    >反向</el-tag
                  >
                </el-checkbox>

                <div v-if="filteredQuestions.length === 0" class="no-result">
                  没有匹配的题目
                </div>
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
.search-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}
.search-hint {
  font-size: 13px;
  color: #999;
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
.batch-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  padding: 6px 10px;
  background: #fff8e7;
  border-radius: 6px;
  border: 1px solid #f0dcae;
}
.selected-hint {
  font-size: 13px;
  color: #8b5a2b;
}
.batch-btns {
  display: flex;
  gap: 6px;
}
.question-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 320px;
  overflow-y: auto;
  padding: 10px;
  background: #fafafa;
  border-radius: 6px;
  border: 1px solid #eeeeee;
  width: 100%;
}
.question-item {
  display: flex;
  align-items: flex-start;
  height: auto;
  white-space: normal;
  padding: 4px 0;
}
.q-num {
  color: #8b5a2b;
  font-size: 12px;
  font-weight: 600;
  min-width: 52px;
  flex-shrink: 0;
}
.q-content {
  font-size: 13px;
  color: #3d2b12;
  line-height: 1.5;
}
.no-result {
  text-align: center;
  color: #aaa;
  font-size: 13px;
  padding: 20px 0;
}
</style>
