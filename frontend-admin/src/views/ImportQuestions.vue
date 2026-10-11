<script setup>
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";

const route = useRoute();
const router = useRouter();

const questionnaireId = ref(Number(route.query.qid) || null);
const questionnaires = ref([]); // 可以导入的问卷列表
const selectedFile = ref(null);
const uploadRef = ref(null);
const importing = ref(false);
const downloading = ref(false);
const resultInfo = ref(null);

// 每一列怎么填（和下载的模板里「填写说明」一致）
const columnHelp = [
  {
    name: "题号",
    required: true,
    desc: "第几题。和已有题目题号相同时，会覆盖更新那道题，不会重复添加。",
    example: "1",
  },
  {
    name: "题目内容",
    required: true,
    desc: "题目文字。",
    example: "我感到心情低落",
  },
  {
    name: "题型",
    required: false,
    desc: "量表、单选、多选、是否、开放题。不填默认量表。",
    example: "量表",
  },
  {
    name: "选项",
    required: false,
    desc: "选项之间用分号隔开；要计分就写「文字=分值」，不计分只写文字。单选、多选至少 2 个选项。",
    example: "完全没有=1；轻度=2；重度=3",
  },
  {
    name: "最低分 / 最高分",
    required: false,
    desc: "量表题不写选项文字时用，默认 1~5 分。写了带分值的选项时会自动计算。",
    example: "1 / 5",
  },
  {
    name: "是否反向计分",
    required: false,
    desc: "填「是」表示反向计分。",
    example: "是",
  },
  {
    name: "填写角色",
    required: false,
    desc: "学生、家长、通用。不填默认学生。",
    example: "学生",
  },
  {
    name: "所属板块",
    required: false,
    desc: "板块标题，相同标题的题归到同一个板块，没有的板块会自动新建。",
    example: "第一部分 情绪",
  },
  {
    name: "板块引导语",
    required: false,
    desc: "板块的说明文字，写在该板块任意一行即可。",
    example: "以下题目请根据最近一周的感受作答。",
  },
];

async function fetchQuestionnaires() {
  const token = localStorage.getItem("admin_token");
  try {
    const res = await fetch("http://localhost:3000/api/questionnaires", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.success) questionnaires.value = data.questionnaires;
  } catch (err) {
    ElMessage.error("加载问卷列表失败");
  }
}

// 下载导入模板
async function downloadTemplate() {
  downloading.value = true;
  const token = localStorage.getItem("admin_token");
  try {
    const res = await fetch(
      "http://localhost:3000/api/questions/import-template",
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "题目导入模板.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    ElMessage.error("下载模板失败，请检查后端服务");
  } finally {
    downloading.value = false;
  }
}

// 选择文件（el-upload 只负责选文件，不自动上传）
function handleFileChange(file) {
  selectedFile.value = file.raw;
  resultInfo.value = null;
}

function handleFileRemove() {
  selectedFile.value = null;
}

// 再选一个文件时，替换掉之前选的
function handleExceed(files) {
  uploadRef.value.clearFiles();
  const file = files[0];
  uploadRef.value.handleStart(file);
}

async function uploadFile() {
  if (!questionnaireId.value) {
    ElMessage.warning("请先选择要导入到哪份问卷");
    return;
  }
  if (!selectedFile.value) {
    ElMessage.warning("请先选择 Excel 文件");
    return;
  }

  importing.value = true;
  resultInfo.value = null;

  const formData = new FormData();
  formData.append("file", selectedFile.value);
  formData.append("questionnaire_id", questionnaireId.value);

  try {
    const token = localStorage.getItem("admin_token");
    const response = await fetch("http://localhost:3000/api/questions/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    resultInfo.value = await response.json();
  } catch (err) {
    resultInfo.value = {
      success: false,
      message: "上传失败，请检查后端服务是否启动",
    };
  } finally {
    importing.value = false;
  }
}

function goBack() {
  if (route.query.qid) router.push(`/questionnaire/${route.query.qid}`);
  else router.push("/");
}

onMounted(fetchQuestionnaires);
</script>

<template>
  <div class="container">
    <el-button @click="goBack" text>← 返回</el-button>

    <div class="header">
      <h2>批量导入题目</h2>
      <el-button @click="downloadTemplate" :loading="downloading"
        >下载导入模板</el-button
      >
    </div>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      description="建议先下载模板照着填。题号和已有题目相同时会覆盖更新；表里没有的列，原来的设置保持不变，所以旧版表格照样能用。导出数据里的「题目与选项对照」表也能直接导入，可用来把一份问卷的题目复制到另一份。"
    />

    <el-card class="card" shadow="never">
      <el-form label-width="96px">
        <el-form-item label="导入到问卷">
          <el-select
            v-model="questionnaireId"
            filterable
            placeholder="选择问卷"
            style="width: 100%"
          >
            <el-option
              v-for="q in questionnaires"
              :key="q.id"
              :value="q.id"
              :label="`${q.title}（编号 ${q.id}，现有 ${q.question_count} 题）`"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="Excel 文件">
          <el-upload
            ref="uploadRef"
            drag
            :auto-upload="false"
            :limit="1"
            accept=".xlsx,.xls"
            :on-change="handleFileChange"
            :on-remove="handleFileRemove"
            :on-exceed="handleExceed"
            style="width: 100%"
          >
            <div class="upload-text">
              把 Excel 文件拖到这里，或<em>点击选择文件</em>
            </div>
          </el-upload>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="uploadFile" :loading="importing">
            {{ importing ? "导入中..." : "开始导入" }}
          </el-button>
        </el-form-item>
      </el-form>

      <!-- 导入结果 -->
      <template v-if="resultInfo">
        <el-alert
          :title="resultInfo.message"
          :type="
            !resultInfo.success
              ? 'error'
              : resultInfo.errors && resultInfo.errors.length > 0
                ? 'warning'
                : 'success'
          "
          :closable="false"
          show-icon
        />
        <ul
          v-if="resultInfo.errors && resultInfo.errors.length > 0"
          class="error-list"
        >
          <li v-for="(e, i) in resultInfo.errors" :key="i">{{ e }}</li>
        </ul>
        <el-button
          v-if="resultInfo.success"
          style="margin-top: 12px"
          @click="
            router.push(`/questionnaire/${questionnaireId}/edit-questions`)
          "
          >去「编辑题目」查看</el-button
        >
      </template>
    </el-card>

    <el-collapse class="help">
      <el-collapse-item title="Excel 每一列怎么填" name="help">
        <el-table :data="columnHelp" size="small">
          <el-table-column label="列名" width="130">
            <template #default="scope">
              {{ scope.row.name }}
              <el-tag v-if="scope.row.required" size="small" type="danger"
                >必填</el-tag
              >
            </template>
          </el-table-column>
          <el-table-column prop="desc" label="怎么填" min-width="260" />
          <el-table-column prop="example" label="例子" min-width="160" />
        </el-table>
      </el-collapse-item>
    </el-collapse>
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
.card {
  margin-top: 16px;
  border: 1px solid #f0dcae;
}
.upload-text {
  font-size: 14px;
  color: #666;
  padding: 10px 0;
}
.upload-text em {
  color: #f4844c;
  font-style: normal;
}
.error-list {
  margin: 10px 0 0;
  padding: 10px 14px 10px 30px;
  background: #fdf6ec;
  border-radius: 6px;
  font-size: 13px;
  color: #8a5a00;
  line-height: 1.8;
}
.help {
  margin-top: 16px;
}
</style>
