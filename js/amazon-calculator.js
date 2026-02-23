/**
 * Amazon Shipping 2026 — Shipping Cost Calculator Engine
 *
 * Parallel calculator to FedEx Ground (calculator.js stays untouched).
 * Key differences from FedEx:
 *  - Surcharge hierarchy: ExtraHeavy > LargePackage > AHS > NonStandard
 *  - AHS sub-priority: Weight > Girth > Length > Width > Packaging
 *  - Zone groups for SC: "2", "3-4", "5+" (not per-zone)
 *  - Girth = L + 2*(W+H) — same formula as FedEx "Length+Girth"
 *  - Fuel surcharge: diesel price lookup table (not user-input %)
 *  - No residential delivery charge
 *  - DAS: 3 tiers only (Delivery Area, Extended, Remote) — no AK/HI
 *  - >150 lb: ExtraHeavy flat $1,875 (not proportional rate)
 */

// ─── Constants ───────────────────────────────────────────────────────
const AMZN_DIM_DIVISOR = 139;
const AMZN_KG_TO_LB = 2.2046;
const AMZN_MAX_TABLE_LB = 150;

// ─── Zone Group Mapping ──────────────────────────────────────────────

function getAmazonZoneGroup(zone, surchargeData) {
    const map = surchargeData.zone_group_map;
    return map[String(zone)] || '5+';
}

// ─── Fuel Surcharge from Diesel Price ────────────────────────────────

function amazonGetFuelPct(dieselPrice, surchargeData) {
    const table = surchargeData.fuel_diesel_table;
    if (!table || !dieselPrice) return 0;

    // Direct table lookup
    for (const row of table) {
        if (dieselPrice >= row.min && dieselPrice < row.max) {
            return row.pct;
        }
    }

    // Extension rule: outside table range
    const ext = surchargeData.fuel_extension_rule;
    if (!ext) return 0;

    const firstRow = table[0];
    const lastRow = table[table.length - 1];

    if (dieselPrice < firstRow.min) {
        // Below table: extend downward
        let price = firstRow.min;
        let pct = firstRow.pct;
        while (price > dieselPrice) {
            price -= ext.increment_price;
            pct -= ext.increment_pct;
        }
        return Math.max(0, Math.round(pct * 100) / 100);
    }

    // Above table: extend upward
    let price = lastRow.max;
    let pct = lastRow.pct + ext.increment_pct;
    while (dieselPrice >= price) {
        price += ext.increment_price;
        pct += ext.increment_pct;
    }
    return Math.round((pct - ext.increment_pct) * 100) / 100;
}

// ─── Surcharge Determination ─────────────────────────────────────────

/**
 * Amazon surcharge hierarchy:
 *   1. ExtraHeavy: weight > 150 lb OR girth > 165" OR length > 108"
 *   2. LargePackage: girth > 130" OR length > 96" (min billable 90 lb)
 *   3. AHS (sub-priority: Weight > Girth > Length > Width > Packaging):
 *      - AHS-Wgt: actual weight > 50 lb
 *      - AHS-Dim (girth): girth > 105"
 *      - AHS-Dim (length): length > 47"
 *      - AHS-Dim (width): width > 42"
 *      - AHS-Pkg: non-standard packaging (not auto-detected)
 *   4. NonStandard: length > 37" OR width > 30" OR height > 24"
 *
 * Only the highest-priority fee applies.
 */
function amazonDetermineSurcharge(L_cm, W_cm, H_cm, weightKg) {
    const dims_cm = [L_cm, W_cm, H_cm].sort((a, b) => b - a);
    const maxDim_in = cmToInchCeil(dims_cm[0]);
    const secondDim_in = cmToInchCeil(dims_cm[1]);
    const thirdDim_in = cmToInchCeil(dims_cm[2]);
    const girth_in = maxDim_in + 2 * (secondDim_in + thirdDim_in);
    const actualLb = kgToLb(weightKg);

    // ── ExtraHeavy (highest priority) ──
    if (actualLb > 150) {
        return { type: 'ExtraHeavy', reason: `실중량 ${actualLb.toFixed(1)} lb > 150 lb`, minLb: null };
    }
    if (girth_in > 165) {
        return { type: 'ExtraHeavy', reason: `Girth ${girth_in}" > 165"`, minLb: null };
    }
    if (maxDim_in > 108) {
        return { type: 'ExtraHeavy', reason: `최장변 ${maxDim_in}" > 108"`, minLb: null };
    }

    // ── LargePackage ──
    if (girth_in > 130) {
        return { type: 'LargePkg', reason: `Girth ${girth_in}" > 130"`, minLb: 90 };
    }
    if (maxDim_in > 96) {
        return { type: 'LargePkg', reason: `최장변 ${maxDim_in}" > 96"`, minLb: 90 };
    }

    // ── AHS (sub-priority: Weight > Girth > Length > Width) ──
    if (actualLb > 50) {
        return { type: 'AHS-Wgt', reason: `실중량 ${actualLb.toFixed(1)} lb > 50 lb`, minLb: null };
    }
    if (girth_in > 105) {
        return { type: 'AHS-Dim', reason: `Girth ${girth_in}" > 105"`, minLb: null };
    }
    if (maxDim_in > 47) {
        return { type: 'AHS-Dim', reason: `최장변 ${maxDim_in}" > 47"`, minLb: null };
    }
    if (secondDim_in > 42) {
        return { type: 'AHS-Dim', reason: `둘째변 ${secondDim_in}" > 42"`, minLb: null };
    }

    // ── NonStandard ──
    if (maxDim_in > 37) {
        return { type: 'NonStd', reason: `최장변 ${maxDim_in}" > 37"`, minLb: null };
    }
    if (secondDim_in > 30) {
        return { type: 'NonStd', reason: `둘째변 ${secondDim_in}" > 30"`, minLb: null };
    }
    if (thirdDim_in > 24) {
        return { type: 'NonStd', reason: `셋째변 ${thirdDim_in}" > 24"`, minLb: null };
    }

    return { type: 'OK', reason: '모든 조건 충족', minLb: null };
}

// ─── Surcharge Amount ────────────────────────────────────────────────

function amazonGetSurchargeAmount(scType, zone, surchargeData) {
    if (scType === 'OK') return 0;
    const group = getAmazonZoneGroup(zone, surchargeData);
    const groupData = surchargeData.amounts[group];
    if (!groupData) return 0;
    // Map internal type names to JSON keys
    const typeMap = {
        'NonStd': 'NonStd',
        'AHS-Dim': 'AHS-Dim',
        'AHS-Wgt': 'AHS-Weight',
        'AHS-Pkg': 'AHS-Pkg',
        'LargePkg': 'LargePkg',
        'ExtraHeavy': 'ExtraHeavy',
    };
    return groupData[typeMap[scType] || scType] || 0;
}

// ─── DAS Charge ──────────────────────────────────────────────────────

function amazonGetDasCharge(dasTier, surchargeData) {
    if (!dasTier || dasTier === 'None') return 0;
    return surchargeData.das[dasTier] || 0;
}

// ─── Rate Lookup ─────────────────────────────────────────────────────

function amazonLookupRate(billableLb, zone, rateTable) {
    const zoneKey = `Z${zone}`;
    const clampedLb = Math.min(billableLb, AMZN_MAX_TABLE_LB);
    const entry = rateTable[String(clampedLb)];
    if (!entry) return 0;
    return entry[zoneKey] || 0;
}

// ─── Line Item Calculation ───────────────────────────────────────────

/**
 * @param {Object} item - { name, L_cm, W_cm, H_cm, weightKg, qty }
 * @param {number} zone
 * @param {number} dieselPrice - $/gallon for fuel surcharge lookup
 * @param {string} dasTier - "None"|"Delivery Area"|"Extended Delivery Area"|"Remote Area"
 * @param {Object} rateTable
 * @param {Object} surchargeData - full surcharges.json
 */
function amazonCalcLineItem(item, zone, dieselPrice, dasTier, rateTable, surchargeData) {
    const { L_cm, W_cm, H_cm, weightKg, qty } = item;

    const actualLb = kgToLb(weightKg);
    const dimLb = calcDimWeight(L_cm, W_cm, H_cm);

    const sc = amazonDetermineSurcharge(L_cm, W_cm, H_cm, weightKg);
    const billableLb = calcBillableWeight(actualLb, dimLb, sc.minLb);

    const baseRate = amazonLookupRate(billableLb, zone, rateTable);

    // Fuel surcharge from diesel price table
    const fuelPct = amazonGetFuelPct(dieselPrice, surchargeData);
    const fuelAmount = baseRate * (fuelPct / 100);
    const rateSubtotal = baseRate + fuelAmount;

    const scAmount = amazonGetSurchargeAmount(sc.type, zone, surchargeData);

    // Amazon has NO residential charge
    const residentialCharge = 0;

    const dasCharge = amazonGetDasCharge(dasTier, surchargeData);

    const perPkgTotal = rateSubtotal + scAmount + residentialCharge + dasCharge;
    const lineTotal = perPkgTotal * qty;

    return {
        name: item.name || '',
        L_cm, W_cm, H_cm, weightKg, qty,
        actualLb: Math.round(actualLb * 100) / 100,
        dimLb: Math.round(dimLb * 100) / 100,
        billableLb,
        baseRate: Math.round(baseRate * 100) / 100,
        fuelPct: Math.round(fuelPct * 100) / 100,
        fuelAmount: Math.round(fuelAmount * 100) / 100,
        rateSubtotal: Math.round(rateSubtotal * 100) / 100,
        scType: sc.type,
        scReason: sc.reason,
        scAmount: Math.round(scAmount * 100) / 100,
        residentialCharge: 0,
        dasCharge: Math.round(dasCharge * 100) / 100,
        perPkgTotal: Math.round(perPkgTotal * 100) / 100,
        lineTotal: Math.round(lineTotal * 100) / 100,
    };
}

// ─── Grand Total ─────────────────────────────────────────────────────

function amazonCalcAll(items, zone, dieselPrice, dasTier, rateTable, surchargeData) {
    const lines = items
        .filter(item => item.qty > 0)
        .map(item => amazonCalcLineItem(item, zone, dieselPrice, dasTier, rateTable, surchargeData));

    const grandTotal = lines.reduce((s, l) => s + l.lineTotal, 0);
    const rateSubtotal = lines.reduce((s, l) => s + (l.rateSubtotal * l.qty), 0);
    const scSubtotal = lines.reduce((s, l) => s + (l.scAmount * l.qty), 0);
    const residentialSubtotal = 0;
    const dasSubtotal = lines.reduce((s, l) => s + (l.dasCharge * l.qty), 0);

    return {
        lines,
        grandTotal: Math.round(grandTotal * 100) / 100,
        rateSubtotal: Math.round(rateSubtotal * 100) / 100,
        scSubtotal: Math.round(scSubtotal * 100) / 100,
        residentialSubtotal: 0,
        dasSubtotal: Math.round(dasSubtotal * 100) / 100,
    };
}

// ─── Exports ─────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getAmazonZoneGroup, amazonGetFuelPct,
        amazonDetermineSurcharge, amazonGetSurchargeAmount,
        amazonGetDasCharge, amazonLookupRate,
        amazonCalcLineItem, amazonCalcAll,
        AMZN_DIM_DIVISOR, AMZN_KG_TO_LB, AMZN_MAX_TABLE_LB,
    };
}
