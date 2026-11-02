<script setup>
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import BarChart from "../components/BarChart.vue";
import { API_BASE } from "../api.js";

const route = useRoute();
const router = useRouter();
const questionnaireId = route.params.id;

const loading = ref(true);
const stats = ref(null);

// 筛选条件
const groupFilter = ref(""); // "" = 全部分组
const completeOnly = ref(true); // 只统计完整作答
const excludeFast = ref(false); // 排除作答过快（平均每题不到 2 秒）

const selectedMeasure = ref(""); // 「得分统计」里当前查看的指标
const groupMeasure = ref(""); // 「分组对比」图里当前查看的指标
const relMeasure = ref(""); // 「信度分析」里当前查看项目分析的指标
const compareGroups = ref([]); // 参与差异检验的分组（空 = 自动选）
const exporting = ref(false);

// 按键作答统计
const keyTrim = ref("3000"); // 异常题次怎么排除（和后端 key-stats.js 一致）
const keyScope = ref("all"); // 被试内分析看哪些人：全部 / 只看键盘 / 只看触屏
const keyTrimOptions = [
  { value: "3000", label: "按住超过 3 秒的题次不算" },
  { value: "2000", label: "按住超过 2 秒的题次不算" },
  { value: "sd3", label: "超出本人平均 ±3 个标准差的不算" },
  { value: "none", label: "不排除" },
];

// 当前的筛选条件（统计和导出共用）
function queryParams() {
  const params = new URLSearchParams({
    group: groupFilter.value,
    complete_only: completeOnly.value ? "1" : "0",
    exclude_fast: excludeFast.value ? "1" : "0",
    key_trim: keyTrim.value,
  });
  if (compareGroups.value.length > 0) {
    params.set("compare_groups", compareGroups.value.join(","));
  }
  return params;
}

async function fetchStats() {
  loading.value = true;
  const token = localStorage.getItem("admin_token");
  const params = queryParams();
  try {
    const res = await fetch(
      `${API_BASE}/api/questionnaires/${questionnaireId}/stats?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await res.json();
    if (data.success) {
      stats.value = data;
      const keys = data.measures.map((m) => m.key);
      if (!keys.includes(selectedMeasure.value))
        selectedMeasure.value = keys[0] || "";
      if (!keys.includes(groupMeasure.value))
        groupMeasure.value = keys[0] || "";
      if (!keys.includes(relMeasure.value)) {
        // 默认看第一个能算出 α 的维度
        const first = data.reliability.find((r) => r.items.length > 0);
        relMeasure.value = first ? first.key : keys[0] || "";
      }
      compareGroups.value = [...data.group_tests.groups];
    } else {
      ElMessage.error(data.message);
    }
  } catch (err) {
    ElMessage.error("加载统计数据失败，请检查后端服务");
  } finally {
    loading.value = false;
  }
}

// ---------- 页面上用到的计算 ----------

const overview = computed(() => stats.value?.overview);
const measures = computed(() => stats.value?.measures || []);
const currentMeasure = computed(() =>
  measures.value.find((m) => m.key === selectedMeasure.value),
);
// 分组对比：至少 2 个分组才有意义
const groupRows = computed(() =>
  (stats.value?.group_compare || []).filter((g) => g.n > 0),
);
const showGroupCompare = computed(() => groupRows.value.length >= 2);
const groupMeasureName = computed(
  () => measures.value.find((m) => m.key === groupMeasure.value)?.name || "",
);

function fmtNum(v) {
  return v === null || v === undefined ? "-" : v;
}

// p 值按论文常用写法显示
function fmtP(p) {
  if (p === null || p === undefined) return "-";
  if (p < 0.001) return "< .001";
  return p.toFixed(3).replace(/^0/, "");
}

// α 系数的评价
function alphaLevel(a) {
  if (a === null || a === undefined) return "";
  if (a < 0) return "为负数，可能有题漏设反向计分";
  if (a >= 0.9) return "很好";
  if (a >= 0.8) return "良好";
  if (a >= 0.7) return "可以接受";
  if (a >= 0.6) return "勉强可用";
  return "偏低";
}
function alphaTagType(a) {
  if (a === null || a === undefined) return "info";
  if (a >= 0.8) return "success";
  if (a >= 0.6) return "warning";
  return "danger";
}

// 项目分析里每道题的提示
function itemTip(it, alpha) {
  const tips = [];
  if (it.citc !== null && it.citc < 0)
    tips.push("与其他题负相关，检查是否漏设反向计分");
  else if (it.citc !== null && it.citc < 0.3) tips.push("与其他题相关偏低");
  if (
    it.alpha_if_deleted !== null &&
    alpha !== null &&
    it.alpha_if_deleted > alpha + 0.01
  )
    tips.push("删去后 α 会提高");
  return tips.join("；");
}

const reliability = computed(() => stats.value?.reliability || []);
const currentRel = computed(() =>
  reliability.value.find((r) => r.key === relMeasure.value),
);
const groupTests = computed(() => stats.value?.group_tests);
const normCompare = computed(() => stats.value?.norm_compare);

// ---------- 按键作答 ----------
const keyData = computed(() => stats.value?.key);
const keyScopeOptions = computed(() => {
  const scopes = keyData.value?.scopes || {};
  return [
    { value: "all", label: "全部（合在一起）" },
    { value: "key", label: "只看键盘" },
    { value: "touch", label: "只看触屏" },
  ].filter((o) => scopes[o.value]);
});
const keyScopeData = computed(() => {
  const scopes = keyData.value?.scopes || {};
  return scopes[keyScope.value] || scopes.all || null;
});

function pText(p) {
  if (p === null || p === undefined) return "";
  return p < 0.001 ? "p < .001" : `p = ${fmtP(p)}`;
}

// 「每多按 100 毫秒，把握程度……」
function slopeText(s) {
  if (s === null || s === undefined) return "";
  if (s === 0) return "基本不变";
  return `${s < 0 ? "降低" : "提高"} ${Math.abs(s)} 分`;
}

function fmtMs(v) {
  return v === null || v === undefined ? "-" : `${v}`;
}

function effectLevel(r) {
  if (!r || r.effect === null) return "";
  const v = Math.abs(r.effect);
  if (r.effect_name === "d")
    return v >= 0.8 ? "大" : v >= 0.5 ? "中" : v >= 0.2 ? "小" : "很小";
  return v >= 0.14 ? "大" : v >= 0.06 ? "中" : v >= 0.01 ? "小" : "很小";
}

async function exportStats() {
  exporting.value = true;
  const token = localStorage.getItem("admin_token");
  try {
    const res = await fetch(
      `${API_BASE}/api/questionnaires/${questionnaireId}/stats/export?${queryParams()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${stats.value?.questionnaire.title || "问卷"}_统计结果.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    ElMessage.error("导出失败，请检查后端服务");
  } finally {
    exporting.value = false;
  }
}

function fmtSeconds(sec) {
  if (sec === null || sec === undefined) return "-";
  const s = Math.round(sec);
  if (s < 60) return `${s} 秒`;
  return `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}

function fmtTime(t) {
  return t ? new Date(t).toLocaleString("zh-CN") : "-";
}

function pct(count, total) {
  return total ? Math.round((count / total) * 1000) / 10 : 0;
}

const typeNames = {
  scale: "量表",
  single_choice: "单选",
  multiple_choice: "多选",
  yes_no: "是否",
  open_text: "开放题",
};

// 逐题分析里，每道题的条形最长按这道题里最多的那个选项来算
function barPct(item, count) {
  const max = Math.max(...item.distribution.map((d) => d.count), 1);
  return (count / max) * 100;
}

// 每道题标题下面那一行：作答人数 · 平均用时 · 平均分
function itemMeta(item) {
  const parts = [`${item.n} 人作答`];
  if (item.avg_seconds !== null) parts.push(`平均用时 ${item.avg_seconds} 秒`);
  if (item.score && item.score.n > 0) {
    let text = `平均分 ${item.score.mean}`;
    if (item.score.sd !== null) text += `（标准差 ${item.score.sd}）`;
    parts.push(text);
  }
  return parts.join(" · ");
}

const openExpanded = ref({}); // 开放题是否展开全部回答

onMounted(fetchStats);
</script>

<template>
  <div class="container" v-loading="loading">
    <div class="page-head">
      <div>
        <h2>统计分析</h2>
      </div>
      <el-button
        v-if="stats && overview.valid > 0"
        type="success"
        :loading="exporting"
        @click="exportStats"
        >导出统计结果（Excel）</el-button
      >
    </div>

    <!-- 筛选条件 -->
    <div class="filter-bar">
      <div class="filter-item">
        <span class="filter-label">分组</span>
        <el-select
          v-model="groupFilter"
          placeholder="全部分组"
          style="width: 160px"
          @change="fetchStats"
        >
          <el-option value="" label="全部分组" />
          <el-option
            v-for="g in stats?.groups || []"
            :key="g.value"
            :value="g.value"
            :label="g.label"
          />
        </el-select>
      </div>
      <el-switch
        v-model="completeOnly"
        active-text="只统计完整作答"
        @change="fetchStats"
      />
      <el-switch
        v-model="excludeFast"
        active-text="排除作答过快（平均每题不到 2 秒）"
        @change="fetchStats"
      />
    </div>

    <template v-if="stats">
      <p class="filter-summary">
        当前统计 <b>{{ overview.valid }}</b> 份作答（共
        {{ overview.total_with_answers }} 份有答案<template
          v-if="overview.excluded_incomplete || overview.excluded_fast"
          >；已排除
          <template v-if="overview.excluded_incomplete"
            >{{ overview.excluded_incomplete }} 份不完整</template
          ><template
            v-if="overview.excluded_incomplete && overview.excluded_fast"
            >、</template
          ><template v-if="overview.excluded_fast"
            >{{ overview.excluded_fast }} 份作答过快</template
          ></template
        ><template v-if="groupFilter"
          >；只看「{{
            stats.groups.find((g) => g.value === groupFilter)?.label
          }}」</template
        >）。<template v-if="overview.empty"
          >另有
          {{ overview.empty }} 份没有任何答案的空提交，不计入统计。</template
        ><template v-if="overview.invalid"
          >另有
          {{ overview.invalid }}
          份被跳题逻辑判为无效答卷，不计入统计。</template
        >
      </p>

      <el-empty
        v-if="overview.valid === 0"
        description="还没有符合条件的作答数据"
      />

      <template v-else>
        <!-- 回收概况 -->
        <div class="tiles">
          <div class="tile">
            <div class="tile-label">有效作答</div>
            <div class="tile-value">{{ overview.valid }} <small>份</small></div>
          </div>
          <div class="tile">
            <div class="tile-label">作答用时（中位数）</div>
            <div class="tile-value">
              {{ fmtSeconds(overview.duration.median) }}
            </div>
          </div>
          <div class="tile">
            <div class="tile-label">最早提交</div>
            <div class="tile-value small">{{ fmtTime(overview.first_at) }}</div>
          </div>
          <div class="tile">
            <div class="tile-label">最近提交</div>
            <div class="tile-value small">{{ fmtTime(overview.last_at) }}</div>
          </div>
        </div>

        <section class="block" v-if="overview.daily.length > 1">
          <h3>每天回收份数</h3>
          <BarChart
            :categories="overview.daily.map((d) => d.date.slice(5))"
            :values="overview.daily.map((d) => d.count)"
            y-name="份数"
            :tooltip="
              (i) => `${overview.daily[i].date}：${overview.daily[i].count} 份`
            "
            :height="200"
          />
        </section>

        <!-- 得分统计 -->
        <section class="block">
          <h3>得分统计</h3>
          <p v-if="measures.length === 0" class="muted">
            这份问卷没有计分题（量表题或带分值的单选题），没有得分可以统计。
          </p>
          <template v-else>
            <p class="muted">
              点击某一行，下面显示它的分数分布和各分数段人数。
            </p>
            <el-table
              :data="measures"
              size="small"
              highlight-current-row
              :row-class-name="
                ({ row }) => (row.key === selectedMeasure ? 'row-active' : '')
              "
              @row-click="(row) => (selectedMeasure = row.key)"
            >
              <el-table-column prop="name" label="指标" min-width="110" />
              <el-table-column prop="formula" label="计分方式" width="110" />
              <el-table-column label="人数" width="70">
                <template #default="{ row }">{{ row.n }}</template>
              </el-table-column>
              <el-table-column label="平均分" width="80">
                <template #default="{ row }">{{ fmtNum(row.mean) }}</template>
              </el-table-column>
              <el-table-column label="标准差" width="80">
                <template #default="{ row }">{{ fmtNum(row.sd) }}</template>
              </el-table-column>
              <el-table-column label="中位数" width="80">
                <template #default="{ row }">{{ fmtNum(row.median) }}</template>
              </el-table-column>
              <el-table-column label="最低 ~ 最高" width="110">
                <template #default="{ row }"
                  >{{ fmtNum(row.min) }} ~ {{ fmtNum(row.max) }}</template
                >
              </el-table-column>
              <el-table-column label="满分范围" width="100">
                <template #default="{ row }"
                  >{{ row.range.min }} ~ {{ row.range.max }}</template
                >
              </el-table-column>
            </el-table>

            <div v-if="currentMeasure" class="measure-detail">
              <div class="measure-chart">
                <h4>「{{ currentMeasure.name }}」分数分布</h4>
                <p v-if="currentMeasure.n === 0" class="muted">
                  暂无可计分的数据（这个维度里的题目可能都不计分）。
                </p>
                <BarChart
                  v-else
                  :categories="currentMeasure.histogram.map((b) => b.label)"
                  :values="currentMeasure.histogram.map((b) => b.count)"
                  y-name="人数"
                  :tooltip="
                    (i) =>
                      `${currentMeasure.histogram[i].label} 分：${currentMeasure.histogram[i].count} 人（${pct(currentMeasure.histogram[i].count, currentMeasure.n)}%）`
                  "
                />
              </div>
              <div class="measure-bands">
                <h4>各分数段人数</h4>
                <p v-if="currentMeasure.bands.length === 0" class="muted">
                  还没有给「{{
                    currentMeasure.name
                  }}」配置分数段，可以到「分数段报告」里设置。
                </p>
                <div
                  v-for="b in currentMeasure.bands"
                  :key="b.label"
                  class="band-row"
                >
                  <span
                    class="band-swatch"
                    :style="{ background: b.color }"
                  ></span>
                  <span class="band-label">
                    {{ b.label }}
                    <small v-if="b.min !== null">{{ b.min }}~{{ b.max }}</small>
                  </span>
                  <span class="band-bar">
                    <i
                      :style="{
                        width: pct(b.count, currentMeasure.n) + '%',
                        background: b.color,
                      }"
                    ></i>
                  </span>
                  <span class="band-count"
                    >{{ b.count }} 人（{{
                      pct(b.count, currentMeasure.n)
                    }}%）</span
                  >
                </div>
              </div>
            </div>
          </template>
        </section>

        <!-- 信度分析 -->
        <section class="block" v-if="reliability.length > 0">
          <h3>信度分析（Cronbach's α）</h3>
          <p class="muted">
            用反向计分之后的分数计算，只用该指标每道题都有得分的作答。一般 α ≥
            0.9 很好，0.8~0.9 良好，0.7~0.8 可以接受，0.6~0.7
            勉强可用。点某一行查看每道题的项目分析。
          </p>
          <el-table
            :data="reliability"
            size="small"
            :row-class-name="
              ({ row }) => (row.key === relMeasure ? 'row-active' : '')
            "
            @row-click="(row) => (relMeasure = row.key)"
          >
            <el-table-column prop="name" label="指标" min-width="110" />
            <el-table-column prop="k" label="题数" width="70" />
            <el-table-column label="有效人数" width="90">
              <template #default="{ row }">{{ row.n }}</template>
            </el-table-column>
            <el-table-column label="Cronbach's α" width="120">
              <template #default="{ row }">
                <b v-if="row.alpha !== null">{{ row.alpha }}</b>
                <span v-else class="muted-inline">-</span>
              </template>
            </el-table-column>
            <el-table-column label="评价" min-width="160">
              <template #default="{ row }">
                <el-tag
                  v-if="row.alpha !== null"
                  size="small"
                  :type="alphaTagType(row.alpha)"
                  >{{ alphaLevel(row.alpha) }}</el-tag
                >
                <span v-else class="muted-inline">{{ row.note }}</span>
              </template>
            </el-table-column>
          </el-table>

          <div
            v-if="currentRel && currentRel.items.length > 0"
            class="sub-block"
          >
            <h4>「{{ currentRel.name }}」项目分析</h4>
            <p class="muted">
              校正题总相关：这道题和其余题总分的相关，一般希望在 0.3
              以上；为负数时多半是这道题要反向计分却没设置。
            </p>
            <el-table :data="currentRel.items" size="small">
              <el-table-column label="题号" width="64">
                <template #default="{ row }">Q{{ row.order_num }}</template>
              </el-table-column>
              <el-table-column label="题目" min-width="200">
                <template #default="{ row }">
                  {{ row.content }}
                  <el-tag v-if="row.reverse" size="small" type="warning"
                    >反向</el-tag
                  >
                </template>
              </el-table-column>
              <el-table-column label="平均分" width="76">
                <template #default="{ row }">{{ fmtNum(row.mean) }}</template>
              </el-table-column>
              <el-table-column label="标准差" width="76">
                <template #default="{ row }">{{ fmtNum(row.sd) }}</template>
              </el-table-column>
              <el-table-column label="校正题总相关" width="110">
                <template #default="{ row }">
                  <span
                    :class="{
                      bad: row.citc !== null && row.citc < 0,
                      weak:
                        row.citc !== null && row.citc >= 0 && row.citc < 0.3,
                    }"
                    >{{ fmtNum(row.citc) }}</span
                  >
                </template>
              </el-table-column>
              <el-table-column label="删除该题后 α" width="110">
                <template #default="{ row }">
                  <span
                    :class="{
                      weak:
                        row.alpha_if_deleted !== null &&
                        currentRel.alpha !== null &&
                        row.alpha_if_deleted > currentRel.alpha + 0.01,
                    }"
                    >{{ fmtNum(row.alpha_if_deleted) }}</span
                  >
                </template>
              </el-table-column>
              <el-table-column label="提示" min-width="150">
                <template #default="{ row }">
                  <span class="tip-text">{{
                    itemTip(row, currentRel.alpha)
                  }}</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </section>

        <!-- 和常模比较 -->
        <section class="block" v-if="normCompare && normCompare.has_norms">
          <h3>和常模比较</h3>
          <p class="muted">
            每个人按自己填的基本信息匹配常模，样本平均分和常模平均分做单样本 t
            检验；d =（样本平均 − 常模平均）÷ 样本标准差。T 分 = 50 + 10 ×（得分
            − 常模平均）÷ 常模标准差。
            <template v-if="normCompare.unmatched > 0"
              >另有
              {{ normCompare.unmatched }}
              份作答没有匹配到常模，未计入。</template
            >
          </p>
          <p v-if="normCompare.rows.length === 0" class="muted">
            常模里还没有填任何指标的均值和标准差。
          </p>
          <el-table v-else :data="normCompare.rows" size="small">
            <el-table-column label="常模" min-width="120">
              <template #default="{ row }">
                {{ row.norm_name }}
                <div class="muted-inline">{{ row.condition_text }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="measure_name" label="指标" min-width="90" />
            <el-table-column prop="n" label="人数" width="60" />
            <el-table-column label="样本" width="110">
              <template #default="{ row }">
                <template v-if="row.n > 0"
                  >{{ row.mean }}
                  <span class="muted-inline" v-if="row.sd !== null"
                    >± {{ row.sd }}</span
                  ></template
                >
                <span v-else class="muted-inline">-</span>
              </template>
            </el-table-column>
            <el-table-column label="常模" width="110">
              <template #default="{ row }"
                >{{ row.norm_mean }}
                <span class="muted-inline">± {{ row.norm_sd }}</span></template
              >
            </el-table-column>
            <el-table-column label="差值" width="70">
              <template #default="{ row }">{{ fmtNum(row.diff) }}</template>
            </el-table-column>
            <el-table-column label="t" width="70">
              <template #default="{ row }">{{ fmtNum(row.t) }}</template>
            </el-table-column>
            <el-table-column label="p" width="74">
              <template #default="{ row }">
                <span :class="{ sig: row.p !== null && row.p < 0.05 }">{{
                  fmtP(row.p)
                }}</span>
              </template>
            </el-table-column>
            <el-table-column label="d" width="60">
              <template #default="{ row }">{{ fmtNum(row.d) }}</template>
            </el-table-column>
            <el-table-column label="T≥60" width="80">
              <template #default="{ row }"
                >{{ row.high }}
                <span class="muted-inline"
                  >({{ pct(row.high, row.n) }}%)</span
                ></template
              >
            </el-table-column>
            <el-table-column label="T≤40" width="80">
              <template #default="{ row }"
                >{{ row.low }}
                <span class="muted-inline"
                  >({{ pct(row.low, row.n) }}%)</span
                ></template
              >
            </el-table-column>
          </el-table>
        </section>

        <!-- 分组对比 -->
        <section class="block" v-if="showGroupCompare && measures.length > 0">
          <h3>分组对比</h3>
          <p class="muted">
            按生成链接时设置的分组统计（不受上面「分组」筛选的影响）。表中为
            平均分 ± 标准差。
          </p>
          <el-table :data="groupRows" size="small">
            <el-table-column prop="label" label="分组" min-width="100" />
            <el-table-column prop="n" label="人数" width="70" />
            <el-table-column
              v-for="m in measures"
              :key="m.key"
              :label="m.name"
              min-width="120"
            >
              <template #default="{ row }">
                <template v-if="row.measures[m.key].n > 0">
                  {{ row.measures[m.key].mean }}
                  <span class="muted" v-if="row.measures[m.key].sd !== null"
                    >± {{ row.measures[m.key].sd }}</span
                  >
                </template>
                <span v-else class="muted">-</span>
              </template>
            </el-table-column>
          </el-table>
          <div class="group-chart">
            <el-radio-group v-model="groupMeasure" size="small">
              <el-radio-button
                v-for="m in measures"
                :key="m.key"
                :value="m.key"
                >{{ m.name }}</el-radio-button
              >
            </el-radio-group>
            <BarChart
              :categories="groupRows.map((g) => g.label)"
              :values="
                groupRows.map((g) => g.measures[groupMeasure]?.mean ?? 0)
              "
              :y-name="`${groupMeasureName}平均分`"
              :integer="false"
              :tooltip="
                (i) => {
                  const d = groupRows[i].measures[groupMeasure];
                  return `${groupRows[i].label}：平均 ${fmtNum(d.mean)}，标准差 ${fmtNum(d.sd)}，${d.n} 人`;
                }
              "
            />
          </div>

          <!-- 差异检验 -->
          <div class="sub-block">
            <h4>差异检验</h4>
            <div class="compare-pick">
              <span class="filter-label">参与比较的分组</span>
              <el-select
                v-model="compareGroups"
                multiple
                collapse-tags
                collapse-tags-tooltip
                placeholder="至少选 2 个分组"
                style="width: 320px"
                @change="fetchStats"
              >
                <el-option
                  v-for="g in groupRows.filter((x) => x.n >= 2)"
                  :key="g.value"
                  :value="g.value"
                  :label="`${g.label}（${g.n} 人）`"
                />
              </el-select>
            </div>
            <p class="muted">
              两组比较用 t 检验（Welch 法，不要求两组方差相等），效应量 d：0.2
              小、0.5 中、0.8 大；三组及以上用单因素方差分析，效应量 η²：0.01
              小、0.06 中、0.14 大。p &lt; .05
              表示组间差异显著。正式发表的分析建议再用 SPSS 等软件核对。
            </p>
            <el-table :data="measures" size="small">
              <el-table-column prop="name" label="指标" min-width="110" />
              <el-table-column label="方法" width="140">
                <template #default="{ row }">
                  <template v-if="groupTests.results[row.key]">{{
                    groupTests.results[row.key].method === "t"
                      ? "t 检验"
                      : "单因素方差分析"
                  }}</template>
                  <span v-else class="muted-inline">人数不足，无法检验</span>
                </template>
              </el-table-column>
              <el-table-column label="统计量" width="150">
                <template #default="{ row }">
                  <template v-if="groupTests.results[row.key]">
                    <template v-if="groupTests.results[row.key].method === 't'"
                      >t({{ groupTests.results[row.key].df1 }}) =
                      {{ groupTests.results[row.key].stat }}</template
                    >
                    <template v-else
                      >F({{ groupTests.results[row.key].df1 }},
                      {{ groupTests.results[row.key].df2 }}) =
                      {{ groupTests.results[row.key].stat }}</template
                    >
                  </template>
                </template>
              </el-table-column>
              <el-table-column label="p" width="80">
                <template #default="{ row }">
                  <span
                    v-if="groupTests.results[row.key]"
                    :class="{ sig: groupTests.results[row.key].p < 0.05 }"
                    >{{ fmtP(groupTests.results[row.key].p) }}</span
                  >
                </template>
              </el-table-column>
              <el-table-column label="效应量" width="130">
                <template #default="{ row }">
                  <template v-if="groupTests.results[row.key]"
                    >{{ groupTests.results[row.key].effect_name }} =
                    {{ fmtNum(groupTests.results[row.key].effect) }}
                    <span class="muted-inline"
                      >（{{ effectLevel(groupTests.results[row.key]) }}）</span
                    ></template
                  >
                </template>
              </el-table-column>
              <el-table-column label="结论" min-width="90">
                <template #default="{ row }">
                  <template v-if="groupTests.results[row.key]">
                    <el-tag
                      v-if="groupTests.results[row.key].p < 0.05"
                      size="small"
                      type="danger"
                      >差异显著</el-tag
                    >
                    <el-tag v-else size="small" type="info">差异不显著</el-tag>
                  </template>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </section>

        <!-- 按键作答 -->
        <section class="block" v-if="keyData && keyData.has_key">
          <h3>按键作答（按住时长）</h3>
          <p class="muted">
            只统计用按键方式作答的答卷（{{ keyData.persons }} 份，{{
              keyData.total_trials
            }}
            个题次）。按住时长 = 按下 → 松开，按下用时 = 题目出现 →
            按下，单位毫秒。按得越久通常表示越没把握（Zhou
            等，2026，PNAS），但效应很小：适合看同一个人内部的变化和整体规律，不能用来判断某一个人。
          </p>
          <div class="key-controls">
            <span class="filter-label">异常题次</span>
            <el-select
              v-model="keyTrim"
              style="width: 260px"
              @change="fetchStats"
            >
              <el-option
                v-for="o in keyTrimOptions"
                :key="o.value"
                :value="o.value"
                :label="o.label"
              />
            </el-select>
            <span class="muted-inline">{{
              keyData.excluded_trials > 0
                ? `排除了 ${keyData.excluded_trials} 个题次，下面的数字都不含它们`
                : "没有题次被排除"
            }}</span>
          </div>

          <h4>按作答输入分开</h4>
          <el-table :data="keyData.devices" size="small">
            <el-table-column prop="label" label="作答输入" width="96" />
            <el-table-column prop="persons" label="人数" width="60" />
            <el-table-column prop="trials" label="题次" width="64" />
            <el-table-column label="按住时长 中位数（四分位）" min-width="170">
              <template #default="{ row }"
                ><b>{{ fmtMs(row.hold.median) }}</b>
                <span class="muted-inline"
                  >（{{ fmtMs(row.hold.q1) }} ~ {{ fmtMs(row.hold.q3) }}）</span
                ></template
              >
            </el-table-column>
            <el-table-column label="平均 ± 标准差" min-width="120">
              <template #default="{ row }"
                >{{ fmtMs(row.hold.mean) }}
                <span class="muted-inline" v-if="row.hold.sd !== null"
                  >± {{ row.hold.sd }}</span
                ></template
              >
            </el-table-column>
            <el-table-column label="每人中位数 平均 ± 标准差" min-width="150">
              <template #default="{ row }"
                >{{ fmtMs(row.person_median.mean) }}
                <span class="muted-inline" v-if="row.person_median.sd !== null"
                  >± {{ row.person_median.sd }}</span
                ></template
              >
            </el-table-column>
            <el-table-column label="按下用时 中位数" width="120">
              <template #default="{ row }">{{ fmtMs(row.rt_median) }}</template>
            </el-table-column>
            <el-table-column
              v-if="keyData.has_confidence"
              label="平均把握"
              width="80"
            >
              <template #default="{ row }">{{
                fmtNum(row.conf_mean)
              }}</template>
            </el-table-column>
          </el-table>
          <p
            class="muted key-hist-note"
            v-if="keyData.devices.some((d) => d.value === 'mixed')"
          >
            「键盘+触屏」是同一份答卷里两种都用过的人（比如带触摸屏的笔记本）；下面的分布图按每个题次实际用的输入方式分，所以题次数和上表不完全一样。
          </p>
          <div class="key-hists">
            <div v-for="h in keyData.histograms" :key="h.value">
              <h4>{{ h.label }}：按住时长分布（{{ h.n }} 个题次）</h4>
              <BarChart
                :categories="h.bins.map((b) => b.label)"
                :values="h.bins.map((b) => b.count)"
                y-name="题次"
                :color="h.value === 'touch' ? '#4a90a4' : '#d9692f'"
                :height="200"
                :tooltip="
                  (i) =>
                    `${h.bins[i].label} 毫秒：${h.bins[i].count} 个题次（${pct(h.bins[i].count, h.n)}%）`
                "
              />
            </div>
          </div>

          <div class="sub-block" v-if="keyScopeData">
            <div class="key-scope-head">
              <h4>被试内分析</h4>
              <el-radio-group
                v-if="keyScopeOptions.length > 1"
                v-model="keyScope"
                size="small"
              >
                <el-radio-button
                  v-for="o in keyScopeOptions"
                  :key="o.value"
                  :value="o.value"
                  >{{ o.label }}</el-radio-button
                >
              </el-radio-group>
            </div>
            <p class="muted">
              每个人只和自己比（自己按得长的题和按得短的题比），所以键盘和触屏、按键快慢习惯不同的人可以合在一起看。
            </p>
            <p class="key-warn" v-if="keyScopeData.persons < 10">
              这里只有 {{ keyScopeData.persons }}
              人，人数太少，下面的结果只能看个大概，不能下结论。
            </p>
            <template v-if="keyData.has_confidence">
              <div v-if="keyScopeData.bins" class="key-bins">
                <div>
                  <BarChart
                    :categories="
                      keyScopeData.bins.map(
                        (b) =>
                          `${b.label}（约 ${Math.round(b.hold_mean)} 毫秒）`,
                      )
                    "
                    :values="keyScopeData.bins.map((b) => b.conf_mean)"
                    y-name="平均把握（1-5）"
                    :integer="false"
                    :height="220"
                    :tooltip="
                      (i) => {
                        const b = keyScopeData.bins[i];
                        return `${b.label}：平均把握 ${b.conf_mean}，95% 置信区间 ${fmtNum(b.ci_low)} ~ ${fmtNum(b.ci_high)}（${b.persons} 人）`;
                      }
                    "
                  />
                </div>
                <div class="key-bins-text">
                  <p>
                    每人把自己的题次按按住时长从短到长分成三份，算每份的平均把握，再对所有人求平均（{{
                      keyScopeData.bins[0].persons
                    }}
                    人，每人至少 3
                    个题次）。按住越长、把握越低，三根柱子就会越来越矮。
                  </p>
                  <p v-for="b in keyScopeData.bins" :key="b.label">
                    {{ b.label }}：{{ fmtNum(b.conf_mean) }}
                    <span class="muted-inline"
                      >（95% 置信区间 {{ fmtNum(b.ci_low) }} ~
                      {{ fmtNum(b.ci_high) }}）</span
                    >
                  </p>
                </div>
              </div>
              <p class="key-result" v-if="keyScopeData.hold_conf">
                <b>按住时长和把握程度</b>：被试内相关
                <template v-if="keyScopeData.hold_conf.r !== null"
                  >r({{ keyScopeData.hold_conf.df }}) =
                  {{ keyScopeData.hold_conf.r }}，<span
                    :class="{
                      sig:
                        keyScopeData.hold_conf.p !== null &&
                        keyScopeData.hold_conf.p < 0.05,
                    }"
                    >{{ pText(keyScopeData.hold_conf.p) }}</span
                  >；每多按 100 毫秒，把握程度平均{{
                    slopeText(keyScopeData.hold_conf.slope100)
                  }}</template
                ><template v-else>算不出来（每人的把握程度都没有变化）</template
                >（{{ keyScopeData.hold_conf.persons }} 人、{{
                  keyScopeData.hold_conf.trials
                }}
                个题次）。论文实验 1 约为每 100 毫秒降低 0.09 分。
              </p>
            </template>
            <p v-else class="muted">
              这份问卷没有问把握程度，所以检验不了按住时长和把握的关系；需要的话在问卷「编辑
              → 答题方式」里打开「每题问把握程度」。
            </p>
            <p class="key-result" v-if="keyScopeData.rt_hold">
              <b>按下用时和按住时长</b>：每人算一个相关，平均 r =
              {{ keyScopeData.rt_hold.mean_r }}（{{
                keyScopeData.rt_hold.persons
              }}
              人）<template v-if="keyScopeData.rt_hold.t !== null"
                >，t({{ keyScopeData.rt_hold.df }}) =
                {{ keyScopeData.rt_hold.t }}，{{
                  pText(keyScopeData.rt_hold.p)
                }}</template
              >。论文里两者基本无关（平均 r ≈
              0.01）；如果这里明显相关，说明按住时长里混进了反应快慢，解读时要小心。
            </p>
          </div>

          <div class="sub-block" v-if="keyData.items.length > 0">
            <h4>每道题</h4>
            <p class="muted">
              被试内标准分：这一题的按住时长比这个人自己平时长（大于
              0）还是短（小于 0），以本人的标准差为单位，再对所有人求平均；大于
              0
              的题，大家按得比平时久，可能更没把握或更难回答。键盘和触屏可以合在一起比较。
            </p>
            <el-table :data="keyData.items" size="small">
              <el-table-column label="题号" width="64">
                <template #default="{ row }">Q{{ row.order_num }}</template>
              </el-table-column>
              <el-table-column
                prop="content"
                label="题目"
                min-width="200"
                show-overflow-tooltip
              />
              <el-table-column prop="trials" label="题次" width="60" />
              <el-table-column label="键盘 中位数" width="96">
                <template #default="{ row }">{{
                  row.key_n ? fmtMs(row.key_median) : "-"
                }}</template>
              </el-table-column>
              <el-table-column label="触屏 中位数" width="96">
                <template #default="{ row }">{{
                  row.touch_n ? fmtMs(row.touch_median) : "-"
                }}</template>
              </el-table-column>
              <el-table-column label="被试内标准分" width="110">
                <template #default="{ row }">
                  <span
                    :class="{
                      weak: row.z_mean !== null && row.z_mean >= 0.3,
                    }"
                    >{{
                      row.z_mean === null
                        ? "-"
                        : (row.z_mean > 0 ? "+" : "") + row.z_mean
                    }}</span
                  >
                </template>
              </el-table-column>
              <el-table-column
                v-if="keyData.has_confidence"
                label="平均把握"
                width="80"
              >
                <template #default="{ row }">{{
                  fmtNum(row.conf_mean)
                }}</template>
              </el-table-column>
              <el-table-column label="按下用时 中位数" width="120">
                <template #default="{ row }">{{
                  fmtMs(row.rt_median)
                }}</template>
              </el-table-column>
            </el-table>
          </div>

          <div class="key-tips">
            <b>手机（触屏）和电脑（键盘）的数据怎么处理</b>
            <ol>
              <li>
                绝对时长（毫秒）分开看：手指按屏幕和按键盘是不同的动作，上面的表和分布图已经按「作答输入」分开。
              </li>
              <li>
                想合在一起分析，用被试内的指标：三档、被试内相关、每题的被试内标准分，每个人只和自己比，设备差异和个人快慢习惯都消掉了。
              </li>
              <li>
                比较不同的人（比如按住时长和总分有没有关系）时，用每人的中位数（导出的「按键数据（每人一行）」里有），并且在同一种设备内比较，或者把作答输入作为控制变量。
              </li>
              <li>
                研究设计上最省事的是统一设备：电脑发「按键作答」链接，手机发「点击作答」链接（生成链接时可以选）。
              </li>
              <li>
                正式分析建议用导出的「按键数据（每题一行）」做混合效应模型：把握程度
                ~ 按住时长 + 按下用时 +
                作答输入，被试作为随机截距（论文的做法）。
              </li>
            </ol>
          </div>
        </section>

        <!-- 逐题分析 -->
        <section class="block">
          <h3>逐题分析</h3>
          <p class="muted">
            显示受测者的原始选择（反向计分题没有反转）。多选题的百分比按作答人数计算，加起来会超过
            100%。
          </p>
          <div v-for="item in stats.items" :key="item.id" class="item-card">
            <div class="item-head">
              <span class="item-no">Q{{ item.order_num }}</span>
              <span class="item-content">{{ item.content }}</span>
              <el-tag size="small" type="info">{{
                typeNames[item.type] || item.type
              }}</el-tag>
              <el-tag v-if="item.reverse" size="small" type="warning"
                >反向</el-tag
              >
            </div>
            <div class="item-meta">{{ itemMeta(item) }}</div>

            <div v-if="item.distribution.length > 0" class="dist">
              <div
                v-for="d in item.distribution"
                :key="d.label"
                class="dist-row"
              >
                <span class="dist-label">{{ d.label }}</span>
                <span class="dist-bar"
                  ><i :style="{ width: barPct(item, d.count) + '%' }"></i
                ></span>
                <span class="dist-count">{{ d.count }} 人（{{ d.pct }}%）</span>
              </div>
            </div>

            <div v-if="item.type === 'open_text'" class="texts">
              <p v-if="item.texts.length === 0" class="muted">还没有回答</p>
              <p
                v-for="(t, i) in openExpanded[item.id]
                  ? item.texts
                  : item.texts.slice(0, 5)"
                :key="i"
                class="text-row"
              >
                {{ t }}
              </p>
              <el-button
                v-if="item.texts.length > 5"
                text
                size="small"
                type="primary"
                @click="openExpanded[item.id] = !openExpanded[item.id]"
                >{{
                  openExpanded[item.id]
                    ? "收起"
                    : `查看全部 ${item.texts.length} 条（最近的在前）`
                }}</el-button
              >
            </div>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.container {
  /* 显示在问卷外框（QuestionnaireShell）里，宽度跟外框一致 */
  padding-bottom: 24px;
}
.page-head {
  margin: 12px 0 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.sub-block {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px dashed #eee;
}
.muted-inline {
  color: #999;
  font-size: 12px;
}
.sig {
  color: #c0392b;
  font-weight: 600;
}
.bad {
  color: #c0392b;
  font-weight: 600;
}
.weak {
  color: #b88230;
  font-weight: 600;
}
.tip-text {
  font-size: 12px;
  color: #b88230;
}
.compare-pick {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.page-head h2 {
  margin: 0;
  font-size: 20px;
  color: #3d2b12;
}
.sub {
  margin: 4px 0 0;
  color: #8a7a5e;
  font-size: 14px;
}
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 24px;
  background: #fff8e7;
  border: 1px solid #f0dcae;
  border-radius: 8px;
  padding: 12px 16px;
}
.filter-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.filter-label {
  font-size: 14px;
  color: #5a4a2e;
}
.filter-summary {
  font-size: 13px;
  color: #666;
  margin: 10px 2px 16px;
  line-height: 1.7;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.tile {
  background: white;
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 12px 16px;
}
.tile-label {
  font-size: 12px;
  color: #999;
}
.tile-value {
  font-size: 22px;
  font-weight: 600;
  color: #3d2b12;
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
}
.tile-value small {
  font-size: 13px;
  font-weight: 400;
  color: #999;
}
.tile-value.small {
  font-size: 14px;
  font-weight: 500;
}
.block {
  background: white;
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 16px;
}
.block h3 {
  margin: 0 0 8px;
  font-size: 16px;
  color: #3d2b12;
}
.block h4 {
  margin: 0 0 8px;
  font-size: 14px;
  color: #5a4a2e;
}
.muted {
  color: #999;
  font-size: 12px;
  margin: 0 0 10px;
}
:deep(.row-active) td {
  background: #fff3e6 !important;
}
:deep(.el-table__row) {
  cursor: pointer;
}
.measure-detail {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: 24px;
  margin-top: 16px;
}
.band-row {
  display: grid;
  grid-template-columns: 12px minmax(70px, auto) 1fr auto;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  font-size: 13px;
}
.band-swatch {
  width: 10px;
  height: 10px;
  border-radius: 3px;
}
.band-label {
  color: #3d2b12;
  white-space: nowrap;
}
.band-label small {
  color: #aaa;
  margin-left: 4px;
}
.band-bar,
.dist-bar {
  height: 10px;
  background: #f3f0ea;
  border-radius: 0 4px 4px 0;
  overflow: hidden;
}
.band-bar i,
.dist-bar i {
  display: block;
  height: 100%;
  border-radius: 0 4px 4px 0;
}
.dist-bar i {
  background: #d9692f;
}
.band-count,
.dist-count {
  color: #666;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.group-chart {
  margin-top: 14px;
}
.item-card {
  border-top: 1px solid #f2f2f2;
  padding: 12px 0;
}
.item-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.item-no {
  font-weight: 600;
  color: #d9692f;
  font-variant-numeric: tabular-nums;
}
.item-content {
  color: #3d2b12;
  font-size: 14px;
}
.item-meta {
  font-size: 12px;
  color: #999;
  margin: 4px 0 8px;
}
.dist-row {
  display: grid;
  grid-template-columns: 150px 1fr 110px;
  align-items: center;
  gap: 10px;
  margin: 4px 0;
  font-size: 13px;
}
.dist-label {
  color: #5a4a2e;
}
.texts {
  font-size: 13px;
}
.text-row {
  margin: 4px 0;
  padding: 6px 10px;
  background: #fafafa;
  border-radius: 6px;
  color: #444;
}
.key-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin: 4px 0 14px;
}
.key-hist-note {
  margin: 10px 0 0;
}
.key-warn {
  font-size: 12px;
  color: #b88230;
  background: #fff8e7;
  border-radius: 6px;
  padding: 6px 10px;
  margin: 0 0 10px;
}
.key-hists {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 16px;
  margin-top: 14px;
}
.key-scope-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.key-scope-head h4 {
  margin: 0;
}
.key-bins {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: 20px;
  align-items: center;
}
.key-bins-text {
  font-size: 13px;
  color: #5a4a2e;
  line-height: 1.7;
}
.key-bins-text p {
  margin: 0 0 4px;
}
.key-result {
  font-size: 13px;
  color: #3d2b12;
  line-height: 1.8;
  margin: 10px 0 0;
}
.key-tips {
  margin-top: 18px;
  background: #f6f9fb;
  border: 1px solid #dde8ee;
  border-radius: 8px;
  padding: 12px 16px;
  font-size: 13px;
  color: #3d4a52;
  line-height: 1.7;
}
.key-tips ol {
  margin: 6px 0 0;
  padding-left: 20px;
}
@media (max-width: 760px) {
  .measure-detail {
    grid-template-columns: 1fr;
  }
  .key-bins {
    grid-template-columns: 1fr;
  }
}
</style>
