/**
 * JP UI Controller — Japan Domestic Shipping Tab
 * V8: Side-by-side comparison of Yamato vs Sagawa.
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
  let chartItemCompare = null;
  let chartCostBreakdown = null;

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
        const ko = z.name_ko || z.name_en || z.id;
        const en = z.name_en ? ` (${z.name_en})` : '';
        opt.textContent = ko + en;
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
    renderCharts(paired, yamatoResult, sagawaResult);
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

      // Decide per-row winner. Both OK → cheaper wins. One errors → other wins by default.
      let ymWin = false, sgWin = false;
      if (!ym.error && !sg.error) {
        if (sg.lineTotal < ym.lineTotal - 0.5) sgWin = true;
        else if (ym.lineTotal < sg.lineTotal - 0.5) ymWin = true;
      } else if (ym.error && !sg.error) {
        sgWin = true;
      } else if (sg.error && !ym.error) {
        ymWin = true;
      }

      // Size divergence (both ok but different appliedSize) — flag it.
      const sizeDivergent = !ym.error && !sg.error && ym.appliedSize !== sg.appliedSize;

      const ymCell = renderCarrierCell(ym, 'yamato', { winner: ymWin, sizeDivergent });
      const sgCell = renderCarrierCell(sg, 'sagawa', { winner: sgWin, sizeDivergent });

      // Diff cell: explicit winner annotation when one errored or they're not equal.
      let diffHtml = '-';
      if (!ym.error && !sg.error) {
        const diff = sg.lineTotal - ym.lineTotal;
        const cls = diff > 0.5 ? 'diff-positive' : diff < -0.5 ? 'diff-negative' : 'diff-zero';
        const arrow = diff > 0.5 ? 'Y▼' : diff < -0.5 ? 'S▼' : '=';
        diffHtml = `<span class="${cls}" title="Sagawa−Yamato">${arrow} ${fmtJpyDiff(diff)}</span>`;
      } else if (ym.error && !sg.error) {
        diffHtml = `<span class="diff-negative" title="Yamato 배송 불가">S▼ Y✗</span>`;
      } else if (sg.error && !ym.error) {
        diffHtml = `<span class="diff-positive" title="Sagawa 배송 불가">Y▼ S✗</span>`;
      } else {
        diffHtml = `<span class="diff-zero">둘 다 ✗</span>`;
      }

      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td class="cell-name">${escHtml(p.name)}</td>
        ${ymCell}
        ${sgCell}
        <td class="diff-cell">${diffHtml}</td>
        <td>${p.qty}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderCarrierCell(line, carrier, opts) {
    opts = opts || {};
    const themeCls = carrier === 'yamato' ? 'yamato-cell' : 'sagawa-cell';
    const winnerCls = opts.winner ? ' winner-cell' : '';

    if (line.error) {
      return `
        <td colspan="4" class="${themeCls} error-row">⚠️ ${escHtml(line.errorReason)}</td>
      `;
    }

    const tags = [];
    const sizeBadge = opts.winner ? ' <span class="winner-badge" title="이 화물은 이 배송사가 유리">★</span>' : '';
    const divergentCls = opts.sizeDivergent ? ' size-divergent' : '';

    if (carrier === 'yamato') {
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
      const adjParts = [];
      if (surcharge > 0) adjParts.push(`+¥${fmtJpy(surcharge)}`);
      if (discount < 0) adjParts.push(`<span class="discount-amount">¥${fmtJpy(discount)}</span>`);
      const adjLine = adjParts.length ? `<span class="adj-line">${adjParts.join(' ')}</span>` : '';

      return `
        <td class="${themeCls}${divergentCls}"><strong>${sizeLabel}</strong>${sizeBadge}</td>
        <td class="${themeCls}">¥${fmtJpy(line.baseRate)}</td>
        <td class="${themeCls} jp-tag-cell">${tags.join(' ')}${adjLine ? '<br>' + adjLine : ''}</td>
        <td class="${themeCls}${winnerCls}"><strong>¥${fmtJpy(line.perPkgTotal)}</strong></td>
      `;
    } else {
      const tier = line.serviceTier === 'large'
        ? '<span class="sg-tag sg-tag--large" title="대형 택배 (170~260)">대형</span>'
        : '<span class="sg-tag sg-tag--std" title="일반 택배 (60~160)">일반</span>';
      const sizeLabel = `${line.appliedSize} ${tier}`;
      if (line.coolError) tags.push(`<span class="sg-tag sg-tag--cool-err">Cool불가</span>`);
      if (line.weightSurcharge > 0) tags.push(`<span class="sg-tag sg-tag--weight">중량할증 +¥${fmtJpy(line.weightSurcharge)}</span>`);
      if (line.coolSurcharge > 0) tags.push(`<span class="sg-tag sg-tag--cool">냉장/냉동 +¥${fmtJpy(line.coolSurcharge)}</span>`);
      if (line.branchDiscount < 0) tags.push(`<span class="sg-tag sg-tag--discount">영업소반입 ¥${fmtJpy(line.branchDiscount)}</span>`);

      return `
        <td class="${themeCls}${divergentCls}">${sizeLabel}${sizeBadge}</td>
        <td class="${themeCls}">¥${fmtJpy(line.baseRate)}</td>
        <td class="${themeCls} jp-tag-cell">${tags.join(' ') || '-'}</td>
        <td class="${themeCls}${winnerCls}"><strong>¥${fmtJpy(line.perPkgTotal)}</strong></td>
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
    const samePrefLabel = state.samePrefecture ? ' | 현내 배송' : '';
    const orgName = orig?.name_ko || orig?.name_en || orig?.id || '';
    const destName = dest?.name_ko || dest?.name_en || dest?.id || '';
    document.getElementById('jp-sum-route').textContent =
      `${orgName} → ${destName} | 야마토 ${payLabel}${samePrefLabel}`;
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

  // ─── Charts ───────────────────────────────────────────────────

  function renderCharts(paired, ym, sg) {
    if (typeof Chart === 'undefined') return;
    renderItemCompareChart(paired);
    renderCostBreakdownChart(ym, sg);
  }

  function renderItemCompareChart(paired) {
    const ctx = document.getElementById('jp-chart-item-compare');
    if (!ctx) return;
    if (chartItemCompare) { chartItemCompare.destroy(); chartItemCompare = null; }

    const active = paired.filter(p => p.yamato && p.sagawa);
    if (!active.length) return;

    const labels = active.map(p => p.name || '(unnamed)');
    const ymTotals = active.map(p => p.yamato.error ? 0 : Math.round(p.yamato.lineTotal));
    const sgTotals = active.map(p => p.sagawa.error ? 0 : Math.round(p.sagawa.lineTotal));

    chartItemCompare = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '야마토 택배',
            data: ymTotals,
            backgroundColor: 'rgba(239, 68, 68, 0.7)',
            borderColor: 'rgba(239, 68, 68, 1)',
            borderWidth: 1,
          },
          {
            label: '사가와 택배',
            data: sgTotals,
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
              label: (c) => `${c.dataset.label}: ¥${c.parsed.y.toLocaleString('ja-JP')}`,
            },
          },
        },
        scales: {
          x: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: '#333' } },
          y: {
            ticks: { color: '#888', callback: (v) => '¥' + v.toLocaleString('ja-JP') },
            grid: { color: '#333' },
          },
        },
      },
    });
  }

  function renderCostBreakdownChart(ym, sg) {
    const ctx = document.getElementById('jp-chart-cost-breakdown');
    if (!ctx) return;
    if (chartCostBreakdown) { chartCostBreakdown.destroy(); chartCostBreakdown = null; }

    if (ym.grandTotal === 0 && sg.grandTotal === 0) return;

    const ymBase = Math.round(ym.baseSubtotal);
    const sgBase = Math.round(sg.baseSubtotal);
    const ymCool = Math.round(ym.coolSubtotal);
    const sgCool = Math.round(sg.coolSubtotal);
    const ymSameday = Math.round(ym.sameDaySubtotal);
    const sgWeight = Math.round(sg.weightSubtotal);
    const ymDiscount = Math.round(ym.discountSubtotal);
    const sgDiscount = Math.round(sg.branchSubtotal);

    chartCostBreakdown = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['야마토 택배', '사가와 택배'],
        datasets: [
          {
            label: '기본 운임',
            data: [ymBase, sgBase],
            backgroundColor: ['rgba(239, 68, 68, 0.6)', 'rgba(59, 130, 246, 0.6)'],
          },
          {
            label: '냉장/냉동 할증',
            data: [ymCool, sgCool],
            backgroundColor: ['rgba(124, 179, 247, 0.6)', 'rgba(124, 179, 247, 0.6)'],
          },
          {
            label: '중량 할증 (사가와 전용)',
            data: [0, sgWeight],
            backgroundColor: ['rgba(0,0,0,0)', 'rgba(251, 191, 36, 0.6)'],
          },
          {
            label: '당일 배송 (야마토 전용)',
            data: [ymSameday, 0],
            backgroundColor: ['rgba(168, 85, 247, 0.6)', 'rgba(0,0,0,0)'],
          },
          {
            label: '할인 합계',
            data: [ymDiscount, sgDiscount],
            backgroundColor: ['rgba(34, 197, 94, 0.6)', 'rgba(34, 197, 94, 0.6)'],
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { color: '#aaa', font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (c) => `${c.dataset.label}: ¥${c.parsed.y.toLocaleString('ja-JP')}`,
            },
          },
        },
        scales: {
          x: { stacked: true, ticks: { color: '#888' }, grid: { color: '#333' } },
          y: {
            stacked: true,
            ticks: { color: '#888', callback: (v) => '¥' + v.toLocaleString('ja-JP') },
            grid: { color: '#333' },
          },
        },
      },
    });
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
