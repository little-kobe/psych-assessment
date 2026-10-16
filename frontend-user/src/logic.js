// 题目逻辑（题目关联、跳题、选项关联）：根据受测者目前的答案，算出显示哪些题、哪些选项、在哪一题结束
// 逻辑的格式见 backend/logic.js 开头的说明。
// 下面的代码和 backend/logic.js 的「核心」部分完全一样（后端用它判断无效答卷、是否答完整），改的时候两边一起改

// ---------------- 核心（和后端 backend/logic.js 一致） ----------------

function parseJsonValue(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function strList(arr) {
  return Array.isArray(arr)
    ? arr.filter((x) => x !== null && x !== undefined && x !== "").map(String)
    : [];
}

function toTarget(t) {
  if (t === "end" || t === "invalid") return t;
  const n = Number(t);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// 把数据库里的 logic 整理成固定格式（格式不对的部分当作没有）
function normalizeLogic(raw) {
  const lg = parseJsonValue(raw) || {};
  let display = null;
  if (lg.display && Array.isArray(lg.display.conditions)) {
    const conditions = lg.display.conditions
      .map((c) => ({
        question_id: Number(c && c.question_id),
        options: strList(c && c.options),
      }))
      .filter((c) => Number.isInteger(c.question_id) && c.options.length > 0);
    if (conditions.length > 0) {
      display = {
        match: lg.display.match === "all" ? "all" : "any",
        conditions,
      };
    }
  }
  let jump = null;
  if (lg.jump && lg.jump.mode === "always") {
    const target = toTarget(lg.jump.target);
    if (target !== null) jump = { mode: "always", target };
  } else if (lg.jump && lg.jump.mode === "option") {
    const rules = (Array.isArray(lg.jump.rules) ? lg.jump.rules : [])
      .map((r) => ({
        option: r && r.option !== undefined ? String(r.option) : "",
        target: toTarget(r && r.target),
      }))
      .filter((r) => r.option !== "" && r.target !== null);
    if (rules.length > 0) jump = { mode: "option", rules };
  }
  let optionLink = null;
  if (lg.option_link && Array.isArray(lg.option_link.items)) {
    const items = lg.option_link.items
      .map((it) => ({
        option: it && it.option !== undefined ? String(it.option) : "",
        show_when: strList(it && it.show_when),
      }))
      .filter((it) => it.option !== "" && it.show_when.length > 0);
    const qid = Number(lg.option_link.question_id);
    if (Number.isInteger(qid) && items.length > 0) {
      optionLink = { question_id: qid, items };
    }
  }
  return { display, jump, option_link: optionLink };
}

function optionLabels(q) {
  const arr = parseJsonValue(q.options);
  if (!Array.isArray(arr)) return [];
  return arr.map((o) =>
    typeof o === "string" ? o : String((o && o.label) ?? ""),
  );
}

function isChoiceType(q) {
  return (
    q.question_type === "single_choice" || q.question_type === "multiple_choice"
  );
}

// 作答顺序：学生（和通用）题在前，家长题在后，各自按题号
function flowOrder(questions) {
  const byOrder = [...questions].sort(
    (a, b) => Number(a.order_num) - Number(b.order_num),
  );
  return [
    ...byOrder.filter((q) => q.role !== "parent"),
    ...byOrder.filter((q) => q.role === "parent"),
  ];
}

// 一道题的答案选了哪些「选项」（统一成文字）
// 答案的写法和答题页一致：量表题是分数（数字），单选、是否题是文字，多选是文字数组
function answerKeys(q, ans) {
  if (ans === undefined || ans === null || ans === "") return [];
  const type = q.question_type || "scale";
  if (type === "scale") {
    return typeof ans === "number" && Number.isFinite(ans) ? [String(ans)] : [];
  }
  if (type === "multiple_choice") {
    return Array.isArray(ans) ? ans.map(String) : [];
  }
  if (type === "single_choice" || type === "yes_no") return [String(ans)];
  return [];
}

function hasValue(ans) {
  if (ans === undefined || ans === null) return false;
  if (Array.isArray(ans)) return ans.length > 0;
  if (typeof ans === "string") return ans.trim().length > 0;
  return true;
}

// 根据目前的答案，算出：哪些题显示（按作答顺序）、每题实际有效的答案、
// 设了选项关联的题显示哪些选项、在哪一题结束作答（end：{ id, invalid }）
// flow：按作答顺序排好的题目；answers：{ 题目id: 答案 }
function evaluateLogic(flow, answers) {
  const pos = new Map(flow.map((q, i) => [Number(q.id), i]));
  const visible = [];
  const effective = {};
  const optionVisible = {};
  let end = null;
  let skipTo = -1;
  const keysOf = (id) => {
    const i = pos.get(Number(id));
    return i === undefined || effective[id] === undefined
      ? []
      : answerKeys(flow[i], effective[id]);
  };
  for (let i = 0; i < flow.length; i++) {
    if (end) break;
    if (i < skipTo) continue; // 被前面的跳题跳过
    const q = flow[i];
    const lg = normalizeLogic(q.logic);
    const isBefore = (id) => pos.has(id) && pos.get(id) < i;

    // 题目关联：只看排在这题前面的题目；条件都无效时当作没设
    if (lg.display) {
      const conds = lg.display.conditions.filter((c) =>
        isBefore(c.question_id),
      );
      if (conds.length > 0) {
        const hit = (c) =>
          keysOf(c.question_id).some((k) => c.options.includes(k));
        const ok =
          lg.display.match === "all" ? conds.every(hit) : conds.some(hit);
        if (!ok) continue;
      }
    }

    // 选项关联：算出显示哪些选项；一个都不显示时整道题跳过
    let ans = answers[q.id];
    if (
      lg.option_link &&
      isChoiceType(q) &&
      isBefore(lg.option_link.question_id)
    ) {
      const src = keysOf(lg.option_link.question_id);
      const shown = optionLabels(q).filter((label) => {
        const item = lg.option_link.items.find((it) => it.option === label);
        return !item || item.show_when.some((k) => src.includes(k));
      });
      if (shown.length === 0) continue;
      optionVisible[q.id] = shown;
      if (q.question_type === "single_choice") {
        if (ans !== undefined && ans !== null && !shown.includes(String(ans)))
          ans = undefined;
      } else if (Array.isArray(ans)) {
        ans = ans.filter((a) => shown.includes(String(a)));
      }
    }

    visible.push(q.id);
    if (hasValue(ans)) effective[q.id] = ans;

    // 跳题逻辑
    let target = null;
    if (lg.jump && lg.jump.mode === "always") {
      target = lg.jump.target;
    } else if (lg.jump && lg.jump.mode === "option") {
      const keys = keysOf(q.id);
      const rule = lg.jump.rules.find((r) => keys.includes(r.option));
      target = rule ? rule.target : null;
    }
    if (target === "end" || target === "invalid") {
      end = { id: q.id, invalid: target === "invalid" };
    } else if (target !== null && pos.has(target) && pos.get(target) > i) {
      skipTo = pos.get(target);
    }
  }
  return { visible, effective, optionVisible, end };
}

export { normalizeLogic, flowOrder, answerKeys, evaluateLogic };
