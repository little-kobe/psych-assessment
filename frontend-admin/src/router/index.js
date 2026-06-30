import { createRouter, createWebHistory } from "vue-router";
import LoginView from "../views/LoginView.vue";
import DashboardView from "../views/DashboardView.vue";
import ImportQuestions from "../views/ImportQuestions.vue";
import QuestionnaireDetail from "../views/QuestionnaireDetail.vue";

const routes = [
  { path: "/login", name: "login", component: LoginView },
  { path: "/", name: "dashboard", component: DashboardView },
  { path: "/import", name: "import", component: ImportQuestions },
  {
    path: "/questionnaire/:id",
    name: "questionnaireDetail",
    component: QuestionnaireDetail,
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
