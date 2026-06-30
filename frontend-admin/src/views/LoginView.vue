<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();
const username = ref("");
const password = ref("");
const errorMsg = ref("");
const loading = ref(false);

async function handleLogin() {
  if (!username.value || !password.value) {
    errorMsg.value = "请输入账号和密码";
    return;
  }

  loading.value = true;
  errorMsg.value = "";

  try {
    const response = await fetch("http://localhost:3000/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: username.value,
        password: password.value,
      }),
    });
    const data = await response.json();

    if (data.success) {
      localStorage.setItem("admin_token", data.token);
      localStorage.setItem("admin_role", data.role);
      localStorage.setItem("admin_name", data.displayName);
      router.push("/");
    } else {
      errorMsg.value = data.message || "登录失败";
    }
  } catch (err) {
    errorMsg.value = "无法连接服务器，请检查后端是否启动";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <svg
      class="bg-art"
      viewBox="0 0 800 600"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <radialGradient id="skyGrad" cx="50%" cy="20%" r="80%">
          <stop offset="0%" stop-color="#FFF6E0" />
          <stop offset="55%" stop-color="#FFEFC2" />
          <stop offset="100%" stop-color="#FDE5A8" />
        </radialGradient>
      </defs>
      <rect width="800" height="600" fill="url(#skyGrad)" />

      <!-- soft tech grid lines -->
      <g stroke="#F2C84B" stroke-width="0.6" opacity="0.25">
        <line x1="0" y1="120" x2="800" y2="120" />
        <line x1="0" y1="220" x2="800" y2="220" />
        <line x1="160" y1="0" x2="160" y2="600" />
        <line x1="640" y1="0" x2="640" y2="600" />
      </g>

      <!-- floating data dots -->
      <g fill="#F4A93B">
        <circle cx="120" cy="90" r="3" opacity="0.6" />
        <circle cx="700" cy="140" r="4" opacity="0.5" />
        <circle cx="660" cy="480" r="3" opacity="0.5" />
        <circle cx="90" cy="430" r="4" opacity="0.55" />
        <circle cx="740" cy="320" r="2.5" opacity="0.5" />
      </g>

      <!-- sunflower cluster, bottom right -->
      <g transform="translate(660,470)">
        <g transform="rotate(0)">
          <g v-for="n in 12" :key="n"></g>
        </g>
        <!-- petals -->
        <g fill="#FBB034">
          <ellipse cx="0" cy="-46" rx="13" ry="26" transform="rotate(0)" />
          <ellipse cx="0" cy="-46" rx="13" ry="26" transform="rotate(30)" />
          <ellipse cx="0" cy="-46" rx="13" ry="26" transform="rotate(60)" />
          <ellipse cx="0" cy="-46" rx="13" ry="26" transform="rotate(90)" />
          <ellipse cx="0" cy="-46" rx="13" ry="26" transform="rotate(120)" />
          <ellipse cx="0" cy="-46" rx="13" ry="26" transform="rotate(150)" />
          <ellipse cx="0" cy="-46" rx="13" ry="26" transform="rotate(180)" />
          <ellipse cx="0" cy="-46" rx="13" ry="26" transform="rotate(210)" />
          <ellipse cx="0" cy="-46" rx="13" ry="26" transform="rotate(240)" />
          <ellipse cx="0" cy="-46" rx="13" ry="26" transform="rotate(270)" />
          <ellipse cx="0" cy="-46" rx="13" ry="26" transform="rotate(300)" />
          <ellipse cx="0" cy="-46" rx="13" ry="26" transform="rotate(330)" />
        </g>
        <circle r="22" fill="#8B5A2B" />
        <circle
          r="22"
          fill="none"
          stroke="#6E4520"
          stroke-width="0.6"
          opacity="0.4"
        />
        <path
          d="M0,22 C-6,70 6,110 -2,150"
          stroke="#6FA85C"
          stroke-width="5"
          fill="none"
          stroke-linecap="round"
        />
        <ellipse
          cx="-22"
          cy="80"
          rx="20"
          ry="9"
          fill="#7CB66A"
          transform="rotate(-25 -22 80)"
        />
      </g>

      <!-- smaller sunflower, top left -->
      <g transform="translate(110,80) scale(0.55)">
        <g fill="#FBB034">
          <ellipse cx="0" cy="-46" rx="13" ry="26" transform="rotate(0)" />
          <ellipse cx="0" cy="-46" rx="13" ry="26" transform="rotate(45)" />
          <ellipse cx="0" cy="-46" rx="13" ry="26" transform="rotate(90)" />
          <ellipse cx="0" cy="-46" rx="13" ry="26" transform="rotate(135)" />
          <ellipse cx="0" cy="-46" rx="13" ry="26" transform="rotate(180)" />
          <ellipse cx="0" cy="-46" rx="13" ry="26" transform="rotate(225)" />
          <ellipse cx="0" cy="-46" rx="13" ry="26" transform="rotate(270)" />
          <ellipse cx="0" cy="-46" rx="13" ry="26" transform="rotate(315)" />
        </g>
        <circle r="20" fill="#8B5A2B" />
      </g>
    </svg>

    <div class="login-card">
      <div class="brand">
        <div class="brand-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="5" r="2.2" fill="white" />
            <path
              d="M12 7.2v4M12 11.2c-3 0-5 2-5 5v2h10v-2c0-3-2-5-5-5Z"
              stroke="white"
              stroke-width="1.4"
              stroke-linejoin="round"
              fill="none"
            />
            <circle cx="6.5" cy="13" r="1.4" fill="white" opacity="0.9" />
            <circle cx="17.5" cy="13" r="1.4" fill="white" opacity="0.9" />
          </svg>
        </div>
        <h1>心理测评管理平台</h1>
        <p class="subtitle">运动心理学研究 · 智能数据分析</p>
      </div>

      <form @submit.prevent="handleLogin" class="form">
        <div class="field">
          <label>账号</label>
          <input
            v-model="username"
            type="text"
            placeholder="请输入账号"
            autocomplete="username"
          />
        </div>
        <div class="field">
          <label>密码</label>
          <input
            v-model="password"
            type="password"
            placeholder="请输入密码"
            autocomplete="current-password"
          />
        </div>

        <p v-if="errorMsg" class="error">{{ errorMsg }}</p>

        <button type="submit" :disabled="loading" class="submit-btn">
          {{ loading ? "登录中..." : "登录" }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #fff8e7;
}

.bg-art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.login-card {
  position: relative;
  z-index: 1;
  width: 380px;
  padding: 40px 36px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.9);
  border-radius: 18px;
  backdrop-filter: blur(10px);
  box-shadow: 0 20px 50px rgba(184, 130, 30, 0.18);
}

.brand {
  text-align: center;
  margin-bottom: 32px;
}
.brand-icon {
  width: 52px;
  height: 52px;
  margin: 0 auto 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background: linear-gradient(135deg, #fbb034, #f4844c);
  box-shadow: 0 6px 16px rgba(244, 132, 76, 0.35);
}
.brand h1 {
  font-size: 18px;
  font-weight: 600;
  color: #3d2b12;
  margin: 0 0 6px;
}
.subtitle {
  font-size: 13px;
  color: #a87c3f;
  margin: 0;
  letter-spacing: 0.3px;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field label {
  font-size: 13px;
  color: #8a6a3a;
}
.field input {
  height: 42px;
  padding: 0 14px;
  background: #fff;
  border: 1px solid #f0dcae;
  border-radius: 10px;
  color: #3d2b12;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}
.field input::placeholder {
  color: #c9b488;
}
.field input:focus {
  border-color: #f4a93b;
  box-shadow: 0 0 0 3px rgba(244, 169, 59, 0.15);
}

.error {
  font-size: 13px;
  color: #d9534f;
  margin: 0;
}

.submit-btn {
  height: 44px;
  margin-top: 8px;
  border: none;
  border-radius: 10px;
  background: linear-gradient(135deg, #fbb034, #f4844c);
  color: white;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition:
    opacity 0.2s,
    transform 0.1s;
}
.submit-btn:hover {
  opacity: 0.92;
}
.submit-btn:active {
  transform: scale(0.98);
}
.submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
