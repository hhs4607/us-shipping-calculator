#!/usr/bin/env node
/**
 * Capture screenshots of the JP tab for visual review.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8765';
const OUT_DIR = path.join(__dirname, '..', 'screenshots');

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage();

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  // Switch to JP tab
  await page.click('button.tab-btn[data-tab="jp"]');
  await page.waitForTimeout(400);

  // Full JP tab
  await page.screenshot({
    path: path.join(OUT_DIR, '01-jp-tab-full.png'),
    fullPage: true,
  });

  // Settings card only
  const settingsCard = await page.$('#tab-jp section.card:nth-of-type(2)');
  if (settingsCard) {
    await settingsCard.screenshot({ path: path.join(OUT_DIR, '02-jp-carrier-settings.png') });
  }

  // Result table card
  const resultCard = await page.$('#tab-jp section.card:nth-of-type(3)');
  if (resultCard) {
    await resultCard.screenshot({ path: path.join(OUT_DIR, '03-jp-comparison-table.png') });
  }

  // Summary card
  const summaryCard = await page.$('#tab-jp section.card:nth-of-type(4)');
  if (summaryCard) {
    await summaryCard.screenshot({ path: path.join(OUT_DIR, '04-jp-summary.png') });
  }

  // Charts card
  const chartCard = await page.$('#tab-jp section.card:nth-of-type(5)');
  if (chartCard) {
    await chartCard.screenshot({ path: path.join(OUT_DIR, '05-jp-charts.png') });
  }

  // Asymmetric error scenario: 50×50×50 35kg
  await page.evaluate(() => {
    while (UI.getItems().length > 1) UI.deleteRow(UI.getItems()[UI.getItems().length - 1].id);
    const items = UI.getItems();
    items[0].L_mm = 500; items[0].W_mm = 500; items[0].H_mm = 500;
    items[0].weightKg = 35; items[0].qty = 1; items[0].name = '35kg cargo';
    JpUI.recalculateWithItems(items);
  });
  await page.waitForTimeout(300);
  const resultCard2 = await page.$('#tab-jp section.card:nth-of-type(3)');
  if (resultCard2) {
    await resultCard2.screenshot({ path: path.join(OUT_DIR, '06-asymmetric-yamato-fail.png') });
  }

  await browser.close();

  const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.png'));
  console.log('Captured ' + files.length + ' screenshots in ' + OUT_DIR);
  files.forEach(f => {
    const stat = fs.statSync(path.join(OUT_DIR, f));
    console.log('  • ' + f + ' (' + Math.round(stat.size / 1024) + ' KB)');
  });
}

run().catch(e => { console.error(e); process.exit(1); });
