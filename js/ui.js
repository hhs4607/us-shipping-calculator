/**
 * UI Controller V2 — DOM manipulation, event handling, real-time calculation.
 * V2: Residential, DAS settings + AHS highest-amount logic
 */

const UI = (() => {
  let data = null;       // { rates, surcharges, defaults, zones, meta }
  let state = null;      // { zone, fuelPct, deliveryType, dasTier, unitDim, unitWeight, items }
  let itemIdCounter = 0;

  // ─── Initialization ─────────────────────────────────────────────

  async function init() {
    try {
      data = await DataLoader.loadAll();
    } catch (e) {
      console.error('Data load failed:', e);
      showToast('데이터 로드 실패: ' + e.message, 'error');
      return;
    }

    const urlState = Storage.loadFromURL();
    if (urlState) {
      // Ensure V2 fields exist
      state = urlState;
      if (!state.deliveryType) state.deliveryType = 'commercial';
      if (!state.dasTier) state.dasTier = 'None';
      itemIdCounter = state.items.length;
    } else {
      resetToDefaults();
    }

    renderSettings();
    renderItemsTable();
    recalculate();
    renderMeta();
    bindEvents();
  }

  function resetToDefaults() {
    const defaults = data.defaults;
    state = {
      zone: defaults.zone || 2,
      fuelPct: defaults.fuel_pct || 0,
      deliveryType: 'commercial',
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

  // ─── Settings ───────────────────────────────────────────────────

  function renderSettings() {
    document.getElementById('zone-select').value = state.zone;
    document.getElementById('fuel-input').value = state.fuelPct;
    document.getElementById('delivery-type').value = state.deliveryType;
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
    const isResidential = state.deliveryType === 'residential';
    const calcItems = state.items.map(item => ({
      name: item.name,
      L_cm: item.L_mm / 10,
      W_cm: item.W_mm / 10,
      H_cm: item.H_mm / 10,
      weightKg: item.weightKg,
      qty: item.qty,
    }));

    const result = calcAll(
      calcItems,
      state.zone,
      state.fuelPct,
      isResidential,
      state.dasTier,
      data.rates,
      data.surcharges
    );

    renderResults(result);
    renderSummary(result);
  }

  // ─── Results ────────────────────────────────────────────────────

  function renderResults(result) {
    const tbody = document.getElementById('results-tbody');
    tbody.innerHTML = '';

    const isResidential = state.deliveryType === 'residential';

    state.items.forEach((item, idx) => {
      const calcItem = {
        name: item.name,
        L_cm: item.L_mm / 10,
        W_cm: item.W_mm / 10,
        H_cm: item.H_mm / 10,
        weightKg: item.weightKg,
        qty: item.qty,
      };

      const line = item.qty > 0
        ? calcLineItem(calcItem, state.zone, state.fuelPct, isResidential, state.dasTier, data.rates, data.surcharges)
        : null;

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
    // Zone
    document.getElementById('zone-select').addEventListener('change', (e) => {
      state.zone = Number(e.target.value);
      recalculate();
      updateURL();
    });

    // Fuel
    document.getElementById('fuel-input').addEventListener('input', (e) => {
      state.fuelPct = Number(e.target.value) || 0;
      recalculate();
      updateURL();
    });

    // Delivery Type (V2)
    document.getElementById('delivery-type').addEventListener('change', (e) => {
      state.deliveryType = e.target.value;
      recalculate();
      updateURL();
    });

    // DAS Tier (V2)
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
          state = importedState;
          if (!state.deliveryType) state.deliveryType = 'commercial';
          if (!state.dasTier) state.dasTier = 'None';
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
    state = loaded;
    if (!state.deliveryType) state.deliveryType = 'commercial';
    if (!state.dasTier) state.dasTier = 'None';
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
      <h4>📐 중량 · 치수</h4>
      <div class="term-row">
        <div class="term-name">DIM Weight<br>(부피중량)</div>
        <div class="term-desc">박스 크기로 환산한 중량입니다.<br><strong>각 변(inch) 올림 후 L × W × H ÷ 139</strong><br>박스가 크고 가벼운 경우, 실제 중량 대신 부피중량이 적용됩니다.</div>
      </div>
      <div class="term-row">
        <div class="term-name">Billable Weight<br>(청구중량)</div>
        <div class="term-desc"><strong>실중량과 부피중량 중 큰 값</strong>이 청구중량이 됩니다. FedEx는 이 중량을 기준으로 운임을 산정합니다.</div>
      </div>
      <div class="term-row">
        <div class="term-name">L + Girth<br>(길이 + 둘레)</div>
        <div class="term-desc"><strong>최장변 + 2 × (높이 + 너비)</strong><br>택배 크기를 판정하는 기준입니다. 이 값이 105"를 넘으면 AHS, 130"를 넘으면 Oversize, 165"를 넘으면 Unauthorized에 해당합니다.</div>
      </div>
    </div>

    <div class="help-section">
      <h4>💰 운임 · 할증</h4>
      <div class="term-row">
        <div class="term-name">Zone<br>(배송 구간)</div>
        <div class="term-desc">출발지에서 도착지까지의 <strong>거리에 따른 구간(2~8)</strong>입니다. Zone 2가 가장 가깝고(~150mi), Zone 8이 가장 멉니다(1,801mi+). 거리가 멀수록 운임이 높아집니다.</div>
      </div>
      <div class="term-row">
        <div class="term-name">Fuel Surcharge<br>(연료할증)</div>
        <div class="term-desc">기본운임에 추가되는 <strong>유류비 비율(%)</strong>입니다. FedEx가 주기적으로 공지하며, 보통 10~15% 범위입니다.</div>
      </div>
      <div class="term-row">
        <div class="term-name">Residential<br>(주거지 할증)</div>
        <div class="term-desc">배송지가 주거지(집, 아파트 등)인 경우 <strong>개당 $5.95</strong>가 추가됩니다. Commercial(사업장)이면 부과되지 않습니다.</div>
      </div>
      <div class="term-row">
        <div class="term-name">DAS<br>(배송지역 할증)</div>
        <div class="term-desc">Delivery Area Surcharge의 약자입니다. <strong>도착지 ZIP코드에 따라</strong> 추가 요금이 부과됩니다.<br>Base($4.20~$6.20), Extended($5.25~$8.30), Remote($15.50), Alaska($43), Hawaii($14.50)</div>
      </div>
    </div>

    <div class="help-section">
      <h4>⚠️ 추가 수수료 (Surcharge)</h4>
      <div class="term-row">
        <div class="term-name">AHS-Dim<br>(치수 추가핸들링)</div>
        <div class="term-desc">다음 중 하나에 해당하면 부과됩니다:<br>• <strong>최장변 > 48"</strong> (약 122cm)<br>• <strong>둘째변 > 30"</strong> (약 76cm)<br>• <strong>L+Girth > 105"</strong><br>Zone별 $28~$38. 최소 청구중량 40lb 적용.</div>
      </div>
      <div class="term-row">
        <div class="term-name">AHS-Wgt<br>(중량 추가핸들링)</div>
        <div class="term-desc"><strong>실중량 > 50lb</strong>(약 22.7kg)인 경우 부과됩니다.<br>Zone별 $43.50~$55.<br>AHS-Dim과 동시 해당 시, <strong>금액이 높은 쪽 1개만</strong> 적용됩니다.</div>
      </div>
      <div class="term-row">
        <div class="term-name">AHS-Pkg<br>(포장 추가핸들링)</div>
        <div class="term-desc"><strong>비표준 포장</strong>(금속, 목재, 원통형, 수축포장 등)에 부과됩니다.<br>Zone별 $25~$31.50.</div>
      </div>
      <div class="term-row">
        <div class="term-name">Oversize<br>(대형)</div>
        <div class="term-desc"><strong>최장변 > 96"</strong> 또는 <strong>L+Girth > 130"</strong>인 경우 부과됩니다.<br>Zone별 $240~$305. 최소 청구중량 90lb 적용.</div>
      </div>
      <div class="term-row">
        <div class="term-name">Unauthorized<br>(초과/비허가)</div>
        <div class="term-desc">다음 중 하나에 해당하면 부과됩니다:<br>• <strong>최장변 > 108"</strong><br>• <strong>L+Girth > 165"</strong><br>• <strong>실중량 > 150lb</strong> (약 68kg)<br>정액 <strong>$1,775</strong>. FedEx가 거부하거나 반송할 수 있습니다.</div>
      </div>
    </div>

    <div class="tip-box">
      <strong>💡 참고:</strong> 추가 수수료는 품목당 1종류만 적용되며, 우선순위는 Unauthorized > Oversize > AHS 순입니다. 모든 금액은 FedEx Ground 2025 기준이며, 연료할증은 별도입니다.
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
        <div class="step-title">Zone 선택</div>
        <div class="step-detail">출발지에서 도착지까지 거리에 맞는 Zone(2~8)을 선택합니다. FedEx 웹사이트에서 ZIP코드로 조회할 수 있습니다.</div>
      </div>
    </div>

    <div class="step-row">
      <span class="step-num">2</span>
      <div class="step-content">
        <div class="step-title">연료할증(%) 입력</div>
        <div class="step-detail">FedEx 공지 기준으로 현재 연료할증률을 입력합니다. 보통 10~15% 범위이며, 0으로 두면 연료할증 없이 계산됩니다.</div>
      </div>
    </div>

    <div class="step-row">
      <span class="step-num">3</span>
      <div class="step-content">
        <div class="step-title">배송지 유형 선택</div>
        <div class="step-detail"><strong>Commercial</strong> = 사업장 (별도 할증 없음)<br><strong>Residential</strong> = 주거지, 아파트, 자택사업장 (개당 $5.95 추가)</div>
      </div>
    </div>

    <div class="step-row">
      <span class="step-num">4</span>
      <div class="step-content">
        <div class="step-title">DAS 티어 선택</div>
        <div class="step-detail">배송지역 할증이 적용되는 지역이면 해당 티어를 선택합니다. 일반 지역은 <strong>None</strong>으로 두면 됩니다.</div>
      </div>
    </div>

    <div class="step-row">
      <span class="step-num">5</span>
      <div class="step-content">
        <div class="step-title">품목 입력</div>
        <div class="step-detail">제품명, 가로/세로/높이(mm 또는 inch), 중량(kg 또는 lb), 수량을 입력합니다. 여러 품목은 ➕ 행 추가 버튼으로 추가하세요.</div>
      </div>
    </div>

    <div class="step-row">
      <span class="step-num">6</span>
      <div class="step-content">
        <div class="step-title">결과 확인</div>
        <div class="step-detail">아래 결과 테이블에서 품목별 상세 비용(기본운임, 연료할증, SC, Residential, DAS)과 총 배송비를 확인합니다.</div>
      </div>
    </div>

    <div class="tip-box">
      <strong>💡 팁:</strong><br>
      • <strong>150lb 초과</strong> 시 rate150 × (청구중량/150) 비례 계산이 적용됩니다.<br>
      • <strong>SC는 품목당 1종류만</strong> 적용됩니다 (Unauthorized > Oversize > AHS 우선순위).<br>
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
      'AHS-Dim': 'sc-tag--ahs-dim',
      'AHS-Wgt': 'sc-tag--ahs-wgt',
      'Oversize': 'sc-tag--oversize',
      'Unauth': 'sc-tag--unauth',
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
