// backend/key-stats.js
// 按键作答的统计（统计页面、导出统计结果、导出作答数据共用）。纯计算，不连数据库。
//
// 每道用按键作答的题叫一个「题次」，记录了：
//   按住时长 hold_ms：按下 → 松开（论文里的 response duration）
//   按下用时 rt_ms：题目出现 → 按下（response initiation time）
//   把握程度 confidence：1-5（问卷设置了「每题问把握程度」才有）
//   作答输入 input_method：key 键盘 / touch 触屏
//
// 分析方法参照 Zhou, Goh, Phillips & Firestone (2026, PNAS)：
//   1. 每个人把自己的按住时长从短到长分成短 / 中 / 长三档，看每档的平均把握程度（论文图 2 的画法）；
//   2. 按住时长和把握程度的被试内相关：每人只和自己比，键盘和触屏、个人习惯的快慢差异都被消掉；
//   3. 每人算一次「按下用时 × 按住时长」的相关，再检验平均相关是否为 0（论文里两者无关）。
// 键盘和触屏的按法不同，绝对时长（毫秒）分开统计，不直接混在一起比。

const statsMath = require("./stats-math");

const INPUT_LABELS = { key: "键盘", touch: "触屏", mixed: "键盘+触屏" };

// 排除异常题次的方式（统计页面可以选）
const TRIM_LABELS = {
  none: "不排除",
  3000: "按住超过 3 秒的题次不算",
  2000: "按住超过 2 秒的题次不算",
  sd3: "超出本人平均 ±3 个标准差的题次不算",
};
const DEFAULT_TRIM = "3000";

function normalizeTrim(v) {
  const s = v === undefined || v === null ? "" : String(v);
  return Object.prototype.hasOwnProperty.call(TRIM_LABELS, s)
    ? s
    : DEFAULT_TRIM;
}

const round = (x, d) =>
  x === null || x === undefined || !Number.isFinite(x)
    ? null
    : Math.round(x * 10 ** d) / 10 ** d;

const mean = (xs) => (xs.length ? statsMath.mean(xs) : null);

// 分位数（线性插值，和 Excel 的 PERCENTILE.INC / QUARTILE.INC 一样）
function quantile(sorted, p) {
  if (sorted.length === 0) return null;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}

function median(values) {
  return quantile(
    [...values].sort((a, b) => a - b),
    0.5,
  );
}

// 毫秒数据的描述统计：题次、平均、标准差、中位数、上下四分位、最短、最长（保留 1 位小数）
function describeMs(values) {
  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const sd = n > 1 ? Math.sqrt(statsMath.sampleVar(values)) : null;
  return {
    n,
    mean: round(mean(values), 1),
    sd: round(sd, 1),
    median: round(quantile(sorted, 0.5), 1),
    q1: round(quantile(sorted, 0.25), 1),
    q3: round(quantile(sorted, 0.75), 1),
    min: n ? sorted[0] : null,
    max: n ? sorted[n - 1] : null,
  };
}

// 一份答卷里的按键题次（多选题、开放题这些用鼠标作答的题没有按住时长，不算）
function trialsOf(answers) {
  const list = [];
  (answers || []).forEach((a) => {
    if (a.hold_ms === null || a.hold_ms === undefined) return;
    const hold = Number(a.hold_ms);
    if (!Number.isFinite(hold)) return;
    const rt =
      a.rt_ms === null || a.rt_ms === undefined ? null : Number(a.rt_ms);
    const conf =
      a.confidence === null || a.confidence === undefined
        ? null
        : Number(a.confidence);
    list.push({
      question_id: a.question_id,
      hold,
      rt: Number.isFinite(rt) ? rt : null,
      conf: conf >= 1 && conf <= 5 ? conf : null,
      input: a.input_method === "touch" ? "touch" : "key",
      z: null,
    });
  });
  return list;
}

// 这个人用什么作答：全是键盘 key、全是触屏 touch、两种都有 mixed
function inputOf(trials) {
  const set = new Set(trials.map((t) => t.input));
  if (set.size === 0) return null;
  if (set.size > 1) return "mixed";
  return [...set][0];
}

// 按选定的方式去掉异常题次
function trimTrials(trials, trim) {
  if (trim === "3000" || trim === "2000") {
    const cap = Number(trim);
    return trials.filter((t) => t.hold <= cap);
  }
  if (trim === "sd3" && trials.length >= 3) {
    const xs = trials.map((t) => t.hold);
    const m = mean(xs);
    const sd = Math.sqrt(statsMath.sampleVar(xs));
    if (sd > 0) return trials.filter((t) => Math.abs(t.hold - m) <= 3 * sd);
  }
  return trials;
}

const pearsonOf = (trials, fx, fy) => {
  const ts = trials.filter((t) => fx(t) !== null && fy(t) !== null);
  return ts.length >= 3 ? statsMath.pearson(ts.map(fx), ts.map(fy)) : null;
};

// 每人一行的汇总（导出作答数据用；用这个人的全部题次，不排除）
function personSummary(answers) {
  const trials = trialsOf(answers);
  if (trials.length === 0) return null;
  const holds = trials.map((t) => t.hold);
  const h = describeMs(holds);
  const rts = trials.filter((t) => t.rt !== null).map((t) => t.rt);
  const confs = trials.filter((t) => t.conf !== null).map((t) => t.conf);
  return {
    input: inputOf(trials),
    input_label: INPUT_LABELS[inputOf(trials)],
    n: trials.length,
    hold_median: h.median,
    hold_mean: h.mean,
    hold_sd: h.sd,
    hold_min: h.min,
    hold_max: h.max,
    over_3s: holds.filter((x) => x > 3000).length,
    rt_median: round(median(rts), 1),
    rt_mean: round(mean(rts), 1),
    conf_n: confs.length,
    conf_mean: round(mean(confs), 2),
    r_hold_conf: round(
      pearsonOf(
        trials,
        (t) => t.hold,
        (t) => t.conf,
      ),
      3,
    ),
    r_rt_hold: round(
      pearsonOf(
        trials,
        (t) => t.rt,
        (t) => t.hold,
      ),
      3,
    ),
  };
}

// 按住时长分布：每 50 毫秒一格，1 秒以上合成一格
function holdHistogram(holds) {
  const bins = [];
  for (let s = 0; s < 1000; s += 50) {
    bins.push({ label: `${s}~${s + 49}`, count: 0 });
  }
  bins.push({ label: "≥1000", count: 0 });
  holds.forEach((h) => {
    const i = Math.min(Math.max(Math.floor(h / 50), 0), 20);
    bins[i].count++;
  });
  return bins;
}

// 一组人（全部 / 只看键盘 / 只看触屏）的被试内分析
function scopeAnalysis(list) {
  // 1. 三档：每人至少 3 个带把握程度的题次
  let bins = null;
  const binPersons = list
    .map((p) => p.trials.filter((t) => t.conf !== null))
    .filter((ts) => ts.length >= 3);
  if (binPersons.length > 0) {
    const acc = [0, 1, 2].map(() => ({ conf: [], hold: [] }));
    binPersons.forEach((ts) => {
      const sorted = [...ts].sort((a, b) => a.hold - b.hold);
      const n = sorted.length;
      const groups = [[], [], []];
      sorted.forEach((t, i) => groups[Math.floor((i * 3) / n)].push(t));
      groups.forEach((g, b) => {
        acc[b].conf.push(mean(g.map((t) => t.conf)));
        acc[b].hold.push(mean(g.map((t) => t.hold)));
      });
    });
    // 置信区间超出 1-5 分时截到 1 和 5（人少时会出现）
    const clamp = (x) => (x === null ? null : Math.min(5, Math.max(1, x)));
    bins = acc.map((a, b) => {
      const ci = statsMath.meanCI(a.conf);
      return {
        label: ["短", "中", "长"][b],
        persons: a.conf.length,
        hold_mean: round(mean(a.hold), 1),
        conf_mean: round(ci.mean, 2),
        ci_low: round(clamp(ci.low), 2),
        ci_high: round(clamp(ci.high), 2),
      };
    });
  }

  // 2. 按住时长 × 把握程度：被试内相关
  let holdConf = null;
  const rc = statsMath.rmCorr(
    list.map((p) =>
      p.trials.filter((t) => t.conf !== null).map((t) => [t.hold, t.conf]),
    ),
  );
  if (rc.k > 0) {
    holdConf = {
      persons: rc.k,
      trials: rc.n,
      r: round(rc.r, 3),
      df: rc.df,
      p: round(rc.p, 4),
      // 每多按 100 毫秒，把握程度平均变化多少分（可以和论文的 β 比较：实验 1 约 −0.09）
      slope100: round(rc.slope === null ? null : rc.slope * 100, 3),
    };
  }

  // 3. 按下用时 × 按住时长：每人一个相关，再看平均相关是否为 0
  let rtHold = null;
  const rs = list
    .map((p) =>
      pearsonOf(
        p.trials,
        (t) => t.rt,
        (t) => t.hold,
      ),
    )
    .filter((r) => r !== null);
  if (rs.length > 0) {
    const n = rs.length;
    const m = mean(rs);
    const sd = n > 1 ? Math.sqrt(statsMath.sampleVar(rs)) : null;
    const se = sd !== null ? sd / Math.sqrt(n) : null;
    const t = se > 0 ? m / se : null;
    rtHold = {
      persons: n,
      mean_r: round(m, 3),
      se: round(se, 3),
      t: round(t, 2),
      df: n > 1 ? n - 1 : null,
      p: t === null ? null : round(statsMath.tTwoTailedP(t, n - 1), 4),
    };
  }

  return { persons: list.length, bins, hold_conf: holdConf, rt_hold: rtHold };
}

// 统计页面用的按键作答统计
// entries：[{ sub, answers }]（已经按统计页的筛选条件筛过）；questions：问卷的题目（按题号排好）
function computeKeyStats(entries, questions, trimRaw) {
  const trim = normalizeTrim(trimRaw);
  const persons = [];
  entries.forEach(({ sub, answers }) => {
    const all = trialsOf(answers);
    if (all.length === 0) return;
    const kept = trimTrials(all, trim);
    // 被试内标准分：这一题的按住时长比本人平时长（> 0）还是短（< 0），以本人的标准差为单位
    const xs = kept.map((t) => t.hold);
    const m = mean(xs);
    const sd = xs.length >= 2 ? Math.sqrt(statsMath.sampleVar(xs)) : 0;
    kept.forEach((t) => (t.z = sd > 0 ? (t.hold - m) / sd : null));
    persons.push({ sub_id: sub.id, input: inputOf(all), all, trials: kept });
  });

  const totalTrials = persons.reduce((s, p) => s + p.all.length, 0);
  const keptTrials = persons.reduce((s, p) => s + p.trials.length, 0);
  const result = {
    has_key: persons.length > 0,
    trim,
    trim_label: TRIM_LABELS[trim],
    persons: persons.length,
    total_trials: totalTrials,
    excluded_trials: totalTrials - keptTrials,
    has_confidence: persons.some((p) => p.trials.some((t) => t.conf !== null)),
    devices: [],
    histograms: [],
    scopes: {},
    items: [],
  };
  if (persons.length === 0) return result;

  // 按设备（作答输入）分开的描述统计
  const deviceRow = (value, list) => {
    const trials = list.flatMap((p) => p.trials);
    const rts = trials.filter((t) => t.rt !== null).map((t) => t.rt);
    const confs = trials.filter((t) => t.conf !== null).map((t) => t.conf);
    return {
      value,
      label: value === "all" ? "合计" : INPUT_LABELS[value],
      persons: list.length,
      trials: trials.length,
      excluded: list.reduce((s, p) => s + p.all.length - p.trials.length, 0),
      hold: describeMs(trials.map((t) => t.hold)),
      // 先算每人自己的中位数，再看这些中位数的平均和标准差（人和人之间比较用这个）
      person_median: describeMs(
        list
          .filter((p) => p.trials.length > 0)
          .map((p) => median(p.trials.map((t) => t.hold))),
      ),
      rt_median: round(median(rts), 1),
      conf_mean: round(mean(confs), 2),
    };
  };
  const present = ["key", "touch", "mixed"].filter((d) =>
    persons.some((p) => p.input === d),
  );
  result.devices = present.map((d) =>
    deviceRow(
      d,
      persons.filter((p) => p.input === d),
    ),
  );
  if (present.length > 1) result.devices.push(deviceRow("all", persons));

  // 按住时长分布（按每个题次实际用的输入方式分开）
  ["key", "touch"].forEach((inp) => {
    const holds = persons
      .flatMap((p) => p.trials)
      .filter((t) => t.input === inp)
      .map((t) => t.hold);
    if (holds.length > 0) {
      result.histograms.push({
        value: inp,
        label: INPUT_LABELS[inp],
        n: holds.length,
        bins: holdHistogram(holds),
      });
    }
  });

  // 被试内分析：全部、只看键盘、只看触屏
  result.scopes.all = scopeAnalysis(persons);
  ["key", "touch"].forEach((d) => {
    const list = persons.filter((p) => p.input === d);
    if (list.length > 0) result.scopes[d] = scopeAnalysis(list);
  });

  // 每道题：键盘、触屏各自的按住时长中位数，被试内标准分的平均（可以把两种设备合在一起看）
  const byQ = {};
  persons.forEach((p) =>
    p.trials.forEach((t) => {
      if (!byQ[t.question_id]) byQ[t.question_id] = [];
      byQ[t.question_id].push(t);
    }),
  );
  result.items = questions
    .filter((q) => byQ[q.id])
    .map((q) => {
      const ts = byQ[q.id];
      const holdsOf = (inp) =>
        ts.filter((t) => t.input === inp).map((t) => t.hold);
      const zs = ts.filter((t) => t.z !== null).map((t) => t.z);
      const confs = ts.filter((t) => t.conf !== null).map((t) => t.conf);
      const rts = ts.filter((t) => t.rt !== null).map((t) => t.rt);
      return {
        id: q.id,
        order_num: q.order_num,
        content: q.content,
        trials: ts.length,
        key_n: holdsOf("key").length,
        key_median: round(median(holdsOf("key")), 1),
        touch_n: holdsOf("touch").length,
        touch_median: round(median(holdsOf("touch")), 1),
        z_mean: round(mean(zs), 2),
        conf_mean: round(mean(confs), 2),
        rt_median: round(median(rts), 1),
      };
    });

  return result;
}

module.exports = {
  INPUT_LABELS,
  TRIM_LABELS,
  DEFAULT_TRIM,
  normalizeTrim,
  trialsOf,
  inputOf,
  personSummary,
  computeKeyStats,
};
