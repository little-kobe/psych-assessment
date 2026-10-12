<script setup>
// 选项图片：每个选项可以配一张图（图形推理题、表情量表等），受测者看到图片选项
import { ref } from "vue";
import { ElMessage } from "element-plus";

const SERVER = "http://localhost:3000";
const model = defineModel({ type: String, default: null });
const emit = defineEmits(["uploaded"]);
const uploading = ref(false);
const fileInput = ref(null);

function pick() {
  fileInput.value.value = "";
  fileInput.value.click();
}

async function upload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  uploading.value = true;
  const form = new FormData();
  form.append("file", file);
  try {
    const res = await fetch(`${SERVER}/api/media`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
      },
      body: form,
    });
    const data = await res.json();
    if (data.success && data.type === "image") {
      model.value = data.url;
      emit("uploaded");
    } else {
      ElMessage.error(data.success ? "选项只能用图片" : data.message);
    }
  } catch {
    ElMessage.error("上传失败，请检查后端服务");
  } finally {
    uploading.value = false;
  }
}
</script>

<template>
  <div class="opt-img">
    <template v-if="model">
      <el-tooltip content="点击更换图片" placement="top">
        <img :src="SERVER + model" class="opt-thumb" @click="pick" />
      </el-tooltip>
      <span class="opt-remove" title="去掉图片" @click="model = null">×</span>
    </template>
    <el-tooltip v-else content="给这个选项配一张图片" placement="top">
      <el-button size="small" :loading="uploading" @click="pick"
        >图片</el-button
      >
    </el-tooltip>
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      style="display: none"
      @change="upload"
    />
  </div>
</template>

<style scoped>
.opt-img {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}
.opt-thumb {
  width: 40px;
  height: 32px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid #e5e5e5;
  cursor: pointer;
}
.opt-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 16px;
  height: 16px;
  line-height: 15px;
  text-align: center;
  font-size: 12px;
  border-radius: 50%;
  background: #f56c6c;
  color: white;
  cursor: pointer;
}
</style>
