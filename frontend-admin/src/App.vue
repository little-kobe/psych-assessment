<script setup>
import { useRoute } from "vue-router";
import AdminLayout from "./components/AdminLayout.vue";

const route = useRoute();
</script>

<template>
  <!-- 登录页单独显示；其他页面都放在左侧菜单的布局里（路由还没解析出来时先不显示，避免闪一下） -->
  <template v-if="route.matched.length > 0">
    <router-view v-if="route.meta.public" />
    <AdminLayout v-else>
      <router-view />
    </AdminLayout>
  </template>
</template>
