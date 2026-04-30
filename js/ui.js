/**
 * UI Controller V7 — Shared Items + Tab-based Comparison
 * V7: Items input shared between US and Japan tabs.
 * US tab: FedEx vs Amazon side-by-side comparison.
 * Japan tab: Yamato TA-Q-BIN (via YamatoUI module).
 */

const UI = (() => {
  let fedexData = null;   // { rates, surcharges, defaults, zones, meta }
  let amazonData = null;  // { rates, surcharges, defaults, zones, meta }
  let state = null;       // { zone, fuelPct, dieselPrice, isResidential, dasTier, unitDim, unitWeight, items }
  let itemIdCounter = 0;
  let chartItemCompare = null;
  let chartCostBreakdown = null;

  // ─── DAS Tier Mapping ────────────────────────────────────────────
  const DAS_TO_FEDEX = {
    'None': 'None',
    'Delivery Area': 'Base',
    'Extended': 'Extended',
    'Remote': 'Remote',
  };

  const DAS_TO_AMAZON = {
    'None': 'None',
    'Delivery Area': 'Delivery Area',
    'Extended': 'Extended Delivery Area',
    'Remote': 'Remote Area',
  };

  // ─── Initialization ─────────────────────────────────────────────

  async function init() {
    const urlState = Storage.loadFromURL();

    try {
      const both = await DataLoader.loadBoth();
      fedexData = both.fedex;
      amazonData = both.amazon;
    } catch (e) {
      console.error('Data load failed:', e);
      showToast('데이터 로드 실패: ' + e.message, 'error');
      return;
    }

    if (urlState) {
      state = migrateState(urlState);
      itemIdCounter = state.items.length;
    } else {
      resetToDefaults();
    }

    renderSettings();
    renderItemsTable();
    recalculate();
    renderMeta();
    bindEvents();

    // Initialize JP tab (Yamato + Sagawa), then trigger calculation with shared items
    if (typeof JpUI !== 'undefined') {
      await JpUI.init();
      JpUI.recalculateWithItems(state.items);
    }
  }

  function migrateState(old) {
    const s = { ...old };

    // Remove V4 carrier field
    delete s.carrier;

    // Convert deliveryType → isResidential
    if ('deliveryType' in s) {
      s.isResidential = s.deliveryType === 'residential';
      delete s.deliveryType;
    }
    if (s.isResidential == null) s.isResidential = false;

    // Convert old FedEx DAS tier to unified
    if (s.dasTierAmazon != null || s.dasTier != null) {
      const oldFedex = s.dasTier || 'None';
      const fedexToUnified = {
        'None': 'None', 'Base': 'Delivery Area',
        'Extended': 'Extended', 'Remote': 'Remote',
        'Alaska': 'None', 'Hawaii': 'None', 'Intra-Hawaii': 'None',
      };
      s.dasTier = fedexToUnified[oldFedex] || 'None';
      delete s.dasTierAmazon;
    }

    if (!s.zone) s.zone = 2;
    if (s.fuelPct == null) s.fuelPct = 0;
    if (s.dieselPrice == null) s.dieselPrice = 3.50;
    if (!s.dasTier) s.dasTier = 'None';

    return s;
  }

  function resetToDefaults() {
    const defaults = fedexData.defaults;
    state = {
      zone: defaults.zone || 2,
      fuelPct: defaults.fuel_pct || 0,
      dieselPrice: 3.50,
      isResidential: false,
      dasTier: 'None',
      unitDim: 'mm',
      unitWeight: 'kg',
      items: defaults.items.map((item, i) => ({
        id: i,
        name: item.name,
        L_mm: parseDimStr(item.dimensions_mm).L,
        W_mm: parseDimStr(item.dimensions_mm).W,
        H_mm: parseDimStr(item.dimensions_mm).H,
        weightKg: item.weight_kg,
        qty: item.qty,
      })),
    };
    itemIdCounter = state.items.length;
  }

  function loadSet(setKey) {
    const defaults = fedexData.defaults;
    let items;
    if (setKey === 'all') {
      items = defaults.items;
    } else if (defaults.sets && defaults.sets[setKey]) {
      items = defaults.sets[setKey];
    } else {
      return;
    }
    state.items = items.map((item, i) => ({
      id: i,
      name: item.name,
      L_mm: parseDimStr(item.dimensions_mm).L,
      W_mm: parseDimStr(item.dimensions_mm).W,
      H_mm: parseDimStr(item.dimensions_mm).H,
      weightKg: item.weight_kg,
      qty: item.qty,
    }));
    itemIdCounter = state.items.length;
    renderItemsTable();
    recalculate();
    document.querySelectorAll('.btn-set').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.btn-set[data-set="${setKey}"]`);
    if (activeBtn) activeBtn.classList.add('active');
  }

  function parseDimStr(str) {
    if (!str) return { L: 0, W: 0, H: 0 };
    const parts = str.split('*').map(Number);
    return { L: parts[0] || 0, W: parts[1] || 0, H: parts[2] || 0 };
  }

  function getCurrentState() {
    return JSON.parse(JSON.stringify(state));
  }

  // ─── Settings ───────────────────────────────────────────────────

  function renderSettings() {
    document.getElementById('zone-select').value = state.zone;
    document.getElementById('fuel-input').value = state.fuelPct;
    document.getElementById('diesel-select').value = state.dieselPrice;
    document.getElementById('residential-check').checked = state.isResidential;
    document.getElementById('das-tier').value = state.dasTier;
    updateUnitToggle('dim', state.unitDim);
    updateUnitToggle('weight', state.unitWeight);
  }

  function updateUnitToggle(type, value) {
    const btns = document.querySelectorAll(`#unit-${type} button`);
    btns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === value);
    });
  }

  // ─── Items Table ────────────────────────────────────────────────

  function renderItemsTable() {
    const tbody = document.getElementById('items-tbody');
    tbody.innerHTML = '';

    const dimLabels = { mm: 'mm', cm: 'cm', inch: 'in' };
    const dl = dimLabels[state.unitDim] || 'mm';
    document.getElementById('th-dim-l').textContent = `L(${dl})`;
    document.getElementById('th-dim-w').textContent = `W(${dl})`;
    document.getElementById('th-dim-h').textContent = `H(${dl})`;
    document.getElementById('th-weight').textContent = state.unitWeight === 'kg' ? '중량(kg)' : '중량(lb)';

    state.items.forEach((item, idx) => {
      const tr = document.createElement('tr');
      tr.dataset.id = item.id;

      const displayL = mmToDisplay(item.L_mm);
      const displayW = mmToDisplay(item.W_mm);
      const displayH = mmToDisplay(item.H_mm);
      const displayWeight = state.unitWeight === 'kg' ? item.weightKg : round2(item.weightKg * 2.2046);

      const dimStep = state.unitDim === 'mm' ? '1' : '0.1';

      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td><input type="text" class="input-name" data-field="name" value="${escHtml(item.name)}" placeholder="품명"></td>
        <td><input type="number" class="input-dim" data-field="L" value="${displayL}" min="0" step="${dimStep}"></td>
        <td><input type="number" class="input-dim" data-field="W" value="${displayW}" min="0" step="${dimStep}"></td>
        <td><input type="number" class="input-dim" data-field="H" value="${displayH}" min="0" step="${dimStep}"></td>
        <td><input type="number" class="input-weight" data-field="weight" value="${displayWeight}" min="0" step="0.1"></td>
        <td><input type="number" class="input-qty" data-field="qty" value="${item.qty}" min="0" step="1"></td>
        <td class="row-actions">
          <button class="duplicate" title="복제" onclick="UI.duplicateRow(${item.id})">📋</button>
          <button class="delete" title="삭제" onclick="UI.deleteRow(${item.id})">✕</button>
        </td>
      `;

      tr.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', () => onItemInput(item.id, input));
        input.addEventListener('change', () => onItemInput(item.id, input));
      });

      tbody.appendChild(tr);
    });
  }

  function mmToDisplay(mm) {
    if (state.unitDim === 'cm') return round2(mm / 10);
    if (state.unitDim === 'inch') return round2(mm / 25.4);
    return mm; // mm
  }

  function displayToMm(val) {
    if (state.unitDim === 'cm') return Number(val) * 10;
    if (state.unitDim === 'inch') return Number(val) * 25.4;
    return Number(val); // mm
  }

  function onItemInput(id, input) {
    const item = state.items.find(i => i.id === id);
    if (!item) return;

    const field = input.dataset.field;
    const val = input.value;

    if (field === 'name') item.name = val;
    else if (field === 'L') item.L_mm = displayToMm(val);
    else if (field === 'W') item.W_mm = displayToMm(val);
    else if (field === 'H') item.H_mm = displayToMm(val);
    else if (field === 'weight') item.weightKg = state.unitWeight === 'kg' ? Number(val) : Number(val) / 2.2046;
    else if (field === 'qty') item.qty = Math.max(0, Math.floor(Number(val)));

    recalculate();
    updateURL();
  }

  function addRow() {
    state.items.push({
      id: itemIdCounter++,
      name: '', L_mm: 0, W_mm: 0, H_mm: 0, weightKg: 0, qty: 1,
    });
    renderItemsTable();
    recalculate();
  }

  function deleteRow(id) {
    state.items = state.items.filter(i => i.id !== id);
    renderItemsTable();
    recalculate();
    updateURL();
  }

  function duplicateRow(id) {
    const item = state.items.find(i => i.id === id);
    if (!item) return;
    const idx = state.items.indexOf(item);
    const clone = { ...item, id: itemIdCounter++, name: item.name + ' (copy)' };
    state.items.splice(idx + 1, 0, clone);
    renderItemsTable();
    recalculate();
    updateURL();
  }

  // ─── Calculation ────────────────────────────────────────────────

  function recalculate() {
    const calcItems = state.items.map(item => ({
      name: item.name,
      L_cm: item.L_mm / 10,
      W_cm: item.W_mm / 10,
      H_cm: item.H_mm / 10,
      weightKg: item.weightKg,
      qty: item.qty,
    }));

    const fedexDas = DAS_TO_FEDEX[state.dasTier] || 'None';
    const amazonDas = DAS_TO_AMAZON[state.dasTier] || 'None';

    const fedexResult = calcAll(
      calcItems, state.zone, state.fuelPct, state.isResidential,
      fedexDas, fedexData.rates, fedexData.surcharges
    );

    const amazonResult = amazonCalcAll(
      calcItems, state.zone, state.dieselPrice,
      amazonDas, amazonData.rates, amazonData.surcharges
    );

    // Per-item results for comparison table
    const itemResults = calcItems.map(item => {
      let fedex = null, amazon = null;
      if (item.qty > 0) {
        fedex = calcLineItem(item, state.zone, state.fuelPct, state.isResidential,
          fedexDas, fedexData.rates, fedexData.surcharges);
        amazon = amazonCalcLineItem(item, state.zone, state.dieselPrice,
          amazonDas, amazonData.rates, amazonData.surcharges);
      }
      return { fedex, amazon, qty: item.qty, name: item.name };
    });

    renderResults(itemResults);
    renderSummary(fedexResult, amazonResult);
    renderCharts(fedexResult, amazonResult, itemResults);

    // Also trigger JP (Yamato + Sagawa) recalculation with shared items
    if (typeof JpUI !== 'undefined' && JpUI.recalculateWithItems) {
      JpUI.recalculateWithItems(state.items);
    }
  }

  // ─── Comparison Results Table ───────────────────────────────────

  function renderResults(itemResults) {
    const tbody = document.getElementById('compare-tbody');
    tbody.innerHTML = '';

    itemResults.forEach((ir, idx) => {
      const tr = document.createElement('tr');
      if (ir.qty === 0) tr.style.opacity = '0.35';

      if (ir.fedex && ir.amazon) {
        const f = ir.fedex;
        const a = ir.amazon;
        const diff = a.lineTotal - f.lineTotal;
        const diffClass = diff > 0.005 ? 'diff-positive' : diff < -0.005 ? 'diff-negative' : 'diff-zero';

        tr.innerHTML = `
          <td>${idx + 1}</td>
          <td class="cell-name">${escHtml(f.name)}</td>
          <td class="fedex-cell">${f.billableLb}</td>
          <td class="fedex-cell">$${fmt(f.rateSubtotal)}</td>
          <td class="fedex-cell">${renderScCell(f)}</td>
          <td class="fedex-cell"><strong>$${fmt(f.perPkgTotal)}</strong></td>
          <td class="amazon-cell">${a.billableLb}</td>
          <td class="amazon-cell">$${fmt(a.rateSubtotal)}</td>
          <td class="amazon-cell">${renderScCell(a)}</td>
          <td class="amazon-cell"><strong>$${fmt(a.perPkgTotal)}</strong></td>
          <td class="${diffClass}">${fmtDiff(diff)}</td>
          <td>${ir.qty}</td>
        `;
      } else {
        tr.innerHTML = `
          <td>${idx + 1}</td>
          <td class="cell-name">${escHtml(ir.name)}</td>
          <td colspan="10" style="color:var(--text-m)">수량 0 — 계산 제외</td>
        `;
      }

      tbody.appendChild(tr);
    });
  }

  function renderScCell(line) {
    if (line.scType === 'OK') {
      return '<span class="sc-tag ' + scTypeToClass('OK') + '">OK</span>';
    }
    const cls = scTypeToClass(line.scType);
    return `<span class="sc-tag ${cls}" title="${escHtml(line.scReason)}">${line.scType}</span> $${fmt(line.scAmount)}`;
  }

  // ─── Comparison Summary ─────────────────────────────────────────

  function renderSummary(fedex, amazon) {
    const totalLines = fedex.lines.length;
    const totalQty = fedex.lines.reduce((s, l) => s + l.qty, 0);
    document.getElementById('sum-count').textContent = totalLines + '건 / ' + totalQty + '개';

    setSummaryRow('rate', fedex.rateSubtotal, amazon.rateSubtotal);
    setSummaryRow('sc', fedex.scSubtotal, amazon.scSubtotal);
    setSummaryRow('resi', fedex.residentialSubtotal, amazon.residentialSubtotal);
    setSummaryRow('das', fedex.dasSubtotal, amazon.dasSubtotal);
    setSummaryGrandRow(fedex.grandTotal, amazon.grandTotal);
  }

  function setSummaryRow(key, fedexVal, amazonVal) {
    document.getElementById('sum-fedex-' + key).textContent = '$' + fmt(fedexVal);
    document.getElementById('sum-amzn-' + key).textContent = '$' + fmt(amazonVal);
    const diff = amazonVal - fedexVal;
    const el = document.getElementById('sum-diff-' + key);
    el.textContent = fmtDiff(diff);
    el.className = 'diff-cell ' + (diff > 0.005 ? 'diff-positive' : diff < -0.005 ? 'diff-negative' : 'diff-zero');
  }

  function setSummaryGrandRow(fedexTotal, amazonTotal) {
    document.getElementById('sum-fedex-grand').textContent = '$' + fmt(fedexTotal);
    document.getElementById('sum-amzn-grand').textContent = '$' + fmt(amazonTotal);
    const diff = amazonTotal - fedexTotal;
    const pct = fedexTotal > 0 ? (diff / fedexTotal * 100) : 0;
    const el = document.getElementById('sum-diff-grand');
    const pctStr = Math.abs(pct) >= 0.05 ? ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)` : '';
    el.textContent = fmtDiff(diff) + pctStr;
    el.className = 'diff-cell ' + (diff > 0.005 ? 'diff-positive' : diff < -0.005 ? 'diff-negative' : 'diff-zero');
  }

  // ─── Charts ─────────────────────────────────────────────────────

  function renderCharts(fedexResult, amazonResult, itemResults) {
    if (typeof Chart === 'undefined') return;

    renderItemCompareChart(itemResults);
    renderCostBreakdownChart(fedexResult, amazonResult);
  }

  function renderItemCompareChart(itemResults) {
    const ctx = document.getElementById('chart-item-compare');
    if (!ctx) return;

    if (chartItemCompare) {
      chartItemCompare.destroy();
      chartItemCompare = null;
    }

    const activeItems = itemResults.filter(ir => ir.fedex && ir.amazon);
    if (activeItems.length === 0) return;

    const labels = activeItems.map(ir => ir.name || '(unnamed)');
    const fedexTotals = activeItems.map(ir => round2(ir.fedex.lineTotal));
    const amazonTotals = activeItems.map(ir => round2(ir.amazon.lineTotal));

    chartItemCompare = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'FedEx Ground',
            data: fedexTotals,
            backgroundColor: 'rgba(34, 197, 94, 0.7)',
            borderColor: 'rgba(34, 197, 94, 1)',
            borderWidth: 1,
          },
          {
            label: 'Amazon Shipping',
            data: amazonTotals,
            backgroundColor: 'rgba(59, 130, 246, 0.7)',
            borderColor: 'rgba(59, 130, 246, 1)',
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { color: '#aaa', font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            },
          },
        },
        scales: {
          x: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: '#333' } },
          y: {
            ticks: {
              color: '#888',
              callback: (v) => '$' + v.toLocaleString(),
            },
            grid: { color: '#333' },
          },
        },
      },
    });
  }

  function renderCostBreakdownChart(fedex, amazon) {
    const ctx = document.getElementById('chart-cost-breakdown');
    if (!ctx) return;

    if (chartCostBreakdown) {
      chartCostBreakdown.destroy();
      chartCostBreakdown = null;
    }

    if (fedex.grandTotal === 0 && amazon.grandTotal === 0) return;

    chartCostBreakdown = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['FedEx Ground', 'Amazon Shipping'],
        datasets: [
          {
            label: 'Rate + Fuel',
            data: [round2(fedex.rateSubtotal), round2(amazon.rateSubtotal)],
            backgroundColor: ['rgba(34, 197, 94, 0.6)', 'rgba(59, 130, 246, 0.6)'],
          },
          {
            label: 'Surcharge',
            data: [round2(fedex.scSubtotal), round2(amazon.scSubtotal)],
            backgroundColor: ['rgba(251, 191, 36, 0.6)', 'rgba(251, 191, 36, 0.6)'],
          },
          {
            label: 'Residential',
            data: [round2(fedex.residentialSubtotal), round2(amazon.residentialSubtotal)],
            backgroundColor: ['rgba(244, 114, 182, 0.6)', 'rgba(244, 114, 182, 0.6)'],
          },
          {
            label: 'DAS',
            data: [round2(fedex.dasSubtotal), round2(amazon.dasSubtotal)],
            backgroundColor: ['rgba(168, 85, 247, 0.6)', 'rgba(168, 85, 247, 0.6)'],
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { color: '#aaa', font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            ticks: { color: '#888' },
            grid: { color: '#333' },
          },
          y: {
            stacked: true,
            ticks: {
              color: '#888',
              callback: (v) => '$' + v.toLocaleString(),
            },
            grid: { color: '#333' },
          },
        },
      },
    });
  }

  // ─── Meta Footer ────────────────────────────────────────────────

  function renderMeta() {
    const footer = document.getElementById('meta-info');
    const parts = [];
    if (fedexData.meta) {
      parts.push(`FedEx: v${fedexData.meta.data_version} ${fedexData.meta.year}`);
    }
    if (amazonData.meta) {
      parts.push(`Amazon: v${amazonData.meta.data_version} ${amazonData.meta.year}`);
    }
    parts.push('DIM ÷139');
    footer.textContent = parts.join(' | ');
  }

  // ─── URL Sync ───────────────────────────────────────────────────

  function updateURL() {
    Storage.saveToURL(getCurrentState());
  }

  // ─── Events ─────────────────────────────────────────────────────

  function bindEvents() {
    // Zone
    document.getElementById('zone-select').addEventListener('change', (e) => {
      state.zone = Number(e.target.value);
      recalculate();
      updateURL();
    });

    // Fuel (FedEx)
    document.getElementById('fuel-input').addEventListener('input', (e) => {
      state.fuelPct = Number(e.target.value) || 0;
      recalculate();
      updateURL();
    });

    // Diesel price (Amazon)
    document.getElementById('diesel-select').addEventListener('change', (e) => {
      state.dieselPrice = Number(e.target.value);
      recalculate();
      updateURL();
    });

    // Residential (FedEx)
    document.getElementById('residential-check').addEventListener('change', (e) => {
      state.isResidential = e.target.checked;
      recalculate();
      updateURL();
    });

    // DAS Tier (unified)
    document.getElementById('das-tier').addEventListener('change', (e) => {
      state.dasTier = e.target.value;
      recalculate();
      updateURL();
    });

    // Unit toggles
    document.querySelectorAll('#unit-dim button').forEach(btn => {
      btn.addEventListener('click', () => {
        state.unitDim = btn.dataset.value;
        updateUnitToggle('dim', state.unitDim);
        renderItemsTable();
        updateURL();
      });
    });

    document.querySelectorAll('#unit-weight button').forEach(btn => {
      btn.addEventListener('click', () => {
        state.unitWeight = btn.dataset.value;
        updateUnitToggle('weight', state.unitWeight);
        renderItemsTable();
        updateURL();
      });
    });

    // Add row
    document.getElementById('btn-add-row').addEventListener('click', addRow);

    // Reset
    document.getElementById('btn-reset').addEventListener('click', () => {
      resetToDefaults();
      renderSettings();
      renderItemsTable();
      recalculate();
      updateURL();
      showToast('기본값으로 초기화되었습니다', 'success');
    });

    // Share
    document.getElementById('btn-share').addEventListener('click', () => {
      const url = Storage.getShareURL(getCurrentState());
      navigator.clipboard.writeText(url).then(() => {
        showToast('링크가 클립보드에 복사되었습니다!', 'success');
      }).catch(() => {
        prompt('링크를 복사하세요:', url);
      });
    });

    // Save scenario
    document.getElementById('btn-save').addEventListener('click', showSaveModal);

    // Load scenario
    document.getElementById('btn-load').addEventListener('click', showLoadModal);

    // Export JSON
    document.getElementById('btn-export').addEventListener('click', () => {
      Storage.exportJSON(getCurrentState());
      showToast('JSON 파일 내보내기 완료', 'success');
    });

    // Import JSON
    document.getElementById('btn-import').addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (e) => {
        try {
          const importedState = await Storage.importJSON(e.target.files[0]);
          state = migrateState(importedState);
          itemIdCounter = state.items.length;
          renderSettings();
          renderItemsTable();
          recalculate();
          updateURL();
          showToast('JSON 파일 가져오기 완료', 'success');
        } catch (err) {
          showToast('파일 오류: ' + err.message, 'error');
        }
      };
      input.click();
    });

    // Glossary
    document.getElementById('btn-glossary').addEventListener('click', showGlossaryModal);

    // Guide
    document.getElementById('btn-guide').addEventListener('click', showGuideModal);

    // Tooltip click support (mobile)
    document.addEventListener('click', (e) => {
      const tip = e.target.closest('.tip');
      document.querySelectorAll('.tip.active').forEach(t => {
        if (t !== tip) t.classList.remove('active');
      });
      if (tip) tip.classList.toggle('active');
    });

    // Set selector buttons (L / M / S / All)
    document.querySelectorAll('.btn-set').forEach(btn => {
      btn.addEventListener('click', () => loadSet(btn.dataset.set));
    });

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b =>
          b.classList.toggle('active', b.dataset.tab === tabId));
        document.querySelectorAll('.tab-content').forEach(el =>
          el.classList.toggle('active', el.id === 'tab-' + tabId));
      });
    });
  }

  // ─── Modals ─────────────────────────────────────────────────────

  function showSaveModal() {
    const overlay = document.getElementById('modal-overlay');
    const modal = document.getElementById('modal-content');
    modal.innerHTML = `
      <h3>💾 시나리오 저장</h3>
      <input type="text" id="scenario-name-input" placeholder="시나리오 이름 입력..." autofocus>
      <div class="modal-actions">
        <button class="btn" onclick="UI.closeModal()">취소</button>
        <button class="btn btn-primary" onclick="UI.doSave()">저장</button>
      </div>
    `;
    overlay.classList.add('active');
    setTimeout(() => document.getElementById('scenario-name-input')?.focus(), 100);
  }

  function doSave() {
    const name = document.getElementById('scenario-name-input')?.value?.trim();
    if (!name) { showToast('이름을 입력하세요', 'error'); return; }
    Storage.saveScenario(name, getCurrentState());
    closeModal();
    showToast(`"${name}" 저장 완료`, 'success');
  }

  function showLoadModal() {
    const overlay = document.getElementById('modal-overlay');
    const modal = document.getElementById('modal-content');
    const scenarios = Storage.getScenarios();

    let listHtml = '';
    if (scenarios.length === 0) {
      listHtml = '<p style="color:var(--text-m); text-align:center; padding:2rem;">저장된 시나리오 없음</p>';
    } else {
      listHtml = '<div class="scenario-list">';
      scenarios.forEach(s => {
        const date = new Date(s.savedAt).toLocaleDateString('ko-KR');
        listHtml += `
          <div class="scenario-item" onclick="UI.doLoad('${escHtml(s.name)}')">
            <div>
              <div class="name">${escHtml(s.name)}</div>
              <div class="date">${date}</div>
            </div>
            <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); UI.doDelete('${escHtml(s.name)}')">삭제</button>
          </div>
        `;
      });
      listHtml += '</div>';
    }

    modal.innerHTML = `
      <h3>📂 시나리오 불러오기</h3>
      ${listHtml}
      <div class="modal-actions">
        <button class="btn" onclick="UI.closeModal()">닫기</button>
      </div>
    `;
    overlay.classList.add('active');
  }

  function doLoad(name) {
    const loaded = Storage.loadScenario(name);
    if (!loaded) { showToast('시나리오를 찾을 수 없습니다', 'error'); return; }

    state = migrateState(loaded);
    itemIdCounter = state.items.length;
    renderSettings();
    renderItemsTable();
    recalculate();
    updateURL();
    closeModal();
    showToast(`"${name}" 불러오기 완료`, 'success');
  }

  function doDelete(name) {
    Storage.deleteScenario(name);
    showLoadModal();
    showToast(`"${name}" 삭제 완료`, 'success');
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.remove('active');
  }

  // ─── Help Modals ────────────────────────────────────────────────

  function showGlossaryModal() {
    const overlay = document.getElementById('modal-overlay');
    const modal = document.getElementById('modal-content');

    modal.innerHTML = `
  <div class="help-modal">
    <h3>📖 배송 용어 사전</h3>

    <div class="help-section">
      <h4>🇺🇸 US — 공통 용어</h4>
      <div class="term-row">
        <div class="term-name">DIM Weight<br>(부피중량)</div>
        <div class="term-desc">박스 크기로 환산한 중량입니다.<br><strong>각 변(inch) 올림 후 L × W × H ÷ 139</strong><br>박스가 크고 가벼운 경우, 실제 중량 대신 부피중량이 적용됩니다.</div>
      </div>
      <div class="term-row">
        <div class="term-name">Billable Weight<br>(청구중량)</div>
        <div class="term-desc"><strong>실중량과 부피중량 중 큰 값</strong>이 청구중량이 됩니다. 이 중량을 기준으로 운임을 산정합니다.</div>
      </div>
      <div class="term-row">
        <div class="term-name">Girth<br>(둘레)</div>
        <div class="term-desc"><strong>최장변 + 2 × (높이 + 너비)</strong><br>택배 크기를 판정하는 기준입니다. FedEx와 Amazon 모두 같은 공식 사용.</div>
      </div>
      <div class="term-row">
        <div class="term-name">Zone<br>(배송 구간)</div>
        <div class="term-desc">출발지에서 도착지까지의 <strong>거리에 따른 구간(2~8)</strong>입니다.</div>
      </div>
      <div class="term-row">
        <div class="term-name">Fuel Surcharge<br>(연료할증)</div>
        <div class="term-desc"><strong>FedEx:</strong> 기본운임 × 사용자 입력 %<br><strong>Amazon:</strong> 주간 경유가격 기준 자동 산정 (14.5~18%)</div>
      </div>
      <div class="term-row">
        <div class="term-name">Residential<br>(주거지 할증)</div>
        <div class="term-desc"><strong>FedEx:</strong> 주거지 배송 시 개당 $5.95 추가<br><strong>Amazon:</strong> 없음</div>
      </div>
      <div class="term-row">
        <div class="term-name">DAS<br>(배송지역 할증)</div>
        <div class="term-desc">
          통합 4단계로 비교합니다:<br>
          <strong>Delivery Area:</strong> FedEx $4.20/$6.20 | Amazon $4.45<br>
          <strong>Extended:</strong> FedEx $5.25/$8.30 | Amazon $5.55<br>
          <strong>Remote:</strong> FedEx $15.50 | Amazon $16.75
        </div>
      </div>
    </div>

    <div class="help-section">
      <h4>⚠️ US — FedEx Ground 추가 수수료</h4>
      <div class="term-row">
        <div class="term-name">AHS-Dim</div>
        <div class="term-desc">최장변 > 48" / 둘째변 > 30" / L+Girth > 105"<br>Zone별 $28~$38. 최소 청구중량 40lb.</div>
      </div>
      <div class="term-row">
        <div class="term-name">AHS-Wgt</div>
        <div class="term-desc">실중량 > 50lb. Zone별 $43.50~$55.</div>
      </div>
      <div class="term-row">
        <div class="term-name">Oversize</div>
        <div class="term-desc">최장변 > 96" / L+Girth > 130". Zone별 $240~$305. 최소 청구중량 90lb.</div>
      </div>
      <div class="term-row">
        <div class="term-name">Unauthorized</div>
        <div class="term-desc">최장변 > 108" / L+Girth > 165" / 실중량 > 150lb. 정액 $1,775.</div>
      </div>
    </div>

    <div class="help-section">
      <h4>📦 US — Amazon Shipping 추가 수수료</h4>
      <div class="term-row">
        <div class="term-name">NonStandard</div>
        <div class="term-desc">최장변 > 37" / 둘째변 > 30" / 셋째변 > 24"<br>Zone그룹별 $11~$14.15</div>
      </div>
      <div class="term-row">
        <div class="term-name">AHS-Dim</div>
        <div class="term-desc">최장변 > 47" / 둘째변 > 42" / Girth > 105"<br>Zone그룹별 $29.26~$37.57</div>
      </div>
      <div class="term-row">
        <div class="term-name">AHS-Wgt</div>
        <div class="term-desc">실중량 > 50lb. Zone그룹별 $45.89~$55.20</div>
      </div>
      <div class="term-row">
        <div class="term-name">LargePkg</div>
        <div class="term-desc">Girth > 130" / 최장변 > 96". Zone그룹별 $255~$320. 최소 청구중량 90lb.</div>
      </div>
      <div class="term-row">
        <div class="term-name">ExtraHeavy</div>
        <div class="term-desc">실중량 > 150lb / Girth > 165" / 최장변 > 108". 정액 $1,875</div>
      </div>
    </div>

    <div class="help-section">
      <h4>🇯🇵 Japan — 공통 용어</h4>
      <div class="term-row">
        <div class="term-name">3변합<br>(3辺合計)</div>
        <div class="term-desc"><strong>가로 + 세로 + 높이(cm)</strong>의 합계입니다. 일본 택배 사이즈 판정의 핵심 기준.</div>
      </div>
      <div class="term-row">
        <div class="term-name">Size<br>(사이즈 등급)</div>
        <div class="term-desc">3변합과 중량 중 더 큰 사이즈 적용 (Yamato 표준/Sagawa 표준). Sagawa 라지(170~)는 3변합 기준만 + 중량할증 별도.</div>
      </div>
      <div class="term-row">
        <div class="term-name">현내배송</div>
        <div class="term-desc">Yamato 전용. 같은 현 내 배송 시 할인 운임. Sagawa는 별도 할인 없음 (표준 요율). 오키나와 제외.</div>
      </div>
      <div class="term-row">
        <div class="term-name">Cool 서비스</div>
        <div class="term-desc">냉장(0~10°C) 또는 냉동(-15°C). <strong>Yamato Size≤120</strong>, <strong>Sagawa Size≤140</strong>까지 가능. 사이즈별 추가 요금.</div>
      </div>
    </div>

    <div class="help-section">
      <h4>🟥 Yamato TA-Q-BIN</h4>
      <div class="term-row">
        <div class="term-name">최대 한도</div>
        <div class="term-desc">3변합 200cm, 최장변 170cm, 중량 30kg.</div>
      </div>
      <div class="term-row">
        <div class="term-name">사이즈 등급</div>
        <div class="term-desc">60/80/100/120/140/160/180/200. MAX(3변합 tier, 중량 tier) 적용.</div>
      </div>
      <div class="term-row">
        <div class="term-name">결제 방법</div>
        <div class="term-desc">현금/캐시리스 — 캐시리스가 ¥1~5 저렴.</div>
      </div>
      <div class="term-row">
        <div class="term-name">당일 배송</div>
        <div class="term-desc">전국 +¥550, 오키나와 +¥330.</div>
      </div>
      <div class="term-row">
        <div class="term-name">4종 할인</div>
        <div class="term-desc">지참(-¥110) / 디지털(-¥60) / 복수구(-¥100) / 영업소수취(-¥60). 중복 적용 가능.</div>
      </div>
    </div>

    <div class="help-section">
      <h4>🟦 Sagawa 飛脚宅配便 / ラージサイズ</h4>
      <div class="term-row">
        <div class="term-name">표준 (飛脚宅配便)</div>
        <div class="term-desc">3변합 ≤160cm AND 중량 ≤30kg → Size 60/80/100/140/160.</div>
      </div>
      <div class="term-row">
        <div class="term-name">라지 (飛脚ラージサイズ)</div>
        <div class="term-desc">3변합 >160cm OR 중량 >30kg → Size 170/180/200/220/240/260. 최대 3변합 260cm, 중량 50kg.</div>
      </div>
      <div class="term-row">
        <div class="term-name">중량 할증</div>
        <div class="term-desc">라지 서비스만 적용. 30~40kg +¥270, 40~50kg +¥540 (1개당).</div>
      </div>
      <div class="term-row">
        <div class="term-name">영업소 반입</div>
        <div class="term-desc">영업소에 직접 반입 시 1개당 -¥100. 계약운임/대금인환 제외.</div>
      </div>
      <div class="term-row">
        <div class="term-name">연료할증</div>
        <div class="term-desc">국내(飛脚宅配便)는 별도 연료할증 없음 (요율에 이미 포함). 국제만 18% 별도.</div>
      </div>
    </div>

    <div class="tip-box">
      <strong>💡 참고:</strong><br>
      • US: 추가 수수료는 품목당 1종류만 적용됩니다. 우선순위가 높은 것만 부과.<br>
      • Japan: 출발/도착지 선택은 Sagawa 13지역 기준. Yamato 호출 시 北/南九州→九州, 東海→中部 자동 매핑.<br>
      • 비교 결과 차이 컬럼: 양수(빨강) = Sagawa가 비쌈, 음수(초록) = Sagawa가 저렴.
    </div>

    <div class="close-row">
      <button class="btn" onclick="UI.closeModal()">닫기</button>
    </div>
  </div>
`;
    overlay.classList.add('active');
  }

  function showGuideModal() {
    const overlay = document.getElementById('modal-overlay');
    const modal = document.getElementById('modal-content');
    modal.innerHTML = `
  <div class="help-modal">
    <h3>❓ 사용 가이드</h3>

    <div class="help-section">
      <h4>📋 공통 — 품목 입력</h4>
      <div class="step-row">
        <span class="step-num">1</span>
        <div class="step-content">
          <div class="step-title">품목 입력 (양 탭 공통)</div>
          <div class="step-detail">상단의 품목 테이블에 제품명, 가로/세로/높이, 중량, 수량을 입력합니다.<br>
          <strong>세트 버튼(All/L/M/S)</strong>으로 기본 품목을 빠르게 불러올 수 있습니다.<br>
          <strong>치수 단위(mm/cm/inch)</strong>와 <strong>중량 단위(kg/lb)</strong>를 전환할 수 있습니다.<br>
          품목은 US 탭과 Japan 탭에서 <strong>동일하게 공유</strong>됩니다.</div>
        </div>
      </div>
    </div>

    <div class="help-section">
      <h4>🇺🇸 US Domestic — FedEx vs Amazon 비교</h4>
      <div class="step-row">
        <span class="step-num">2</span>
        <div class="step-content">
          <div class="step-title">US 배송 설정</div>
          <div class="step-detail"><strong>Zone(2~8)</strong>과 <strong>DAS 티어</strong>를 선택합니다. 두 배송사에 동시 적용됩니다.</div>
        </div>
      </div>
      <div class="step-row">
        <span class="step-num">3</span>
        <div class="step-content">
          <div class="step-title">배송사별 설정</div>
          <div class="step-detail"><strong>FedEx:</strong> 연료할증률(%)을 직접 입력하고, Residential 체크박스를 설정합니다.<br><strong>Amazon:</strong> 경유가격($/갤런)을 선택하면 자동으로 연료할증률이 산정됩니다.</div>
        </div>
      </div>
      <div class="step-row">
        <span class="step-num">4</span>
        <div class="step-content">
          <div class="step-title">비교 결과 확인</div>
          <div class="step-detail">동일 품목에 대한 FedEx와 Amazon의 배송비를 나란히 비교합니다.<br>차이 금액과 그래프로 어느 배송사가 유리한지 즉시 확인할 수 있습니다.</div>
        </div>
      </div>
    </div>

    <div class="help-section">
      <h4>🇯🇵 Japan Domestic — Yamato vs Sagawa 비교</h4>
      <div class="step-row">
        <span class="step-num">5</span>
        <div class="step-content">
          <div class="step-title">JP 경로 설정 (공통)</div>
          <div class="step-detail">출발지와 도착지를 선택합니다 (Sagawa 13지역 기준). Yamato는 자동으로 12지역으로 매핑됩니다.<br>Cool 서비스도 두 배송사 동시 적용. 동일 현내 체크 시 Yamato에만 할인 운임 적용.</div>
        </div>
      </div>
      <div class="step-row">
        <span class="step-num">6</span>
        <div class="step-content">
          <div class="step-title">배송사별 설정</div>
          <div class="step-detail"><strong>Yamato:</strong> 결제(현금/캐시리스), 4종 할인(지참/디지털/복수구/영업소수취), 당일 배송.<br><strong>Sagawa:</strong> 영업소 반입 할인 (-¥100/개).</div>
        </div>
      </div>
      <div class="step-row">
        <span class="step-num">7</span>
        <div class="step-content">
          <div class="step-title">비교 결과 확인</div>
          <div class="step-detail">동일 화물에 대한 Yamato와 Sagawa 사이즈 판정/요율/할증/할인/합계를 한 행에서 비교합니다.<br>요약 표에서 비용 구성별 차이와 총 배송비 차이(%)를 확인할 수 있습니다.<br>각 배송사 한도 초과 품목은 별도 에러로 표시됩니다.</div>
        </div>
      </div>
    </div>

    <div class="tip-box">
      <strong>💡 팁:</strong><br>
      • <strong>US 차이 컬럼:</strong> 양수(빨강) = Amazon이 비쌈, 음수(초록) = Amazon이 저렴<br>
      • <strong>품목 공유:</strong> 품목을 변경하면 US와 Japan 결과가 모두 자동 업데이트됩니다.<br>
      • <strong>💾 저장</strong>으로 시나리오를 로컬에 저장하고, <strong>🔗 공유</strong>로 URL을 복사할 수 있습니다.<br>
      • <strong>⬇ Export</strong>로 JSON 파일을 내보내고, <strong>⬆ Import</strong>로 불러올 수 있습니다.<br>
      • 각 설정의 <strong>ⓘ</strong> 아이콘에 마우스를 올리면 용어 설명을 볼 수 있습니다.
    </div>

    <div class="close-row">
      <button class="btn" onclick="UI.closeModal()">닫기</button>
    </div>
  </div>
`;
    overlay.classList.add('active');
  }

  // ─── Toast ──────────────────────────────────────────────────────

  function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = 'toast show ' + type;
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  // ─── Helpers ────────────────────────────────────────────────────

  function fmt(n) {
    return (Math.round(n * 100) / 100).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function fmtDiff(n) {
    const abs = Math.abs(n);
    if (abs < 0.005) return '$0.00';
    const sign = n > 0 ? '+' : '-';
    return sign + '$' + fmt(abs);
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function scTypeToClass(type) {
    const map = {
      'OK': 'sc-tag--ok',
      'AHS-Dim': 'sc-tag--ahs-dim',
      'AHS-Wgt': 'sc-tag--ahs-wgt',
      'Oversize': 'sc-tag--oversize',
      'Unauth': 'sc-tag--unauth',
      'NonStd': 'sc-tag--nonstd',
      'LargePkg': 'sc-tag--largepkg',
      'ExtraHeavy': 'sc-tag--extraheavy',
    };
    return map[type] || '';
  }

  // ─── Public API ─────────────────────────────────────────────────

  function getItems() {
    return state ? state.items : [];
  }

  return {
    init, addRow, deleteRow, duplicateRow, getItems,
    doSave, doLoad, doDelete, closeModal, showToast,
    showGlossaryModal, showGuideModal,
  };
})();

document.addEventListener('DOMContentLoaded', UI.init);
