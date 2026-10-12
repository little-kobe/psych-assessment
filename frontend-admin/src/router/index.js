import { createRouter, createWebHistory } from "vue-router";
import LoginView from "../views/LoginView.vue";
import DashboardView from "../views/DashboardView.vue";
import ImportQuestions from "../views/ImportQuestions.vue";
import QuestionnaireDetail from "../views/QuestionnaireDetail.vue";
import DimensionConfig from "../views/DimensionConfig.vue";
import AdminManage from "../views/AdminManage.vue";
import QuestionEditor from "../views/QuestionEditor.vue";
import ScoreRuleConfig from "../views/ScoreRuleConfig.vue";
import SubjectInfoConfig from "../views/SubjectInfoConfig.vue";
import StatsView from "../views/StatsView.vue";
import BundleEdit from "../views/BundleEdit.vue";
import NormConfig from "../views/NormConfig.vue";

const routes = [
  { path: "/login", name: "login", component: LoginView },
  {
    path: "/questionnaire/:id/stats",
    name: "questionnaireStats",
    component: StatsView,
  },
  {
    path: "/questionnaire/:id/info-fields",
    name: "subjectInfoConfig",
    component: SubjectInfoConfig,
  },
  {
    path: "/questionnaire/:id/score-rules",
    name: "scoreRuleConfig",
    component: ScoreRuleConfig,
  },
  {
    path: "/questionnaire/:id/edit-questions",
    name: "questionEditor",
    component: QuestionEditor,
  },
  { path: "/", name: "dashboard", component: DashboardView },
  // 问卷组合：列表显示在首页布局里（左侧菜单「问卷组合」），编辑是单独页面
  { path: "/bundles", name: "bundles", component: DashboardView },
  { path: "/bundle/:id", name: "bundleEdit", component: BundleEdit },
  {
    path: "/questionnaire/:id/norms",
    name: "normConfig",
    component: NormConfig,
  },
  { path: "/import", name: "import", component: ImportQuestions },
  {
    path: "/questionnaire/:id",
    name: "questionnaireDetail",
    component: QuestionnaireDetail,
  },
  {
    path: "/questionnaire/:id/dimensions",
    name: "dimensionConfig",
    component: DimensionConfig,
  },
  { path: "/admin-manage", name: "adminManage", component: AdminManage },
];

const router = createRouter({
  // 上线后后台放在 /admin/ 下面（见 vite.config.js 的 base），本地开发还是根路径
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

export default router;
