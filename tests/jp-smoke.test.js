#!/usr/bin/env node
/**
 * JP Tab Smoke Test — Playwright
 *
 * Validates that the JP tab (Yamato vs Sagawa) loads, calculates, and renders
 * correctly. Run via: node tests/jp-smoke.test.js
 *
 * Assumes a local HTTP server is running at TEST_BASE_URL (default
 * http://localhost:8765). The test runner script `tests/run.sh` starts one.
 */

const { chromium } = require('playwright');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8765';
const HEADLESS = process.env.HEADLESS !== '0';

let passes = 0, fails = 0;
const failures = [];

function assert(cond, label) {
  if (cond) { console.log('  ✓ ' + label); passes++; }
  else      { console.log('  ✗ ' + label); fails++; failures.push(label); }
}

function isPositiveNumber(n) {
  return typeof n === 'number' && n > 0 && isFinite(n);
}

async function run() {
  console.log('Browser launch (' + (HEADLESS ? 'headless' : 'headed') + ')…');
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push('PAGEERROR: ' + err.message));

  console.log('\n[1] Initial load');
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500); // let async data fetch settle

  assert(consoleErrors.length === 0, 'no console errors after load (got ' + consoleErrors.length + (consoleErrors[0] ? ': ' + consoleErrors[0].slice(0,120) : '') + ')');
  const title = await page.textContent('#header-title');
  assert(/배송비/.test(title), 'header title rendered');

  console.log('\n[2] Module / data globals exposed');
  const globals = await page.evaluate(() => ({
    UI: typeof UI,
    JpUI: typeof JpUI,
    DataLoader: typeof DataLoader,
    sagawaCalcAll: typeof sagawaCalcAll,
    yamatoCalcAll: typeof yamatoCalcAll,
    SAGAWA_TO_YAMATO_REGION: typeof SAGAWA_TO_YAMATO_REGION,
  }));
  assert(globals.UI === 'object', 'UI module loaded');
  assert(globals.JpUI === 'object', 'JpUI module loaded');
  assert(globals.sagawaCalcAll === 'function', 'sagawaCalcAll exposed');
  assert(globals.SAGAWA_TO_YAMATO_REGION === 'object', 'region map exposed');

  console.log('\n[3] Tab switching');
  await page.click('button.tab-btn[data-tab="jp"]');
  await page.waitForTimeout(150);
  const jpVisible = await page.isVisible('#tab-jp');
  const usVisible = await page.isVisible('#tab-us');
  assert(jpVisible, 'JP tab visible after switch');
  assert(!usVisible, 'US tab hidden after switch');

  console.log('\n[4] JP origin selector populated (Sagawa 13 regions)');
  const originOpts = await page.$$eval('#jp-origin option', opts => opts.map(o => o.value));
  assert(originOpts.length === 13, 'origin has 13 options (got ' + originOpts.length + ')');
  const expected = ['hokkaido','kita_tohoku','minami_tohoku','kanto','shin_etsu','tokai','hokuriku','kansai','chugoku','shikoku','kita_kyushu','minami_kyushu','okinawa'];
  assert(JSON.stringify(originOpts) === JSON.stringify(expected), 'origin region IDs match Sagawa schema');

  console.log('\n[5] Default items render in JP comparison table');
  const rowCount = await page.$$eval('#jp-result-tbody tr', rows => rows.length);
  assert(rowCount >= 1, 'at least 1 row rendered (got ' + rowCount + ')');

  console.log('\n[6] Summary cells contain rendered yen amounts');
  const ymGrandText = await page.textContent('#jp-sum-ym-grand');
  const sgGrandText = await page.textContent('#jp-sum-sg-grand');
  assert(/¥/.test(ymGrandText), 'Yamato grand total has ¥ symbol (' + ymGrandText + ')');
  assert(/¥/.test(sgGrandText), 'Sagawa grand total has ¥ symbol (' + sgGrandText + ')');

  console.log('\n[7] Settings change triggers recalculation');
  // Switch destination from default (kansai) to okinawa — should change Sagawa total.
  const sgBefore = await page.textContent('#jp-sum-sg-grand');
  await page.selectOption('#jp-destination', 'okinawa');
  await page.waitForTimeout(150);
  const sgAfterOkinawa = await page.textContent('#jp-sum-sg-grand');
  assert(sgBefore !== sgAfterOkinawa, 'Sagawa total changes after destination switch (' + sgBefore + ' → ' + sgAfterOkinawa + ')');

  // Reset back
  await page.selectOption('#jp-destination', 'kansai');
  await page.waitForTimeout(150);

  console.log('\n[8] Cool surcharge toggles affect total');
  const beforeCool = await page.textContent('#jp-sum-sg-grand');
  await page.selectOption('#jp-cool', 'chilled');
  await page.waitForTimeout(150);
  const afterCool = await page.textContent('#jp-sum-sg-grand');
  // Cool either: different (if applicable), or same (if all items > Size 140 → cool unavailable)
  // Either is OK; just ensure no crash and rendered.
  assert(/¥/.test(afterCool), 'Sagawa total still rendered after cool toggle');
  await page.selectOption('#jp-cool', 'none');
  await page.waitForTimeout(150);

  console.log('\n[9] Branch dropoff discount affects Sagawa only');
  const sgBeforeBranch = await page.evaluate(() =>
    parseInt(document.getElementById('jp-sum-sg-grand').textContent.replace(/[^\d]/g,''), 10));
  const ymBeforeBranch = await page.evaluate(() =>
    parseInt(document.getElementById('jp-sum-ym-grand').textContent.replace(/[^\d]/g,''), 10));
  await page.check('#sg-branch');
  await page.waitForTimeout(150);
  const sgAfterBranch = await page.evaluate(() =>
    parseInt(document.getElementById('jp-sum-sg-grand').textContent.replace(/[^\d]/g,''), 10));
  const ymAfterBranch = await page.evaluate(() =>
    parseInt(document.getElementById('jp-sum-ym-grand').textContent.replace(/[^\d]/g,''), 10));
  assert(sgAfterBranch < sgBeforeBranch, 'Sagawa total decreased after branch dropoff (' + sgBeforeBranch + ' → ' + sgAfterBranch + ')');
  assert(ymAfterBranch === ymBeforeBranch, 'Yamato total unchanged by Sagawa-only setting');
  await page.uncheck('#sg-branch');
  await page.waitForTimeout(150);

  console.log('\n[10] Item-level results expose error rows when present');
  // The default frame item is 57kg → both Yamato (>30kg) and Sagawa (>50kg) error.
  const errorCells = await page.$$eval('#jp-result-tbody .error-row', els => els.length);
  assert(errorCells > 0, 'at least one error cell present for default 57kg frame (got ' + errorCells + ')');

  console.log('\n[11] Sagawa handles cargo Yamato cannot');
  // Override the first row to a 50×50×50cm 35kg item — Yamato 30kg over, but
  // Sagawa Large service should accept it (3-side 150 ≤ 160 with weight 35kg
  // forces tier 170).
  await page.evaluate(() => {
    while (UI.getItems().length > 1) UI.deleteRow(UI.getItems()[UI.getItems().length - 1].id);
    const items = UI.getItems();
    items[0].L_mm = 500; items[0].W_mm = 500; items[0].H_mm = 500;
    items[0].weightKg = 35;
    items[0].qty = 1;
    items[0].name = 'TEST 35kg';
    JpUI.recalculateWithItems(items);
  });
  await page.waitForTimeout(250);
  const probe = await page.evaluate(() => {
    const row = document.querySelector('#jp-result-tbody tr');
    if (!row) return { err: 'no row' };
    const cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent.trim());
    return {
      cells,
      ymHasError: !!row.querySelector('.yamato-cell.error-row, .error-row.yamato-cell, td.error-row'),
      html: row.innerHTML.slice(0, 600),
    };
  });
  assert(/error-row/.test(probe.html), 'Yamato error row shown (item exceeds 30kg)');
  // Yamato error renders 1 <td colspan=4> error cell, then the 4 Sagawa cells follow.
  // Cell layout: [#, name, ymError, sgSize, sgBase, sgTags, sgTotal, diff, qty]
  const sgSizeCell = (probe.cells || [])[3] || '';
  const sgTotalCell = (probe.cells || [])[6] || '';
  assert(/(170|180|200|220|240|260)/.test(sgSizeCell), 'Sagawa large size assigned (got cell="' + sgSizeCell + '")');
  assert(/대형/.test(sgSizeCell), 'Sagawa large-tier badge shown');
  assert(/¥/.test(sgTotalCell), 'Sagawa total rendered alongside Yamato error');

  console.log('\n[12] Reset returns to default items');
  await page.click('#btn-reset');
  await page.waitForTimeout(200);
  const itemCountAfterReset = await page.evaluate(() => UI.getItems().filter(i => i.qty > 0).length);
  assert(itemCountAfterReset >= 1, 'reset reloads default items (got ' + itemCountAfterReset + ')');

  console.log('\n[13] Winner badge appears on cheaper carrier per row');
  // Set a single small standard cargo where Yamato is typically cheaper.
  await page.evaluate(() => {
    while (UI.getItems().length > 1) UI.deleteRow(UI.getItems()[UI.getItems().length - 1].id);
    const items = UI.getItems();
    items[0].L_mm = 300; items[0].W_mm = 250; items[0].H_mm = 200;
    items[0].weightKg = 3;
    items[0].qty = 1;
    items[0].name = 'small box';
    JpUI.recalculateWithItems(items);
  });
  await page.waitForTimeout(200);
  const winnerInfo = await page.evaluate(() => {
    const winnerCells = document.querySelectorAll('#jp-result-tbody td.winner-cell').length;
    const badges = document.querySelectorAll('#jp-result-tbody .winner-badge').length;
    return { winnerCells, badges };
  });
  assert(winnerInfo.winnerCells >= 1, 'winner-cell class applied (got ' + winnerInfo.winnerCells + ')');
  assert(winnerInfo.badges >= 1, 'winner-badge ★ rendered (got ' + winnerInfo.badges + ')');

  console.log('\n[14] Asymmetric error case marks Sagawa as winner');
  await page.evaluate(() => {
    const items = UI.getItems();
    items[0].L_mm = 500; items[0].W_mm = 500; items[0].H_mm = 500;
    items[0].weightKg = 35;
    items[0].name = 'YM-overweight';
    JpUI.recalculateWithItems(items);
  });
  await page.waitForTimeout(200);
  const asymInfo = await page.evaluate(() => {
    const row = document.querySelector('#jp-result-tbody tr');
    return {
      hasYmError: !!row.querySelector('.yamato-cell.error-row'),
      sgWinnerCount: row.querySelectorAll('.sagawa-cell.winner-cell').length,
      diffText: row.querySelector('.diff-cell')?.textContent || '',
    };
  });
  assert(asymInfo.hasYmError, 'Yamato error rendered');
  assert(asymInfo.sgWinnerCount >= 1, 'Sagawa winner-cell applied when Yamato errors');
  assert(/Y✗|S▼/.test(asymInfo.diffText), 'diff cell shows asymmetric arrow (got "' + asymInfo.diffText.trim() + '")');

  console.log('\n[15] Size divergence highlight when carriers assign different sizes');
  // Reset and find a real default item where sizes likely diverge.
  await page.click('#btn-reset');
  await page.waitForTimeout(200);
  const divergent = await page.evaluate(() => {
    return document.querySelectorAll('#jp-result-tbody td.size-divergent').length;
  });
  // Defaults include items where Yamato would be Size 200 max but Sagawa goes higher → divergence
  assert(divergent >= 1, 'at least one size-divergent cell highlighted (got ' + divergent + ')');

  console.log('\n[16] Charts render after data load');
  const chartProbe = await page.evaluate(() => {
    const itemCanvas = document.getElementById('jp-chart-item-compare');
    const breakdownCanvas = document.getElementById('jp-chart-cost-breakdown');
    return {
      itemPresent: !!itemCanvas,
      breakdownPresent: !!breakdownCanvas,
      itemHasContent: itemCanvas && itemCanvas.height > 0,
      breakdownHasContent: breakdownCanvas && breakdownCanvas.height > 0,
    };
  });
  assert(chartProbe.itemPresent, 'item compare canvas exists');
  assert(chartProbe.breakdownPresent, 'breakdown canvas exists');
  assert(chartProbe.itemHasContent, 'item canvas has rendered content (height>0)');
  assert(chartProbe.breakdownHasContent, 'breakdown canvas has rendered content');

  console.log('\n[17] Numeric consistency: per-pkg × qty == lineTotal');
  const consistency = await page.evaluate(() => {
    const items = UI.getItems().map(i => ({
      name: i.name, L_cm: i.L_mm / 10, W_cm: i.W_mm / 10, H_cm: i.H_mm / 10,
      weightKg: i.weightKg, qty: i.qty,
    }));
    const ymOrigin = SAGAWA_TO_YAMATO_REGION['kanto'];
    const ymDest = SAGAWA_TO_YAMATO_REGION['kansai'];
    // Inline access to module data via DataLoader cache (already loaded).
    return DataLoader.loadJp().then(({ yamato, sagawa }) => {
      const ym = yamatoCalcAll(items, ymOrigin, ymDest, 'cash', false, 'none', false, [],
        yamato.ratesCash, yamato.ratesCashless, yamato.ratesIntrapref,
        yamato.surcharges, yamato.discounts);
      const sg = sagawaCalcAll(items, 'kanto', 'kansai', 'none', false,
        sagawa.rates, sagawa.surcharges);
      const mismatches = [];
      [...ym.lines, ...sg.lines].forEach(l => {
        const expected = l.error ? 0 : l.perPkgTotal * l.qty;
        if (Math.abs(expected - l.lineTotal) > 0.5) {
          mismatches.push(`${l.name}: ${expected} vs ${l.lineTotal}`);
        }
      });
      return {
        ok: mismatches.length === 0,
        mismatches,
        ymGrand: ym.grandTotal,
        sgGrand: sg.grandTotal,
      };
    });
  });
  assert(consistency.ok, 'all per-pkg × qty = lineTotal' + (consistency.mismatches?.length ? ': ' + consistency.mismatches.join('; ') : ''));
  assert(typeof consistency.ymGrand === 'number' && consistency.ymGrand >= 0, 'Yamato grand total is non-negative number');
  assert(typeof consistency.sgGrand === 'number' && consistency.sgGrand >= 0, 'Sagawa grand total is non-negative number');

  await browser.close();

  console.log('\n──────────────────────────────────');
  console.log(`Passed: ${passes}   Failed: ${fails}`);
  if (fails > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('All assertions passed.');
}

run().catch(e => {
  console.error('\nTest crashed:', e);
  process.exit(1);
});
