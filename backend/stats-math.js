// backend/stats-math.js
// 统计分析用到的数学函数：t 分布、F 分布、正态分布的概率，Cronbach's α，t 检验，方差分析，
// 置信区间，被试内相关（按键作答的统计用）。
// 都是纯计算函数，不连数据库；结果已经用 Python 的 scipy 逐一核对过。

// ---------- 概率分布 ----------

// ln Γ(x)（Lanczos 近似）
function logGamma(x) {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    // 反射公式
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return (
    0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
  );
}

// 不完全 Beta 函数的连分式部分
function betaContinuedFraction(a, b, x) {
  const MAX_ITER = 300;
  const EPS = 1e-15;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

// 正则化不完全 Beta 函数 I_x(a, b)
function betaInc(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnFront =
    logGamma(a + b) -
    logGamma(a) -
    logGamma(b) +
    a * Math.log(x) +
    b * Math.log(1 - x);
  const front = Math.exp(lnFront);
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

// t 检验的双侧 p 值
function tTwoTailedP(t, df) {
  if (!(df > 0) || !Number.isFinite(t)) return null;
  return betaInc(df / 2, 0.5, df / (df + t * t));
}

// F 检验的 p 值（右尾）
function fUpperP(f, df1, df2) {
  if (!(df1 > 0) || !(df2 > 0) || !Number.isFinite(f)) return null;
  if (f <= 0) return 1;
  return betaInc(df2 / 2, df1 / 2, df2 / (df2 + df1 * f));
}

// 标准正态分布的累积概率 Φ(z)（误差小于 1.2e-7）
function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * x);
  const erfc =
    t *
    Math.exp(
      -x * x -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t *
                                  (1.48851587 +
                                    t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return z >= 0 ? 1 - erfc / 2 : erfc / 2;
}

// ---------- 基础统计 ----------

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// 样本方差（除以 n-1）
function sampleVar(values) {
  const n = values.length;
  if (n < 2) return null;
  const m = mean(values);
  return values.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1);
}

// 皮尔逊相关系数；有一列全部相同时返回 null
function pearson(x, y) {
  const n = x.length;
  if (n < 3) return null;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

// ---------- 信度分析 ----------

// Cronbach's α。rows：每人一行，每行是各题得分（只放每道题都答了的人）
function cronbachAlpha(rows) {
  const n = rows.length;
  const k = n > 0 ? rows[0].length : 0;
  if (n < 2 || k < 2) return null;
  let sumItemVar = 0;
  for (let j = 0; j < k; j++) sumItemVar += sampleVar(rows.map((r) => r[j]));
  const totalVar = sampleVar(rows.map((r) => r.reduce((a, b) => a + b, 0)));
  if (!totalVar) return null;
  return (k / (k - 1)) * (1 - sumItemVar / totalVar);
}

// 项目分析：每道题的平均分、标准差、校正题总相关（这道题和其余题总分的相关）、删除这道题后的 α
function itemAnalysis(rows) {
  const n = rows.length;
  const k = n > 0 ? rows[0].length : 0;
  const result = [];
  for (let j = 0; j < k; j++) {
    const item = rows.map((r) => r[j]);
    const rest = rows.map((r) => r.reduce((a, b) => a + b, 0) - r[j]);
    const v = sampleVar(item);
    result.push({
      mean: n > 0 ? mean(item) : null,
      sd: v === null ? null : Math.sqrt(v),
      citc: pearson(item, rest),
      alpha_if_deleted:
        k > 2
          ? cronbachAlpha(rows.map((r) => r.filter((_, i) => i !== j)))
          : null,
    });
  }
  return result;
}

// ---------- 差异检验 ----------

// 两组比较：Welch t 检验（不假设两组方差相等），效应量 Cohen's d 用合并标准差
function welchT(a, b) {
  const na = a.length;
  const nb = b.length;
  if (na < 2 || nb < 2) return null;
  const ma = mean(a);
  const mb = mean(b);
  const va = sampleVar(a);
  const vb = sampleVar(b);
  const se2 = va / na + vb / nb;
  if (se2 === 0) return null;
  const t = (ma - mb) / Math.sqrt(se2);
  const df = se2 ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1));
  const pooled = Math.sqrt(((na - 1) * va + (nb - 1) * vb) / (na + nb - 2));
  return {
    t,
    df,
    p: tTwoTailedP(t, df),
    d: pooled > 0 ? (ma - mb) / pooled : null,
  };
}

// 三组及以上：单因素方差分析，效应量 η²
function anovaOneWay(groups) {
  const list = groups.filter((g) => g.length > 0);
  const k = list.length;
  const N = list.reduce((s, g) => s + g.length, 0);
  if (k < 2 || N - k < 1) return null;
  const grand = list.reduce((s, g) => s + g.reduce((a, b) => a + b, 0), 0) / N;
  let ssb = 0;
  let ssw = 0;
  list.forEach((g) => {
    const m = mean(g);
    ssb += g.length * (m - grand) ** 2;
    g.forEach((v) => (ssw += (v - m) ** 2));
  });
  const df1 = k - 1;
  const df2 = N - k;
  if (ssw === 0) return null;
  const f = ssb / df1 / (ssw / df2);
  return { f, df1, df2, p: fUpperP(f, df1, df2), eta2: ssb / (ssb + ssw) };
}

// 单样本 t 检验：样本平均分和常模平均分比较，效应量 d = (样本均值 - 常模均值) / 样本标准差
function oneSampleT(values, mu) {
  const n = values.length;
  if (n < 2) return null;
  const m = mean(values);
  const s = Math.sqrt(sampleVar(values));
  if (s === 0) return null;
  const t = (m - mu) / (s / Math.sqrt(n));
  return { t, df: n - 1, p: tTwoTailedP(t, n - 1), d: (m - mu) / s };
}

// t 分布的双侧临界值（如 df = 10、alpha = 0.05 时约 2.228），用来算 95% 置信区间
function tCritical(df, alpha = 0.05) {
  if (!(df > 0)) return null;
  let lo = 0;
  let hi = 1000;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (tTwoTailedP(mid, df) > alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// 平均数和 95% 置信区间（t 分布）
function meanCI(values) {
  const n = values.length;
  if (n === 0) return null;
  const m = mean(values);
  if (n < 2) return { n, mean: m, low: null, high: null };
  const se = Math.sqrt(sampleVar(values) / n);
  const tc = tCritical(n - 1);
  return { n, mean: m, low: m - tc * se, high: m + tc * se };
}

// 被试内相关（repeated measures correlation，Bakdash & Marusich, 2017）：
// 每个人的 x、y 先减去本人的平均数，再把所有人合在一起算相关，自由度 = 观测数 − 人数 − 1。
// 只看同一个人内部 x 高的时候 y 是不是也高，人和人之间的差异（如手机和电脑整体按得快慢不同）不影响结果。
// persons：每人一个数组，元素是 [x, y]；每人至少 2 个观测才计入。
// 返回 r、自由度、p、斜率（x 每增加 1，y 平均变化多少，和固定被试截距的回归斜率相同）
function rmCorr(persons) {
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  let N = 0;
  let k = 0;
  persons.forEach((obs) => {
    if (obs.length < 2) return;
    const mx = mean(obs.map((o) => o[0]));
    const my = mean(obs.map((o) => o[1]));
    obs.forEach(([x, y]) => {
      sxy += (x - mx) * (y - my);
      sxx += (x - mx) ** 2;
      syy += (y - my) ** 2;
    });
    N += obs.length;
    k++;
  });
  const df = N - k - 1;
  if (k === 0 || df < 1 || sxx === 0 || syy === 0) {
    return { r: null, df: df > 0 ? df : null, p: null, slope: null, n: N, k };
  }
  const r = sxy / Math.sqrt(sxx * syy);
  const t = Math.abs(r) >= 1 ? Infinity : r * Math.sqrt(df / (1 - r * r));
  return {
    r,
    df,
    p: Number.isFinite(t) ? tTwoTailedP(t, df) : 0,
    slope: sxy / sxx,
    n: N,
    k,
  };
}

module.exports = {
  logGamma,
  betaInc,
  tTwoTailedP,
  tCritical,
  fUpperP,
  normalCdf,
  mean,
  sampleVar,
  meanCI,
  pearson,
  rmCorr,
  cronbachAlpha,
  itemAnalysis,
  welchT,
  anovaOneWay,
  oneSampleT,
};
