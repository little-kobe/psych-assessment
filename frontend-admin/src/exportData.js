// 下载一份问卷的作答数据（Excel）。问卷页顶部「导出数据」和删除问卷前的「先导出数据」共用
import { ElMessage } from "element-plus";
import { API_BASE } from "./api.js";

export async function downloadQuestionnaireData(id, title) {
  const token = localStorage.getItem("admin_token");
  try {
    const res = await fetch(`${API_BASE}/api/questionnaires/${id}/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      ElMessage.error("导出失败，请检查是否有作答数据");
      return false;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title || "问卷"}_作答数据.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    ElMessage.success("导出成功");
    return true;
  } catch {
    ElMessage.error("导出失败，请检查后端服务");
    return false;
  }
}
