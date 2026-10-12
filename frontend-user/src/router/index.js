import { createRouter, createWebHistory } from "vue-router";
import HomeView from "../views/HomeView.vue";
import QuestionnaireView from "../views/QuestionnaireView.vue";

const routes = [
  {
    // 首页：提示受测者通过研究者发的链接或二维码进入
    path: "/",
    name: "home",
    component: HomeView,
  },
  {
    path: "/q/:id",
    name: "questionnaire",
    component: QuestionnaireView,
  },
  {
    // 问卷组合：一个链接依次作答几份问卷（和单份问卷用同一个页面）
    path: "/b/:id",
    name: "bundle",
    component: QuestionnaireView,
  },
  {
    // 其他写错的网址：显示「链接有误」
    path: "/:pathMatch(.*)*",
    name: "notFound",
    component: HomeView,
    props: { notFound: true },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
