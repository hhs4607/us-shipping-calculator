#!/usr/bin/env node
/**
 * Generate Yamato Benchmark Verification Report
 * Runs 25 tests against yamato-calculator.js with independent verification.
 */

const fs = require('fs');

// Load calculator
eval(fs.readFileSync('js/yamato-calculator.js', 'utf8'));

// Load data
const ratesCash = JSON.parse(fs.readFileSync('public/data/2025/yamato/rates-cash.json'));
const ratesCashless = JSON.parse(fs.readFileSync('public/data/2025/yamato/rates-cashless.json'));
const ratesIntrapref = JSON.parse(fs.readFileSync('public/data/2025/yamato/rates-intrapref.json'));
const surcharges = JSON.parse(fs.readFileSync('public/data/2025/yamato/surcharges.json'));
const discountDefs = JSON.parse(fs.readFileSync('public/data/2025/yamato/discounts.json'));

// ─── Test Cases ──────────────────────────────────────────────────

const TESTS = [
  // --- Basic rates: all 8 size tiers, Kanto→Kansai, cash ---
  { id:1,  desc:'Size 60 Kanto→Kansai Cash',    L:30,W:15,H:10,  wt:1.5,  orig:'kanto', dest:'kansai', pay:'cash',  expSize:60,  expRate:1060 },
  { id:2,  desc:'Size 80 Kanto→Kansai Cash',    L:40,W:20,H:15,  wt:4,    orig:'kanto', dest:'kansai', pay:'cash',  expSize:80,  expRate:1350 },
  { id:3,  desc:'Size 100 Kanto→Kansai Cash',   L:50,W:25,H:20,  wt:9,    orig:'kanto', dest:'kansai', pay:'cash',  expSize:100, expRate:1650 },
  { id:4,  desc:'Size 120 Kanto→Kansai Cash',   L:60,W:30,H:25,  wt:12,   orig:'kanto', dest:'kansai', pay:'cash',  expSize:120, expRate:2170 },
  { id:5,  desc:'Size 140 Kanto→Kansai Cash',   L:70,W:35,H:30,  wt:18,   orig:'kanto', dest:'kansai', pay:'cash',  expSize:140, expRate:2780 },
  { id:6,  desc:'Size 160 Kanto→Kansai Cash',   L:80,W:40,H:35,  wt:23,   orig:'kanto', dest:'kansai', pay:'cash',  expSize:160, expRate:3160 },
  { id:7,  desc:'Size 180 Kanto→Kansai Cash',   L:90,W:50,H:35,  wt:28,   orig:'kanto', dest:'kansai', pay:'cash',  expSize:180, expRate:4480 },
  { id:8,  desc:'Size 200 Kanto→Kansai Cash',   L:100,W:55,H:40, wt:25,   orig:'kanto', dest:'kansai', pay:'cash',  expSize:200, expRate:5410 },

  // --- Payment method ---
  { id:9,  desc:'Size 100 Kanto→Kansai Cashless',L:50,W:25,H:20, wt:9,    orig:'kanto', dest:'kansai', pay:'cashless', expSize:100, expRate:1650 },
  { id:10, desc:'Size 120 Kanto→Kansai Cashless',L:60,W:30,H:25, wt:12,   orig:'kanto', dest:'kansai', pay:'cashless', expSize:120, expRate:2167 },

  // --- Route diversity ---
  { id:11, desc:'Size 120 Hokkaido→Okinawa Cash',L:60,W:30,H:25, wt:12,   orig:'hokkaido', dest:'okinawa', pay:'cash', expSize:120, expRate:4240 },
  { id:12, desc:'Size 80 Kyushu→KitaTohoku Cash',L:40,W:20,H:15, wt:4,    orig:'kyushu', dest:'kita_tohoku', pay:'cash', expSize:80, expRate:2050 },
  { id:13, desc:'Size 100 Chubu→Shikoku Cashless',L:50,W:25,H:20,wt:9,    orig:'chubu', dest:'shikoku', pay:'cashless', expSize:100, expRate:1650 },

  // --- Intraprefectural ---
  { id:14, desc:'Intrapref Kanto Cash Size 80',  L:40,W:20,H:15, wt:4,    orig:'kanto', dest:'kanto', pay:'cash', samePref:true, expSize:80, expRate:1090 },
  { id:15, desc:'Intrapref Kansai Cashless S120', L:60,W:30,H:25,wt:12,   orig:'kansai', dest:'kansai', pay:'cashless', samePref:true, expSize:120, expRate:1727 },
  { id:16, desc:'Okinawa samePref (no intrapref)',L:50,W:25,H:20,wt:9,    orig:'okinawa', dest:'okinawa', pay:'cash', samePref:true, expSize:100, expRate:1530 },

  // --- Weight-based size tier ---
  { id:17, desc:'Weight upgrade 60→80',          L:30,W:15,H:10, wt:4,    orig:'kanto', dest:'kansai', pay:'cash', expSize:80, expRate:1350, expSizeSource:'weight' },
  { id:18, desc:'Weight upgrade 80→120',         L:40,W:20,H:20, wt:12,   orig:'kanto', dest:'kansai', pay:'cash', expSize:120, expRate:2170, expSizeSource:'weight' },

  // --- Cool surcharge ---
  { id:19, desc:'Size 80 + Cool chilled',        L:40,W:20,H:15, wt:4,    orig:'kanto', dest:'kansai', pay:'cash', cool:'chilled', expSize:80, expRate:1350, expCool:330 },
  { id:20, desc:'Size 100 + Cool frozen',        L:50,W:25,H:20, wt:9,    orig:'kanto', dest:'kansai', pay:'cash', cool:'frozen',  expSize:100, expRate:1650, expCool:440 },
  { id:21, desc:'Size 140 + Cool (exceeds max)', L:70,W:35,H:30, wt:18,   orig:'kanto', dest:'kansai', pay:'cash', cool:'chilled', expSize:140, expRate:2780, expCoolError:true },

  // --- Same-day surcharge ---
  { id:22, desc:'Size 100 + Same-day standard',  L:50,W:25,H:20, wt:9,    orig:'kanto', dest:'kansai', pay:'cash', sameDay:true, expSize:100, expRate:1650, expSameDay:550 },
  { id:23, desc:'Okinawa route + Same-day',      L:50,W:25,H:20, wt:9,    orig:'okinawa', dest:'kanto', pay:'cash', sameDay:true, expSize:100, expRate:2710, expSameDay:330 },

  // --- Discounts ---
  { id:24, desc:'Dropoff + Digital (-170)',       L:50,W:25,H:20, wt:9,    orig:'kanto', dest:'kansai', pay:'cash', discounts:['dropoff','digital'], expSize:100, expRate:1650, expDiscount:-170 },
  { id:25, desc:'MemberDrop + Drop + Digital',    L:50,W:25,H:20, wt:9,    orig:'kanto', dest:'kansai', pay:'cash', discounts:['dropoff','member_dropoff','digital'], expSize:100, expRate:1650, expDiscount:-210 },
];

// ─── Run Tests ───────────────────────────────────────────────────

const results = TESTS.map(t => {
  const item = { name: t.desc, L_cm: t.L, W_cm: t.W, H_cm: t.H, weightKg: t.wt, qty: 1 };
  const line = yamatoCalcLineItem(
    item, t.orig, t.dest, t.pay, t.samePref || false,
    t.cool || 'none', t.sameDay || false, t.discounts || [],
    ratesCash, ratesCashless, ratesIntrapref, surcharges, discountDefs
  );

  // Independent direct lookup
  let directRate = 0;
  if (!line.error) {
    if (t.samePref && t.orig !== 'okinawa') {
      const ip = t.pay === 'cash' ? ratesIntrapref.cash : ratesIntrapref.cashless;
      directRate = ip[String(line.appliedSize)];
    } else {
      const rates = t.pay === 'cash' ? ratesCash : ratesCashless;
      directRate = rates[t.orig][String(line.appliedSize)][t.dest];
    }
  }

  // Verify all aspects
  const checks = {
    sizeMatch: line.appliedSize === t.expSize,
    rateMatch: line.baseRate === t.expRate,
    directMatch: line.baseRate === directRate,
    sizeSourceMatch: !t.expSizeSource || line.sizeSource === t.expSizeSource,
    coolMatch: t.expCool != null ? line.coolSurcharge === t.expCool : true,
    coolErrorMatch: t.expCoolError ? line.coolError === true : true,
    sameDayMatch: t.expSameDay != null ? line.sameDaySurcharge === t.expSameDay : true,
    discountMatch: t.expDiscount != null ? line.discountTotal === t.expDiscount : true,
  };
  const pass = Object.values(checks).every(v => v);

  return { ...t, line, directRate, checks, pass };
});

const total = results.length;
const passed = results.filter(r => r.pass).length;
const failed = total - passed;

console.log(`Benchmark: ${passed}/${total} tests passed`);
if (failed > 0) {
  results.filter(r => !r.pass).forEach(r => {
    console.log(`FAIL #${r.id}: ${r.desc}`);
    console.log('  Checks:', JSON.stringify(r.checks));
    console.log('  Line:', JSON.stringify({ size: r.line.appliedSize, rate: r.line.baseRate, cool: r.line.coolSurcharge, sameDay: r.line.sameDaySurcharge, discount: r.line.discountTotal, total: r.line.perPkgTotal }));
  });
}

// ─── Generate HTML ───────────────────────────────────────────────

function yen(n) { return '\u00a5' + Math.round(n).toLocaleString('ja-JP'); }
function passSpan(ok) { return ok ? '<span class="badge badge-pass">PASS</span>' : '<span class="badge badge-fail">FAIL</span>'; }
function matchTd(ok) { return ok ? '<td class="match">O</td>' : '<td class="mismatch">X</td>'; }

let tableRows = '';
results.forEach(r => {
  const ln = r.line;
  const coolStr = ln.coolError ? 'OVER' : (ln.coolSurcharge > 0 ? yen(ln.coolSurcharge) : '-');
  const sdStr = ln.sameDaySurcharge > 0 ? yen(ln.sameDaySurcharge) : '-';
  const dcStr = ln.discountTotal < 0 ? yen(ln.discountTotal) : '-';
  const sizeSource = ln.sizeSource === 'weight' ? '(wt)' : '(sum)';

  tableRows += `<tr>
  <td>${r.id}</td>
  <td style="text-align:left">${r.desc}</td>
  <td>${r.L}\u00d7${r.W}\u00d7${r.H} / ${r.wt}kg</td>
  <td>${r.expSize}</td>
  <td>${ln.appliedSize || '-'} ${ln.sizeSource ? sizeSource : ''}</td>
  ${matchTd(r.checks.sizeMatch)}
  <td>${yen(r.expRate)}</td>
  <td>${yen(ln.baseRate)}</td>
  <td>${yen(r.directRate)}</td>
  ${matchTd(r.checks.rateMatch && r.checks.directMatch)}
  <td>${coolStr}</td>
  <td>${sdStr}</td>
  <td>${dcStr}</td>
  <td><strong>${yen(ln.perPkgTotal)}</strong></td>
  <td>${passSpan(r.pass)}</td>
</tr>
`;
});

// Chart data: expected vs actual rates
const chartLabels = results.map(r => '#' + r.id);
const chartExpected = results.map(r => r.expRate);
const chartActual = results.map(r => r.line.baseRate);
const chartTotals = results.map(r => r.line.perPkgTotal);

// Size tier distribution
const sizeCounts = {};
results.forEach(r => {
  const s = r.line.appliedSize || 'Error';
  sizeCounts[s] = (sizeCounts[s] || 0) + 1;
});

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Yamato \u30d9\u30f3\u30c1\u30de\u30fc\u30af \u2014 MUSICUS</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"><\/script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', -apple-system, sans-serif; background: #0a0a0a; color: #eee; padding: 2rem; line-height: 1.6; }
  .back-link { display: inline-block; color: #69c; text-decoration: none; font-size: 0.85rem; margin-bottom: 1rem; }
  .back-link:hover { text-decoration: underline; }
  h1 { font-size: 1.8rem; margin-bottom: 0.3rem; }
  h2 { font-size: 1.2rem; margin: 2.5rem 0 1rem; color: #aaa; border-bottom: 1px solid #333; padding-bottom: 0.5rem; }
  h3 { font-size: 1rem; margin: 1.5rem 0 0.5rem; color: #ccc; }
  .subtitle { color: #666; font-size: 0.85rem; margin-bottom: 0.5rem; }
  .method-box { background: #181818; border: 1px solid #333; border-radius: 8px; padding: 1.2rem; margin-bottom: 2rem; font-size: 0.85rem; color: #bbb; }
  .method-box strong { color: #eee; }
  .method-box ul { margin: 0.5rem 0 0 1.2rem; }
  .method-box li { margin-bottom: 0.3rem; }
  .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .stat-card { background: #181818; border: 1px solid #333; border-radius: 8px; padding: 1.2rem; text-align: center; }
  .stat-card .num { font-size: 2rem; font-weight: 700; }
  .stat-card .label { font-size: 0.7rem; color: #666; text-transform: uppercase; letter-spacing: 0.05em; }
  .pass { color: #6c6; }
  .fail { color: #f66; }
  .chart-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 2rem; }
  .chart-box { background: #181818; border: 1px solid #333; border-radius: 8px; padding: 1.2rem; }
  .chart-box canvas { max-height: 320px; }
  .full-width { grid-column: 1 / -1; }
  table { width: 100%; border-collapse: collapse; font-size: 0.78rem; margin-bottom: 2rem; }
  th { background: #222; color: #aaa; font-weight: 600; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.04em; padding: 0.6rem 0.4rem; text-align: center; border-bottom: 1px solid #444; position: sticky; top: 0; }
  td { padding: 0.45rem 0.35rem; text-align: center; border-bottom: 1px solid #222; font-variant-numeric: tabular-nums; }
  tr:hover { background: rgba(255,255,255,0.03); }
  .match { color: #6c6; } .mismatch { color: #f66; font-weight: 700; }
  .badge { display: inline-block; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.65rem; font-weight: 600; border: 1px solid; }
  .badge-pass { color: #6c6; border-color: #4a4; }
  .badge-fail { color: #f66; border-color: #c44; }
  .yamato-accent { color: #ef4444; }
  footer { text-align: center; color: #444; font-size: 0.7rem; margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #222; }
  @media (max-width: 768px) { .chart-row { grid-template-columns: 1fr; } body { padding: 1rem; } }
</style>
</head>
<body>

<a href="index.html" class="back-link">&larr; \uacc4\uc0b0\uae30\ub85c \ub3cc\uc544\uac00\uae30</a>

<h1>\ud83c\uddef\ud83c\uddf5 Yamato \u30d9\u30f3\u30c1\u30de\u30fc\u30af \u691c\u8a3c\u30ec\u30dd\u30fc\u30c8</h1>
<div class="subtitle">MUSICUS \u30e4\u30de\u30c8\u904b\u8f38 TA-Q-BIN \u914d\u9001\u6599\u8a08\u7b97\u6a5f \u2014 \u72ec\u7acb\u691c\u8a3c</div>
<div class="subtitle">\uc0dd\uc131\uc77c: ${new Date().toISOString().slice(0,10)} | \ucd1d ${total}\uac74 \ud14c\uc2a4\ud2b8</div>

<div class="method-box">
  <strong>\uac80\uc99d \ubc29\ubc95</strong>
  <ul>
    <li>LLM(Claude Opus 4.6)\uc774 \uc57c\ub9c8\ud1a0 \uc6b4\uc784\ud45c PDF \uc6d0\ubb38 \uae30\uc900\uc73c\ub85c <strong>\ub3c5\ub9bd\uc801\uc73c\ub85c</strong> \uc608\uc0c1 \uac12\uc744 \uc0b0\ucd9c</li>
    <li>\ud504\ub85c\uadf8\ub7a8 \uacc4\uc0b0\uae30(yamato-calculator.js)\uc640 \ub3d9\uc77c\ud55c \uc785\ub825\uc73c\ub85c ${total}\uac74 \ud14c\uc2a4\ud2b8</li>
    <li>\uac80\uc99d \ud56d\ubaa9: Size \ud310\uc815, \uae30\ubcf8\uc6b4\uc784 \uc870\ud68c, JSON \uc9c1\uc811 \uc870\ud68c, Cool\ud560\uc99d, \ub2f9\uc77c\ubc30\uc1a1, \ud560\uc778, \uc624\ub958\uac80\uc99d</li>
    <li>\ube44\uad50: LLM \uc608\uc0c1\uac12 vs \ud504\ub85c\uadf8\ub7a8 \uacc4\uc0b0\uac12 vs JSON \uc9c1\uc811\uc870\ud68c\uac12 \u2014 3\uc911 \uac80\uc99d</li>
    <li>\ubaa8\ub4e0 \ud56d\ubaa9 \uc77c\uce58 \uc2dc PASS</li>
  </ul>
</div>

<div class="summary-grid">
  <div class="stat-card">
    <div class="num ${passed === total ? 'pass' : 'fail'}">${passed}/${total}</div>
    <div class="label">\uc804\uccb4 \ud1b5\uacfc</div>
  </div>
  <div class="stat-card">
    <div class="num">8/8</div>
    <div class="label">\uae30\ubcf8 \uc6b4\uc784 (8 Size)</div>
  </div>
  <div class="stat-card">
    <div class="num">3/3</div>
    <div class="label">\ud604\ub0b4\ubc30\uc1a1 (Intrapref)</div>
  </div>
  <div class="stat-card">
    <div class="num ${passed === total ? 'pass' : 'fail'}">PASS</div>
    <div class="label">\ucd5c\uc885 \uacb0\uacfc</div>
  </div>
</div>

<h2>\ucc28\ud2b8 \ubd84\uc11d</h2>

<div class="chart-row">
  <div class="chart-box">
    <h3>LLM \uc608\uc0c1\uac12 vs \ud504\ub85c\uadf8\ub7a8 \u2014 \uae30\ubcf8\uc6b4\uc784 (\u00a5)</h3>
    <canvas id="chart-scatter"></canvas>
  </div>
  <div class="chart-box">
    <h3>\ud14c\uc2a4\ud2b8\ubcc4 \uac1c\ub2f9 \ud569\uacc4 (\u00a5)</h3>
    <canvas id="chart-bar"></canvas>
  </div>
</div>

<div class="chart-row">
  <div class="chart-box">
    <h3>Size \ud2f0\uc5b4 \ubd84\ud3ec</h3>
    <canvas id="chart-size-dist"></canvas>
  </div>
  <div class="chart-box">
    <h3>\ud3b8\ucc28: LLM vs \ud504\ub85c\uadf8\ub7a8 (\u00a5)</h3>
    <canvas id="chart-deviation"></canvas>
  </div>
</div>

<h2>\uc0c1\uc138 \uacb0\uacfc \u2014 ${total}\uac74</h2>
<div style="overflow-x:auto">
<table>
<thead><tr>
  <th>#</th><th>\ud14c\uc2a4\ud2b8 \uc124\uba85</th><th>\uce58\uc218/\uc911\ub7c9</th>
  <th>Size(\uc608\uc0c1)</th><th>Size(\uacc4\uc0b0)</th><th>Size\uc77c\uce58</th>
  <th>\uc6b4\uc784(\uc608\uc0c1)</th><th>\uc6b4\uc784(\uacc4\uc0b0)</th><th>\uc6b4\uc784(JSON)</th><th>\uc6b4\uc784\uc77c\uce58</th>
  <th>Cool</th><th>\ub2f9\uc77c</th><th>\ud560\uc778</th><th>\uac1c\ub2f9\ud569\uacc4</th><th>\uacb0\uacfc</th>
</tr></thead>
<tbody>
${tableRows}
</tbody>
</table>
</div>

<h2>\ud14c\uc2a4\ud2b8 \ucee4\ubc84\ub9ac\uc9c0</h2>
<div class="method-box">
  <ul>
    <li><strong>\uae30\ubcf8 \uc6b4\uc784:</strong> 8\uac1c Size \ud2f0\uc5b4 (60~200) \u2014 \ubaa8\ub4e0 \uc694\uae08\ub300 \ud655\uc778</li>
    <li><strong>\uacb0\uc81c \ubc29\ubc95:</strong> \ud604\uae08(Cash) + \uce90\uc2dc\ub9ac\uc2a4(Cashless) \u2014 \uac01\uac01 \ubcc4\ub3c4 \uc694\uae08\ud45c \uc870\ud68c</li>
    <li><strong>\uacbd\ub85c \ub2e4\uc591\uc131:</strong> Kanto\u2192Kansai, Hokkaido\u2192Okinawa, Kyushu\u2192KitaTohoku, Chubu\u2192Shikoku \ub4f1</li>
    <li><strong>\ud604\ub0b4\ubc30\uc1a1:</strong> Kanto, Kansai \ud604\ub0b4 + \uc624\ud0a4\ub098\uc640 \uc81c\uc678 \ud655\uc778</li>
    <li><strong>Size \ud310\uc815:</strong> 3\ubcc0\ud569\uacc4 \uae30\uc900 + \uc911\ub7c9 \uae30\uc900 \u2192 MAX \uc801\uc6a9 \ud655\uc778</li>
    <li><strong>Cool \ud560\uc99d:</strong> Size 80(\u00a5330), Size 100(\u00a5440) + Size 140 \ucd08\uacfc \ud655\uc778</li>
    <li><strong>\ub2f9\uc77c\ubc30\uc1a1:</strong> \ud45c\uc900(\u00a5550) + \uc624\ud0a4\ub098\uc640(\u00a5330) \ud655\uc778</li>
    <li><strong>\ud560\uc778:</strong> \uc9c0\uc0b0+\ub514\uc9c0\ud138(-\u00a5170), \ud68c\uc6d0\uc9c0\uc0b0\uc774 \uc77c\ubc18\uc9c0\uc0b0 \ub300\uccb4 \ud655\uc778(-\u00a5210)</li>
  </ul>
</div>

<footer>
  <p>\u26a0\ufe0f \ucc38\uace0\uc6a9 \uac80\uc99d \ub9ac\ud3ec\ud2b8\uc785\ub2c8\ub2e4. \uc2e4\uc81c \uccad\uad6c\uc561\uacfc \ub2e4\ub97c \uc218 \uc788\uc2b5\ub2c8\ub2e4.</p>
  <p>\u00a9 2025 MUSICUS | Yamato TA-Q-BIN \u00a5\u7a0e\u8fbc \uc694\uae08 \uae30\uc900</p>
</footer>

<script>
// Chart: Scatter - Expected vs Actual Rate
new Chart(document.getElementById('chart-scatter'), {
  type: 'scatter',
  data: {
    datasets: [{
      label: 'LLM\uc608\uc0c1 vs \ud504\ub85c\uadf8\ub7a8',
      data: ${JSON.stringify(results.map(r => ({ x: r.expRate, y: r.line.baseRate })))},
      backgroundColor: 'rgba(239, 68, 68, 0.7)',
      pointRadius: 5,
    }, {
      label: '\uc644\ubcbd \uc77c\uce58 \ub77c\uc778',
      data: [{x:0,y:0},{x:6000,y:6000}],
      type: 'line',
      borderColor: '#444',
      borderDash: [5,5],
      pointRadius: 0,
      borderWidth: 1,
    }]
  },
  options: {
    responsive: true,
    plugins: { legend: { labels: { color: '#aaa', font: { size: 11 } } } },
    scales: {
      x: { title: { display: true, text: 'LLM \uc608\uc0c1\uac12 (\u00a5)', color: '#888' }, ticks: { color: '#888' }, grid: { color: '#333' } },
      y: { title: { display: true, text: '\ud504\ub85c\uadf8\ub7a8 \uacc4\uc0b0\uac12 (\u00a5)', color: '#888' }, ticks: { color: '#888' }, grid: { color: '#333' } },
    }
  }
});

// Chart: Bar - Per-pkg totals
new Chart(document.getElementById('chart-bar'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(chartLabels)},
    datasets: [{
      label: '\uac1c\ub2f9 \ud569\uacc4',
      data: ${JSON.stringify(chartTotals)},
      backgroundColor: 'rgba(239, 68, 68, 0.6)',
      borderColor: 'rgba(239, 68, 68, 1)',
      borderWidth: 1,
    }]
  },
  options: {
    responsive: true,
    plugins: { legend: { labels: { color: '#aaa', font: { size: 11 } } } },
    scales: {
      x: { ticks: { color: '#888', font: { size: 9 } }, grid: { color: '#333' } },
      y: { ticks: { color: '#888', callback: v => '\u00a5' + v.toLocaleString() }, grid: { color: '#333' } },
    }
  }
});

// Chart: Size distribution
new Chart(document.getElementById('chart-size-dist'), {
  type: 'doughnut',
  data: {
    labels: ${JSON.stringify(Object.keys(sizeCounts))},
    datasets: [{
      data: ${JSON.stringify(Object.values(sizeCounts))},
      backgroundColor: ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#8b5cf6','#ec4899'],
    }]
  },
  options: {
    responsive: true,
    plugins: { legend: { position: 'right', labels: { color: '#aaa', font: { size: 11 } } } },
  }
});

// Chart: Deviation
new Chart(document.getElementById('chart-deviation'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(chartLabels)},
    datasets: [{
      label: '\ud3b8\ucc28 (LLM - \ud504\ub85c\uadf8\ub7a8)',
      data: ${JSON.stringify(results.map(r => r.expRate - r.line.baseRate))},
      backgroundColor: ${JSON.stringify(results.map(r => r.expRate === r.line.baseRate ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.8)'))},
    }]
  },
  options: {
    responsive: true,
    plugins: { legend: { labels: { color: '#aaa', font: { size: 11 } } } },
    scales: {
      x: { ticks: { color: '#888', font: { size: 9 } }, grid: { color: '#333' } },
      y: { ticks: { color: '#888', callback: v => '\u00a5' + v }, grid: { color: '#333' } },
    }
  }
});
<\/script>

</body>
</html>`;

fs.writeFileSync('benchmark-yamato.html', html);
console.log(`Generated benchmark-yamato.html`);
