<script setup></script>

<template>
  <div class="app-shell">
    <nav class="nav-bar">
      <router-link to="/">问卷填写</router-link>
      <router-link to="/admin/import">导入题目</router-link>
    </nav>
    <router-view />
  </div>
</template>

<style scoped>
.nav-bar {
  padding: 16px 24px;
  background: #f5f5f5;
  border-bottom: 1px solid #ddd;
}
.nav-bar a {
  margin-right: 20px;
  text-decoration: none;
  color: #333;
  font-weight: bold;
}
.nav-bar a.router-link-active {
  color: #1976d2;
}
</style>
