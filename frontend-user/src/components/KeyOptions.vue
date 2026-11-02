<script setup>
// 按键作答模式的一道题（正式题、练习题共用）：
// 选项前面标字母（A、B、C…），答完后（设置了的话）问把握程度 1-5。
// 键盘由答题页统一监听；这里只处理触屏：手指按下、抬起（鼠标点选项不算，答题页会提示用键盘）
import { letterOf, CONFIDENCE_LEVELS } from "../keyResponse.js";

defineProps({
  options: { type: Array, default: () => [] }, // [{ label, image }]，image 是完整地址
  pressedIndex: { type: Number, default: -1 }, // 正按着（或刚选中）的选项
  phase: { type: String, default: "idle" }, // ready / pressed / done / confidence …
  touch: { type: Boolean, default: false }, // 触屏设备：提示文字写「点」而不是「按键」
  hint: { type: String, default: "" }, // 临时提示
});
const emit = defineEmits(["press", "release", "cancel", "confidence"]);
</script>

<template>
  <div class="key-trial">
    <!-- 把握程度 -->
    <div v-if="phase === 'confidence'" class="confidence-panel">
      <p class="confidence-title">你对刚才的回答有多大把握？</p>
      <div class="confidence-buttons">
        <button
          v-for="c in CONFIDENCE_LEVELS"
          :key="c.value"
          class="confidence-btn"
          @click="emit('confidence', c.value)"
        >
          <b>{{ c.value }}</b>
          <span>{{ c.label }}</span>
        </button>
      </div>
      <p class="key-tip">
        {{ touch ? "点一个数字" : "按数字键 1–5，或直接点选" }}
      </p>
    </div>

    <template v-else>
      <div
        class="key-options no-save"
        :class="{ disabled: phase === 'done' }"
        @contextmenu.prevent
        @dragstart.prevent
      >
        <div
          v-for="(opt, i) in options"
          :key="i"
          class="key-option"
          :class="{ pressed: pressedIndex === i }"
          @pointerdown="emit('press', $event, i)"
          @pointerup="emit('release', $event, i)"
          @pointercancel="emit('cancel', $event, i)"
        >
          <span class="key-letter">{{ letterOf(i) }}</span>
          <img
            v-if="opt.image"
            :src="opt.image"
            :alt="opt.label"
            class="key-img"
          />
          <span class="key-label">{{ opt.label }}</span>
        </div>
      </div>
      <p class="key-tip">
        {{
          phase === "done"
            ? "已记录"
            : touch
              ? "直接点你选的选项"
              : "按选项前面的字母键作答"
        }}
      </p>
    </template>
    <p v-if="hint" class="key-hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.key-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* 触屏上按住选项时不要滚动页面、不要弹出长按菜单、不要选中文字 */
  touch-action: none;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}
.key-option {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1.5px solid #dcefe0;
  background: #fff;
  border-radius: 10px;
  font-size: 15px;
  color: #3d5a48;
  transition:
    background-color 0.08s,
    border-color 0.08s;
}
.key-letter {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 7px;
  border: 1.5px solid #9ed9b2;
  background: #f4fbf6;
  color: #2e7d32;
  font-weight: 700;
  font-size: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
}
.key-img {
  width: 72px;
  height: 72px;
  object-fit: contain;
  border-radius: 6px;
  background: #fafafa;
  flex-shrink: 0;
}
.key-label {
  line-height: 1.4;
}
.key-option.pressed {
  border-color: #4caf7d;
  background: #eaf7ef;
}
.key-option.pressed .key-letter {
  background: #4caf7d;
  border-color: #4caf7d;
  color: #fff;
}
.key-options.disabled .key-option:not(.pressed) {
  opacity: 0.55;
}
.key-tip {
  margin: 12px 0 0;
  text-align: center;
  font-size: 12px;
  color: #9cb8a6;
}
.key-hint {
  margin: 8px 0 0;
  text-align: center;
  font-size: 13px;
  color: #c0702a;
  background: #fff6ec;
  border-radius: 8px;
  padding: 6px 10px;
}
.confidence-title {
  margin: 0 0 14px;
  text-align: center;
  font-size: 15px;
  font-weight: 600;
  color: #2e4a38;
}
.confidence-buttons {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}
.confidence-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 4px;
  border: 1.5px solid #dcefe0;
  background: #fff;
  border-radius: 10px;
  cursor: pointer;
  font-family: inherit;
}
.confidence-btn b {
  font-size: 18px;
  color: #2e7d32;
}
.confidence-btn span {
  font-size: 11px;
  color: #6b8a76;
  line-height: 1.3;
}
.confidence-btn:hover {
  border-color: #9ed9b2;
  background: #f4fbf6;
}
</style>
