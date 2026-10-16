// 题目逻辑（题目关联、跳题逻辑、选项关联）在后台用到的工具：整理格式、列出可选的选项、生成说明文字和提醒
// 逻辑的格式见 backend/logic.js 开头；normalizeLogic、flowOrder 和那里的一样

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
export function normalizeLogic(raw) {
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

// 作答顺序：学生（和通用）题在前，家长题在后，各自按题号（和答题页一致）
export function flowOrder(questions) {
  const byOrder = [...questions].sort(
    (a, b) => Number(a.order_num) - Number(b.order_num),
  );
  return [
    ...byOrder.filter((q) => q.role !== "parent"),
    ...byOrder.filter((q) => q.role === "parent"),
  ];
}

function parseOptionList(raw) {
  const arr = parseJsonValue(raw);
  if (!Array.isArray(arr)) return [];
  return arr.map((o) =>
    typeof o === "string"
      ? { label: o, score: null }
      : { label: String(o?.label ?? ""), score: o?.score ?? null },
  );
}

// 一道题可以被选的「选项」：key 是逻辑里保存的值，text 是显示的文字
// 单选、多选：选项文字；是否题：是 / 否；量表题：分数（配了文字的显示文字）；开放题：没有
export function optionChoices(q) {
  if (!q) return [];
  const type = q.question_type || "scale";
  if (type === "single_choice" || type === "multiple_choice") {
    return parseOptionList(q.options)
      .filter((o) => o.label)
      .map((o) => ({ key: o.label, text: o.label }));
  }
  if (type === "yes_no") {
    return [
      { key: "是", text: "是" },
      { key: "否", text: "否" },
    ];
  }
  if (type === "scale") {
    const opts = parseOptionList(q.options);
    const list = [];
    for (let s = Number(q.min_score); s <= Number(q.max_score); s++) {
      const found = opts.find((o) => Number(o.score) === s && o.label);
      list.push({
        key: String(s),
        text: found ? `${found.label}（${s}分）` : `${s} 分`,
      });
    }
    return list;
  }
  return [];
}

// 能不能当作条件 / 选项关联的来源（有选项可选）
export function canBeSource(q) {
  return optionChoices(q).length > 0;
}

// 能不能按选项跳题（只能选一个答案的题型）
export function canJumpByOption(q) {
  return ["scale", "single_choice", "yes_no"].includes(
    q.question_type || "scale",
  );
}

// 能不能设置选项关联（有文字选项的单选、多选题）
export function canLinkOptions(q) {
  return ["single_choice", "multiple_choice"].includes(q.question_type);
}

export function questionTitle(q, maxLen = 24) {
  if (!q) return "（已删除的题目）";
  const text =
    q.content.length > maxLen ? q.content.slice(0, maxLen) + "…" : q.content;
  return `第${q.order_num}题 ${text}`;
}

function quote(keys, q) {
  const choices = optionChoices(q);
  return keys
    .map((k) => {
      const c = choices.find((x) => x.key === k);
      return `「${c ? c.text : k}」`;
    })
    .join("或");
}

function targetText(target, byId) {
  if (target === "end") return "结束作答";
  if (target === "invalid") return "判为无效答卷";
  const t = byId[target];
  return t ? `第${t.order_num}题` : "（已删除的题目）";
}

// 题目列表里显示的逻辑说明和提醒：[{ kind: "display" | "jump" | "option", text, warn }]
export function logicSummary(q, questions) {
  const lg = normalizeLogic(q.logic);
  const flow = flowOrder(questions);
  const pos = new Map(flow.map((x, i) => [Number(x.id), i]));
  const me = pos.get(Number(q.id));
  const byId = {};
  questions.forEach((x) => (byId[x.id] = x));
  const lines = [];

  if (lg.display) {
    const problems = [];
    const parts = lg.display.conditions.map((c) => {
      const src = byId[c.question_id];
      if (!src) {
        problems.push("条件里的题目已删除");
        return "（已删除的题目）";
      }
      if (!(pos.get(Number(src.id)) < me))
        problems.push(`第${src.order_num}题排在这题后面，这个条件不起作用`);
      const keys = optionChoices(src).map((x) => x.key);
      const missing = c.options.filter((k) => !keys.includes(k));
      if (missing.length > 0)
        problems.push(
          `第${src.order_num}题已经没有选项「${missing.join("、")}」`,
        );
      return `第${src.order_num}题选${quote(c.options, src)}`;
    });
    lines.push({
      kind: "display",
      text: `显示条件：${parts.join(lg.display.match === "all" ? "，并且 " : "，或者 ")}`,
      warn: false,
    });
    problems.forEach((p) =>
      lines.push({ kind: "display", text: p, warn: true }),
    );
  }

  if (lg.jump) {
    const problems = [];
    const checkTarget = (t) => {
      if (t === "end" || t === "invalid") return;
      const tq = byId[t];
      if (!tq) problems.push("跳转目标的题目已删除");
      else if (!(pos.get(Number(tq.id)) > me))
        problems.push(`跳转目标第${tq.order_num}题不在这题后面，不起作用`);
    };
    let text;
    if (lg.jump.mode === "always") {
      checkTarget(lg.jump.target);
      text = `跳题：答完${lg.jump.target === "end" || lg.jump.target === "invalid" ? "" : "跳到"}${targetText(lg.jump.target, byId)}`;
    } else {
      const keys = optionChoices(q).map((x) => x.key);
      const missing = lg.jump.rules
        .map((r) => r.option)
        .filter((k) => !keys.includes(k));
      if (missing.length > 0)
        problems.push(`本题已经没有选项「${missing.join("、")}」`);
      lg.jump.rules.forEach((r) => checkTarget(r.target));
      text =
        "跳题：" +
        lg.jump.rules
          .map(
            (r) => `选${quote([r.option], q)} → ${targetText(r.target, byId)}`,
          )
          .join("；");
    }
    lines.push({ kind: "jump", text, warn: false });
    problems.forEach((p) => lines.push({ kind: "jump", text: p, warn: true }));
  }

  if (lg.option_link) {
    const problems = [];
    const src = byId[lg.option_link.question_id];
    if (!src) problems.push("选项关联的题目已删除");
    else if (!(pos.get(Number(src.id)) < me))
      problems.push(`第${src.order_num}题排在这题后面，选项关联不起作用`);
    const mine = optionChoices(q).map((x) => x.key);
    const missingMine = lg.option_link.items
      .map((it) => it.option)
      .filter((k) => !mine.includes(k));
    if (missingMine.length > 0)
      problems.push(`本题已经没有选项「${missingMine.join("、")}」`);
    if (src) {
      const keys = optionChoices(src).map((x) => x.key);
      const missingSrc = [
        ...new Set(
          lg.option_link.items.flatMap((it) =>
            it.show_when.filter((k) => !keys.includes(k)),
          ),
        ),
      ];
      if (missingSrc.length > 0)
        problems.push(
          `第${src.order_num}题已经没有选项「${missingSrc.join("、")}」`,
        );
    }
    lines.push({
      kind: "option",
      text: `选项关联：跟随${src ? `第${src.order_num}题` : "（已删除的题目）"}，${lg.option_link.items.length} 个选项按条件显示`,
      warn: false,
    });
    problems.forEach((p) =>
      lines.push({ kind: "option", text: p, warn: true }),
    );
  }
  return lines;
}
