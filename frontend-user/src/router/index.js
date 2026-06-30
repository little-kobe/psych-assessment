// frontend-user/src/router/index.js
import { createRouter, createWebHistory } from "vue-router";
import QuestionnaireView from "../views/QuestionnaireView.vue";

const routes = [
  {
    path: "/",
    name: "questionnaire",
    component: QuestionnaireView,
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
