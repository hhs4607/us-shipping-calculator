/**
 * UI Controller V4 — Multi-carrier support (FedEx Ground + Amazon Shipping)
 * V4: Carrier toggle, Amazon diesel fuel lookup, Amazon surcharge tiers
 */

const UI = (() => {
  let data = null;       // { rates, surcharges, defaults, zones, meta }
  let state = null;      // { carrier, zone, fuelPct, dieselPrice, deliveryType, dasTier, dasTierAmazon, unitDim, unitWeight, items }
  let itemIdCounter = 0;

  // ─── Carrier Helpers ───────────────────────────────────────────

  function isAmazon() {
    return state && state.carrier === 'amazon-shipping';
  }

  function isFedEx() {
    return !state || state.carrier === 'fedex-ground';
  }

  // ─── Initialization ─────────────────────────────────────────────

  async function init() {
    // Try URL state first to determine carrier
    const urlState = Storage.loadFromURL();
    const carrier = (urlState && urlState.carrier) || 'fedex-ground';

    try {
      data = await DataLoader.loadAll(carrier);
    } catch (e) {
      console.error('Data load failed:', e);
      showToast('데이터 로드 실패: ' + e.message, 'error');
      return;
    }

    if (urlState) {
      state = urlState;
      if (!state.carrier) state.carrier = 'fedex-ground';
      if (!state.deliveryType) state.deliveryType = 'commercial';
      if (!state.dasTier) state.dasTier = 'None';
      if (!state.dasTierAmazon) state.dasTierAmazon = 'None';
      if (state.dieselPrice == null) state.dieselPrice = 3.50;
      itemIdCounter = state.items.length;
    } else {
      resetToDefaults();
    }

    renderCarrierToggle();
    updateCarrierUI();
    renderSettings();
    renderItemsTable();
    recalculate();
    renderMeta();
    bindEvents();
  }

  function resetToDefaults() {
    const defaults = data.defaults;
    const carrier = (state && state.carrier) || 'fedex-ground';
    state = {
      carrier,
      zone: defaults.zone || 2,
      fuelPct: defaults.fuel_pct || 0,
      dieselPrice: defaults.diesel_price || 3.50,
      deliveryType: 'commercial',
      dasTier: 'None',
      dasTierAmazon: 'None',
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
    const defaults = data.defaults;
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
    // Update active button
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

  // ─── Carrier Toggle ────────────────────────────────────────────

  function renderCarrierToggle() {
    document.querySelectorAll('.carrier-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.carrier === state.carrier);
    });
  }

  async function switchCarrier(newCarrier) {
    if (newCarrier === state.carrier) return;

    try {
      data = await DataLoader.loadAll(newCarrier);
    } catch (e) {
      showToast('데이터 로드 실패: ' + e.message, 'error');
      return;
    }

    state.carrier = newCarrier;
    renderCarrierToggle();
    updateCarrierUI();
    updateHeaderTitle();
    resetToDefaults();
    renderSettings();
    renderItemsTable();
    recalculate();
    renderMeta();
    updateURL();
    showToast(newCarrier === 'amazon-shipping' ? 'Amazon Shipping으로 전환' : 'FedEx Ground로 전환', 'success');
  }

  function updateHeaderTitle() {
    const titleEl = document.getElementById('header-title');
    if (isAmazon()) {
      titleEl.textContent = 'Amazon Shipping 2026 배송비 계산기';
    } else {
      titleEl.textContent = 'FedEx Ground 2025 배송비 계산기';
    }
  }

  function updateCarrierUI() {
    const amazon = isAmazon();

    // FedEx-only controls
    document.getElementById('setting-fuel-pct').style.display = amazon ? 'none' : '';
    document.getElementById('setting-delivery-type').style.display = amazon ? 'none' : '';
    document.getElementById('setting-das-fedex').style.display = amazon ? 'none' : '';

    // Amazon-only controls
    document.getElementById('setting-diesel').style.display = amazon ? '' : 'none';
    document.getElementById('setting-das-amazon').style.display = amazon ? '' : 'none';

    updateHeaderTitle();
  }

  // ─── Settings ───────────────────────────────────────────────────

  function renderSettings() {
    document.getElementById('zone-select').value = state.zone;
    document.getElementById('fuel-input').value = state.fuelPct;
    document.getElementById('diesel-select').value = state.dieselPrice;
    document.getElementById('delivery-type').value = state.deliveryType;
    document.getElementById('das-tier').value = state.dasTier;
    document.getElementById('das-tier-amazon').value = state.dasTierAmazon;
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

    document.getElementById('th-dim-l').textContent = state.unitDim === 'mm' ? 'L(mm)' : 'L(in)';
    document.getElementById('th-dim-w').textContent = state.unitDim === 'mm' ? 'W(mm)' : 'W(in)';
    document.getElementById('th-dim-h').textContent = state.unitDim === 'mm' ? 'H(mm)' : 'H(in)';
    document.getElementById('th-weight').textContent = state.unitWeight === 'kg' ? '중량(kg)' : '중량(lb)';

    state.items.forEach((item, idx) => {
      const tr = document.createElement('tr');
      tr.dataset.id = item.id;

      const displayL = state.unitDim === 'mm' ? item.L_mm : mmToInDisplay(item.L_mm);
      const displayW = state.unitDim === 'mm' ? item.W_mm : mmToInDisplay(item.W_mm);
      const displayH = state.unitDim === 'mm' ? item.H_mm : mmToInDisplay(item.H_mm);
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

  function mmToInDisplay(mm) { return round2(mm / 25.4); }

  function onItemInput(id, input) {
    const item = state.items.find(i => i.id === id);
    if (!item) return;

    const field = input.dataset.field;
    const val = input.value;

    if (field === 'name') item.name = val;
    else if (field === 'L') item.L_mm = state.unitDim === 'mm' ? Number(val) : Number(val) * 25.4;
    else if (field === 'W') item.W_mm = state.unitDim === 'mm' ? Number(val) : Number(val) * 25.4;
    else if (field === 'H') item.H_mm = state.unitDim === 'mm' ? Number(val) : Number(val) * 25.4;
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

    let result;
    if (isAmazon()) {
      result = amazonCalcAll(
        calcItems,
        state.zone,
        state.dieselPrice,
        state.dasTierAmazon,
        data.rates,
        data.surcharges
      );
    } else {
      const isResidential = state.deliveryType === 'residential';
      result = calcAll(
        calcItems,
        state.zone,
        state.fuelPct,
        isResidential,
        state.dasTier,
        data.rates,
        data.surcharges
      );
    }

    renderResults(result);
    renderSummary(result);
  }

  // ─── Results ────────────────────────────────────────────────────

  function renderResults(result) {
    const tbody = document.getElementById('results-tbody');
    tbody.innerHTML = '';

    state.items.forEach((item, idx) => {
      const calcItem = {
        name: item.name,
        L_cm: item.L_mm / 10,
        W_cm: item.W_mm / 10,
        H_cm: item.H_mm / 10,
        weightKg: item.weightKg,
        qty: item.qty,
      };

      let line = null;
      if (item.qty > 0) {
        if (isAmazon()) {
          line = amazonCalcLineItem(calcItem, state.zone, state.dieselPrice, state.dasTierAmazon, data.rates, data.surcharges);
        } else {
          const isResidential = state.deliveryType === 'residential';
          line = calcLineItem(calcItem, state.zone, state.fuelPct, isResidential, state.dasTier, data.rates, data.surcharges);
        }
      }

      const tr = document.createElement('tr');
      if (item.qty === 0) tr.style.opacity = '0.35';

      if (line) {
        const scClass = scTypeToClass(line.scType);
        tr.innerHTML = `
          <td>${idx + 1}</td>
          <td style="text-align:left">${escHtml(line.name)}</td>
          <td>${fmt(line.actualLb)}</td>
          <td>${fmt(line.dimLb)}</td>
          <td><strong>${line.billableLb}</strong></td>
          <td>$${fmt(line.baseRate)}</td>
          <td>$${fmt(line.fuelAmount)}</td>
          <td>$${fmt(line.rateSubtotal)}</td>
          <td><span class="sc-tag ${scClass}">${line.scType}</span></td>
          <td class="sc-reason">${escHtml(line.scReason)}</td>
          <td>$${fmt(line.scAmount)}</td>
          <td>$${fmt(line.residentialCharge)}</td>
          <td>$${fmt(line.dasCharge)}</td>
          <td>${calcItem.qty}</td>
          <td><strong>$${fmt(line.lineTotal)}</strong></td>
        `;
      } else {
        tr.innerHTML = `
          <td>${idx + 1}</td>
          <td style="text-align:left">${escHtml(calcItem.name)}</td>
          <td colspan="13" style="color:var(--text-m)">수량 0 — 계산 제외</td>
        `;
      }

      tbody.appendChild(tr);
    });
  }

  function renderSummary(result) {
    document.getElementById('sum-rate').textContent = '$' + fmt(result.rateSubtotal);
    document.getElementById('sum-sc').textContent = '$' + fmt(result.scSubtotal);
    document.getElementById('sum-resi').textContent = '$' + fmt(result.residentialSubtotal);
    document.getElementById('sum-das').textContent = '$' + fmt(result.dasSubtotal);
    document.getElementById('sum-grand').textContent = '$' + fmt(result.grandTotal);
    document.getElementById('sum-count').textContent =
      result.lines.length + '건 / ' + result.lines.reduce((s, l) => s + l.qty, 0) + '개';
  }

  // ─── Meta Footer ────────────────────────────────────────────────

  function renderMeta() {
    const footer = document.getElementById('meta-info');
    if (data.meta) {
      footer.textContent = `Data v${data.meta.data_version} | ${data.meta.service} ${data.meta.year} | DIM ÷${data.meta.dim_divisor}`;
    }
  }

  // ─── URL Sync ───────────────────────────────────────────────────

  function updateURL() {
    Storage.saveToURL(getCurrentState());
  }

  // ─── Events ─────────────────────────────────────────────────────

  function bindEvents() {
    // Carrier toggle
    document.querySelectorAll('.carrier-btn').forEach(btn => {
      btn.addEventListener('click', () => switchCarrier(btn.dataset.carrier));
    });

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

    // Delivery Type (FedEx)
    document.getElementById('delivery-type').addEventListener('change', (e) => {
      state.deliveryType = e.target.value;
      recalculate();
      updateURL();
    });

    // DAS Tier (FedEx)
    document.getElementById('das-tier').addEventListener('change', (e) => {
      state.dasTier = e.target.value;
      recalculate();
      updateURL();
    });

    // DAS Tier (Amazon)
    document.getElementById('das-tier-amazon').addEventListener('change', (e) => {
      state.dasTierAmazon = e.target.value;
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
          // Load carrier data if different
          const importCarrier = importedState.carrier || 'fedex-ground';
          if (importCarrier !== state.carrier) {
            data = await DataLoader.loadAll(importCarrier);
          }
          state = importedState;
          if (!state.carrier) state.carrier = 'fedex-ground';
          if (!state.deliveryType) state.deliveryType = 'commercial';
          if (!state.dasTier) state.dasTier = 'None';
          if (!state.dasTierAmazon) state.dasTierAmazon = 'None';
          if (state.dieselPrice == null) state.dieselPrice = 3.50;
          itemIdCounter = state.items.length;
          renderCarrierToggle();
          updateCarrierUI();
          renderSettings();
          renderItemsTable();
          recalculate();
          renderMeta();
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
        const carrierLabel = s.state && s.state.carrier === 'amazon-shipping' ? ' [Amazon]' : ' [FedEx]';
        listHtml += `
          <div class="scenario-item" onclick="UI.doLoad('${escHtml(s.name)}')">
            <div>
              <div class="name">${escHtml(s.name)}${carrierLabel}</div>
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

  async function doLoad(name) {
    const loaded = Storage.loadScenario(name);
    if (!loaded) { showToast('시나리오를 찾을 수 없습니다', 'error'); return; }

    // Load carrier data if different
    const loadCarrier = loaded.carrier || 'fedex-ground';
    if (loadCarrier !== state.carrier) {
      try {
        data = await DataLoader.loadAll(loadCarrier);
      } catch (e) {
        showToast('데이터 로드 실패: ' + e.message, 'error');
        return;
      }
    }

    state = loaded;
    if (!state.carrier) state.carrier = 'fedex-ground';
    if (!state.deliveryType) state.deliveryType = 'commercial';
    if (!state.dasTier) state.dasTier = 'None';
    if (!state.dasTierAmazon) state.dasTierAmazon = 'None';
    if (state.dieselPrice == null) state.dieselPrice = 3.50;
    itemIdCounter = state.items.length;
    renderCarrierToggle();
    updateCarrierUI();
    renderSettings();
    renderItemsTable();
    recalculate();
    renderMeta();
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

    const amazonSection = `
    <div class="help-section">
      <h4>📦 Amazon Shipping 추가 수수료</h4>
      <div class="term-row">
        <div class="term-name">NonStandard<br>(비표준)</div>
        <div class="term-desc">다음 중 하나에 해당하면 부과:<br>• <strong>최장변 > 37"</strong><br>• <strong>둘째변 > 30"</strong><br>• <strong>셋째변 > 24"</strong><br>Zone그룹별 $11~$14.15</div>
      </div>
      <div class="term-row">
        <div class="term-name">AHS-Dim<br>(치수 추가핸들링)</div>
        <div class="term-desc">• <strong>최장변 > 47"</strong><br>• <strong>둘째변 > 42"</strong><br>• <strong>Girth > 105"</strong><br>Zone그룹별 $29.26~$37.57</div>
      </div>
      <div class="term-row">
        <div class="term-name">AHS-Wgt<br>(중량 추가핸들링)</div>
        <div class="term-desc"><strong>실중량 > 50lb</strong> 시 부과.<br>Zone그룹별 $45.89~$55.20</div>
      </div>
      <div class="term-row">
        <div class="term-name">LargePkg<br>(대형)</div>
        <div class="term-desc"><strong>Girth > 130"</strong> 또는 <strong>최장변 > 96"</strong><br>Zone그룹별 $255~$320. 최소 청구중량 90lb.</div>
      </div>
      <div class="term-row">
        <div class="term-name">ExtraHeavy<br>(초중량)</div>
        <div class="term-desc">• <strong>실중량 > 150lb</strong><br>• <strong>Girth > 165"</strong><br>• <strong>최장변 > 108"</strong><br>정액 <strong>$1,875</strong></div>
      </div>
    </div>`;

    modal.innerHTML = `
  <div class="help-modal">
    <h3>📖 배송 용어 사전</h3>

    <div class="help-section">
      <h4>📐 중량 · 치수</h4>
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
    </div>

    <div class="help-section">
      <h4>💰 운임 · 할증</h4>
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
        <div class="term-desc"><strong>FedEx:</strong> 7단계 (Base~Intra-Hawaii)<br><strong>Amazon:</strong> 3단계 (Delivery Area $4.45, Extended $5.55, Remote $16.75). 미 본토 48주만.</div>
      </div>
    </div>

    <div class="help-section">
      <h4>⚠️ FedEx Ground 추가 수수료</h4>
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

    ${amazonSection}

    <div class="tip-box">
      <strong>💡 참고:</strong> 추가 수수료는 품목당 1종류만 적용됩니다. 우선순위가 높은 것만 부과됩니다.
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

    <div class="step-row">
      <span class="step-num">1</span>
      <div class="step-content">
        <div class="step-title">배송사 선택</div>
        <div class="step-detail">FedEx Ground 또는 Amazon Shipping 중 하나를 선택합니다. 요금 테이블과 추가 수수료 규칙이 다릅니다.</div>
      </div>
    </div>

    <div class="step-row">
      <span class="step-num">2</span>
      <div class="step-content">
        <div class="step-title">Zone 선택</div>
        <div class="step-detail">출발지에서 도착지까지 거리에 맞는 Zone(2~8)을 선택합니다.</div>
      </div>
    </div>

    <div class="step-row">
      <span class="step-num">3</span>
      <div class="step-content">
        <div class="step-title">연료할증 설정</div>
        <div class="step-detail"><strong>FedEx:</strong> 연료할증률(%)을 직접 입력합니다.<br><strong>Amazon:</strong> 경유가격($/갤런)을 선택하면 자동으로 연료할증률이 산정됩니다.</div>
      </div>
    </div>

    <div class="step-row">
      <span class="step-num">4</span>
      <div class="step-content">
        <div class="step-title">추가 설정</div>
        <div class="step-detail"><strong>FedEx:</strong> 배송지 유형(Commercial/Residential), DAS 티어<br><strong>Amazon:</strong> DAS 티어 (미 본토 48주만 지원)</div>
      </div>
    </div>

    <div class="step-row">
      <span class="step-num">5</span>
      <div class="step-content">
        <div class="step-title">품목 입력</div>
        <div class="step-detail">제품명, 가로/세로/높이, 중량, 수량을 입력합니다. 여러 품목은 ➕ 행 추가 버튼으로 추가하세요.</div>
      </div>
    </div>

    <div class="step-row">
      <span class="step-num">6</span>
      <div class="step-content">
        <div class="step-title">결과 확인</div>
        <div class="step-detail">아래 결과 테이블에서 품목별 상세 비용과 총 배송비를 확인합니다.</div>
      </div>
    </div>

    <div class="tip-box">
      <strong>💡 팁:</strong><br>
      • <strong>배송사를 전환</strong>하면 동일 제품에 대한 FedEx/Amazon 요금을 비교할 수 있습니다.<br>
      • <strong>💾 저장</strong>으로 시나리오를 로컬에 저장하고, <strong>🔗 공유</strong>로 URL을 복사할 수 있습니다.<br>
      • <strong>⬇ Export</strong>로 JSON 파일을 내보내고, <strong>⬆ Import</strong>로 불러올 수 있습니다.<br>
      • 각 설정과 결과 컬럼의 <strong>ⓘ</strong> 아이콘에 마우스를 올리면 용어 설명을 볼 수 있습니다.
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

  function round2(n) { return Math.round(n * 100) / 100; }

  function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function scTypeToClass(type) {
    const map = {
      'OK': 'sc-tag--ok',
      // FedEx types
      'AHS-Dim': 'sc-tag--ahs-dim',
      'AHS-Wgt': 'sc-tag--ahs-wgt',
      'Oversize': 'sc-tag--oversize',
      'Unauth': 'sc-tag--unauth',
      // Amazon types
      'NonStd': 'sc-tag--nonstd',
      'LargePkg': 'sc-tag--largepkg',
      'ExtraHeavy': 'sc-tag--extraheavy',
    };
    return map[type] || '';
  }

  // ─── Public API ─────────────────────────────────────────────────

  return {
    init, addRow, deleteRow, duplicateRow,
    doSave, doLoad, doDelete, closeModal, showToast,
    showGlossaryModal, showGuideModal,
  };
})();

document.addEventListener('DOMContentLoaded', UI.init);
