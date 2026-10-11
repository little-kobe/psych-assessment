<script setup>
// 答题端首页：受测者不应该直接打开这里，而是通过研究者发的链接或二维码进入某份问卷。
// 网址写错（找不到对应页面）时也显示这个页面，notFound 为 true 时换成「链接有误」的提示。
defineProps({
  notFound: { type: Boolean, default: false },
});
</script>

<template>
  <div class="page">
    <svg
      class="bg-art"
      viewBox="0 0 800 600"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="homeSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#EAF6F0" />
          <stop offset="100%" stop-color="#F4FBF6" />
        </linearGradient>
      </defs>
      <rect width="800" height="600" fill="url(#homeSky)" />
      <path
        d="M0,460 C150,400 300,440 450,400 C600,360 700,420 800,390 L800,600 L0,600 Z"
        fill="#DCEFE0"
      />
      <path
        d="M0,510 C180,470 350,500 500,470 C650,440 720,480 800,460 L800,600 L0,600 Z"
        fill="#CDE8D4"
      />
    </svg>

    <div class="content">
      <div class="home-card">
        <div class="home-icon">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
            <circle
              cx="12"
              cy="12"
              r="9.5"
              stroke="#4CAF7D"
              stroke-width="1.5"
            />
            <path
              v-if="!notFound"
              d="M8 12.5l2.5 2.5L16 9.5"
              stroke="#4CAF7D"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              v-else
              d="M12 7.5v5.5M12 16.2v.3"
              stroke="#4CAF7D"
              stroke-width="1.8"
              stroke-linecap="round"
            />
          </svg>
        </div>

        <template v-if="!notFound">
          <h1>心理测评</h1>
          <p class="home-text">
            请使用研究者发给你的问卷链接或二维码进入作答。
          </p>
        </template>
        <template v-else>
          <h1>链接有误</h1>
          <p class="home-text">没有找到这个页面，请确认链接是否完整。</p>
        </template>

        <p class="home-sub">如果链接打不开，请联系发放问卷的老师或研究者。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
}
.bg-art {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
}
.content {
  position: relative;
  z-index: 1;
  max-width: 420px;
  margin: 0 auto;
  padding: 18vh 20px 40px;
}
.home-card {
  background: rgba(255, 255, 255, 0.92);
  border-radius: 20px;
  padding: 40px 28px 32px;
  text-align: center;
  box-shadow: 0 16px 40px rgba(76, 175, 125, 0.12);
}
.home-icon {
  margin-bottom: 12px;
}
.home-card h1 {
  font-size: 20px;
  font-weight: 600;
  color: #2e4a38;
  margin: 0 0 10px;
}
.home-text {
  font-size: 15px;
  color: #3d5a48;
  line-height: 1.7;
  margin: 0 0 14px;
}
.home-sub {
  font-size: 13px;
  color: #8aaa94;
  margin: 0;
}
</style>
