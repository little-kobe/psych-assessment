import { createRouter, createWebHistory } from "vue-router";
import QuestionnaireView from "../views/QuestionnaireView.vue";

const routes = [
  {
    path: "/",
    name: "home",
    redirect: "/q/1", // 暂时默认跳转到1号问卷，等做了问卷列表再改
  },
  {
    path: "/q/:id",
    name: "questionnaire",
    component: QuestionnaireView,
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
