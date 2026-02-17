/**
 * FedEx Ground 2025 — Shipping Cost Calculator Engine V2
 * 
 * Pure-function calculation engine that mirrors the Excel formulas exactly.
 * V2 changes:
 *  - AHS-Dim vs AHS-Wgt: when both apply, pick the higher $ amount
 *  - Residential Delivery Charge ($5.95/pkg if residential)
 *  - Delivery Area Surcharge (DAS) per tier
 *  - Total = (base + fuel) + SC + Residential + DAS  per pkg × qty
 */

// ─── Constants ───────────────────────────────────────────────────────
const DIM_DIVISOR = 139;
const KG_TO_LB = 2.2046;
const MAX_TABLE_LB = 150;

// ─── Unit Conversion ─────────────────────────────────────────────────

function cmToInchCeil(cm) {
    return Math.ceil(cm / 2.54);
}

function kgToLb(kg) {
    return kg * KG_TO_LB;
}

function mmToInchCeil(mm) {
    return cmToInchCeil(mm / 10);
}

// ─── DIM Weight ──────────────────────────────────────────────────────

function calcDimWeight(L_cm, W_cm, H_cm) {
    const L_in = cmToInchCeil(L_cm);
    const W_in = cmToInchCeil(W_cm);
    const H_in = cmToInchCeil(H_cm);
    return (L_in * W_in * H_in) / DIM_DIVISOR;
}

// ─── Surcharge Determination (V2) ────────────────────────────────────

/**
 * Determine surcharge type.
 * Priority: Unauthorized > Oversize > (AHS-Dim or AHS-Wgt highest $) > OK
 * 
 * V2 change: When BOTH AHS-Dim and AHS-Wgt conditions are true,
 * compare their dollar amounts for the given zone and pick the higher one.
 * (2025: AHS-Wgt is more expensive in most zones.)
 * 
 * @param {number} L_cm
 * @param {number} W_cm
 * @param {number} H_cm
 * @param {number} weightKg
 * @param {number} zone        - needed for AHS amount comparison
 * @param {Object} scAmounts   - zone-keyed surcharge amounts
 * @returns {{ type: string, reason: string, minLb: number|null }}
 */
function determineSurcharge(L_cm, W_cm, H_cm, weightKg, zone, scAmounts) {
    const dims_cm = [L_cm, W_cm, H_cm].sort((a, b) => b - a);
    const maxDim_cm = dims_cm[0];
    const secondDim_cm = dims_cm[1];
    const thirdDim_cm = dims_cm[2];

    const maxDim_in = cmToInchCeil(maxDim_cm);
    const secondDim_in = cmToInchCeil(secondDim_cm);
    const thirdDim_in = cmToInchCeil(thirdDim_cm);

    const lengthGirth_in = maxDim_in + 2 * (secondDim_in + thirdDim_in);
    const actualLb = kgToLb(weightKg);

    // ── Unauthorized (highest priority) ──
    if (weightKg > 68) {
        return { type: 'Unauth', reason: `실중량 ${actualLb.toFixed(1)} lb > 150 lb ✗`, minLb: 90 };
    }
    if (maxDim_in > 108) {
        return { type: 'Unauth', reason: `최장변 ${maxDim_in} in > 108 in ✗`, minLb: 90 };
    }
    if (lengthGirth_in > 165) {
        return { type: 'Unauth', reason: `L+Girth ${lengthGirth_in} in > 165 in ✗`, minLb: 90 };
    }

    // ── Oversize ──
    if (maxDim_in > 96) {
        return { type: 'Oversize', reason: `최장변 ${maxDim_in} in > 96 in ✗`, minLb: 90 };
    }
    if (lengthGirth_in > 130) {
        return { type: 'Oversize', reason: `L+Girth ${lengthGirth_in} in > 130 in ✗`, minLb: 90 };
    }

    // ── AHS checks (V2: compare amounts when both apply) ──
    const isAhsDim = (maxDim_in > 48) || (secondDim_in > 30);
    // Also check L+Girth > 105 for AHS-Dim (use sorted dims, same as Oversize/Unauth)
    const lgInch = maxDim_in + 2 * (secondDim_in + thirdDim_in);
    const isAhsDimLG = (lgInch > 105);
    const ahsDimTriggered = isAhsDim || isAhsDimLG;

    const isAhsWgt = (weightKg > 22.68); // >50 lb

    if (ahsDimTriggered && isAhsWgt) {
        // Both conditions met → compare amounts, pick higher
        const zoneData = scAmounts[String(zone)] || {};
        const dimAmt = zoneData['AHS-Dim'] || 0;
        const wgtAmt = zoneData['AHS-Weight'] || 0;

        if (wgtAmt >= dimAmt) {
            return { type: 'AHS-Wgt', reason: `Dim+Wgt 동시 → Wgt($${wgtAmt}) ≥ Dim($${dimAmt})`, minLb: null };
        } else {
            return { type: 'AHS-Dim', reason: `Dim+Wgt 동시 → Dim($${dimAmt}) > Wgt($${wgtAmt})`, minLb: 40 };
        }
    }

    if (ahsDimTriggered) {
        let reason;
        if (maxDim_in > 48) reason = `최장변 ${maxDim_in} in > 48 in ✗`;
        else if (secondDim_in > 30) reason = `2번째변 ${secondDim_in} in > 30 in ✗`;
        else reason = `L+Girth ${lgInch} in > 105 in ✗`;
        return { type: 'AHS-Dim', reason, minLb: 40 };
    }

    if (isAhsWgt) {
        return { type: 'AHS-Wgt', reason: `실중량 ${actualLb.toFixed(1)} lb > 50 lb ✗`, minLb: null };
    }

    return { type: 'OK', reason: '모든 조건 충족 ✓', minLb: null };
}

// ─── Billable Weight ─────────────────────────────────────────────────

function calcBillableWeight(actualLb, dimLb, scMinLb) {
    const base = Math.max(Math.ceil(Math.max(actualLb, dimLb)), 1);
    if (scMinLb != null) {
        return Math.max(base, scMinLb);
    }
    return base;
}

// ─── Rate Lookup ─────────────────────────────────────────────────────

function lookupRate(billableLb, zone, rateTable) {
    const zoneKey = `Z${zone}`;
    if (billableLb <= MAX_TABLE_LB) {
        const entry = rateTable[String(billableLb)];
        if (!entry) return 0;
        return entry[zoneKey] || 0;
    }
    // >150 lb: proportional
    const rate150 = rateTable[String(MAX_TABLE_LB)];
    if (!rate150) return 0;
    const baseRate150 = rate150[zoneKey] || 0;
    return baseRate150 * (billableLb / MAX_TABLE_LB);
}

// ─── Surcharge Amount ────────────────────────────────────────────────

function getSurchargeAmount(scType, zone, scAmounts) {
    if (scType === 'OK') return 0;
    const zoneData = scAmounts[String(zone)];
    if (!zoneData) return 0;
    const typeMap = {
        'AHS-Dim': 'AHS-Dim',
        'AHS-Wgt': 'AHS-Weight',
        'Oversize': 'Oversize',
        'Unauth': 'Unauthorized',
    };
    return zoneData[typeMap[scType]] || 0;
}

// ─── Residential Charge ──────────────────────────────────────────────

function getResidentialCharge(isResidential, surchargeData) {
    if (!isResidential) return 0;
    return (surchargeData.residential && surchargeData.residential.charge_per_pkg) || 5.95;
}

// ─── DAS Charge ──────────────────────────────────────────────────────

function getDasCharge(dasTier, isResidential, surchargeData) {
    if (!dasTier || dasTier === 'None') return 0;
    const dasTable = surchargeData.das;
    if (!dasTable || !dasTable[dasTier]) return 0;
    const key = isResidential ? 'residential' : 'commercial';
    return dasTable[dasTier][key] || 0;
}

// ─── Line Item Calculation (V2) ──────────────────────────────────────

/**
 * @param {Object} item - { name, L_cm, W_cm, H_cm, weightKg, qty }
 * @param {number} zone
 * @param {number} fuelPct
 * @param {boolean} isResidential
 * @param {string} dasTier - "None"|"Base"|"Extended"|"Remote"|"Alaska"|"Hawaii"|"Intra-Hawaii"
 * @param {Object} rateTable
 * @param {Object} surchargeData - full surcharges.json (amounts, residential, das)
 */
function calcLineItem(item, zone, fuelPct, isResidential, dasTier, rateTable, surchargeData) {
    const { L_cm, W_cm, H_cm, weightKg, qty } = item;
    const scAmounts = surchargeData.amounts;

    const actualLb = kgToLb(weightKg);
    const dimLb = calcDimWeight(L_cm, W_cm, H_cm);

    // V2: pass zone & scAmounts for AHS comparison
    const sc = determineSurcharge(L_cm, W_cm, H_cm, weightKg, zone, scAmounts);

    const billableLb = calcBillableWeight(actualLb, dimLb, sc.minLb);
    const baseRate = lookupRate(billableLb, zone, rateTable);

    // Fuel surcharge on base rate only
    const fuelAmount = baseRate * (fuelPct / 100);
    const rateSubtotal = baseRate + fuelAmount;

    const scAmount = getSurchargeAmount(sc.type, zone, scAmounts);

    // V2: Residential + DAS
    const residentialCharge = getResidentialCharge(isResidential, surchargeData);
    const dasCharge = getDasCharge(dasTier, isResidential, surchargeData);

    // V2 total: (base+fuel) + SC + Residential + DAS
    const perPkgTotal = rateSubtotal + scAmount + residentialCharge + dasCharge;
    const lineTotal = perPkgTotal * qty;

    return {
        name: item.name || '',
        L_cm, W_cm, H_cm, weightKg, qty,
        actualLb: Math.round(actualLb * 100) / 100,
        dimLb: Math.round(dimLb * 100) / 100,
        billableLb,
        baseRate: Math.round(baseRate * 100) / 100,
        fuelAmount: Math.round(fuelAmount * 100) / 100,
        rateSubtotal: Math.round(rateSubtotal * 100) / 100,
        scType: sc.type,
        scReason: sc.reason,
        scAmount: Math.round(scAmount * 100) / 100,
        residentialCharge: Math.round(residentialCharge * 100) / 100,
        dasCharge: Math.round(dasCharge * 100) / 100,
        perPkgTotal: Math.round(perPkgTotal * 100) / 100,
        lineTotal: Math.round(lineTotal * 100) / 100,
    };
}

// ─── Grand Total (V2) ────────────────────────────────────────────────

function calcAll(items, zone, fuelPct, isResidential, dasTier, rateTable, surchargeData) {
    const scAmounts = surchargeData.amounts;

    const lines = items
        .filter(item => item.qty > 0)
        .map(item => calcLineItem(item, zone, fuelPct, isResidential, dasTier, rateTable, surchargeData));

    const grandTotal = lines.reduce((s, l) => s + l.lineTotal, 0);
    const rateSubtotal = lines.reduce((s, l) => s + (l.rateSubtotal * l.qty), 0);
    const scSubtotal = lines.reduce((s, l) => s + (l.scAmount * l.qty), 0);
    const residentialSubtotal = lines.reduce((s, l) => s + (l.residentialCharge * l.qty), 0);
    const dasSubtotal = lines.reduce((s, l) => s + (l.dasCharge * l.qty), 0);

    return {
        lines,
        grandTotal: Math.round(grandTotal * 100) / 100,
        rateSubtotal: Math.round(rateSubtotal * 100) / 100,
        scSubtotal: Math.round(scSubtotal * 100) / 100,
        residentialSubtotal: Math.round(residentialSubtotal * 100) / 100,
        dasSubtotal: Math.round(dasSubtotal * 100) / 100,
    };
}

// ─── Exports ─────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        cmToInchCeil, kgToLb, mmToInchCeil,
        calcDimWeight, determineSurcharge, calcBillableWeight,
        lookupRate, getSurchargeAmount,
        getResidentialCharge, getDasCharge,
        calcLineItem, calcAll,
        DIM_DIVISOR, KG_TO_LB, MAX_TABLE_LB,
    };
}
