<script setup>
// 从其他问卷复制题目：可以同时选几份问卷，勾选其中的部分或全部题目，复制到当前问卷的最后
import { ref, computed, watch } from "vue";
import { ElMessage } from "element-plus";

const SERVER = "http://localhost:3000";
const props = defineProps({
  targetId: { type: [Number, String], required: true }, // 复制到哪份问卷
});
const visible = defineModel({ type: Boolean, default: false });
const emit = defineEmits(["copied"]);

const questionnaires = ref([]); // 可以选的来源问卷
const sources = ref([]); // 选中的来源问卷 id（按选择顺序）
const sourceData = ref({}); // { 问卷id: { title, questions } }
const loadingIds = ref([]);
const checked = ref([]); // 勾选的题目 id
const keyword = ref("");
const withSections = ref(true);
const withDimensions = ref(true);
const copying = ref(false);

const token = () => localStorage.getItem("admin_token");

watch(visible, async (open) => {
  if (!open) return;
  sources.value = [];
  sourceData.value = {};
  checked.value = [];
  keyword.value = "";
  try {
    const res = await fetch(`${SERVER}/api/questionnaires`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    const data = await res.json();
    if (data.success) {
      questionnaires.value = data.questionnaires.filter(
        (q) => String(q.id) !== String(props.targetId),
      );
    }
  } catch {
    ElMessage.error("加载问卷列表失败");
  }
});

// 新选了来源问卷时加载它的题目；取消选择时把它的题目从勾选里去掉
watch(sources, async (ids, oldIds = []) => {
  for (const id of ids) {
    if (sourceData.value[id] || loadingIds.value.includes(id)) continue;
    loadingIds.value.push(id);
    try {
      const res = await fetch(`${SERVER}/api/questionnaires/${id}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) {
        sourceData.value[id] = {
          title: data.questionnaire.title,
          questions: data.questions,
        };
      }
    } finally {
      loadingIds.value = loadingIds.value.filter((x) => x !== id);
    }
  }
  const removed = oldIds.filter((id) => !ids.includes(id));
  removed.forEach((id) => {
    const qids = (sourceData.value[id]?.questions || []).map((q) => q.id);
    checked.value = checked.value.filter((x) => !qids.includes(x));
  });
});

function visibleQuestions(id) {
  const list = sourceData.value[id]?.questions || [];
  const k = keyword.value.trim();
  if (!k) return list;
  return list.filter((q) => q.content.includes(k) || String(q.order_num) === k);
}

function checkedCount(id) {
  const ids = (sourceData.value[id]?.questions || []).map((q) => q.id);
  return ids.filter((x) => checked.value.includes(x)).length;
}

// 「全选」只作用于当前搜索结果
function allChecked(id) {
  const list = visibleQuestions(id);
  return list.length > 0 && list.every((q) => checked.value.includes(q.id));
}
function someChecked(id) {
  const list = visibleQuestions(id);
  const n = list.filter((q) => checked.value.includes(q.id)).length;
  return n > 0 && n < list.length;
}
function toggleAll(id, on) {
  const ids = visibleQuestions(id).map((q) => q.id);
  if (on) checked.value = [...new Set([...checked.value, ...ids])];
  else checked.value = checked.value.filter((x) => !ids.includes(x));
}

// 发给后端的顺序：按选择来源问卷的顺序，每份问卷里按题号
const orderedIds = computed(() => {
  const result = [];
  sources.value.forEach((id) => {
    (sourceData.value[id]?.questions || []).forEach((q) => {
      if (checked.value.includes(q.id)) result.push(q.id);
    });
  });
  return result;
});

const typeNames = {
  scale: "量表",
  single_choice: "单选",
  multiple_choice: "多选",
  yes_no: "是否",
  open_text: "开放题",
};

// 题目有没有图片、视频（题干或选项）
function hasMedia(q) {
  const parse = (v) => {
    if (typeof v !== "string") return v;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  };
  const m = parse(q.media);
  if (Array.isArray(m) && m.length > 0) return true;
  const opts = parse(q.options);
  return Array.isArray(opts) && opts.some((o) => o && o.image);
}

async function doCopy() {
  if (orderedIds.value.length === 0) {
    ElMessage.warning("请先勾选要复制的题目");
    return;
  }
  copying.value = true;
  try {
    const res = await fetch(
      `${SERVER}/api/questionnaires/${props.targetId}/copy-questions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token()}`,
        },
        body: JSON.stringify({
          question_ids: orderedIds.value,
          with_sections: withSections.value,
          with_dimensions: withDimensions.value,
        }),
      },
    );
    const data = await res.json();
    if (data.success) {
      ElMessage({ type: "success", message: data.message, duration: 5000 });
      visible.value = false;
      emit("copied", data);
    } else {
      ElMessage.error(data.message);
    }
  } catch {
    ElMessage.error("复制失败，请检查后端服务");
  } finally {
    copying.value = false;
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="从其他问卷复制题目"
    width="760px"
    top="6vh"
  >
    <p class="hint">
      可以同时选几份问卷，勾选其中的部分或全部题目。复制的题目接在本问卷最后，题型、选项分值、反向计分、图片都会一起复制，之后可以拖动调整顺序。
    </p>

    <div class="pick-row">
      <el-select
        v-model="sources"
        multiple
        filterable
        placeholder="选择来源问卷（可多选）"
        style="flex: 1"
      >
        <el-option
          v-for="q in questionnaires"
          :key="q.id"
          :value="q.id"
          :label="`${q.title}（${q.question_count} 题）`"
        />
      </el-select>
      <el-input
        v-model="keyword"
        placeholder="搜索题目内容或题号"
        clearable
        style="width: 200px"
      />
    </div>

    <div class="source-area">
      <el-empty
        v-if="sources.length === 0"
        :image-size="60"
        description="先在上面选择要从哪份问卷复制"
      />
      <div v-for="id in sources" :key="id" class="src-block">
        <div class="src-head">
          <el-checkbox
            :model-value="allChecked(id)"
            :indeterminate="someChecked(id)"
            :disabled="visibleQuestions(id).length === 0"
            @change="(v) => toggleAll(id, v)"
          >
            <b>{{ sourceData[id]?.title || "加载中…" }}</b>
          </el-checkbox>
          <span class="src-count"
            >已选 {{ checkedCount(id) }} /
            {{ sourceData[id]?.questions.length ?? "…" }} 题</span
          >
        </div>
        <el-checkbox-group v-model="checked" class="src-list">
          <el-checkbox
            v-for="q in visibleQuestions(id)"
            :key="q.id"
            :value="q.id"
            class="src-item"
          >
            <span class="q-no">Q{{ q.order_num }}</span>
            <span class="q-text">{{ q.content }}</span>
            <el-tag size="small" type="info" class="q-tag">{{
              typeNames[q.question_type || "scale"]
            }}</el-tag>
            <el-tag
              v-if="q.is_reverse_scored"
              size="small"
              type="warning"
              class="q-tag"
              >反向</el-tag
            >
            <el-tag v-if="hasMedia(q)" size="small" class="q-tag"
              >有图片/视频</el-tag
            >
          </el-checkbox>
          <p
            v-if="sourceData[id] && visibleQuestions(id).length === 0"
            class="empty-tip"
          >
            {{ keyword ? "没有匹配的题目" : "这份问卷还没有题目" }}
          </p>
        </el-checkbox-group>
      </div>
    </div>

    <template #footer>
      <div class="footer">
        <div class="footer-opts">
          <el-checkbox v-model="withSections"
            >连同所属板块（标题和引导语）</el-checkbox
          >
          <el-checkbox v-model="withDimensions"
            >连同所属维度（本问卷有同名维度时并入）</el-checkbox
          >
        </div>
        <div>
          <el-button @click="visible = false">取消</el-button>
          <el-button
            type="primary"
            :loading="copying"
            :disabled="orderedIds.length === 0"
            @click="doCopy"
            >复制 {{ orderedIds.length }} 道题</el-button
          >
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: #666;
  line-height: 1.6;
}
.pick-row {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}
.source-area {
  max-height: 52vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.src-block {
  border: 1px solid #f0dcae;
  border-radius: 8px;
  overflow: hidden;
}
.src-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: #fff8e7;
}
.src-count {
  font-size: 12px;
  color: #8b5a2b;
}
.src-list {
  display: flex;
  flex-direction: column;
  padding: 6px 12px;
}
.src-item {
  display: flex;
  align-items: flex-start;
  height: auto;
  white-space: normal;
  margin-right: 0;
  padding: 4px 0;
}
.src-item :deep(.el-checkbox__label) {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
}
.q-no {
  color: #8b5a2b;
  font-weight: 600;
  font-size: 12px;
  min-width: 34px;
}
.q-text {
  font-size: 13px;
  color: #3d2b12;
  line-height: 1.5;
}
.q-tag {
  flex-shrink: 0;
}
.empty-tip {
  font-size: 12px;
  color: #aaa;
  margin: 6px 0;
}
.footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.footer-opts {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
}
</style>
