<script setup>
// 账号管理
//  总账号：所有账号；新建总账号 / 导师 / 研究者；研究者可以选所属导师，导师可以选名下研究者；
//          表格里勾选多个研究者后一次分配给某个导师（全选 / 反选 / 只选未分配）
//  导师：「我的研究者」，只看到、管理自己名下的研究者（新建的研究者自动归到自己名下）
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import {
  Plus,
  Search,
  Edit,
  Key,
  Delete,
  Refresh,
} from "@element-plus/icons-vue";
import { API_BASE } from "../api.js";
import { ROLE_NAMES, currentRole, me } from "../session.js";
import MemberPicker from "../components/MemberPicker.vue";

const router = useRouter();
const isAdmin = computed(() => currentRole() === "admin");
// 后台登录地址（发给新账号用）：本地是 http://localhost:5174/login，线上是 https://域名/admin/login
const loginUrl = new URL(router.resolve("/login").href, window.location.origin)
  .href;

const admins = ref([]);
const loading = ref(false);

function authHeaders(json = false) {
  const h = { Authorization: `Bearer ${localStorage.getItem("admin_token")}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

async function fetchAdmins() {
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE}/api/admins`, {
      headers: authHeaders(),
    });
    const data = await res.json();
    if (data.success) admins.value = data.admins;
    else ElMessage.error(data.message || "获取账号列表失败");
  } catch {
    ElMessage.error("获取账号列表失败，请检查后端服务");
  } finally {
    loading.value = false;
  }
}
onMounted(fetchAdmins);

const supervisors = computed(() =>
  admins.value.filter((a) => a.role === "supervisor"),
);
const researchers = computed(() =>
  admins.value.filter((a) => a.role === "researcher"),
);
const unassignedCount = computed(
  () => researchers.value.filter((r) => !r.supervisor_id).length,
);

// ---------- 筛选（总账号） ----------
const filter = ref("all"); // all / admin / supervisor / researcher / unassigned / sup:<id>
const keyword = ref("");

const filterChips = computed(() => [
  { value: "all", label: "全部", count: admins.value.length },
  {
    value: "admin",
    label: "总账号",
    count: admins.value.filter((a) => a.role === "admin").length,
  },
  { value: "supervisor", label: "导师", count: supervisors.value.length },
  { value: "researcher", label: "研究者", count: researchers.value.length },
  { value: "unassigned", label: "未分配导师", count: unassignedCount.value },
]);

const rows = computed(() => {
  const k = keyword.value.trim().toLowerCase();
  return admins.value.filter((a) => {
    const f = filter.value;
    if (f === "admin" || f === "supervisor" || f === "researcher") {
      if (a.role !== f) return false;
    } else if (f === "unassigned") {
      if (a.role !== "researcher" || a.supervisor_id) return false;
    } else if (f.startsWith("sup:")) {
      const id = Number(f.slice(4));
      if (!(a.id === id || a.supervisor_id === id)) return false;
    }
    if (!k) return true;
    return (
      (a.display_name || "").toLowerCase().includes(k) ||
      (a.username || "").toLowerCase().includes(k)
    );
  });
});

// ---------- 勾选研究者，批量分配导师（总账号） ----------
const tableRef = ref(null);
const selectedIds = ref([]);
const assignTo = ref(""); // "" 未选；"none" 取消分配；导师 id
const assigning = ref(false);

const canSelect = (row) => isAdmin.value && row.role === "researcher";
function onSelectionChange(list) {
  selectedIds.value = list.map((r) => r.id);
}
function setSelection(pred) {
  const t = tableRef.value;
  if (!t) return;
  rows.value.forEach((r) => {
    if (canSelect(r)) t.toggleRowSelection(r, !!pred(r));
  });
}
const selectAllResearchers = () => setSelection(() => true);
const invertSelection = () =>
  setSelection((r) => !selectedIds.value.includes(r.id));
const selectUnassigned = () => setSelection((r) => !r.supervisor_id);
const clearSelection = () => tableRef.value?.clearSelection();

async function batchAssign() {
  if (selectedIds.value.length === 0 || assignTo.value === "") return;
  assigning.value = true;
  try {
    const res = await fetch(`${API_BASE}/api/admins/batch-assign`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({
        researcher_ids: selectedIds.value,
        supervisor_id: assignTo.value === "none" ? null : assignTo.value,
      }),
    });
    const data = await res.json();
    if (data.success) {
      const target =
        assignTo.value === "none"
          ? "已取消分配"
          : `已分配给「${supervisors.value.find((s) => s.id === assignTo.value)?.display_name}」`;
      ElMessage.success(`${data.count} 位研究者${target}`);
      assignTo.value = "";
      await fetchAdmins();
      clearSelection();
    } else ElMessage.error(data.message || "分配失败");
  } catch {
    ElMessage.error("分配失败，请检查后端服务");
  } finally {
    assigning.value = false;
  }
}

// ---------- 新建 / 编辑账号 ----------
const showEdit = ref(false);
const editing = ref(null); // null = 新建
const saving = ref(false);
const form = ref({});

function randomPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  const arr = new Uint32Array(10);
  crypto.getRandomValues(arr);
  arr.forEach((x) => (s += chars[x % chars.length]));
  return s;
}

function openCreate(role = "researcher") {
  editing.value = null;
  form.value = {
    display_name: "",
    username: "",
    password: randomPassword(),
    role: isAdmin.value ? role : "researcher",
    supervisor_id: filter.value.startsWith("sup:")
      ? Number(filter.value.slice(4))
      : null,
    member_ids: [],
  };
  showEdit.value = true;
}

function openEdit(row) {
  editing.value = row;
  form.value = {
    display_name: row.display_name,
    username: row.username,
    role: row.role,
    supervisor_id: row.supervisor_id,
    member_ids: researchers.value
      .filter((r) => r.supervisor_id === row.id)
      .map((r) => r.id),
  };
  showEdit.value = true;
}

const editTitle = computed(() =>
  editing.value
    ? `编辑账号：${editing.value.display_name}`
    : isAdmin.value
      ? "新建账号"
      : "新建研究者",
);

function copyText(text) {
  navigator.clipboard?.writeText(text).then(
    () => ElMessage.success("已复制"),
    () => ElMessage.warning("复制失败，请手动选中复制"),
  );
}

async function saveAccount() {
  const f = form.value;
  if (!f.display_name?.trim()) return ElMessage.warning("请填写姓名");
  if (!editing.value) {
    if (!f.username?.trim()) return ElMessage.warning("请填写登录账号");
    if (!f.password || f.password.length < 6)
      return ElMessage.warning("密码不能少于6位");
  }
  saving.value = true;
  const body = { display_name: f.display_name.trim() };
  if (!editing.value) {
    body.username = f.username.trim();
    body.password = f.password;
  }
  if (isAdmin.value) {
    body.role = f.role;
    if (f.role === "researcher") body.supervisor_id = f.supervisor_id || null;
    if (f.role === "supervisor") body.member_ids = f.member_ids;
  }
  try {
    const res = await fetch(
      editing.value
        ? `${API_BASE}/api/admins/${editing.value.id}`
        : `${API_BASE}/api/admins`,
      {
        method: editing.value ? "PUT" : "POST",
        headers: authHeaders(true),
        body: JSON.stringify(body),
      },
    );
    const data = await res.json();
    if (data.success) {
      if (editing.value) ElMessage.success("已保存");
      else {
        createdInfo.value = {
          name: body.display_name,
          username: body.username,
          password: body.password,
        };
      }
      showEdit.value = false;
      fetchAdmins();
    } else ElMessage.error(data.message || "保存失败");
  } catch {
    ElMessage.error("保存失败，请检查后端服务");
  } finally {
    saving.value = false;
  }
}

// 新建成功后显示一次账号密码，方便复制发给对方
const createdInfo = ref(null);

// ---------- 重置密码 ----------
const resetTarget = ref(null);
const newPassword = ref("");
const resetting = ref(false);
function openReset(row) {
  resetTarget.value = row;
  newPassword.value = randomPassword();
}
async function resetPassword() {
  if (!newPassword.value || newPassword.value.length < 6)
    return ElMessage.warning("新密码不能少于6位");
  resetting.value = true;
  try {
    const res = await fetch(
      `${API_BASE}/api/admins/${resetTarget.value.id}/password`,
      {
        method: "PUT",
        headers: authHeaders(true),
        body: JSON.stringify({ new_password: newPassword.value }),
      },
    );
    const data = await res.json();
    if (data.success) {
      createdInfo.value = {
        name: resetTarget.value.display_name,
        username: resetTarget.value.username,
        password: newPassword.value,
        reset: true,
      };
      resetTarget.value = null;
    } else ElMessage.error(data.message || "重置失败");
  } catch {
    ElMessage.error("重置失败，请检查后端服务");
  } finally {
    resetting.value = false;
  }
}

// ---------- 删除 ----------
const deleteTarget = ref(null);
const transferTo = ref(null);
const deleting = ref(false);
const deleteOwns = computed(
  () =>
    !!deleteTarget.value &&
    deleteTarget.value.questionnaire_count + deleteTarget.value.bundle_count >
      0,
);
const transferOptions = computed(() =>
  admins.value.filter((a) => a.id !== deleteTarget.value?.id),
);
function openDelete(row) {
  deleteTarget.value = row;
  // 默认移交给他的导师；没有导师就给自己
  transferTo.value = row.supervisor_id || me.value?.id || null;
}
async function doDelete() {
  deleting.value = true;
  try {
    const res = await fetch(`${API_BASE}/api/admins/${deleteTarget.value.id}`, {
      method: "DELETE",
      headers: authHeaders(true),
      body: JSON.stringify({ transfer_to: transferTo.value }),
    });
    const data = await res.json();
    if (data.success) {
      ElMessage.success(data.message || "已删除");
      deleteTarget.value = null;
      fetchAdmins();
    } else ElMessage.error(data.message || "删除失败");
  } catch {
    ElMessage.error("删除失败，请检查后端服务");
  } finally {
    deleting.value = false;
  }
}

function fmtDate(t) {
  if (!t) return "-";
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>{{ isAdmin ? "账号管理" : "我的研究者" }}</h1>
        <p class="sub" v-if="isAdmin">
          总账号能看到所有问卷；导师能看到自己和名下研究者的问卷；研究者只能看到自己的。
        </p>
        <p class="sub" v-else>
          这些研究者的问卷你都能看到和管理，也可以帮他们重置密码。要调整谁在你名下，请联系总账号。
        </p>
      </div>
      <div class="head-actions">
        <el-input
          v-model="keyword"
          :prefix-icon="Search"
          placeholder="搜索姓名或账号"
          clearable
          style="width: 200px"
        />
        <el-button type="primary" :icon="Plus" @click="openCreate()">{{
          isAdmin ? "新建账号" : "新建研究者"
        }}</el-button>
      </div>
    </div>

    <!-- 总账号：按角色 / 导师筛选 -->
    <template v-if="isAdmin">
      <div class="chips">
        <button
          v-for="c in filterChips"
          :key="c.value"
          type="button"
          class="chip"
          :class="{
            active: filter === c.value,
            warn: c.value === 'unassigned' && c.count > 0,
          }"
          @click="filter = c.value"
        >
          {{ c.label }} <span class="chip-count">{{ c.count }}</span>
        </button>
      </div>

      <div v-if="supervisors.length > 0" class="sup-cards">
        <button
          v-for="s in supervisors"
          :key="s.id"
          type="button"
          class="sup-card"
          :class="{ active: filter === `sup:${s.id}` }"
          @click="filter = filter === `sup:${s.id}` ? 'all' : `sup:${s.id}`"
        >
          <span class="sup-name">{{ s.display_name }}</span>
          <span class="sup-meta"
            >{{ s.member_count }} 位研究者 ·
            {{ s.questionnaire_count }} 份问卷</span
          >
        </button>
        <button
          type="button"
          class="sup-card add"
          @click="openCreate('supervisor')"
        >
          <span class="sup-name">+ 新建导师</span>
          <span class="sup-meta">新建时可以直接选名下研究者</span>
        </button>
      </div>
      <div v-else class="first-tip">
        还没有导师账号。点「新建账号」选择角色「导师」，可以同时勾选他名下的研究者。
      </div>

      <!-- 勾选研究者后批量分配 -->
      <div class="batch">
        <span class="batch-label">快捷选择研究者：</span>
        <el-button
          size="small"
          text
          type="primary"
          @click="selectAllResearchers"
          >全选</el-button
        >
        <el-button size="small" text type="primary" @click="invertSelection"
          >反选</el-button
        >
        <el-button size="small" text type="primary" @click="selectUnassigned"
          >只选未分配</el-button
        >
        <el-button size="small" text @click="clearSelection">清空</el-button>
        <span class="batch-sep"></span>
        <template v-if="selectedIds.length > 0">
          <span class="batch-label"
            >已选 <b>{{ selectedIds.length }}</b> 人，分配给</span
          >
          <el-select
            v-model="assignTo"
            size="small"
            placeholder="选择导师"
            style="width: 150px"
          >
            <el-option
              v-for="s in supervisors"
              :key="s.id"
              :value="s.id"
              :label="s.display_name"
            />
            <el-option value="none" label="取消分配（无导师）" />
          </el-select>
          <el-button
            size="small"
            type="primary"
            :disabled="assignTo === ''"
            :loading="assigning"
            @click="batchAssign"
            >确定</el-button
          >
        </template>
        <span v-else class="batch-hint"
          >勾选表格里的研究者后，可以一次分配给某位导师</span
        >
      </div>
    </template>

    <div class="card" v-loading="loading">
      <el-table
        ref="tableRef"
        :data="rows"
        row-key="id"
        @selection-change="onSelectionChange"
      >
        <el-table-column
          v-if="isAdmin"
          type="selection"
          width="44"
          :selectable="canSelect"
          reserve-selection
        />
        <el-table-column label="姓名" min-width="150">
          <template #default="{ row }">
            <div class="name">
              {{ row.display_name }}
              <span v-if="row.is_self" class="self">（我）</span>
            </div>
            <div class="muted">账号 {{ row.username }}</div>
          </template>
        </el-table-column>
        <el-table-column v-if="isAdmin" label="角色" width="96">
          <template #default="{ row }">
            <span class="role-badge" :class="row.role">{{
              ROLE_NAMES[row.role] || row.role
            }}</span>
          </template>
        </el-table-column>
        <el-table-column
          v-if="isAdmin"
          label="导师 / 名下研究者"
          min-width="150"
        >
          <template #default="{ row }">
            <template v-if="row.role === 'researcher'">
              <span v-if="row.supervisor_name" class="sup-link">{{
                row.supervisor_name
              }}</span>
              <span v-else class="unassigned">未分配</span>
            </template>
            <template v-else-if="row.role === 'supervisor'">
              <span>{{ row.member_count }} 位研究者</span>
            </template>
            <span v-else class="muted">管理所有人</span>
          </template>
        </el-table-column>
        <el-table-column label="问卷" width="90" align="right">
          <template #default="{ row }">
            {{ row.questionnaire_count
            }}<span v-if="row.bundle_count" class="muted">
              +{{ row.bundle_count }}组合</span
            >
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="110">
          <template #default="{ row }">{{ fmtDate(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="" width="250" align="right">
          <template #default="{ row }">
            <div v-if="row.can_manage" class="row-actions">
              <el-button size="small" text :icon="Edit" @click="openEdit(row)"
                >编辑</el-button
              >
              <el-button size="small" text :icon="Key" @click="openReset(row)"
                >重置密码</el-button
              >
              <el-button
                size="small"
                text
                type="danger"
                :icon="Delete"
                @click="openDelete(row)"
              />
            </div>
            <span v-else-if="row.is_self" class="muted"
              >自己的密码在右上角修改</span
            >
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty">
            {{
              admins.length === 0
                ? isAdmin
                  ? "还没有账号"
                  : "你名下还没有研究者。可以点「新建研究者」，或请总账号把已有的研究者分给你。"
                : "没有符合条件的账号"
            }}
          </div>
        </template>
      </el-table>
    </div>

    <!-- 新建 / 编辑 -->
    <el-dialog v-model="showEdit" :title="editTitle" width="560px" top="6vh">
      <el-form label-width="90px" @submit.prevent>
        <el-form-item v-if="isAdmin && !editing" label="角色">
          <el-radio-group v-model="form.role">
            <el-radio-button value="researcher">研究者</el-radio-button>
            <el-radio-button value="supervisor">导师</el-radio-button>
            <el-radio-button value="admin">总账号</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-else-if="isAdmin && editing" label="角色">
          <el-radio-group v-model="form.role">
            <el-radio-button value="researcher">研究者</el-radio-button>
            <el-radio-button value="supervisor">导师</el-radio-button>
            <el-radio-button value="admin">总账号</el-radio-button>
          </el-radio-group>
          <div
            v-if="editing.role === 'supervisor' && form.role !== 'supervisor'"
            class="form-tip warn"
          >
            改成别的角色后，他名下的
            {{ editing.member_count }} 位研究者会变成未分配。
          </div>
        </el-form-item>
        <div class="role-desc">
          <template v-if="form.role === 'admin'"
            >总账号：能看到所有问卷，管理所有账号。</template
          >
          <template v-else-if="form.role === 'supervisor'"
            >导师：能看到自己和名下研究者的问卷，能帮名下研究者重置密码。</template
          >
          <template v-else>研究者：只能看到自己建的问卷。</template>
        </div>
        <el-form-item label="姓名">
          <el-input v-model="form.display_name" placeholder="例如：张三" />
        </el-form-item>
        <template v-if="!editing">
          <el-form-item label="登录账号">
            <el-input
              v-model="form.username"
              placeholder="字母或数字，例如 zhangsan"
            />
          </el-form-item>
          <el-form-item label="初始密码">
            <el-input v-model="form.password">
              <template #append>
                <el-button
                  :icon="Refresh"
                  @click="form.password = randomPassword()"
                  >换一个</el-button
                >
              </template>
            </el-input>
            <div class="form-tip">
              建好后会显示账号和密码，可以复制发给对方；对方登录后在右上角自己修改密码。
            </div>
          </el-form-item>
        </template>
        <el-form-item
          v-if="isAdmin && form.role === 'researcher'"
          label="所属导师"
        >
          <el-select
            v-model="form.supervisor_id"
            placeholder="未分配"
            clearable
            style="width: 240px"
          >
            <el-option
              v-for="s in supervisors"
              :key="s.id"
              :value="s.id"
              :label="s.display_name"
            />
          </el-select>
          <div class="form-tip">
            选了导师后，导师能看到他的问卷。{{
              supervisors.length === 0 ? "现在还没有导师账号。" : ""
            }}
          </div>
        </el-form-item>
        <el-form-item v-if="!isAdmin && !editing" label="所属导师">
          <span class="muted">自动归到你名下</span>
        </el-form-item>
        <el-form-item
          v-if="isAdmin && form.role === 'supervisor'"
          label="名下研究者"
        >
          <MemberPicker
            v-model="form.member_ids"
            :researchers="researchers"
            :supervisor-id="editing ? editing.id : null"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEdit = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveAccount">{{
          editing ? "保存" : "创建"
        }}</el-button>
      </template>
    </el-dialog>

    <!-- 新建 / 重置后显示账号密码 -->
    <el-dialog
      :model-value="!!createdInfo"
      :title="createdInfo?.reset ? '密码已重置' : '账号已创建'"
      width="420px"
      @update:model-value="(v) => !v && (createdInfo = null)"
    >
      <div v-if="createdInfo" class="cred">
        <p class="muted">
          把下面的账号密码发给「{{
            createdInfo.name
          }}」。关掉这个窗口后就看不到密码了。
        </p>
        <div class="cred-row">
          <span>登录地址</span><b>{{ loginUrl }}</b>
        </div>
        <div class="cred-row">
          <span>账号</span><b>{{ createdInfo.username }}</b>
        </div>
        <div class="cred-row">
          <span>密码</span><b>{{ createdInfo.password }}</b>
        </div>
      </div>
      <template #footer>
        <el-button
          @click="
            copyText(
              `登录地址：${loginUrl}\n账号：${createdInfo.username}\n密码：${createdInfo.password}`,
            )
          "
          >复制账号密码</el-button
        >
        <el-button type="primary" @click="createdInfo = null">好了</el-button>
      </template>
    </el-dialog>

    <!-- 重置密码 -->
    <el-dialog
      :model-value="!!resetTarget"
      title="重置密码"
      width="420px"
      @update:model-value="(v) => !v && (resetTarget = null)"
    >
      <p v-if="resetTarget" class="muted">
        给「{{ resetTarget.display_name }}」（账号
        {{ resetTarget.username }}）设置新密码：
      </p>
      <el-input v-model="newPassword">
        <template #append>
          <el-button :icon="Refresh" @click="newPassword = randomPassword()"
            >换一个</el-button
          >
        </template>
      </el-input>
      <template #footer>
        <el-button @click="resetTarget = null">取消</el-button>
        <el-button type="primary" :loading="resetting" @click="resetPassword"
          >确认重置</el-button
        >
      </template>
    </el-dialog>

    <!-- 删除账号 -->
    <el-dialog
      :model-value="!!deleteTarget"
      title="删除账号"
      width="460px"
      @update:model-value="(v) => !v && (deleteTarget = null)"
    >
      <div v-if="deleteTarget" class="del">
        <p>
          确定删除「<b>{{ deleteTarget.display_name }}</b
          >」（账号 {{ deleteTarget.username }}）？删除后这个账号不能再登录。
        </p>
        <p
          v-if="
            deleteTarget.role === 'supervisor' && deleteTarget.member_count > 0
          "
          class="warn"
        >
          他名下的 {{ deleteTarget.member_count }} 位研究者会变成「未分配」。
        </p>
        <template v-if="deleteOwns">
          <p>
            他建了 {{ deleteTarget.questionnaire_count }} 份问卷{{
              deleteTarget.bundle_count
                ? `、${deleteTarget.bundle_count} 个问卷组合`
                : ""
            }}，问卷和作答数据不会删除，移交给：
          </p>
          <el-select
            v-if="isAdmin"
            v-model="transferTo"
            placeholder="选择接收的账号"
            filterable
            style="width: 100%"
          >
            <el-option
              v-for="a in transferOptions"
              :key="a.id"
              :value="a.id"
              :label="`${a.display_name}（${ROLE_NAMES[a.role]}${a.is_self ? '，我' : ''}）`"
            />
          </el-select>
          <p v-else><b>你自己</b></p>
        </template>
      </div>
      <template #footer>
        <el-button @click="deleteTarget = null">取消</el-button>
        <el-button
          type="danger"
          :loading="deleting"
          :disabled="deleteOwns && isAdmin && !transferTo"
          @click="doDelete"
          >删除账号</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  max-width: 1080px;
  margin: 0 auto;
}
.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.page-head h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
  color: var(--app-text);
}
.sub {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--app-text-3);
}
.head-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.chip {
  border: 1px solid var(--app-border);
  background: #fff;
  color: var(--app-text-2);
  border-radius: 999px;
  padding: 5px 14px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.chip:hover {
  border-color: #e4cfae;
}
.chip.active {
  background: var(--el-color-primary);
  border-color: var(--el-color-primary);
  color: #fff;
}
.chip-count {
  margin-left: 4px;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}
.chip.warn:not(.active) .chip-count {
  color: #a96a14;
  opacity: 1;
  font-weight: 600;
}
.sup-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}
.sup-card {
  text-align: left;
  border: 1px solid var(--app-border);
  background: #fff;
  border-radius: 12px;
  padding: 10px 14px;
  cursor: pointer;
  font: inherit;
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}
.sup-card:hover {
  border-color: #e4cfae;
  box-shadow: 0 2px 8px rgba(184, 130, 30, 0.1);
}
.sup-card.active {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 2px var(--el-color-primary-light-8);
}
.sup-card.add {
  border-style: dashed;
  background: transparent;
}
.sup-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text);
}
.sup-card.add .sup-name {
  color: var(--el-color-primary);
}
.sup-meta {
  font-size: 12px;
  color: var(--app-text-3);
}
.first-tip {
  font-size: 13px;
  color: var(--app-text-2);
  background: var(--app-accent-soft);
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 12px;
}
.batch {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 6px;
  background: #fff;
  border: 1px solid var(--app-border);
  border-radius: 12px;
  padding: 8px 14px;
  margin-bottom: 12px;
  font-size: 13px;
}
.batch .el-button + .el-button {
  margin-left: 0;
}
.batch-label {
  color: var(--app-text-2);
}
.batch-label b {
  color: var(--el-color-primary);
}
.batch-sep {
  width: 1px;
  height: 16px;
  background: var(--app-border);
  margin: 0 6px;
}
.batch-hint {
  color: var(--app-text-3);
  font-size: 12px;
}
.card {
  background: var(--app-card);
  border: 1px solid var(--app-border);
  border-radius: 12px;
  padding: 4px 8px 8px;
  min-height: 120px;
}
.name {
  font-weight: 600;
  color: var(--app-text);
}
.self {
  font-weight: 400;
  color: var(--app-text-3);
  font-size: 12px;
}
.muted {
  font-size: 12px;
  color: var(--app-text-3);
}
.unassigned {
  font-size: 12px;
  color: #a96a14;
  background: #fdf2dc;
  padding: 1px 8px;
  border-radius: 999px;
}
.role-badge {
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 999px;
  font-weight: 600;
  background: #f3ede3;
  color: var(--app-text-2);
  white-space: nowrap;
}
.role-badge.admin {
  background: #fdebd9;
  color: #a0481b;
}
.role-badge.supervisor {
  background: #e7f0fb;
  color: #2f5d8a;
}
.role-badge.researcher {
  background: #e8f5ec;
  color: #2f7d4f;
}
.row-actions {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}
.row-actions .el-button + .el-button {
  margin-left: 2px;
}
.empty {
  padding: 32px 0;
  font-size: 13px;
  color: var(--app-text-3);
}
.role-desc {
  margin: -8px 0 14px 90px;
  font-size: 12px;
  color: var(--app-text-3);
}
.form-tip {
  width: 100%;
  font-size: 12px;
  color: var(--app-text-3);
  line-height: 1.6;
}
.form-tip.warn,
.warn {
  color: #a96a14;
}
.cred-row {
  display: flex;
  gap: 12px;
  padding: 8px 12px;
  background: #faf6ef;
  border-radius: 8px;
  margin-top: 8px;
  font-size: 14px;
}
.cred-row span {
  width: 64px;
  color: var(--app-text-3);
  flex-shrink: 0;
}
.cred-row b {
  word-break: break-all;
  font-family: ui-monospace, Menlo, Consolas, monospace;
}
.del p {
  margin: 0 0 10px;
  line-height: 1.7;
  font-size: 14px;
}
</style>
