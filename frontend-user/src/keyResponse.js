// 按键作答模式用到的工具
//
// 做法参照 Zhou, Goh, Phillips & Firestone (2026, PNAS)「Response duration tracks confidence」：
// 受测者正常按键作答，按下（KeyDown）就选中答案，松开（KeyUp）后进入下一题。记录两个时间：
//   按下用时 = 题目出现 → 按下按键（反应启动时间）
//   按住时长 = 按下 → 松开（response duration，论文发现没把握时会按得更久一点）
// 不提示受测者「按住、想好再松开」：那样测到的就是有意的思考时间，而不是论文里自然的按键时长

// 练习题（只用来熟悉按键，不保存）
export const PRACTICE_ITEMS = [
  {
    content: "练习：下面哪一个是水果？",
    options: ["苹果", "汽车", "书本", "桌子"],
  },
  { content: "练习：1 + 2 等于几？", options: ["2", "3", "4", "5"] },
  {
    content: "练习：晴天时，天空通常是什么颜色？",
    options: ["红色", "绿色", "蓝色", "黑色"],
  },
  { content: "练习：一周有几天？", options: ["5 天", "6 天", "7 天", "8 天"] },
  { content: "练习：下面哪一种动物会飞？", options: ["鱼", "鸟", "牛", "马"] },
];

// 能用按键作答的题型：量表、单选、是否题（一题只选一个答案）。多选、开放题照常用鼠标/手指作答
export function isKeyCapable(q) {
  if (!q) return false;
  const type = q.question_type || "scale";
  return type === "scale" || type === "single_choice" || type === "yes_no";
}

// 第 i 个选项对应的字母：0 → A
export function letterOf(i) {
  return i < 26 ? String.fromCharCode(65 + i) : "";
}

// 按的是哪个字母键（返回 0 表示 A，不是字母键返回 -1）
// 优先看 e.key；开着中文输入法等情况下 e.key 不是字母时，按键盘上的物理位置 e.code 判断
export function letterIndexFromEvent(e) {
  if (typeof e.key === "string" && /^[a-z]$/i.test(e.key)) {
    return e.key.toUpperCase().charCodeAt(0) - 65;
  }
  const m = /^Key([A-Z])$/.exec(e.code || "");
  return m ? m[1].charCodeAt(0) - 65 : -1;
}

// 数字键 1-5（主键盘或小键盘），用于回答把握程度；不是返回 0
export function digitFromEvent(e) {
  const m = /^(?:Digit|Numpad)([1-5])$/.exec(e.code || "");
  if (m) return Number(m[1]);
  return /^[1-5]$/.test(e.key) ? Number(e.key) : 0;
}

// 事件发生的时刻（毫秒，和 performance.now() 同一个起点）。
// 现在的浏览器 event.timeStamp 就是这个；极老的浏览器给的是 1970 年起的毫秒数，这时退回 performance.now()
export function eventTime(e) {
  const now = performance.now();
  const t = e && typeof e.timeStamp === "number" ? e.timeStamp : NaN;
  return Number.isFinite(t) && t > 0 && Math.abs(now - t) < 60000 ? t : now;
}

// 这台设备主要是触屏（手机、平板）吗：决定说明文字写「按键」还是「点选项」
export function isTouchDevice() {
  try {
    return (
      window.matchMedia("(pointer: coarse)").matches &&
      !window.matchMedia("(pointer: fine)").matches
    );
  } catch {
    return false;
  }
}

export const CONFIDENCE_LEVELS = [
  { value: 1, label: "完全没把握" },
  { value: 2, label: "不太有把握" },
  { value: 3, label: "一般" },
  { value: 4, label: "比较有把握" },
  { value: 5, label: "非常有把握" },
];
