// frontend/src/router/index.js
import { createRouter, createWebHistory } from "vue-router";
import QuestionnaireView from "../views/QuestionnaireView.vue";
import ImportQuestions from "../views/ImportQuestions.vue";

const routes = [
  {
    path: "/",
    name: "questionnaire",
    component: QuestionnaireView,
  },
  {
    path: "/admin/import",
    name: "import",
    component: ImportQuestions,
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
