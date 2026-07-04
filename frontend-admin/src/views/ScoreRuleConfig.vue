<script setup>
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";

const route = useRoute();
const router = useRouter();
const questionnaireId = route.params.id;

const rules = ref([]);
const loading = ref(true);
const saving = ref(false);

// 心理学常用分段预设（标签+颜色）
const presets = [
  { label: "正常", color: "#4CAF7D" },
  { label: "轻度", color: "#8BC34A" },
  { label: "中度", color: "#FFC107" },
  { label: "中重度", color: "#FF9800" },
  { label: "重度", color: "#F44336" },
  { label: "优秀", color: "#2196F3" },
  { label: "良好", color: "#4CAF7D" },
  { label: "一般", color: "#9E9E9E" },
  { label: "较差", color: "#FF9800" },
  { label: "低焦虑", color: "#4CAF7D" },
  { label: "中焦虑", color: "#FFC107" },
  { label: "高焦虑", color: "#F44336" },
];

function applyPreset(rule, preset) {
  rule.label = preset.label;
  rule.color = preset.color;
}

async function fetchRules() {
  const token = localStorage.getItem("admin_token");
  try {
    const res = await fetch(
      `http://localhost:3000/api/questionnaires/${questionnaireId}/score-rules`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await res.json();
    if (data.success)
      rules.value = data.rules.map((r) => ({
        ...r,
        visible_to_subject:
          r.visible_to_subject === 1 || r.visible_to_subject === true,
        color: r.color || "#4CAF7D",
      }));
  } catch (err) {
    ElMessage.error("加载失败");
  } finally {
    loading.value = false;
  }
}

function addRule() {
  rules.value.push({
    min_score: 0,
    max_score: 0,
    label: "",
    description: "",
    visible_to_subject: false,
    color: "#4CAF7D",
  });
}

function removeRule(index) {
  rules.value.splice(index, 1);
}

async function saveRules() {
  // 验证
  for (const r of rules.value) {
    if (!r.label) {
      ElMessage.warning("每个分数段都必须填写标签名称");
      return;
    }
    if (r.min_score > r.max_score) {
      ElMessage.warning(`"${r.label}"的分数段下限不能大于上限`);
      return;
    }
  }

  saving.value = true;
  const token = localStorage.getItem("admin_token");
  try {
    const res = await fetch(
      `http://localhost:3000/api/questionnaires/${questionnaireId}/score-rules`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ rules: rules.value }),
      },
    );
    const data = await res.json();
    if (data.success) {
      ElMessage.success("分数段配置保存成功");
      fetchRules();
    } else {
      ElMessage.error(data.message);
    }
  } catch (err) {
    ElMessage.error("保存失败");
  } finally {
    saving.value = false;
  }
}

onMounted(fetchRules);
</script>

<template>
  <div class="container" v-loading="loading">
    <el-button @click="router.push(`/questionnaire/${questionnaireId}`)" text
      >← 返回问卷详情</el-button
    >

    <div class="header">
      <h2>分数段报告配置</h2>
      <div style="display: flex; gap: 8px">
        <el-button @click="addRule">添加分数段</el-button>
        <el-button type="primary" @click="saveRules" :loading="saving"
          >保存配置</el-button
        >
      </div>
    </div>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom: 20px"
      description="根据受测者的总得分匹配对应的评价描述。可设置是否对受测者可见——开启后受测者提交问卷时会看到对应的评价；关闭则只有管理员在回答记录里能看到。"
    />

    <div v-if="rules.length === 0 && !loading">
      <el-empty
        description="还没有分数段配置，点击右上角「添加分数段」开始配置"
      >
        <el-button type="primary" @click="addRule">添加第一个分数段</el-button>
      </el-empty>
    </div>

    <div class="rules-list">
      <el-card v-for="(rule, index) in rules" :key="index" class="rule-card">
        <div class="rule-header">
          <span class="rule-index">分数段 {{ index + 1 }}</span>
          <el-button type="danger" size="small" text @click="removeRule(index)"
            >删除</el-button
          >
        </div>

        <el-form label-width="100px">
          <el-form-item label="分数范围">
            <div style="display: flex; align-items: center; gap: 8px">
              <el-input-number
                v-model="rule.min_score"
                :precision="1"
                style="width: 120px"
                placeholder="下限"
              />
              <span>至</span>
              <el-input-number
                v-model="rule.max_score"
                :precision="1"
                style="width: 120px"
                placeholder="上限"
              />
              <span style="font-size: 12px; color: #999">分（含两端）</span>
            </div>
          </el-form-item>

          <el-form-item label="分段标签">
            <div
              style="
                display: flex;
                flex-direction: column;
                gap: 10px;
                width: 100%;
              "
            >
              <!-- 预设快速选择 -->
              <div class="preset-row">
                <span style="font-size: 12px; color: #999; margin-right: 8px"
                  >预设：</span
                >
                <span
                  v-for="p in presets"
                  :key="p.label"
                  class="preset-tag"
                  :style="{
                    background: p.color + '22',
                    color: p.color,
                    borderColor: p.color + '66',
                  }"
                  @click="applyPreset(rule, p)"
                  >{{ p.label }}</span
                >
              </div>

              <!-- 自定义标签名+颜色 -->
              <div style="display: flex; align-items: center; gap: 10px">
                <el-input
                  v-model="rule.label"
                  placeholder="自定义标签名"
                  style="max-width: 180px"
                />
                <span style="font-size: 13px; color: #888">颜色：</span>
                <el-color-picker v-model="rule.color" show-alpha />
                <!-- 预览效果 -->
                <span
                  v-if="rule.label"
                  class="label-preview"
                  :style="{
                    background: (rule.color || '#4CAF7D') + '22',
                    color: rule.color || '#4CAF7D',
                    borderColor: (rule.color || '#4CAF7D') + '66',
                  }"
                  >{{ rule.label }}</span
                >
              </div>
            </div>
          </el-form-item>

          <el-form-item label="评价描述">
            <el-input
              v-model="rule.description"
              type="textarea"
              :rows="3"
              placeholder="对该分数段的详细说明，如干预建议、解释说明等"
            />
          </el-form-item>

          <el-form-item label="对受测者可见">
            <el-switch
              v-model="rule.visible_to_subject"
              active-text="提交后展示给受测者"
              inactive-text="仅管理员可见"
            />
          </el-form-item>
        </el-form>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.preset-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.preset-tag {
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  border: 1px solid;
  cursor: pointer;
  transition: opacity 0.15s;
}
.preset-tag:hover {
  opacity: 0.75;
}
.label-preview {
  padding: 3px 14px;
  border-radius: 14px;
  font-size: 13px;
  font-weight: 600;
  border: 1px solid;
}

.container {
  max-width: 760px;
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
.rules-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.rule-card {
  border: 1px solid #f0dcae;
}
.rule-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.rule-index {
  font-weight: 600;
  color: #8b5a2b;
  font-size: 14px;
}
</style>
