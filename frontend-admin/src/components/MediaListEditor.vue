<script setup>
// 题目的图片 / 视频 / 音频：上传后显示在题目文字下方、选项上方，可以放多个，可以删除和调整顺序
import { ref } from "vue";
import { ElMessage } from "element-plus";

const SERVER = "http://localhost:3000";
const model = defineModel({ type: Array, default: () => [] });
const uploading = ref(false);
const fileInput = ref(null);

const typeNames = { image: "图片", video: "视频", audio: "音频" };

function pick() {
  fileInput.value.value = "";
  fileInput.value.click();
}

async function uploadFiles(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;
  uploading.value = true;
  const token = localStorage.getItem("admin_token");
  const list = [...(model.value || [])];
  for (const file of files) {
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`${SERVER}/api/media`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json();
      if (data.success) {
        list.push({ type: data.type, url: data.url, name: file.name });
      } else {
        ElMessage.error(`${file.name}：${data.message}`);
      }
    } catch {
      ElMessage.error(`${file.name} 上传失败，请检查后端服务`);
    }
  }
  model.value = list;
  uploading.value = false;
}

function remove(i) {
  const list = [...model.value];
  list.splice(i, 1);
  model.value = list;
}

function move(i, delta) {
  const list = [...model.value];
  const j = i + delta;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  model.value = list;
}
</script>

<template>
  <div class="media-editor">
    <div v-for="(m, i) in model" :key="m.url" class="media-item">
      <img v-if="m.type === 'image'" :src="SERVER + m.url" class="thumb" />
      <video
        v-else-if="m.type === 'video'"
        :src="SERVER + m.url"
        class="thumb"
        preload="metadata"
        muted
      />
      <div v-else class="thumb audio-thumb">♪</div>
      <div class="media-info">
        <el-tag size="small" type="info">{{ typeNames[m.type] }}</el-tag>
        <span class="media-name">{{ m.name || m.url.split("/").pop() }}</span>
      </div>
      <div class="media-actions">
        <el-button
          v-if="model.length > 1"
          size="small"
          text
          :disabled="i === 0"
          @click="move(i, -1)"
          >↑</el-button
        >
        <el-button
          v-if="model.length > 1"
          size="small"
          text
          :disabled="i === model.length - 1"
          @click="move(i, 1)"
          >↓</el-button
        >
        <el-button size="small" text type="danger" @click="remove(i)"
          >删除</el-button
        >
      </div>
    </div>
    <div class="media-add">
      <el-button size="small" :loading="uploading" @click="pick"
        >+ 添加图片 / 视频 / 音频</el-button
      >
      <span class="tip"
        >显示在题目文字下方、选项上方。图片支持 jpg、png、gif，视频建议用
        mp4，音频支持 mp3、wav、m4a</span
      >
    </div>
    <input
      ref="fileInput"
      type="file"
      multiple
      accept="image/*,video/mp4,video/webm,video/quicktime,audio/*"
      style="display: none"
      @change="uploadFiles"
    />
  </div>
</template>

<style scoped>
.media-editor {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.media-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px;
  border: 1px solid #eee;
  border-radius: 6px;
  background: #fafafa;
}
.thumb {
  width: 72px;
  height: 48px;
  object-fit: cover;
  border-radius: 4px;
  background: #e9e9e9;
  flex-shrink: 0;
}
.audio-thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  color: #8b5a2b;
}
.media-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.media-name {
  font-size: 12px;
  color: #666;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.media-actions {
  display: flex;
  flex-shrink: 0;
}
.media-add {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.tip {
  font-size: 12px;
  color: #999;
  line-height: 1.5;
}
</style>
