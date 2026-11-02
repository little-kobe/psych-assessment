<script setup>
// 修改自己的密码（右上角账号菜单里打开）
import { ref, computed, watch } from "vue";
import { ElMessage } from "element-plus";
import { API_BASE } from "../api.js";

const props = defineProps({
  modelValue: { type: Boolean, default: false },
});
const emit = defineEmits(["update:modelValue"]);
const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
});

const form = ref({ old: "", next: "", again: "" });
const saving = ref(false);

watch(
  () => props.modelValue,
  (open) => {
    if (open) form.value = { old: "", next: "", again: "" };
  },
);

async function save() {
  const f = form.value;
  if (!f.old) return ElMessage.warning("请输入原密码");
  if (f.next.length < 6) return ElMessage.warning("新密码不能少于6位");
  if (f.next !== f.again) return ElMessage.warning("两次输入的新密码不一样");
  saving.value = true;
  try {
    const res = await fetch(`${API_BASE}/api/admin/me/password`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
      },
      body: JSON.stringify({ old_password: f.old, new_password: f.next }),
    });
    const data = await res.json();
    if (data.success) {
      ElMessage.success("密码已修改，下次登录用新密码");
      visible.value = false;
    } else {
      ElMessage.error(data.message || "修改失败");
    }
  } catch {
    ElMessage.error("修改失败，请检查后端服务");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="修改密码" width="400px">
    <el-form label-width="80px" @submit.prevent>
      <el-form-item label="原密码">
        <el-input
          v-model="form.old"
          type="password"
          show-password
          autocomplete="current-password"
        />
      </el-form-item>
      <el-form-item label="新密码">
        <el-input
          v-model="form.next"
          type="password"
          show-password
          placeholder="至少 6 位"
          autocomplete="new-password"
        />
      </el-form-item>
      <el-form-item label="再输一次">
        <el-input
          v-model="form.again"
          type="password"
          show-password
          autocomplete="new-password"
          @keyup.enter="save"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>
