<script setup>
import { ref, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";

const admins = ref([]);
const loading = ref(false);
const showCreateDialog = ref(false);
const showResetDialog = ref(false);
const creating = ref(false);
const resetting = ref(false);
const resetTargetId = ref(null);
const resetTargetName = ref("");

const newAdmin = ref({
  username: "",
  password: "",
  display_name: "",
  role: "researcher",
});
const newPassword = ref("");

const currentRole = localStorage.getItem("admin_role");

async function fetchAdmins() {
  loading.value = true;
  const token = localStorage.getItem("admin_token");
  try {
    const res = await fetch("http://localhost:3000/api/admins", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.success) admins.value = data.admins;
  } catch (err) {
    ElMessage.error("获取账号列表失败");
  } finally {
    loading.value = false;
  }
}

async function createAdmin() {
  if (
    !newAdmin.value.username ||
    !newAdmin.value.password ||
    !newAdmin.value.display_name
  ) {
    ElMessage.warning("账号、密码、姓名不能为空");
    return;
  }
  if (newAdmin.value.password.length < 6) {
    ElMessage.warning("密码不能少于6位");
    return;
  }
  creating.value = true;
  const token = localStorage.getItem("admin_token");
  try {
    const res = await fetch("http://localhost:3000/api/admins", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(newAdmin.value),
    });
    const data = await res.json();
    if (data.success) {
      ElMessage.success("账号创建成功");
      showCreateDialog.value = false;
      newAdmin.value = {
        username: "",
        password: "",
        display_name: "",
        role: "researcher",
      };
      fetchAdmins();
    } else {
      ElMessage.error(data.message);
    }
  } catch (err) {
    ElMessage.error("创建失败，请检查后端服务");
  } finally {
    creating.value = false;
  }
}

function openResetDialog(admin) {
  resetTargetId.value = admin.id;
  resetTargetName.value = admin.display_name;
  newPassword.value = "";
  showResetDialog.value = true;
}

async function resetPassword() {
  if (!newPassword.value || newPassword.value.length < 6) {
    ElMessage.warning("新密码不能少于6位");
    return;
  }
  resetting.value = true;
  const token = localStorage.getItem("admin_token");
  try {
    const res = await fetch(
      `http://localhost:3000/api/admins/${resetTargetId.value}/password`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ new_password: newPassword.value }),
      },
    );
    const data = await res.json();
    if (data.success) {
      ElMessage.success("密码重置成功");
      showResetDialog.value = false;
    } else {
      ElMessage.error(data.message);
    }
  } catch (err) {
    ElMessage.error("重置失败，请检查后端服务");
  } finally {
    resetting.value = false;
  }
}

async function deleteAdmin(admin) {
  try {
    await ElMessageBox.confirm(
      `确认删除账号"${admin.display_name}"？删除后该账号无法登录，其创建的问卷数据不受影响。`,
      "删除确认",
      {
        type: "warning",
        confirmButtonText: "确认删除",
        cancelButtonText: "取消",
      },
    );
  } catch {
    return; // 用户点了取消
  }

  const token = localStorage.getItem("admin_token");
  try {
    const res = await fetch(`http://localhost:3000/api/admins/${admin.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.success) {
      ElMessage.success("账号已删除");
      fetchAdmins();
    } else {
      ElMessage.error(data.message);
    }
  } catch (err) {
    ElMessage.error("删除失败，请检查后端服务");
  }
}

function formatTime(timeStr) {
  if (!timeStr) return "-";
  return new Date(timeStr).toLocaleString("zh-CN");
}

onMounted(fetchAdmins);
</script>

<template>
  <div class="container">
    <div class="header">
      <h2>账号管理</h2>
      <el-button type="primary" @click="showCreateDialog = true"
        >新建账号</el-button
      >
    </div>

    <el-alert
      v-if="currentRole !== 'supervisor'"
      title="权限不足"
      type="warning"
      description="只有导师账号可以管理研究者账号"
      :closable="false"
      show-icon
    />

    <el-table :data="admins" v-loading="loading" style="margin-top: 16px">
      <el-table-column prop="display_name" label="姓名" width="140" />
      <el-table-column prop="username" label="账号" width="140" />
      <el-table-column label="角色" width="100">
        <template #default="scope">
          <el-tag
            :type="scope.row.role === 'supervisor' ? 'warning' : 'info'"
            size="small"
          >
            {{ scope.row.role === "supervisor" ? "导师" : "研究者" }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="180">
        <template #default="scope">{{
          formatTime(scope.row.created_at)
        }}</template>
      </el-table-column>
      <el-table-column label="操作">
        <template #default="scope">
          <div style="display: flex; gap: 8px">
            <el-button size="small" @click="openResetDialog(scope.row)"
              >重置密码</el-button
            >
            <el-button
              size="small"
              type="danger"
              :disabled="scope.row.role === 'supervisor'"
              @click="deleteAdmin(scope.row)"
              >删除</el-button
            >
          </div>
        </template>
      </el-table-column>
    </el-table>

    <!-- 新建账号弹窗 -->
    <el-dialog v-model="showCreateDialog" title="新建账号" width="420px">
      <el-form :model="newAdmin" label-width="70px">
        <el-form-item label="姓名">
          <el-input v-model="newAdmin.display_name" placeholder="如：张三" />
        </el-form-item>
        <el-form-item label="账号">
          <el-input
            v-model="newAdmin.username"
            placeholder="登录用的账号名，建议用英文"
          />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="newAdmin.password"
            type="password"
            placeholder="至少6位"
            show-password
          />
        </el-form-item>
        <el-form-item label="角色">
          <el-radio-group v-model="newAdmin.role">
            <el-radio value="researcher">研究者（只能管理自己的问卷）</el-radio>
            <el-radio value="supervisor">导师（可查看所有数据）</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="createAdmin" :loading="creating"
          >创建</el-button
        >
      </template>
    </el-dialog>

    <!-- 重置密码弹窗 -->
    <el-dialog
      v-model="showResetDialog"
      :title="`重置密码：${resetTargetName}`"
      width="380px"
    >
      <el-form label-width="70px">
        <el-form-item label="新密码">
          <el-input
            v-model="newPassword"
            type="password"
            placeholder="至少6位"
            show-password
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showResetDialog = false">取消</el-button>
        <el-button type="primary" @click="resetPassword" :loading="resetting"
          >确认重置</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.container {
  max-width: 800px;
  margin: 20px auto;
  padding: 24px;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.header h2 {
  margin: 0;
  font-size: 20px;
  color: #3d2b12;
}
</style>
