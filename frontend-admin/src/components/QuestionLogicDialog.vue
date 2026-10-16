<script setup>
// 题目逻辑设置弹窗：题目关联（满足条件才显示这道题）、跳题逻辑、选项关联
// mode：display = 题目关联，jump = 跳题逻辑，option = 选项关联
import { ref, computed, watch } from "vue";
import { ElMessage } from "element-plus";
import { API_BASE } from "../api.js";
import {
  normalizeLogic,
  flowOrder,
  optionChoices,
  canBeSource,
  canJumpByOption,
  canLinkOptions,
  questionTitle,
} from "../logic.js";

const props = defineProps({
  mode: { type: String, default: "display" },
  question: { type: Object, default: null }, // 正在设置的题目
  questions: { type: Array, default: () => [] }, // 这份问卷的所有题目
});
const visible = defineModel({ type: Boolean, default: false });
const emit = defineEmits(["saved"]);
const saving = ref(false);

const titles = {
  display: "题目关联：满足条件才显示这道题",
  jump: "跳题逻辑",
  option: "选项关联：选项跟随前面某题变化",
};

// 按作答顺序，这道题前面的题、后面的题
const flow = computed(() => flowOrder(props.questions));
const myPos = computed(() =>
  flow.value.findIndex((q) => props.question && q.id === props.question.id),
);
const earlierSources = computed(() =>
  flow.value.slice(0, Math.max(0, myPos.value)).filter(canBeSource),
);
const laterQuestions = computed(() => flow.value.slice(myPos.value + 1));
const byId = computed(() => {
  const m = {};
  props.questions.forEach((q) => (m[q.id] = q));
  return m;
});
function choicesOf(id) {
  return optionChoices(byId.value[id]);
}

// ---------- 题目关联 ----------
const match = ref("any");
const conditions = ref([]); // [{ question_id, options: [] }]
function addCondition() {
  conditions.value.push({ question_id: null, options: [] });
}

// ---------- 跳题逻辑 ----------
const jumpMode = ref("none"); // none / option / always
const ruleTargets = ref({}); // { 选项: 跳转目标 }，"" 表示不跳转
const alwaysTarget = ref("");
const myChoices = computed(() => optionChoices(props.question));
const targetOptions = computed(() => [
  { value: "end", label: "跳到问卷末尾，结束作答" },
  { value: "invalid", label: "直接提交为无效答卷（不计入统计）" },
  ...laterQuestions.value.map((q) => ({
    value: q.id,
    label: `跳到 ${questionTitle(q, 30)}`,
  })),
]);

// ---------- 选项关联 ----------
const linkSource = ref(null);
const linkMap = ref({}); // { 本题选项: [来源题的选项] }
const myOptionLabels = computed(() =>
  optionChoices(props.question).map((c) => c.key),
);

// 打开弹窗时，把这道题已有的设置填进来
watch(visible, (open) => {
  if (!open || !props.question) return;
  const lg = normalizeLogic(props.question.logic);
  match.value = lg.display ? lg.display.match : "any";
  conditions.value = lg.display
    ? lg.display.conditions.map((c) => ({
        question_id: byId.value[c.question_id] ? c.question_id : null,
        options: [...c.options],
      }))
    : [];
  if (props.mode === "display" && conditions.value.length === 0) addCondition();

  jumpMode.value = lg.jump ? lg.jump.mode : "none";
  ruleTargets.value = {};
  alwaysTarget.value = "";
  if (lg.jump && lg.jump.mode === "always") alwaysTarget.value = lg.jump.target;
  if (lg.jump && lg.jump.mode === "option") {
    lg.jump.rules.forEach((r) => (ruleTargets.value[r.option] = r.target));
  }
  if (!canJumpByOption(props.question) && jumpMode.value === "option")
    jumpMode.value = "none";

  linkSource.value = lg.option_link ? lg.option_link.question_id : null;
  linkMap.value = {};
  myOptionLabels.value.forEach((label) => (linkMap.value[label] = []));
  if (lg.option_link) {
    lg.option_link.items.forEach((it) => {
      if (linkMap.value[it.option] !== undefined)
        linkMap.value[it.option] = [...it.show_when];
    });
  }
});

// 换了选项关联的来源题，清空已勾选的
function changeLinkSource() {
  Object.keys(linkMap.value).forEach((k) => (linkMap.value[k] = []));
}

// 按当前弹窗里的设置，生成这一部分的逻辑（返回 null 表示清除）
function buildPart() {
  if (props.mode === "display") {
    const conds = conditions.value
      .filter((c) => c.question_id && c.options.length > 0)
      .map((c) => ({ question_id: c.question_id, options: [...c.options] }));
    return conds.length > 0 ? { match: match.value, conditions: conds } : null;
  }
  if (props.mode === "jump") {
    if (jumpMode.value === "always") {
      return alwaysTarget.value
        ? { mode: "always", target: alwaysTarget.value }
        : null;
    }
    if (jumpMode.value === "option") {
      const rules = myChoices.value
        .filter((c) => ruleTargets.value[c.key])
        .map((c) => ({ option: c.key, target: ruleTargets.value[c.key] }));
      return rules.length > 0 ? { mode: "option", rules } : null;
    }
    return null;
  }
  if (!linkSource.value) return null;
  const items = Object.entries(linkMap.value)
    .filter(([, keys]) => keys.length > 0)
    .map(([option, keys]) => ({ option, show_when: [...keys] }));
  return items.length > 0 ? { question_id: linkSource.value, items } : null;
}

// 保存前检查：有没有填了一半的
function checkBeforeSave() {
  if (props.mode === "display") {
    if (conditions.value.some((c) => c.question_id && c.options.length === 0))
      return "有条件选了题目，但没有勾选选项";
  }
  if (
    props.mode === "jump" &&
    jumpMode.value === "always" &&
    !alwaysTarget.value
  )
    return "请选择填写这道题后跳转到哪里";
  if (props.mode === "option" && linkSource.value) {
    const anyChecked = Object.values(linkMap.value).some((k) => k.length > 0);
    if (!anyChecked) return "请至少给一个选项勾选显示条件，或者选择「不关联」";
  }
  return "";
}

async function save(clear = false) {
  if (!clear) {
    const problem = checkBeforeSave();
    if (problem) {
      ElMessage.warning(problem);
      return;
    }
  }
  const lg = normalizeLogic(props.question.logic);
  const key = { display: "display", jump: "jump", option: "option_link" }[
    props.mode
  ];
  const next = {
    display: lg.display,
    jump: lg.jump,
    option_link: lg.option_link,
  };
  next[key] = clear ? null : buildPart();
  saving.value = true;
  try {
    const res = await fetch(
      `${API_BASE}/api/questions/${props.question.id}/logic`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
        },
        body: JSON.stringify({ logic: next }),
      },
    );
    const data = await res.json();
    if (data.success) {
      ElMessage.success(clear || !next[key] ? "已清除" : "已保存");
      visible.value = false;
      emit("saved", data.logic);
    } else {
      ElMessage.error(data.message);
    }
  } catch {
    ElMessage.error("保存失败，请检查后端服务");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="titles[mode]"
    width="680px"
    top="8vh"
    append-to-body
  >
    <div v-if="question" class="logic-body">
      <p class="current-q">当前题目：{{ questionTitle(question, 40) }}</p>

      <!-- ========== 题目关联 ========== -->
      <template v-if="mode === 'display'">
        <el-empty
          v-if="earlierSources.length === 0"
          :image-size="60"
          description="这道题前面没有可以当作条件的题目（需要单选、多选、是否或量表题）"
        />
        <template v-else>
          <p class="block-title">前面的题目满足下面的条件时，才显示这道题：</p>
          <div v-for="(c, i) in conditions" :key="i" class="cond-card">
            <div class="cond-head">
              <span class="cond-no">条件 {{ i + 1 }}</span>
              <el-select
                v-model="c.question_id"
                placeholder="选择前面的题目"
                filterable
                class="cond-select"
                @change="c.options = []"
              >
                <el-option
                  v-for="s in earlierSources"
                  :key="s.id"
                  :value="s.id"
                  :label="questionTitle(s, 30)"
                />
              </el-select>
              <el-button
                text
                type="danger"
                size="small"
                @click="conditions.splice(i, 1)"
                >删除</el-button
              >
            </div>
            <div v-if="c.question_id" class="cond-options">
              <span class="muted">选了以下任意一个：</span>
              <el-checkbox-group v-model="c.options">
                <el-checkbox
                  v-for="o in choicesOf(c.question_id)"
                  :key="o.key"
                  :value="o.key"
                  >{{ o.text }}</el-checkbox
                >
              </el-checkbox-group>
            </div>
          </div>
          <el-button size="small" @click="addCondition">+ 添加条件</el-button>
          <div v-if="conditions.length > 1" class="match-row">
            多个条件之间：
            <el-radio-group v-model="match">
              <el-radio value="any">满足任意一个就显示</el-radio>
              <el-radio value="all">全部满足才显示</el-radio>
            </el-radio-group>
          </div>
          <p class="tip">
            条件只能选这道题前面的题。前面的题自己没显示（被跳过、被隐藏）时，它的条件算不满足。不设条件，这道题就总是显示。
          </p>
        </template>
      </template>

      <!-- ========== 跳题逻辑 ========== -->
      <template v-else-if="mode === 'jump'">
        <el-radio-group v-model="jumpMode" class="jump-mode">
          <el-radio value="none">不跳题</el-radio>
          <el-radio value="option" :disabled="!canJumpByOption(question)"
            >按选项跳题</el-radio
          >
          <el-radio value="always">无条件跳题</el-radio>
        </el-radio-group>
        <p v-if="!canJumpByOption(question)" class="tip">
          多选题、开放题只能用「无条件跳题」。
        </p>

        <table v-if="jumpMode === 'option'" class="jump-table">
          <thead>
            <tr>
              <th>选择</th>
              <th>跳转到</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in myChoices" :key="c.key">
              <td class="opt-cell">{{ c.text }}</td>
              <td>
                <el-select
                  v-model="ruleTargets[c.key]"
                  placeholder="不跳转，按顺序填写下一题"
                  clearable
                  filterable
                  class="target-select"
                >
                  <el-option
                    v-for="t in targetOptions"
                    :key="t.value"
                    :value="t.value"
                    :label="t.label"
                  />
                </el-select>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="jumpMode === 'always'" class="always-row">
          填写这道题后跳转到
          <el-select
            v-model="alwaysTarget"
            placeholder="选择跳转到哪里"
            filterable
            class="target-select"
          >
            <el-option
              v-for="t in targetOptions"
              :key="t.value"
              :value="t.value"
              :label="t.label"
            />
          </el-select>
        </div>

        <p class="tip">
          中间被跳过的题不显示，也不计分。「结束作答」会直接提交，算正常答卷；「无效答卷」也会提交，但不进入统计和常模，导出时会注明（常用来筛掉不符合条件的人）。<br />
          只想根据前面的回答显示或隐藏某几道题时，用「题目关联」更方便。
        </p>
      </template>

      <!-- ========== 选项关联 ========== -->
      <template v-else>
        <el-empty
          v-if="!canLinkOptions(question)"
          :image-size="60"
          description="只有单选题、多选题可以设置选项关联"
        />
        <el-empty
          v-else-if="earlierSources.length === 0"
          :image-size="60"
          description="这道题前面没有可以关联的题目（需要单选、多选、是否或量表题）"
        />
        <template v-else>
          <div class="link-source">
            这道题的选项跟随
            <el-select
              v-model="linkSource"
              placeholder="不关联"
              clearable
              filterable
              class="cond-select"
              @change="changeLinkSource"
            >
              <el-option
                v-for="s in earlierSources"
                :key="s.id"
                :value="s.id"
                :label="questionTitle(s, 30)"
              />
            </el-select>
            变化
          </div>
          <table v-if="linkSource" class="jump-table">
            <thead>
              <tr>
                <th>本题选项</th>
                <th>前面那题选了这些时才显示（不勾选 = 总是显示）</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="label in myOptionLabels" :key="label">
                <td class="opt-cell">{{ label }}</td>
                <td>
                  <el-checkbox-group v-model="linkMap[label]">
                    <el-checkbox
                      v-for="o in choicesOf(linkSource)"
                      :key="o.key"
                      :value="o.key"
                      >{{ o.text }}</el-checkbox
                    >
                  </el-checkbox-group>
                </td>
              </tr>
            </tbody>
          </table>
          <p class="tip">
            例如第 1 题选手机品牌，第 2 题选型号：给「华为 Mate
            60」勾上「华为」，选了华为的人才会看到它。
            一个选项都不显示时，这道题会自动跳过。
          </p>
        </template>
      </template>
    </div>

    <template #footer>
      <div class="footer">
        <el-button text type="danger" :loading="saving" @click="save(true)"
          >清除这项设置</el-button
        >
        <div>
          <el-button @click="visible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="save(false)"
            >保存</el-button
          >
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.logic-body {
  max-height: 64vh;
  overflow-y: auto;
  padding-right: 4px;
}
.current-q {
  margin: 0 0 14px;
  font-weight: 600;
  color: #3d2b12;
  background: #fff8e7;
  border-radius: 6px;
  padding: 8px 12px;
  line-height: 1.5;
}
.block-title {
  margin: 0 0 10px;
  font-size: 13px;
  color: #666;
}
.cond-card {
  border: 1px solid #f0dcae;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
.cond-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cond-no {
  font-size: 12px;
  color: #8b5a2b;
  font-weight: 600;
  flex-shrink: 0;
}
.cond-select {
  flex: 1;
  min-width: 260px;
}
.cond-options {
  margin-top: 8px;
  padding-left: 52px;
}
.muted {
  font-size: 12px;
  color: #999;
}
.match-row {
  margin-top: 12px;
  font-size: 13px;
  color: #3d2b12;
  display: flex;
  align-items: center;
  gap: 8px;
}
.jump-mode {
  margin-bottom: 8px;
}
.jump-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 8px;
  font-size: 13px;
}
.jump-table th {
  text-align: left;
  font-weight: 600;
  color: #8b5a2b;
  background: #fff8e7;
  padding: 8px 10px;
}
.jump-table td {
  border-top: 1px solid #f3e6c4;
  padding: 8px 10px;
  vertical-align: middle;
}
.opt-cell {
  width: 32%;
  color: #3d2b12;
}
.target-select {
  width: 100%;
}
.always-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  font-size: 13px;
  white-space: nowrap;
}
.link-source {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #3d2b12;
}
.tip {
  margin: 12px 0 0;
  font-size: 12px;
  color: #999;
  line-height: 1.7;
}
.footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
