import { createRouter, createWebHistory } from "vue-router";
import LoginView from "../views/LoginView.vue";
import DashboardView from "../views/DashboardView.vue";
import ImportQuestions from "../views/ImportQuestions.vue";
import QuestionnaireShell from "../views/QuestionnaireShell.vue";
import QuestionnaireDetail from "../views/QuestionnaireDetail.vue";
import DimensionConfig from "../views/DimensionConfig.vue";
import AdminManage from "../views/AdminManage.vue";
import QuestionEditor from "../views/QuestionEditor.vue";
import ScoreRuleConfig from "../views/ScoreRuleConfig.vue";
import SubjectInfoConfig from "../views/SubjectInfoConfig.vue";
import StatsView from "../views/StatsView.vue";
import BundleList from "../views/BundleList.vue";
import BundleEdit from "../views/BundleEdit.vue";
import NormConfig from "../views/NormConfig.vue";

// 除了登录页，其他页面都显示在左侧菜单 + 顶栏的布局里（App.vue 里按 meta.public 区分）
const routes = [
  {
    path: "/login",
    name: "login",
    component: LoginView,
    meta: { public: true },
  },
  { path: "/", name: "dashboard", component: DashboardView },
  { path: "/bundles", name: "bundles", component: BundleList },
  { path: "/bundle/:id", name: "bundleEdit", component: BundleEdit },
  { path: "/import", name: "import", component: ImportQuestions },
  { path: "/admin-manage", name: "adminManage", component: AdminManage },
  // 一份问卷的各个页面：上面是问卷标题、常用操作和标签页，下面切换具体内容
  {
    path: "/questionnaire/:id",
    component: QuestionnaireShell,
    children: [
      {
        path: "",
        name: "questionnaireDetail",
        component: QuestionnaireDetail,
      },
      {
        path: "edit-questions",
        name: "questionEditor",
        component: QuestionEditor,
      },
      {
        path: "dimensions",
        name: "dimensionConfig",
        component: DimensionConfig,
      },
      {
        path: "score-rules",
        name: "scoreRuleConfig",
        component: ScoreRuleConfig,
      },
      {
        path: "info-fields",
        name: "subjectInfoConfig",
        component: SubjectInfoConfig,
      },
      { path: "norms", name: "normConfig", component: NormConfig },
      { path: "stats", name: "questionnaireStats", component: StatsView },
    ],
  },
  // 地址打错了回到问卷列表
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

const router = createRouter({
  // 上线后后台放在 /admin/ 下面（见 vite.config.js 的 base），本地开发还是根路径
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

// 没登录的话先去登录页，登录后回到原来要去的页面
router.beforeEach((to) => {
  if (to.meta.public) return true;
  if (!localStorage.getItem("admin_token")) {
    return { path: "/login", query: { redirect: to.fullPath } };
  }
  return true;
});

export default router;
