// 题目逻辑：题目关联（满足条件才显示）、跳题逻辑、选项关联
//
// 每道题的逻辑存在 questions.logic（JSON），三部分都可以没有：
// {
//   display: { match: "any" | "all", conditions: [{ question_id, options: ["是"] }] },
//       前面某题选了 options 里任意一个，条件成立；any = 任一条件成立就显示，all = 全部成立才显示
//   jump: { mode: "option", rules: [{ option: "否", target: 题目id | "end" | "invalid" }] }
//       或 { mode: "always", target: 题目id | "end" | "invalid" }
//       end = 跳到问卷末尾结束作答；invalid = 直接提交为无效答卷（不进统计）
//   option_link: { question_id, items: [{ option: "本题选项文字", show_when: ["前面那题的选项"] }] }
//       前面那题选了 show_when 里任意一个，这个选项才显示；没列出的选项总是显示
// }
// 「选项」统一用文字表示：单选、多选是选项文字，是否题是「是 / 否」，量表题是分数（如 "3"）
//
// 下面「核心」部分和 frontend-user/src/logic.js 完全一样（答题页按它决定显示哪些题），改的时候两边一起改

// ---------------- 核心（和答题端一致） ----------------

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

// ---------------- 后端专用 ----------------

// 数据库里的一行答案 → 答题页那种写法
function rawFromRow(q, row) {
  if (!row) return undefined;
  const type = q.question_type || "scale";
  if (type === "scale") {
    return row.answer_value === null || row.answer_value === undefined
      ? undefined
      : Number(row.answer_value);
  }
  const text = row.answer_text;
  if (text === null || text === undefined || text === "") return undefined;
  if (type === "multiple_choice") {
    const arr = parseJsonValue(text);
    return Array.isArray(arr) ? arr.map(String) : [String(text)];
  }
  return String(text);
}

// 问卷里有没有任何一道题设了逻辑
function anyLogic(questions) {
  return questions.some((q) => {
    const lg = normalizeLogic(q.logic);
    return !!(lg.display || lg.jump || lg.option_link);
  });
}

// 一份提交：按逻辑应该显示哪些题、是否被判为无效答卷、是否每道显示的题都答了
// rows：这份提交的答案行（answers 表）
function checkSubmission(questions, rows) {
  const answered = new Set(
    rows
      .filter(
        (r) =>
          (r.answer_value !== null && r.answer_value !== undefined) ||
          (r.answer_text !== null &&
            r.answer_text !== undefined &&
            r.answer_text !== ""),
      )
      .map((r) => Number(r.question_id)),
  );
  if (!anyLogic(questions)) {
    const rowIds = new Set(rows.map((r) => Number(r.question_id)));
    return {
      visible: flowOrder(questions).map((q) => Number(q.id)),
      invalid: false,
      complete: questions.every((q) => rowIds.has(Number(q.id))),
    };
  }
  const flow = flowOrder(questions);
  const rowOf = {};
  rows.forEach((r) => (rowOf[Number(r.question_id)] = r));
  const answers = {};
  flow.forEach((q) => {
    const raw = rawFromRow(q, rowOf[Number(q.id)]);
    if (raw !== undefined) answers[q.id] = raw;
  });
  const st = evaluateLogic(flow, answers);
  return {
    visible: st.visible.map(Number),
    invalid: !!(st.end && st.end.invalid),
    complete: st.visible.every((id) => answered.has(Number(id))),
  };
}

// 保存前检查逻辑：只保留引用本问卷题目（且不是本题自己）的部分；全空时返回 null
function sanitizeLogic(input, questionIds, selfId) {
  const ok = (id) =>
    questionIds.has(Number(id)) && Number(id) !== Number(selfId);
  const lg = normalizeLogic(input);
  const cut = (s) => String(s).slice(0, 500);
  const display = lg.display
    ? {
        match: lg.display.match,
        conditions: lg.display.conditions
          .filter((c) => ok(c.question_id))
          .map((c) => ({
            question_id: c.question_id,
            options: c.options.slice(0, 200).map(cut),
          })),
      }
    : null;
  const validTarget = (t) => t === "end" || t === "invalid" || ok(t);
  let jump = null;
  if (lg.jump && lg.jump.mode === "always" && validTarget(lg.jump.target)) {
    jump = lg.jump;
  } else if (lg.jump && lg.jump.mode === "option") {
    const rules = lg.jump.rules
      .filter((r) => validTarget(r.target))
      .slice(0, 200)
      .map((r) => ({ option: cut(r.option), target: r.target }));
    if (rules.length > 0) jump = { mode: "option", rules };
  }
  const optionLink =
    lg.option_link && ok(lg.option_link.question_id)
      ? {
          question_id: lg.option_link.question_id,
          items: lg.option_link.items.slice(0, 500).map((it) => ({
            option: cut(it.option),
            show_when: it.show_when.slice(0, 200).map(cut),
          })),
        }
      : null;
  const result = {};
  if (display && display.conditions.length > 0) result.display = display;
  if (jump) result.jump = jump;
  if (optionLink) result.option_link = optionLink;
  return Object.keys(result).length > 0 ? result : null;
}

// 逻辑里引用的题目 id 按 mapId 换掉（mapId 返回新 id，返回 null 表示去掉这一部分）
// 复制题目时换成新题目的 id；删除题目时去掉引用它的部分
function remapLogic(raw, mapId) {
  const lg = normalizeLogic(raw);
  const map = (id) => {
    const v = mapId(Number(id));
    return v === null || v === undefined ? null : Number(v);
  };
  const mapTarget = (t) => (t === "end" || t === "invalid" ? t : map(t));
  const out = {};
  if (lg.display) {
    const conditions = lg.display.conditions
      .map((c) => ({ ...c, question_id: map(c.question_id) }))
      .filter((c) => c.question_id !== null);
    if (conditions.length > 0)
      out.display = { match: lg.display.match, conditions };
  }
  if (lg.jump && lg.jump.mode === "always") {
    const target = mapTarget(lg.jump.target);
    if (target !== null) out.jump = { mode: "always", target };
  } else if (lg.jump) {
    const rules = lg.jump.rules
      .map((r) => ({ ...r, target: mapTarget(r.target) }))
      .filter((r) => r.target !== null);
    if (rules.length > 0) out.jump = { mode: "option", rules };
  }
  if (lg.option_link) {
    const qid = map(lg.option_link.question_id);
    if (qid !== null)
      out.option_link = { question_id: qid, items: lg.option_link.items };
  }
  return Object.keys(out).length > 0 ? out : null;
}

// 删除题目后：把其他题目逻辑里引用这道题的部分去掉。返回 { logic, changed }
function stripReference(raw, deletedId) {
  const before = JSON.stringify(remapLogic(raw, (id) => id));
  const logic = remapLogic(raw, (id) => (id === Number(deletedId) ? null : id));
  return { logic, changed: JSON.stringify(logic) !== before };
}

module.exports = {
  normalizeLogic,
  flowOrder,
  answerKeys,
  evaluateLogic,
  rawFromRow,
  anyLogic,
  checkSubmission,
  sanitizeLogic,
  remapLogic,
  stripReference,
};
