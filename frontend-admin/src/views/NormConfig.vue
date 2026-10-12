<script setup>
// 常模设置：录入量表手册 / 文献里的常模均值和标准差，可以按性别、年级等分成几套
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";

const SERVER = "http://localhost:3000";
const route = useRoute();
const router = useRouter();
const questionnaireId = route.params.id;

const loading = ref(true);
const saving = ref(false);
const questionnaire = ref(null);
const measures = ref([]); // [{ key: "total", name: "总分" }, { key: "dim3", name: "焦虑" }]
const infoFields = ref([]);
const norms = ref([]);
const normInReport = ref(false);

const token = () => localStorage.getItem("admin_token");

function blankValues() {
  const v = {};
  measures.value.forEach((m) => (v[m.key] = { mean: null, sd: null }));
  return v;
}

async function load() {
  try {
    const res = await fetch(
      `${SERVER}/api/questionnaires/${questionnaireId}/norms`,
      {
        headers: { Authorization: `Bearer ${token()}` },
      },
    );
    const data = await res.json();
    if (!data.success) {
      ElMessage.error(data.message);
      return;
    }
    questionnaire.value = data.questionnaire;
    measures.value = data.measures;
    infoFields.value = data.info_fields;
    normInReport.value = !!data.questionnaire.norm_in_report;
    norms.value = data.norms.map((n) => {
      const values = blankValues();
      Object.entries(n.values || {}).forEach(([k, v]) => {
        if (values[k]) values[k] = { mean: v.mean, sd: v.sd };
      });
      return {
        name: n.name,
        source: n.source || "",
        conditions: (n.conditions || []).map((c) => ({ ...c })),
        values,
      };
    });
  } catch {
    ElMessage.error("加载失败，请检查后端服务");
  } finally {
    loading.value = false;
  }
}

function addNorm() {
  norms.value.push({
    name: norms.value.length === 0 ? "常模" : "",
    source: "",
    conditions: [],
    values: blankValues(),
  });
}

async function removeNorm(i) {
  try {
    await ElMessageBox.confirm(
      `确认删除「${norms.value[i].name || "这套常模"}」？`,
      "删除常模",
      { type: "warning" },
    );
  } catch {
    return;
  }
  norms.value.splice(i, 1);
}

function fieldOf(key) {
  return infoFields.value.find((f) => f.field_key === key);
}

function addCondition(n) {
  const f = infoFields.value[0];
  n.conditions.push({
    field_key: f.field_key,
    op: f.field_type === "number" ? "range" : "eq",
    value: "",
    min: null,
    max: null,
  });
}

// 换了字段：数字字段用范围，其他用「等于」
function onFieldChange(c) {
  const f = fieldOf(c.field_key);
  c.op = f && f.field_type === "number" ? "range" : "eq";
  c.value = "";
  c.min = null;
  c.max = null;
}

// 每套常模适用人群的文字说明
function conditionSummary(n) {
  if (n.conditions.length === 0) return "所有人";
  return n.conditions
    .map((c) => {
      const label = fieldOf(c.field_key)?.field_label || c.field_key;
      if (c.op === "range") return `${label} ${c.min ?? ""}~${c.max ?? ""}`;
      return `${label}=${c.value || "?"}`;
    })
    .join("，并且 ");
}

const chartOff = computed(
  () => questionnaire.value && !questionnaire.value.show_report_chart,
);

async function save() {
  for (const [i, n] of norms.value.entries()) {
    if (!n.name.trim()) {
      ElMessage.warning(`第 ${i + 1} 套常模还没有填名称`);
      return;
    }
    // 每个指标的平均分和标准差要么都填，要么都不填；标准差要大于 0
    const blank = (x) => x === null || x === undefined || x === "";
    for (const m of measures.value) {
      const v = n.values[m.key];
      if (blank(v.mean) && blank(v.sd)) continue;
      if (blank(v.mean) || blank(v.sd) || !(Number(v.sd) > 0)) {
        ElMessage.warning(
          `「${n.name}」的「${m.name}」只填了一半，或标准差不大于 0`,
        );
        return;
      }
    }
    for (const c of n.conditions) {
      if (c.op === "eq" && !String(c.value || "").trim()) {
        ElMessage.warning(`「${n.name}」的适用条件还没有填完整`);
        return;
      }
      if (c.op === "range" && c.min === null && c.max === null) {
        ElMessage.warning(`「${n.name}」的范围条件至少要填一头`);
        return;
      }
    }
  }
  // 两套常模的适用条件完全一样时，只有排在前面的那套会被用到
  const keyOf = (n) =>
    JSON.stringify(
      n.conditions
        .map((c) =>
          c.op === "range"
            ? [c.field_key, "range", c.min ?? null, c.max ?? null]
            : [c.field_key, "eq", String(c.value || "").trim()],
        )
        .sort((a, b) => String(a).localeCompare(String(b))),
    );
  for (let i = 0; i < norms.value.length; i++) {
    for (let j = i + 1; j < norms.value.length; j++) {
      if (keyOf(norms.value[i]) === keyOf(norms.value[j])) {
        ElMessage.warning(
          `「${norms.value[i].name}」和「${norms.value[j].name}」的适用人群完全一样，只有前面那套会被用到，请删掉一套或修改条件`,
        );
        return;
      }
    }
  }
  saving.value = true;
  try {
    const res = await fetch(
      `${SERVER}/api/questionnaires/${questionnaireId}/norms`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token()}`,
        },
        body: JSON.stringify({
          norms: norms.value,
          norm_in_report: normInReport.value,
        }),
      },
    );
    const data = await res.json();
    if (data.success) ElMessage.success("常模已保存");
    else ElMessage.error(data.message);
  } catch {
    ElMessage.error("保存失败，请检查后端服务");
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="container" v-loading="loading">
    <el-button text @click="router.push(`/questionnaire/${questionnaireId}`)"
      >← 返回问卷详情</el-button
    >

    <div class="header">
      <div>
        <h2>常模设置</h2>
        <p class="sub" v-if="questionnaire">{{ questionnaire.title }}</p>
      </div>
      <div>
        <el-button @click="addNorm">添加一套常模</el-button>
        <el-button type="primary" :loading="saving" @click="save"
          >保存</el-button
        >
      </div>
    </div>

    <el-alert type="info" :closable="false" show-icon class="gap">
      <template #title
        >常模是参照人群的平均分和标准差，一般来自量表手册或文献。</template
      >
      <div class="alert-body">
        填好后：作答详情里会显示每个人的 T
        分和大约超过常模中百分之多少的人；统计分析页会把样本和常模做比较（单样本
        t 检验）；导出数据会多出 T 分列。<br />
        可以按性别、年级等分成几套。每个受测者按自己填的基本信息，自动用<b>条件最符合</b>的那一套；都不符合时用适用「所有人」的那一套，没有就不比较。<br />
        注意：常模的分数要和这里的计分方式一致（比如常模是总均分，总分就要设成「取平均」）。
      </div>
    </el-alert>

    <el-card shadow="never" class="card">
      <el-switch
        v-model="normInReport"
        active-text="在受测者的结果图表里显示常模平均（和「你的得分」「平均分」并排）"
      />
      <p v-if="chartOff" class="tip warn">
        这份问卷还没打开「结果图表」，受测者看不到图表。需要的话到问卷详情 →
        「编辑问卷」里打开。
      </p>
    </el-card>

    <p v-if="infoFields.length === 0" class="tip">
      这份问卷没有设置基本信息字段，只能录入适用「所有人」的常模。需要按性别、年级分开时，先到「基本信息」里添加字段。
    </p>

    <el-empty
      v-if="!loading && norms.length === 0"
      description="还没有常模，点右上角「添加一套常模」"
    />

    <el-card
      v-for="(n, i) in norms"
      :key="i"
      shadow="never"
      class="card norm-card"
    >
      <div class="norm-head">
        <span class="norm-index">常模 {{ i + 1 }}</span>
        <span class="norm-summary">适用：{{ conditionSummary(n) }}</span>
        <el-button size="small" text type="danger" @click="removeNorm(i)"
          >删除</el-button
        >
      </div>

      <el-form label-width="100px">
        <el-form-item label="名称">
          <el-input
            v-model="n.name"
            placeholder="如：全国常模、男生、初一女生"
          />
        </el-form-item>
        <el-form-item label="来源">
          <el-input
            v-model="n.source"
            placeholder="可不填，如：金华等（1986）全国常模，N=1388"
          />
        </el-form-item>
        <el-form-item label="适用人群">
          <div class="conds">
            <div v-for="(c, ci) in n.conditions" :key="ci" class="cond-row">
              <el-select
                v-model="c.field_key"
                style="width: 150px"
                @change="onFieldChange(c)"
              >
                <el-option
                  v-for="f in infoFields"
                  :key="f.field_key"
                  :value="f.field_key"
                  :label="f.field_label"
                />
              </el-select>
              <template v-if="c.op === 'range'">
                <span>在</span>
                <el-input-number
                  v-model="c.min"
                  :controls="false"
                  :value-on-clear="null"
                  placeholder="最小"
                  style="width: 90px"
                />
                <span>到</span>
                <el-input-number
                  v-model="c.max"
                  :controls="false"
                  :value-on-clear="null"
                  placeholder="最大"
                  style="width: 90px"
                />
                <span>之间（含两端）</span>
              </template>
              <template v-else>
                <span>是</span>
                <el-select
                  v-if="(fieldOf(c.field_key)?.options || []).length > 0"
                  v-model="c.value"
                  style="width: 160px"
                  placeholder="选择"
                >
                  <el-option
                    v-for="o in fieldOf(c.field_key).options"
                    :key="o"
                    :value="o"
                    :label="o"
                  />
                </el-select>
                <el-input
                  v-else
                  v-model="c.value"
                  style="width: 160px"
                  placeholder="和受测者填的完全一样"
                />
              </template>
              <el-button
                text
                type="danger"
                size="small"
                @click="n.conditions.splice(ci, 1)"
                >去掉</el-button
              >
            </div>
            <el-button
              size="small"
              :disabled="infoFields.length === 0"
              @click="addCondition(n)"
              >+ 添加条件</el-button
            >
            <span v-if="n.conditions.length === 0" class="tip inline"
              >不加条件 = 适用所有人</span
            >
          </div>
        </el-form-item>
        <el-form-item label="均值和标准差">
          <el-table :data="measures" size="small" class="value-table">
            <el-table-column prop="name" label="指标" min-width="120">
              <template #default="{ row }">
                {{ row.name }}
                <span v-if="row.formula" class="tip inline">{{
                  row.formula === "mean" ? "（均值）" : "（求和）"
                }}</span>
              </template>
            </el-table-column>
            <el-table-column label="平均分" width="150">
              <template #default="{ row }">
                <el-input-number
                  v-model="n.values[row.key].mean"
                  :controls="false"
                  :value-on-clear="null"
                  placeholder="不填则不比较"
                  style="width: 130px"
                />
              </template>
            </el-table-column>
            <el-table-column label="标准差" width="150">
              <template #default="{ row }">
                <el-input-number
                  v-model="n.values[row.key].sd"
                  :controls="false"
                  :value-on-clear="null"
                  :min="0"
                  style="width: 130px"
                />
              </template>
            </el-table-column>
          </el-table>
        </el-form-item>
      </el-form>
    </el-card>
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
  margin: 16px 0;
}
.header h2 {
  margin: 0;
  font-size: 20px;
  color: #3d2b12;
}
.sub {
  margin: 4px 0 0;
  color: #8a7a5e;
  font-size: 14px;
}
.gap {
  margin-bottom: 16px;
}
.alert-body {
  line-height: 1.7;
  font-size: 13px;
}
.card {
  border: 1px solid #f0dcae;
  margin-bottom: 16px;
}
.tip {
  font-size: 12px;
  color: #999;
  line-height: 1.6;
  margin: 6px 0 0;
}
.tip.inline {
  margin: 0 0 0 6px;
}
.tip.warn {
  color: #b88230;
}
.norm-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.norm-index {
  font-weight: 600;
  color: #8b5a2b;
}
.norm-summary {
  flex: 1;
  font-size: 13px;
  color: #666;
}
.conds {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
}
.cond-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
  color: #555;
}
.value-table {
  width: 100%;
}
</style>
