<script setup>
// 页面顶部的面包屑，如「问卷管理 / 某问卷 / 导入题目」，前面几级可以点击返回
defineProps({
  items: { type: Array, required: true }, // [{ label, to }]，最后一项是当前页面，不用 to
});
</script>

<template>
  <div class="crumbs">
    <template v-for="(it, i) in items" :key="i">
      <span v-if="i > 0" class="sep">/</span>
      <router-link v-if="it.to" :to="it.to">{{ it.label }}</router-link>
      <span v-else class="current">{{ it.label }}</span>
    </template>
  </div>
</template>

<style scoped>
.crumbs {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--app-text-3);
  margin-bottom: 10px;
  min-width: 0;
}
.crumbs a {
  color: var(--app-text-2);
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 320px;
}
.crumbs a:hover {
  color: var(--el-color-primary);
}
.sep {
  color: #d6cbb8;
}
.current {
  white-space: nowrap;
}
</style>
