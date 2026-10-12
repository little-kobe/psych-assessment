<script setup>
import { API_BASE } from "../api.js";
// 新建 / 编辑问卷组合：选择问卷、拖动排序、设置说明和开关
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import Sortable from "sortablejs";
import ShareLinkDialog from "../components/ShareLinkDialog.vue";

const SERVER = API_BASE;
const route = useRoute();
const router = useRouter();
const isNew = route.params.id === "new";
const bundleId = ref(isNew ? null : Number(route.params.id));

const loading = ref(true);
const saving = ref(false);
const form = ref({
  title: "",
  description: "",
  consent_text: "",
  shuffle: false,
  is_active: true,
});
const selected = ref([]); // 组合里的问卷（按顺序）：[{ id, title, question_count }]
const allQuestionnaires = ref([]);
const toAdd = ref([]);
const participants = ref(0);
const showLink = ref(false);

const token = () => localStorage.getItem("admin_token");

// 还没加进组合的问卷
const available = computed(() =>
  allQuestionnaires.value.filter(
    (q) => !selected.value.some((s) => s.id === q.id),
  ),
);
const totalQuestions = computed(() =>
  selected.value.reduce((n, q) => n + Number(q.question_count || 0), 0),
);

async function load() {
  try {
    const res = await fetch(`${SERVER}/api/questionnaires`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    const data = await res.json();
    if (data.success) allQuestionnaires.value = data.questionnaires;

    if (!isNew) {
      const r = await fetch(`${SERVER}/api/bundles/${bundleId.value}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const d = await r.json();
      if (!d.success) {
        ElMessage.error(d.message);
        router.push("/bundles");
        return;
      }
      const b = d.bundle;
      form.value = {
        title: b.title,
        description: b.description || "",
        consent_text: b.consent_text || "",
        shuffle: !!b.shuffle,
        is_active: !!b.is_active,
      };
      selected.value = b.questionnaires.map((q) => ({
        id: q.id,
        title: q.title,
        question_count: q.question_count,
      }));
      participants.value = b.participants;
    }
  } catch {
    ElMessage.error("加载失败，请检查后端服务");
  } finally {
    loading.value = false;
  }
}

function addSelected() {
  toAdd.value.forEach((id) => {
    const q = allQuestionnaires.value.find((x) => x.id === id);
    if (q && !selected.value.some((s) => s.id === id)) {
      selected.value.push({
        id: q.id,
        title: q.title,
        question_count: q.question_count,
      });
    }
  });
  toAdd.value = [];
}

function removeAt(i) {
  selected.value.splice(i, 1);
}

// ---------- 拖动排序 ----------
const listRef = ref(null);
let sortable = null;
let dragOrigin = null;

function setupSortable() {
  if (!listRef.value || sortable) return;
  sortable = Sortable.create(listRef.value, {
    animation: 180,
    draggable: ".b-item",
    filter: ".b-remove",
    preventOnFilter: false,
    ghostClass: "drag-ghost",
    chosenClass: "drag-chosen",
    // 用鼠标事件模拟拖动（不用浏览器原生拖放），各浏览器效果一致，拖起的卡片跟着鼠标走
    forceFallback: true,
    fallbackClass: "drag-floating",
    fallbackOnBody: true,
    onStart: (evt) => {
      dragOrigin = { parent: evt.item.parentNode, next: evt.item.nextSibling };
    },
    onEnd: (evt) => {
      const { oldDraggableIndex: from, newDraggableIndex: to, item } = evt;
      if (dragOrigin) dragOrigin.parent.insertBefore(item, dragOrigin.next);
      dragOrigin = null;
      if (from === to || from === undefined || to === undefined) return;
      const arr = [...selected.value];
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      selected.value = arr;
    },
  });
}
onBeforeUnmount(() => sortable && sortable.destroy());

async function save() {
  if (!form.value.title.trim()) {
    ElMessage.warning("请填写组合名称");
    return;
  }
  if (selected.value.length === 0) {
    ElMessage.warning("请至少添加一份问卷");
    return;
  }
  saving.value = true;
  try {
    const res = await fetch(
      isNew && !bundleId.value
        ? `${SERVER}/api/bundles`
        : `${SERVER}/api/bundles/${bundleId.value}`,
      {
        method: isNew && !bundleId.value ? "POST" : "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token()}`,
        },
        body: JSON.stringify({
          ...form.value,
          questionnaire_ids: selected.value.map((q) => q.id),
        }),
      },
    );
    const data = await res.json();
    if (data.success) {
      ElMessage.success(isNew && !bundleId.value ? "组合已创建" : "已保存");
      if (data.id) {
        bundleId.value = data.id;
        router.replace(`/bundle/${data.id}`);
      }
    } else {
      ElMessage.error(data.message);
    }
  } catch {
    ElMessage.error("保存失败，请检查后端服务");
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await load();
  await nextTick();
  setupSortable();
});
</script>

<template>
  <div class="container" v-loading="loading">
    <el-button text @click="router.push('/bundles')">← 返回问卷组合</el-button>

    <div class="header">
      <h2>{{ bundleId ? "编辑问卷组合" : "新建问卷组合" }}</h2>
      <div>
        <el-button v-if="bundleId" type="success" plain @click="showLink = true"
          >生成链接</el-button
        >
        <el-button type="primary" :loading="saving" @click="save"
          >保存</el-button
        >
      </div>
    </div>

    <el-alert
      v-if="participants > 0"
      type="warning"
      :closable="false"
      show-icon
      class="gap"
      :title="`已经有 ${participants} 人通过这个组合作答`"
      description="现在调整问卷或顺序，只影响之后作答的人；已经交上来的数据不受影响。"
    />

    <el-card shadow="never" class="card">
      <el-form label-width="96px">
        <el-form-item label="组合名称">
          <el-input
            v-model="form.title"
            placeholder="例如：2026 秋季新生心理普查（受测者会看到）"
          />
        </el-form-item>
        <el-form-item label="开始前说明">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            placeholder="受测者开始前看到的总说明，如：本次测评共 3 份问卷，大约需要 15 分钟。"
          />
        </el-form-item>
        <el-form-item label="知情同意">
          <el-input
            v-model="form.consent_text"
            type="textarea"
            :rows="3"
            placeholder="不填则使用默认的知情同意文字"
          />
        </el-form-item>
        <el-form-item label="问卷顺序">
          <el-switch
            v-model="form.shuffle"
            active-text="每人随机打乱顺序"
            inactive-text="按下面的顺序"
          />
          <div class="tip">
            随机顺序可以平衡顺序效应（比如疲劳对后面问卷的影响）；每个人实际的作答顺序会记录在导出数据里。
          </div>
        </el-form-item>
        <el-form-item label="状态">
          <el-switch
            v-model="form.is_active"
            active-text="开放填写"
            inactive-text="已关闭"
          />
          <div class="tip">
            组合链接只看这里的开关；各问卷自己的开关、截止时间、回收上限只管它的单独链接。
          </div>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="card">
      <div class="block-title">
        组合里的问卷
        <span class="muted"
          >共 {{ selected.length }} 份、{{
            totalQuestions
          }}
          道题。按住拖动可以调整顺序</span
        >
      </div>

      <div class="add-row">
        <el-select
          v-model="toAdd"
          multiple
          filterable
          placeholder="选择要加进来的问卷（可多选）"
          style="flex: 1"
        >
          <el-option
            v-for="q in available"
            :key="q.id"
            :value="q.id"
            :label="`${q.title}（${q.question_count} 题）`"
          />
        </el-select>
        <el-button :disabled="toAdd.length === 0" @click="addSelected"
          >添加</el-button
        >
      </div>

      <div ref="listRef" class="b-list">
        <div v-for="(q, i) in selected" :key="q.id" class="b-item">
          <span class="b-dots">⠿</span>
          <span class="b-no">{{ i + 1 }}</span>
          <span class="b-title">{{ q.title }}</span>
          <span class="muted">{{ q.question_count }} 题</span>
          <el-tag
            v-if="Number(q.question_count) === 0"
            size="small"
            type="warning"
            >没有题目，作答时会跳过</el-tag
          >
          <el-button
            class="b-remove"
            size="small"
            text
            type="danger"
            @click="removeAt(i)"
            >移出</el-button
          >
        </div>
      </div>
      <el-empty
        v-if="selected.length === 0"
        :image-size="60"
        description="还没有添加问卷"
      />

      <div class="tip" style="margin-top: 10px">
        受测者只填一次基本信息：几份问卷要求的基本信息字段会合并，同一个字段（如性别）只问一次，并分别记到每份问卷的数据里。
      </div>
    </el-card>

    <ShareLinkDialog
      v-if="bundleId"
      v-model="showLink"
      :path="`/b/${bundleId}`"
      :file-name="form.title || '问卷组合'"
      title="生成组合链接"
    />
  </div>
</template>

<style scoped>
.container {
  max-width: 820px;
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
.gap {
  margin-bottom: 16px;
}
.card {
  border: 1px solid #f0dcae;
  margin-bottom: 16px;
}
.tip {
  font-size: 12px;
  color: #999;
  line-height: 1.6;
  width: 100%;
}
.block-title {
  font-weight: 600;
  color: #8b5a2b;
  margin-bottom: 12px;
}
.muted {
  font-weight: 400;
  font-size: 12px;
  color: #999;
  margin-left: 8px;
}
.add-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.b-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.b-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #f0dcae;
  border-radius: 8px;
  background: #fffdf8;
  cursor: grab;
}
.b-item:hover {
  box-shadow: 0 2px 10px rgba(139, 90, 43, 0.12);
}
.b-dots {
  color: #c9b48a;
  font-size: 16px;
}
.b-no {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: linear-gradient(135deg, #fbb034, #f4844c);
  color: white;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.b-title {
  flex: 1;
  color: #3d2b12;
  font-size: 14px;
}
.b-item .muted {
  margin-left: 0;
}
.drag-ghost {
  background: #fff3e6;
  border-style: dashed;
  border-color: #f4844c;
  opacity: 0.7;
}
.drag-chosen {
  box-shadow: 0 6px 18px rgba(244, 132, 76, 0.28);
}
.drag-floating {
  border-color: #f4844c;
  box-shadow: 0 10px 28px rgba(244, 132, 76, 0.35);
  cursor: grabbing;
}
</style>
