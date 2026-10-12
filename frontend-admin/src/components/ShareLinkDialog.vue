<script setup>
import { API_BASE } from "../api.js";
// 生成答题链接和二维码（单份问卷、问卷组合共用）
import { ref, watch } from "vue";
import { ElMessage } from "element-plus";
import QRCode from "qrcode";

const props = defineProps({
  path: { type: String, required: true }, // 答题端路径，如 /q/3、/b/2
  fileName: { type: String, default: "问卷" }, // 下载二维码时的文件名前缀
  title: { type: String, default: "生成问卷链接" },
});
const visible = defineModel({ type: Boolean, default: false });

// 上线后（npm run build）：答题链接就是当前网站的地址（如 http://服务器IP/q/3），不用选
// 本地开发时：链接里用的主机地址默认用电脑的局域网 IP（手机扫码才能打开），也可以切换成 localhost 只在本机测试
const IS_DEV = import.meta.env.DEV;
const linkHost = ref("localhost");
const lanIps = ref([]);
const groupName = ref("");
const generatedLink = ref("");
const qrDataUrl = ref(""); // 二维码图片（base64）

async function fetchLanIps() {
  if (lanIps.value.length > 0) return; // 只需要取一次
  const token = localStorage.getItem("admin_token");
  try {
    const res = await fetch(`${API_BASE}/api/server-info`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.success && data.lan_ips.length > 0) {
      lanIps.value = data.lan_ips;
      linkHost.value = data.lan_ips[0];
    }
  } catch (err) {
    console.error("获取局域网地址失败:", err);
  }
}

async function generate() {
  const base = IS_DEV
    ? `http://${linkHost.value}:5173${props.path}`
    : `${window.location.origin}${props.path}`;
  generatedLink.value = groupName.value
    ? `${base}?group=${encodeURIComponent(groupName.value)}`
    : base;
  // 链接变了，二维码跟着重新生成
  qrDataUrl.value = await QRCode.toDataURL(generatedLink.value, {
    width: 240,
    margin: 1,
  });
}

watch(visible, async (open) => {
  if (!open) return;
  groupName.value = "";
  if (IS_DEV) await fetchLanIps();
  generate();
});

function downloadQrCode() {
  const a = document.createElement("a");
  a.href = qrDataUrl.value;
  a.download = `${props.fileName}${
    groupName.value ? "_" + groupName.value : ""
  }_二维码.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function copyLink() {
  navigator.clipboard
    .writeText(generatedLink.value)
    .then(() => ElMessage.success("链接已复制"))
    .catch(() => ElMessage.error("复制失败，请手动复制"));
}
</script>

<template>
  <el-dialog v-model="visible" :title="title" width="520px">
    <div class="link-dialog">
      <p class="link-hint">
        可以为不同群体生成带分组标记的链接，方便数据分析时做组间比较。
      </p>

      <el-form label-width="80px">
        <el-form-item v-if="IS_DEV" label="链接地址">
          <el-select v-model="linkHost" style="width: 100%" @change="generate">
            <el-option
              v-for="ip in lanIps"
              :key="ip"
              :value="ip"
              :label="`${ip}（局域网，手机可扫码）`"
            />
            <el-option value="localhost" label="localhost（仅本机测试）" />
          </el-select>
        </el-form-item>
        <el-form-item label="分组名称">
          <el-input
            v-model="groupName"
            placeholder="如：A班、实验组、男生组（不填则为无分组）"
            @input="generate"
            clearable
          />
        </el-form-item>
      </el-form>

      <div class="link-preview">
        <div class="link-label">生成的链接：</div>
        <div class="link-text">{{ generatedLink }}</div>
        <el-button size="small" type="primary" @click="copyLink"
          >复制链接</el-button
        >
      </div>

      <!-- 二维码 -->
      <div v-if="qrDataUrl" class="qr-box">
        <img :src="qrDataUrl" alt="问卷二维码" class="qr-img" />
        <div class="qr-side">
          <p>手机扫码即可填写，分组名称会一起带上。</p>
          <el-button size="small" @click="downloadQrCode"
            >下载二维码图片</el-button
          >
        </div>
      </div>
      <el-alert
        v-if="IS_DEV && linkHost === 'localhost'"
        type="warning"
        :closable="false"
        show-icon
        title="localhost 地址只能在本机打开，手机扫码打不开"
        description="手机测试请在「链接地址」里选局域网 IP，并确保手机和电脑连的是同一个 Wi-Fi。"
      />

      <div class="link-tips">
        <p>💡 使用建议：</p>
        <ul>
          <li>给A班同学发：<code>...?group=A班</code></li>
          <li>给B班同学发：<code>...?group=B班</code></li>
          <li>导出数据时，每条记录会自动带上对应的分组标签</li>
        </ul>
      </div>
    </div>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.link-dialog {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.link-hint {
  font-size: 13px;
  color: #888;
  margin: 0;
}
.link-preview {
  background: #f9f9f9;
  border-radius: 8px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.link-label {
  font-size: 12px;
  color: #999;
}
.link-text {
  font-size: 13px;
  color: #3d2b12;
  word-break: break-all;
  background: white;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid #eee;
}
.qr-box {
  display: flex;
  align-items: center;
  gap: 16px;
  background: #f9f9f9;
  border-radius: 8px;
  padding: 12px 14px;
}
.qr-img {
  width: 140px;
  height: 140px;
  border: 1px solid #eee;
  border-radius: 6px;
  background: white;
}
.qr-side p {
  font-size: 13px;
  color: #666;
  margin: 0 0 10px;
}
.link-tips {
  font-size: 12px;
  color: #999;
}
.link-tips p {
  margin: 0 0 4px;
}
.link-tips ul {
  margin: 0;
  padding-left: 16px;
}
.link-tips li {
  margin-bottom: 4px;
}
.link-tips code {
  background: #f0f0f0;
  padding: 1px 6px;
  border-radius: 4px;
  color: #666;
}
</style>
