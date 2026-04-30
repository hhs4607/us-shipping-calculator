/**
 * JP UI Controller — Japan Domestic Shipping Tab
 * V8: Side-by-side comparison of Yamato TA-Q-BIN vs Sagawa Hikyaku Takuhaibin.
 *
 * Origin/Destination selector uses Sagawa's 13-region split (more granular).
 * For Yamato calls, regions map down via SAGAWA_TO_YAMATO_REGION (kita_kyushu,
 * minami_kyushu → kyushu; tokai → chubu).
 *
 * Items come from UI module (shared with US tab).
 */

const JpUI = (() => {
  let yamatoData = null;
  let sagawaData = null;
  let state = null;

  // ─── Utilities ──────────────────────────────────────────────────

  function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function round1(n) { return Math.round(n * 10) / 10; }
  function fmtJpy(n) { return Math.round(n).toLocaleString('ja-JP'); }
  function fmtJpyDiff(n) {
    const abs = Math.abs(n);
    if (abs < 0.5) return '¥0';
    return (n > 0 ? '+¥' : '-¥') + fmtJpy(abs);
  }

  const DISCOUNT_KO = {
    dropoff: '지참할인', digital: '디지털할인',
    multi_package: '복수구할인', branch_pickup: '영업소수취',
    member_dropoff: '회원지참할인',
  };

  function toast(msg, type) {
    if (typeof UI !== 'undefined' && UI.showToast) UI.showToast(msg, type);
  }

  // Map Sagawa-region id → Yamato-region id
  function toYamatoRegion(sagawaId) {
    return (typeof SAGAWA_TO_YAMATO_REGION !== 'undefined'
      ? SAGAWA_TO_YAMATO_REGION[sagawaId]
      : sagawaId) || sagawaId;
  }

  // ─── Initialization ─────────────────────────────────────────────

  async function init() {
    try {
      const both = await DataLoader.loadJp();
      yamatoData = both.yamato;
      sagawaData = both.sagawa;
    } catch (e) {
      console.error('JP data load failed:', e);
      return;
    }

    resetToDefaults();
    populateZones();
    renderSettings();
    bindEvents();
  }

  function resetToDefaults() {
    const sd = sagawaData.defaults || {};
    state = {
      origin: sd.origin || 'kanto',
      destination: sd.destination || 'kansai',
      samePrefecture: false,
      coolType: 'none',
      // Yamato-specific
      ymPayment: 'cash',
      ymSameDay: false,
      ymDiscounts: [],
      // Sagawa-specific
      sgBranchDropoff: false,
    };
  }

  function populateZones() {
    // Use Sagawa's 13-region list as the user-facing selector
    const zones = sagawaData.zones;
    const originSel = document.getElementById('jp-origin');
    const destSel = document.getElementById('jp-destination');

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
    document.getElementById('jp-origin').value = state.origin;
    document.getElementById('jp-destination').value = state.destination;
    document.getElementById('jp-same-pref').checked = state.samePrefecture;
    document.getElementById('jp-cool').value = state.coolType;

    document.querySelectorAll('#ym-payment button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === state.ymPayment);
    });

    document.getElementById('ym-sameday').checked = state.ymSameDay;
    document.querySelectorAll('[data-discount]').forEach(cb => {
      cb.checked = state.ymDiscounts.includes(cb.dataset.discount);
    });

    document.getElementById('sg-branch').checked = state.sgBranchDropoff;
  }

  // ─── Calculation ───────────────────────────────────────────────

  function recalculateWithItems(items) {
    if (!yamatoData || !sagawaData) return;

    const calcItems = items.map(item => ({
      name: item.name,
      L_cm: item.L_mm / 10,
      W_cm: item.W_mm / 10,
      H_cm: item.H_mm / 10,
      weightKg: item.weightKg,
      qty: item.qty,
    }));

    const ymOrigin = toYamatoRegion(state.origin);
    const ymDest = toYamatoRegion(state.destination);

    const yamatoResult = yamatoCalcAll(
      calcItems, ymOrigin, ymDest,
      state.ymPayment, state.samePrefecture,
      state.coolType, state.ymSameDay, state.ymDiscounts,
      yamatoData.ratesCash, yamatoData.ratesCashless, yamatoData.ratesIntrapref,
      yamatoData.surcharges, yamatoData.discounts
    );

    const sagawaResult = sagawaCalcAll(
      calcItems, state.origin, state.destination,
      state.coolType, state.sgBranchDropoff,
      sagawaData.rates, sagawaData.surcharges
    );

    // Both calcAll filter qty>0 in identical order, so align the line arrays by counter.
    let activeIdx = 0;
    const paired = calcItems.map(item => {
      if (item.qty <= 0) {
        return { name: item.name, qty: item.qty, yamato: null, sagawa: null };
      }
      const ym = yamatoResult.lines[activeIdx] || null;
      const sg = sagawaResult.lines[activeIdx] || null;
      activeIdx++;
      return { name: item.name, qty: item.qty, yamato: ym, sagawa: sg };
    });

    renderResults(paired);
    renderSummary(yamatoResult, sagawaResult);
  }

  // ─── Results Table ────────────────────────────────────────────

  function renderResults(paired) {
    const tbody = document.getElementById('jp-result-tbody');
    tbody.innerHTML = '';

    paired.forEach((p, idx) => {
      const tr = document.createElement('tr');
      if (p.qty === 0) tr.style.opacity = '0.35';

      if (!p.yamato || !p.sagawa) {
        tr.innerHTML = `
          <td>${idx + 1}</td>
          <td class="cell-name">${escHtml(p.name)}</td>
          <td colspan="11" style="color:var(--text-m)">수량 0 — 계산 제외</td>
        `;
        tbody.appendChild(tr);
        return;
      }

      const ym = p.yamato;
      const sg = p.sagawa;

      const ymCell = renderCarrierCell(ym, 'yamato');
      const sgCell = renderCarrierCell(sg, 'sagawa');

      const bothOk = !ym.error && !sg.error;
      let diff = 0, diffHtml = '-';
      if (bothOk) {
        diff = sg.lineTotal - ym.lineTotal;
        const cls = diff > 0.5 ? 'diff-positive' : diff < -0.5 ? 'diff-negative' : 'diff-zero';
        diffHtml = `<span class="${cls}">${fmtJpyDiff(diff)}</span>`;
      }

      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td class="cell-name">${escHtml(p.name)}</td>
        ${ymCell}
        ${sgCell}
        <td>${diffHtml}</td>
        <td>${p.qty}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderCarrierCell(line, carrier) {
    const themeCls = carrier === 'yamato' ? 'yamato-cell' : 'sagawa-cell';

    if (line.error) {
      return `
        <td colspan="4" class="${themeCls} error-row">⚠️ ${escHtml(line.errorReason)}</td>
      `;
    }

    const tags = [];

    if (carrier === 'yamato') {
      // Size source rationale
      const sumWins = line.sumTier > line.weightTier;
      const wgtWins = line.weightTier > line.sumTier;
      const sizeLabel = line.appliedSize + (line.isIntrapref ? ' 현내' : '');
      if (sumWins) tags.push(`<span class="ym-tag ym-tag--sum">3변합 ${line.sumTier}</span>`);
      else if (wgtWins) tags.push(`<span class="ym-tag ym-tag--weight">중량▲ ${line.weightTier}</span>`);
      else tags.push(`<span class="ym-tag ym-tag--equal">${line.appliedSize}</span>`);
      if (line.coolError) tags.push(`<span class="ym-tag ym-tag--cool-err">Cool불가</span>`);
      line.discountDetails.forEach(d => {
        const label = DISCOUNT_KO[d.key] || d.name;
        tags.push(`<span class="ym-tag ym-tag--discount">${escHtml(label)}</span>`);
      });

      const surcharge = line.coolSurcharge + line.sameDaySurcharge;
      const discount = line.discountTotal;
      const surchargeHtml = surcharge > 0 ? `+¥${fmtJpy(surcharge)}` : '-';
      const discountHtml = discount < 0 ? `<span class="discount-amount">¥${fmtJpy(discount)}</span>` : '-';

      return `
        <td class="${themeCls}"><strong>${sizeLabel}</strong></td>
        <td class="${themeCls}">¥${fmtJpy(line.baseRate)}</td>
        <td class="${themeCls} jp-tag-cell">${tags.join(' ')}<br><span class="adj-line">${surchargeHtml} ${discountHtml}</span></td>
        <td class="${themeCls}"><strong>¥${fmtJpy(line.perPkgTotal)}</strong></td>
      `;
    } else {
      // Sagawa
      const tier = line.serviceTier === 'large' ? '<span class="sg-tag sg-tag--large">L</span>' : '<span class="sg-tag sg-tag--std">S</span>';
      const sizeLabel = `${line.appliedSize} ${tier}`;
      if (line.coolError) tags.push(`<span class="sg-tag sg-tag--cool-err">Cool불가</span>`);
      if (line.weightSurcharge > 0) tags.push(`<span class="sg-tag sg-tag--weight">중량할증 +¥${fmtJpy(line.weightSurcharge)}</span>`);
      if (line.coolSurcharge > 0) tags.push(`<span class="sg-tag sg-tag--cool">Cool +¥${fmtJpy(line.coolSurcharge)}</span>`);
      if (line.branchDiscount < 0) tags.push(`<span class="sg-tag sg-tag--discount">영업소반입 ¥${fmtJpy(line.branchDiscount)}</span>`);

      return `
        <td class="${themeCls}">${sizeLabel}</td>
        <td class="${themeCls}">¥${fmtJpy(line.baseRate)}</td>
        <td class="${themeCls} jp-tag-cell">${tags.join(' ') || '-'}</td>
        <td class="${themeCls}"><strong>¥${fmtJpy(line.perPkgTotal)}</strong></td>
      `;
    }
  }

  // ─── Summary ──────────────────────────────────────────────────

  function renderSummary(ym, sg) {
    const ymActive = ym.lines.filter(l => !l.error && l.qty > 0).length;
    const sgActive = sg.lines.filter(l => !l.error && l.qty > 0).length;
    const totalQty = ym.lines.reduce((s, l) => s + l.qty, 0);
    document.getElementById('jp-sum-count').textContent =
      `${Math.max(ymActive, sgActive)}건 / ${totalQty}개`;

    setRow('base', ym.baseSubtotal, sg.baseSubtotal);
    setRow('cool', ym.coolSubtotal, sg.coolSubtotal);
    setRow('weight', 0, sg.weightSubtotal);
    setRow('sameday', ym.sameDaySubtotal, 0);
    setRow('discount', ym.discountSubtotal, sg.branchSubtotal);
    setGrand(ym.grandTotal, sg.grandTotal);

    const zones = sagawaData.zones;
    const orig = zones.find(z => z.id === state.origin);
    const dest = zones.find(z => z.id === state.destination);
    const payLabel = state.ymPayment === 'cash' ? '현금' : '캐시리스';
    const samePrefLabel = state.samePrefecture ? ' | 현내배송' : '';
    document.getElementById('jp-sum-route').textContent =
      `${orig?.name_ja || ''} → ${dest?.name_ja || ''} | Yamato ${payLabel}${samePrefLabel}`;
  }

  function setRow(key, ymVal, sgVal) {
    document.getElementById('jp-sum-ym-' + key).textContent =
      ymVal === 0 ? '-' : (ymVal < 0 ? '¥' + fmtJpy(ymVal) : '¥' + fmtJpy(ymVal));
    document.getElementById('jp-sum-sg-' + key).textContent =
      sgVal === 0 ? '-' : (sgVal < 0 ? '¥' + fmtJpy(sgVal) : '¥' + fmtJpy(sgVal));
    const diff = sgVal - ymVal;
    const el = document.getElementById('jp-sum-diff-' + key);
    if (Math.abs(diff) < 0.5) {
      el.textContent = '-';
      el.className = 'diff-cell diff-zero';
    } else {
      el.textContent = fmtJpyDiff(diff);
      el.className = 'diff-cell ' + (diff > 0 ? 'diff-positive' : 'diff-negative');
    }
  }

  function setGrand(ymTotal, sgTotal) {
    document.getElementById('jp-sum-ym-grand').textContent = '¥' + fmtJpy(ymTotal);
    document.getElementById('jp-sum-sg-grand').textContent = '¥' + fmtJpy(sgTotal);
    const diff = sgTotal - ymTotal;
    const pct = ymTotal > 0 ? (diff / ymTotal * 100) : 0;
    const el = document.getElementById('jp-sum-diff-grand');
    const pctStr = Math.abs(pct) >= 0.5 ? ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)` : '';
    el.textContent = fmtJpyDiff(diff) + pctStr;
    el.className = 'diff-cell ' + (diff > 0.5 ? 'diff-positive' : diff < -0.5 ? 'diff-negative' : 'diff-zero');
  }

  // ─── Events ───────────────────────────────────────────────────

  function onSettingChange() {
    if (typeof UI !== 'undefined' && UI.getItems) {
      recalculateWithItems(UI.getItems());
    }
  }

  function bindEvents() {
    document.getElementById('jp-origin').addEventListener('change', e => { state.origin = e.target.value; onSettingChange(); });
    document.getElementById('jp-destination').addEventListener('change', e => { state.destination = e.target.value; onSettingChange(); });
    document.getElementById('jp-same-pref').addEventListener('change', e => { state.samePrefecture = e.target.checked; onSettingChange(); });
    document.getElementById('jp-cool').addEventListener('change', e => { state.coolType = e.target.value; onSettingChange(); });

    document.querySelectorAll('#ym-payment button').forEach(btn => {
      btn.addEventListener('click', () => {
        state.ymPayment = btn.dataset.value;
        document.querySelectorAll('#ym-payment button').forEach(b => b.classList.toggle('active', b === btn));
        onSettingChange();
      });
    });

    document.getElementById('ym-sameday').addEventListener('change', e => { state.ymSameDay = e.target.checked; onSettingChange(); });

    document.querySelectorAll('[data-discount]').forEach(cb => {
      cb.addEventListener('change', () => {
        state.ymDiscounts = Array.from(document.querySelectorAll('[data-discount]:checked'))
          .map(c => c.dataset.discount);
        onSettingChange();
      });
    });

    document.getElementById('sg-branch').addEventListener('change', e => { state.sgBranchDropoff = e.target.checked; onSettingChange(); });
  }

  // ─── Public API ───────────────────────────────────────────────

  return { init, recalculateWithItems };
})();
