/**
 * Yamato UI Controller — Japan Domestic Shipping Tab
 * V7: Items are shared from UI module. This module handles only
 * Yamato-specific settings, calculation, and result rendering.
 * Depends on: DataLoader, yamato-calculator.js globals.
 */

const YamatoUI = (() => {
  let data = null;
  let state = null;

  // ─── Utilities ──────────────────────────────────────────────────

  function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  function fmtJpy(n) {
    return Math.round(n).toLocaleString('ja-JP');
  }

  function toast(msg, type) {
    if (typeof UI !== 'undefined' && UI.showToast) {
      UI.showToast(msg, type);
    }
  }

  // ─── Initialization ─────────────────────────────────────────────

  async function init() {
    try {
      data = await DataLoader.loadYamato();
    } catch (e) {
      console.error('Yamato data load failed:', e);
      return;
    }

    resetToDefaults();
    populateZones();
    renderSettings();
    bindEvents();
  }

  function resetToDefaults() {
    const d = data.defaults;
    state = {
      origin: d.origin || 'kanto',
      destination: d.destination || 'kansai',
      payment: d.payment || 'cash',
      samePrefecture: false,
      coolType: 'none',
      sameDay: false,
      discounts: [],
    };
  }

  function populateZones() {
    const zones = data.zones;
    const originSel = document.getElementById('ym-origin');
    const destSel = document.getElementById('ym-destination');

    [originSel, destSel].forEach(sel => {
      sel.innerHTML = '';
      zones.forEach(z => {
        const opt = document.createElement('option');
        opt.value = z.id;
        opt.textContent = `${z.name_ja} (${z.name_en})`;
        sel.appendChild(opt);
      });
    });

    originSel.value = state.origin;
    destSel.value = state.destination;
  }

  // ─── Settings ─────────────────────────────────────────────────

  function renderSettings() {
    document.getElementById('ym-origin').value = state.origin;
    document.getElementById('ym-destination').value = state.destination;
    document.getElementById('ym-same-pref').checked = state.samePrefecture;
    document.getElementById('ym-cool').value = state.coolType;
    document.getElementById('ym-sameday').checked = state.sameDay;

    document.querySelectorAll('#ym-payment button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === state.payment);
    });

    document.querySelectorAll('[data-discount]').forEach(cb => {
      cb.checked = state.discounts.includes(cb.dataset.discount);
    });
  }

  // ─── Calculation (receives items from UI) ───────────────────────

  function recalculateWithItems(items) {
    if (!data) return;

    const calcItems = items.map(item => ({
      name: item.name,
      L_cm: item.L_mm / 10,
      W_cm: item.W_mm / 10,
      H_cm: item.H_mm / 10,
      weightKg: item.weightKg,
      qty: item.qty,
    }));

    const result = yamatoCalcAll(
      calcItems,
      state.origin,
      state.destination,
      state.payment,
      state.samePrefecture,
      state.coolType,
      state.sameDay,
      state.discounts,
      data.ratesCash,
      data.ratesCashless,
      data.ratesIntrapref,
      data.surcharges,
      data.discounts
    );

    renderResults(result);
    renderSummary(result);
  }

  // ─── Results Table ────────────────────────────────────────────

  function renderResults(result) {
    const tbody = document.getElementById('ym-result-tbody');
    tbody.innerHTML = '';

    result.lines.forEach((line, idx) => {
      const tr = document.createElement('tr');

      if (line.error) {
        tr.innerHTML = `
          <td>${idx + 1}</td>
          <td class="cell-name">${escHtml(line.name)}</td>
          <td colspan="10" class="error-row">\u26a0\ufe0f ${escHtml(line.errorReason)}</td>
        `;
      } else {
        const coolStr = line.coolSurcharge > 0 ? '\u00a5' + fmtJpy(line.coolSurcharge) : '-';
        const discountStr = line.discountTotal < 0 ? '\u00a5' + fmtJpy(line.discountTotal) : '-';
        const sizeLabel = line.appliedSize + (line.isIntrapref ? ' 현내' : '');

        tr.innerHTML = `
          <td>${idx + 1}</td>
          <td class="cell-name">${escHtml(line.name)}</td>
          <td>${round1(line.L_cm)}\u00d7${round1(line.W_cm)}\u00d7${round1(line.H_cm)}</td>
          <td>${line.weightKg}</td>
          <td>${line.threeSideSum}</td>
          <td><strong>${sizeLabel}</strong></td>
          <td>\u00a5${fmtJpy(line.baseRate)}</td>
          <td>${coolStr}</td>
          <td>${discountStr}</td>
          <td><strong>\u00a5${fmtJpy(line.perPkgTotal)}</strong></td>
          <td>${line.qty}</td>
          <td><strong>\u00a5${fmtJpy(line.lineTotal)}</strong></td>
        `;
      }

      if (line.qty === 0) tr.style.opacity = '0.35';
      tbody.appendChild(tr);
    });
  }

  // ─── Summary ──────────────────────────────────────────────────

  function renderSummary(result) {
    const activeLines = result.lines.filter(l => !l.error && l.qty > 0);
    const totalQty = activeLines.reduce((s, l) => s + l.qty, 0);
    document.getElementById('ym-sum-count').textContent =
      activeLines.length + '\uac74 / ' + totalQty + '\uac1c';

    document.getElementById('ym-sum-base').textContent = '\u00a5' + fmtJpy(result.baseSubtotal);
    document.getElementById('ym-sum-cool').textContent = '\u00a5' + fmtJpy(result.coolSubtotal);
    document.getElementById('ym-sum-sameday').textContent = '\u00a5' + fmtJpy(result.sameDaySubtotal);
    document.getElementById('ym-sum-discount').textContent =
      result.discountSubtotal < 0 ? '\u00a5' + fmtJpy(result.discountSubtotal) : '\u00a50';
    document.getElementById('ym-sum-grand').textContent = '\u00a5' + fmtJpy(result.grandTotal);

    const zones = data.zones;
    const orig = zones.find(z => z.id === state.origin);
    const dest = zones.find(z => z.id === state.destination);
    const payLabel = state.payment === 'cash' ? '현금' : '캐시리스';
    const samePrefLabel = state.samePrefecture ? ' | 현내배송' : '';
    document.getElementById('ym-sum-route').textContent =
      `${orig?.name_ja || ''} \u2192 ${dest?.name_ja || ''} | ${payLabel}${samePrefLabel}`;
  }

  // ─── Events ───────────────────────────────────────────────────

  function onSettingChange() {
    // Trigger recalculation with current shared items from UI
    if (typeof UI !== 'undefined' && UI.getItems) {
      recalculateWithItems(UI.getItems());
    }
  }

  function bindEvents() {
    document.getElementById('ym-origin').addEventListener('change', (e) => {
      state.origin = e.target.value;
      onSettingChange();
    });

    document.getElementById('ym-destination').addEventListener('change', (e) => {
      state.destination = e.target.value;
      onSettingChange();
    });

    document.getElementById('ym-same-pref').addEventListener('change', (e) => {
      state.samePrefecture = e.target.checked;
      onSettingChange();
    });

    document.querySelectorAll('#ym-payment button').forEach(btn => {
      btn.addEventListener('click', () => {
        state.payment = btn.dataset.value;
        document.querySelectorAll('#ym-payment button').forEach(b =>
          b.classList.toggle('active', b === btn));
        onSettingChange();
      });
    });

    document.getElementById('ym-cool').addEventListener('change', (e) => {
      state.coolType = e.target.value;
      onSettingChange();
    });

    document.getElementById('ym-sameday').addEventListener('change', (e) => {
      state.sameDay = e.target.checked;
      onSettingChange();
    });

    document.querySelectorAll('[data-discount]').forEach(cb => {
      cb.addEventListener('change', () => {
        state.discounts = Array.from(document.querySelectorAll('[data-discount]:checked'))
          .map(c => c.dataset.discount);
        onSettingChange();
      });
    });
  }

  // ─── Public API ───────────────────────────────────────────────

  return { init, recalculateWithItems };
})();
