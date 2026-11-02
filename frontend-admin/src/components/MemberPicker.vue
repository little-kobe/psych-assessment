<script setup>
// 选研究者（给导师分配名下研究者用）：搜索、全选、反选、清空、只看未分配，按住 Shift 点击可以连续选一段
import { ref, computed } from "vue";
import { Search } from "@element-plus/icons-vue";

const props = defineProps({
  modelValue: { type: Array, default: () => [] }, // 选中的研究者 id
  // 所有研究者：[{ id, display_name, username, supervisor_id, supervisor_name }]
  researchers: { type: Array, default: () => [] },
  // 正在编辑的导师 id（新建时为空）。已经在他名下的研究者不提示「现属其他导师」
  supervisorId: { type: Number, default: null },
});
const emit = defineEmits(["update:modelValue"]);

const keyword = ref("");
const onlyUnassigned = ref(false);
const lastIndex = ref(-1); // 上次点的是可见列表里的第几个（Shift 连选用）

const selected = computed(() => new Set(props.modelValue));

const visible = computed(() => {
  const k = keyword.value.trim().toLowerCase();
  return props.researchers.filter((r) => {
    if (onlyUnassigned.value && r.supervisor_id) return false;
    if (!k) return true;
    return (
      (r.display_name || "").toLowerCase().includes(k) ||
      (r.username || "").toLowerCase().includes(k)
    );
  });
});

// 选中的人里，原来属于别的导师的（保存后会转过来）
const movingCount = computed(
  () =>
    props.researchers.filter(
      (r) =>
        selected.value.has(r.id) &&
        r.supervisor_id &&
        r.supervisor_id !== props.supervisorId,
    ).length,
);

function update(set) {
  // 保持和研究者列表一样的顺序
  emit(
    "update:modelValue",
    props.researchers.filter((r) => set.has(r.id)).map((r) => r.id),
  );
}

function toggle(r, index, event) {
  const set = new Set(selected.value);
  const willSelect = !set.has(r.id);
  if (event?.shiftKey && lastIndex.value >= 0) {
    // Shift：从上次点的那个到这个，全部设成和这个一样的状态
    const [from, to] = [lastIndex.value, index].sort((a, b) => a - b);
    visible.value.slice(from, to + 1).forEach((x) => {
      if (willSelect) set.add(x.id);
      else set.delete(x.id);
    });
  } else if (willSelect) set.add(r.id);
  else set.delete(r.id);
  lastIndex.value = index;
  update(set);
}

function selectAll() {
  const set = new Set(selected.value);
  visible.value.forEach((r) => set.add(r.id));
  update(set);
}
function invert() {
  const set = new Set(selected.value);
  visible.value.forEach((r) =>
    set.has(r.id) ? set.delete(r.id) : set.add(r.id),
  );
  update(set);
}
function clearVisible() {
  const set = new Set(selected.value);
  visible.value.forEach((r) => set.delete(r.id));
  update(set);
}
</script>

<template>
  <div class="picker">
    <div class="tools">
      <el-input
        v-model="keyword"
        :prefix-icon="Search"
        placeholder="搜索姓名或账号"
        clearable
        size="small"
        class="search"
      />
      <el-checkbox v-model="onlyUnassigned" size="small"
        >只看未分配</el-checkbox
      >
    </div>
    <div class="tools">
      <div class="quick">
        <el-button size="small" text type="primary" @click="selectAll"
          >全选</el-button
        >
        <el-button size="small" text type="primary" @click="invert"
          >反选</el-button
        >
        <el-button size="small" text @click="clearVisible">清空</el-button>
      </div>
      <span class="count"
        >已选 <b>{{ modelValue.length }}</b> / {{ researchers.length }} 人</span
      >
    </div>

    <div class="list">
      <div
        v-for="(r, i) in visible"
        :key="r.id"
        class="row"
        :class="{ on: selected.has(r.id) }"
        @click="toggle(r, i, $event)"
      >
        <el-checkbox
          :model-value="selected.has(r.id)"
          @click.prevent
          size="small"
        />
        <span class="name">{{ r.display_name }}</span>
        <span class="user">{{ r.username }}</span>
        <span
          v-if="r.supervisor_id && r.supervisor_id !== supervisorId"
          class="tag other"
          >现属 {{ r.supervisor_name }}</span
        >
        <span v-else-if="!r.supervisor_id" class="tag free">未分配</span>
      </div>
      <div v-if="visible.length === 0" class="empty">
        {{
          researchers.length === 0 ? "还没有研究者账号" : "没有符合条件的研究者"
        }}
      </div>
    </div>
    <div class="hint">
      点一行勾选，按住 Shift 再点另一行可以连续选一段。「全选 / 反选 /
      清空」只作用于当前筛选出来的人。
      <span v-if="movingCount > 0" class="warn"
        >其中 {{ movingCount }} 人现在属于其他导师，保存后会转过来。</span
      >
    </div>
  </div>
</template>

<style scoped>
.picker {
  width: 100%;
  border: 1px solid var(--app-border);
  border-radius: 10px;
  padding: 10px 12px;
  background: #fffdf9;
}
.tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}
.search {
  flex: 1;
}
.quick .el-button + .el-button {
  margin-left: 4px;
}
.count {
  font-size: 12px;
  color: var(--app-text-3);
}
.count b {
  color: var(--el-color-primary);
}
.list {
  max-height: 240px;
  overflow-y: auto;
  border-top: 1px solid #f0ebe2;
  user-select: none;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 6px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  line-height: 1.4;
}
.row:hover {
  background: #faf5ec;
}
.row.on {
  background: #fdf1e8;
}
.name {
  color: var(--app-text);
}
.user {
  color: var(--app-text-3);
  font-size: 12px;
}
.tag {
  margin-left: auto;
  font-size: 11px;
  padding: 0 8px;
  border-radius: 999px;
  white-space: nowrap;
}
.tag.other {
  background: #fdf2dc;
  color: #a96a14;
}
.tag.free {
  background: #f3ede3;
  color: var(--app-text-3);
}
.empty {
  padding: 20px 0;
  text-align: center;
  font-size: 13px;
  color: var(--app-text-3);
}
.hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--app-text-3);
  line-height: 1.6;
}
.warn {
  color: #a96a14;
}
</style>
