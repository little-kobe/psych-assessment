<script setup>
// 问卷设置：标题、说明、知情同意、记录时长、结果图表、答题方式、回收控制
// （原来在问卷详情页的「编辑问卷」，现在问卷的每个页面顶部都能打开）
import { ref, computed, watch } from "vue";
import { ElMessage } from "element-plus";
import { API_BASE } from "../api.js";

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  questionnaire: { type: Object, default: null },
});
const emit = defineEmits(["update:modelValue", "saved"]);

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
});

const saving = ref(false);
const form = ref({});

watch(
  () => props.modelValue,
  (open) => {
    if (!open || !props.questionnaire) return;
    const q = props.questionnaire;
    form.value = {
      title: q.title,
      description: q.description || "",
      consent_text: q.consent_text || "",
      track_timing: !!q.track_timing,
      is_active: q.is_active !== false && q.is_active !== 0,
      max_responses: q.max_responses || null,
      expires_at: q.expires_at || null,
      show_report_chart: !!q.show_report_chart,
      answer_mode: q.answer_mode || "click",
      key_practice: q.key_practice ?? 3,
      key_confidence: !!q.key_confidence,
    };
  },
);

async function save() {
  if (!form.value.title || !form.value.title.trim()) {
    ElMessage.warning("问卷标题不能为空");
    return;
  }
  saving.value = true;
  const token = localStorage.getItem("admin_token");
  try {
    const res = await fetch(
      `${API_BASE}/api/questionnaires/${props.questionnaire.id}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form.value),
      },
    );
    const data = await res.json();
    if (data.success) {
      ElMessage.success("保存成功");
      visible.value = false;
      emit("saved");
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
  <el-dialog v-model="visible" title="问卷设置" width="580px" top="6vh">
    <el-form :model="form" label-width="90px">
      <el-divider content-position="left">基本</el-divider>
      <el-form-item label="问卷标题">
        <el-input v-model="form.title" />
      </el-form-item>
      <el-form-item label="问卷说明">
        <el-input v-model="form.description" type="textarea" :rows="2" />
      </el-form-item>
      <el-form-item label="知情同意">
        <el-input
          v-model="form.consent_text"
          type="textarea"
          :rows="4"
          placeholder="受测者答题前会看到这段说明"
        />
      </el-form-item>
      <el-form-item label="记录时长">
        <el-switch v-model="form.track_timing" />
      </el-form-item>
      <el-form-item label="结果图表">
        <el-switch
          v-model="form.show_report_chart"
          active-text="答完后给受测者看维度得分图"
        />
        <div class="form-tip">
          显示每个维度的得分、所有人的平均分和对应说明（需要先配置维度）。
        </div>
      </el-form-item>

      <el-divider content-position="left">答题方式</el-divider>
      <el-form-item label="作答方式">
        <el-radio-group v-model="form.answer_mode">
          <el-radio value="click">点击作答</el-radio>
          <el-radio value="key">按键作答（记录按键时长）</el-radio>
        </el-radio-group>
        <div class="form-tip">
          按键作答：电脑上用键盘字母键 A、B、C…
          作答，记录「题目出现→按下」和「按下→松开」的毫秒数；手机上记录手指按下到抬起的时间。适用于量表、单选、是否题，多选和开放题照常作答。生成链接时也可以单独指定。
        </div>
      </el-form-item>
      <template v-if="form.answer_mode === 'key'">
        <el-form-item label="练习题">
          <el-input-number
            v-model="form.key_practice"
            :min="0"
            :max="5"
            controls-position="right"
            style="width: 110px"
          />
          <span class="form-tip-inline">道，正式作答前熟悉按键，不保存</span>
        </el-form-item>
        <el-form-item label="把握程度">
          <el-switch
            v-model="form.key_confidence"
            active-text="每题答完后问一次把握程度（1-5）"
          />
        </el-form-item>
      </template>

      <el-divider content-position="left">回收控制</el-divider>
      <el-form-item label="问卷状态">
        <el-switch
          v-model="form.is_active"
          active-text="开放填写"
          inactive-text="已关闭"
        />
      </el-form-item>
      <el-form-item label="最大回收数">
        <el-input-number
          v-model="form.max_responses"
          :min="1"
          :max="99999"
          placeholder="不填表示不限制"
          controls-position="right"
          style="width: 180px"
        />
        <span class="form-tip-inline">份，不填表示不限制</span>
      </el-form-item>
      <el-form-item label="截止时间">
        <el-date-picker
          v-model="form.expires_at"
          type="datetime"
          placeholder="不选表示不限制"
          format="YYYY-MM-DD HH:mm"
          value-format="YYYY-MM-DD HH:mm:ss"
          style="width: 220px"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.form-tip {
  font-size: 12px;
  color: var(--app-text-3);
  line-height: 1.6;
  width: 100%;
}
.form-tip-inline {
  margin-left: 8px;
  font-size: 12px;
  color: var(--app-text-3);
}
:deep(.el-divider__text) {
  color: var(--app-text-2);
  font-weight: 600;
}
</style>
