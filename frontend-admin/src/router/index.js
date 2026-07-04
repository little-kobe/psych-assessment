import { createRouter, createWebHistory } from "vue-router";
import LoginView from "../views/LoginView.vue";
import DashboardView from "../views/DashboardView.vue";
import ImportQuestions from "../views/ImportQuestions.vue";
import QuestionnaireDetail from "../views/QuestionnaireDetail.vue";
import DimensionConfig from "../views/DimensionConfig.vue";
import AdminManage from "../views/AdminManage.vue";
import QuestionEditor from "../views/QuestionEditor.vue";
import ScoreRuleConfig from "../views/ScoreRuleConfig.vue";

const routes = [
  { path: "/login", name: "login", component: LoginView },
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
  history: createWebHistory(),
  routes,
});

export default router;
