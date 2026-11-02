<script setup>
// 删除问卷：先显示会删掉什么（题目、作答记录、所在的问卷组合），
// 要输入问卷标题才能删，有作答记录时提示先导出数据。
import { ref, computed, watch } from "vue";
import { ElMessage } from "element-plus";
import { API_BASE } from "../api.js";
import { downloadQuestionnaireData } from "../exportData.js";

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  questionnaireId: { type: [Number, String], default: null },
});
const emit = defineEmits(["update:modelValue", "deleted"]);

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
});

const loading = ref(false);
const preview = ref(null);
const typed = ref("");
const deleting = ref(false);
const exporting = ref(false);

const canDelete = computed(
  () =>
    !!preview.value &&
    typed.value.trim() !== "" &&
    typed.value.trim() === String(preview.value.title).trim(),
);

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return;
    typed.value = "";
    preview.value = null;
    loading.value = true;
    const token = localStorage.getItem("admin_token");
    try {
      const res = await fetch(
        `${API_BASE}/api/questionnaires/${props.questionnaireId}/delete-preview`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await res.json();
      if (data.success) preview.value = data;
      else {
        ElMessage.error(data.message || "加载失败");
        visible.value = false;
      }
    } catch {
      ElMessage.error("加载失败，请检查后端服务");
      visible.value = false;
    } finally {
      loading.value = false;
    }
  },
);

async function exportFirst() {
  exporting.value = true;
  await downloadQuestionnaireData(props.questionnaireId, preview.value?.title);
  exporting.value = false;
}

async function doDelete() {
  if (!canDelete.value) return;
  deleting.value = true;
  const token = localStorage.getItem("admin_token");
  try {
    const res = await fetch(
      `${API_BASE}/api/questionnaires/${props.questionnaireId}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ confirm_title: typed.value.trim() }),
      },
    );
    const data = await res.json();
    if (data.success) {
      ElMessage.success(`已删除「${preview.value.title}」`);
      visible.value = false;
      emit("deleted", props.questionnaireId);
    } else {
      ElMessage.error(data.message || "删除失败");
    }
  } catch {
    ElMessage.error("删除失败，请检查后端服务");
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="删除问卷"
    width="480px"
    :close-on-click-modal="false"
  >
    <div v-loading="loading" class="body">
      <template v-if="preview">
        <div class="danger-box">
          <div class="danger-title">删除后不能恢复，下面这些会一起删掉：</div>
          <ul>
            <li>
              问卷「<b>{{ preview.title }}</b
              >」和它的
              {{ preview.question_count }}
              道题，以及维度、分数段、常模、基本信息字段等设置
            </li>
            <li v-if="preview.submission_count > 0">
              <b class="strong">{{ preview.submission_count }} 份作答记录</b
              >（包括每题答案和被试基本信息）
            </li>
            <li v-else>还没有作答记录</li>
            <li v-if="preview.bundles.length > 0">
              它会从这些问卷组合里移除：{{
                preview.bundles.map((b) => `「${b.title}」`).join("、")
              }}
            </li>
            <li v-if="preview.media_count > 0">
              题目里的图片、视频（其他问卷没用到的才会删）
            </li>
          </ul>
        </div>

        <div v-if="preview.submission_count > 0" class="export-row">
          <span>建议先把作答数据导出保存。</span>
          <el-button size="small" :loading="exporting" @click="exportFirst"
            >先导出数据</el-button
          >
        </div>

        <div class="confirm">
          <label>请输入问卷标题确认删除</label>
          <el-input
            v-model="typed"
            :placeholder="preview.title"
            @keyup.enter="doDelete"
          />
        </div>
      </template>
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        type="danger"
        :disabled="!canDelete"
        :loading="deleting"
        @click="doDelete"
        >永久删除</el-button
      >
    </template>
  </el-dialog>
</template>

<style scoped>
.body {
  min-height: 120px;
}
.danger-box {
  background: #fef3f2;
  border: 1px solid #f9d3cf;
  border-radius: 10px;
  padding: 12px 16px;
  color: #6b3a33;
  font-size: 13px;
  line-height: 1.7;
}
.danger-title {
  font-weight: 600;
  color: #b42318;
  margin-bottom: 4px;
}
.danger-box ul {
  margin: 0;
  padding-left: 18px;
}
.strong {
  color: #b42318;
}
.export-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding: 10px 14px;
  background: var(--app-accent-soft);
  border-radius: 10px;
  font-size: 13px;
  color: var(--app-text-2);
}
.confirm {
  margin-top: 16px;
}
.confirm label {
  display: block;
  font-size: 13px;
  color: var(--app-text-2);
  margin-bottom: 6px;
}
</style>
