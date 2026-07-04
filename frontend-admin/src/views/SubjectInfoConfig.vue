<script setup>
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";

const route = useRoute();
const router = useRouter();
const questionnaireId = route.params.id;

const fields = ref([]);
const loading = ref(true);
const saving = ref(false);

// 预设常用字段
const presetFields = [
  {
    field_key: "gender",
    field_label: "性别",
    field_type: "radio",
    options: ["男", "女", "其他"],
    is_required: true,
  },
  {
    field_key: "age",
    field_label: "年龄",
    field_type: "number",
    options: null,
    is_required: true,
  },
  {
    field_key: "sport_years",
    field_label: "运动年限（年）",
    field_type: "number",
    options: null,
    is_required: true,
  },
  {
    field_key: "sport_type",
    field_label: "主要运动项目",
    field_type: "text",
    options: null,
    is_required: true,
  },
  {
    field_key: "sport_level",
    field_label: "运动水平",
    field_type: "radio",
    options: ["业余", "专业", "国家队"],
    is_required: true,
  },
  {
    field_key: "training_hours",
    field_label: "每周训练时长（小时）",
    field_type: "number",
    options: null,
    is_required: false,
  },
  {
    field_key: "education",
    field_label: "学历",
    field_type: "radio",
    options: ["初中及以下", "高中/中专", "大专", "本科", "硕士及以上"],
    is_required: false,
  },
  {
    field_key: "grade",
    field_label: "年级",
    field_type: "text",
    options: null,
    is_required: false,
  },
  {
    field_key: "school",
    field_label: "学校/单位",
    field_type: "text",
    options: null,
    is_required: false,
  },
];

const typeOptions = [
  { value: "text", label: "文本输入" },
  { value: "number", label: "数字输入" },
  { value: "radio", label: "单选按钮" },
  { value: "select", label: "下拉选择" },
];

async function fetchFields() {
  const token = localStorage.getItem("admin_token");
  try {
    const res = await fetch(
      `http://localhost:3000/api/questionnaires/${questionnaireId}/info-fields`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await res.json();
    if (data.success) {
      fields.value = data.fields.map((f) => ({
        ...f,
        options: f.options
          ? typeof f.options === "string"
            ? JSON.parse(f.options)
            : f.options
          : [],
        is_required: f.is_required === 1 || f.is_required === true,
      }));
    }
  } catch (err) {
    ElMessage.error("加载失败");
  } finally {
    loading.value = false;
  }
}

function addPreset(preset) {
  // 检查是否已添加过同一字段
  if (fields.value.find((f) => f.field_key === preset.field_key)) {
    ElMessage.warning(`"${preset.field_label}"已经添加过了`);
    return;
  }
  fields.value.push({
    ...preset,
    options: preset.options ? [...preset.options] : [],
  });
}

function addCustom() {
  fields.value.push({
    field_key: "custom_" + Date.now(),
    field_label: "",
    field_type: "text",
    options: [],
    is_required: true,
  });
}

function removeField(index) {
  fields.value.splice(index, 1);
}

function addOption(field) {
  if (!field.options) field.options = [];
  field.options.push("");
}

function removeOption(field, index) {
  field.options.splice(index, 1);
}

function moveUp(index) {
  if (index === 0) return;
  const arr = [...fields.value];
  [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
  fields.value = arr;
}

function moveDown(index) {
  if (index === fields.value.length - 1) return;
  const arr = [...fields.value];
  [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
  fields.value = arr;
}

async function saveFields() {
  for (const f of fields.value) {
    if (!f.field_label) {
      ElMessage.warning("字段显示名称不能为空");
      return;
    }
    if (
      ["radio", "select"].includes(f.field_type) &&
      (!f.options || f.options.length < 2)
    ) {
      ElMessage.warning(`"${f.field_label}"的单选/下拉类型至少需要2个选项`);
      return;
    }
  }

  saving.value = true;
  const token = localStorage.getItem("admin_token");
  try {
    const res = await fetch(
      `http://localhost:3000/api/questionnaires/${questionnaireId}/info-fields`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ fields: fields.value }),
      },
    );
    const data = await res.json();
    if (data.success) ElMessage.success("保存成功");
    else ElMessage.error(data.message);
  } catch (err) {
    ElMessage.error("保存失败");
  } finally {
    saving.value = false;
  }
}

onMounted(fetchFields);
</script>

<template>
  <div class="container" v-loading="loading">
    <el-button @click="router.push(`/questionnaire/${questionnaireId}`)" text
      >← 返回问卷详情</el-button
    >

    <div class="header">
      <h2>被试基本信息配置</h2>
      <el-button type="primary" @click="saveFields" :loading="saving"
        >保存配置</el-button
      >
    </div>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom: 20px"
      description="受测者填完知情同意后、正式答题前，会先填写这些基本信息。数据导出时会作为前几列出现在Excel中。"
    />

    <!-- 预设字段快速添加 -->
    <el-card class="preset-card">
      <div class="preset-title">预设字段（点击快速添加）</div>
      <div class="preset-list">
        <el-button
          v-for="p in presetFields"
          :key="p.field_key"
          size="small"
          @click="addPreset(p)"
          :disabled="!!fields.find((f) => f.field_key === p.field_key)"
          >{{ p.field_label }}</el-button
        >
      </div>
    </el-card>

    <div v-if="fields.length === 0 && !loading" style="margin: 20px 0">
      <el-empty description="还没有配置信息字段，从上方预设中选择或自定义添加">
        <el-button @click="addCustom">自定义添加</el-button>
      </el-empty>
    </div>

    <div class="fields-list">
      <el-card v-for="(field, index) in fields" :key="index" class="field-card">
        <div class="field-header">
          <span class="field-index">字段 {{ index + 1 }}</span>
          <div style="display: flex; gap: 6px">
            <el-button-group>
              <el-button
                size="small"
                :disabled="index === 0"
                @click="moveUp(index)"
                >↑</el-button
              >
              <el-button
                size="small"
                :disabled="index === fields.length - 1"
                @click="moveDown(index)"
                >↓</el-button
              >
            </el-button-group>
            <el-button
              type="danger"
              size="small"
              text
              @click="removeField(index)"
              >删除</el-button
            >
          </div>
        </div>

        <el-form label-width="90px">
          <el-form-item label="显示名称">
            <el-input
              v-model="field.field_label"
              placeholder="如：性别、年龄"
              style="max-width: 220px"
            />
          </el-form-item>
          <el-form-item label="字段类型">
            <el-select v-model="field.field_type" style="width: 160px">
              <el-option
                v-for="t in typeOptions"
                :key="t.value"
                :value="t.value"
                :label="t.label"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="是否必填">
            <el-switch v-model="field.is_required" />
          </el-form-item>
          <el-form-item
            v-if="['radio', 'select'].includes(field.field_type)"
            label="选项内容"
          >
            <div class="options-editor">
              <div
                v-for="(opt, i) in field.options"
                :key="i"
                class="option-row"
              >
                <el-input
                  v-model="field.options[i]"
                  :placeholder="`选项${i + 1}`"
                  style="max-width: 200px"
                />
                <el-button type="danger" text @click="removeOption(field, i)"
                  >删除</el-button
                >
              </div>
              <el-button size="small" @click="addOption(field)"
                >+ 添加选项</el-button
              >
            </div>
          </el-form-item>
        </el-form>
      </el-card>
    </div>

    <div style="margin-top: 16px">
      <el-button @click="addCustom">+ 自定义添加字段</el-button>
    </div>
  </div>
</template>

<style scoped>
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
.preset-card {
  margin-bottom: 20px;
  border: 1px solid #f0dcae;
}
.preset-title {
  font-size: 13px;
  color: #8b5a2b;
  margin-bottom: 10px;
  font-weight: 600;
}
.preset-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.fields-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
}
.field-card {
  border: 1px solid #f0dcae;
}
.field-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}
.field-index {
  font-weight: 600;
  color: #8b5a2b;
  font-size: 14px;
}
.options-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.option-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
