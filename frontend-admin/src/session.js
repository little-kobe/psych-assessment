// 当前登录的账号信息（顶栏、菜单、账号管理页共用）。
// 角色以服务器为准：每次进入后台读一次 /api/admin/me，总账号改了角色或导师后，刷新页面就生效。
import { ref } from "vue";
import { API_BASE } from "./api.js";

export const ROLE_NAMES = {
  admin: "总账号",
  supervisor: "导师",
  researcher: "研究者",
};

export const me = ref(null);

// 还没读到服务器的信息时，先用登录时存下来的，避免页面闪一下
export function currentRole() {
  return me.value?.role || localStorage.getItem("admin_role") || "";
}
export function currentName() {
  return me.value?.display_name || localStorage.getItem("admin_name") || "";
}

export function clearSession() {
  localStorage.removeItem("admin_token");
  localStorage.removeItem("admin_role");
  localStorage.removeItem("admin_name");
  me.value = null;
}

// 读取当前账号；登录过期或账号被删时返回 "unauthorized"
export async function loadMe() {
  const token = localStorage.getItem("admin_token");
  if (!token) return "unauthorized";
  try {
    const res = await fetch(`${API_BASE}/api/admin/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      clearSession();
      return "unauthorized";
    }
    const data = await res.json();
    if (data.success) {
      me.value = data;
      localStorage.setItem("admin_role", data.role);
      localStorage.setItem("admin_name", data.display_name || "");
    }
    return data;
  } catch {
    return null; // 网络问题：先不处理，页面上的请求会各自提示
  }
}
