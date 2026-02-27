/**
 * Yamato Transport TA-Q-BIN — Shipping Cost Calculator Engine
 *
 * Size determination: Applied Size = MAX(3-side-sum tier, weight tier)
 * No DIM divisor formula. All rates in JPY (tax included).
 *
 * Effective: 2025-12-01 (standard), 2025-11-10 (intraprefectural)
 */

// ─── Size Tier Rules ────────────────────────────────────────────────

const YAMATO_SIZE_TIERS = [60, 80, 100, 120, 140, 160, 180, 200];

const YAMATO_WEIGHT_LIMITS = {
  60: 2, 80: 5, 100: 10, 120: 15, 140: 20, 160: 25, 180: 30, 200: 30
};

const YAMATO_MAX_THREE_SIDE_CM = 200;
const YAMATO_MAX_LONGEST_CM = 170;
const YAMATO_MAX_WEIGHT_KG = 30;

// ─── Size Tier Determination ────────────────────────────────────────

function yamatoSizeTierFromSum(sumCm) {
  for (const tier of YAMATO_SIZE_TIERS) {
    if (sumCm <= tier) return tier;
  }
  return null; // exceeds 200cm
}

function yamatoSizeTierFromWeight(weightKg) {
  for (const tier of YAMATO_SIZE_TIERS) {
    if (weightKg <= YAMATO_WEIGHT_LIMITS[tier]) return tier;
  }
  return null; // exceeds 30kg
}

function yamatoCalcSize(L_cm, W_cm, H_cm, weightKg) {
  const dims = [L_cm, W_cm, H_cm].sort((a, b) => b - a);
  const longest = dims[0];
  const threeSideSum = L_cm + W_cm + H_cm;

  // Validate limits
  if (longest > YAMATO_MAX_LONGEST_CM) {
    return {
      error: true,
      reason: `最長辺 ${longest.toFixed(0)}cm > ${YAMATO_MAX_LONGEST_CM}cm 超過`,
      threeSideSum, longest
    };
  }
  if (threeSideSum > YAMATO_MAX_THREE_SIDE_CM) {
    return {
      error: true,
      reason: `3辺合計 ${threeSideSum.toFixed(0)}cm > ${YAMATO_MAX_THREE_SIDE_CM}cm 超過`,
      threeSideSum, longest
    };
  }
  if (weightKg > YAMATO_MAX_WEIGHT_KG) {
    return {
      error: true,
      reason: `重量 ${weightKg.toFixed(1)}kg > ${YAMATO_MAX_WEIGHT_KG}kg 超過`,
      threeSideSum, longest
    };
  }

  const sumTier = yamatoSizeTierFromSum(threeSideSum);
  const weightTier = yamatoSizeTierFromWeight(weightKg);

  if (!sumTier || !weightTier) {
    return {
      error: true,
      reason: 'サイズ超過',
      threeSideSum, longest
    };
  }

  const appliedSize = Math.max(sumTier, weightTier);
  const sizeSource = sumTier >= weightTier ? 'sum' : 'weight';

  return {
    error: false,
    threeSideSum: Math.round(threeSideSum * 10) / 10,
    longest: Math.round(longest * 10) / 10,
    sumTier,
    weightTier,
    appliedSize,
    sizeSource,
    reason: sizeSource === 'sum'
      ? `3辺計 ${threeSideSum.toFixed(0)}cm → Size ${sumTier}`
      : `重量 ${weightKg.toFixed(1)}kg → Size ${weightTier}`
  };
}

// ─── Rate Lookup ────────────────────────────────────────────────────

function yamatoLookupRate(origin, destination, appliedSize, payment, ratesCash, ratesCashless, ratesIntrapref, samePrefecture) {
  // Intraprefectural rate takes priority (excl. Okinawa)
  if (samePrefecture && origin !== 'okinawa') {
    const intrapref = payment === 'cash' ? ratesIntrapref.cash : ratesIntrapref.cashless;
    const rate = intrapref[String(appliedSize)];
    if (rate != null) return { rate, isIntrapref: true };
  }

  const rates = payment === 'cash' ? ratesCash : ratesCashless;
  const originRates = rates[origin];
  if (!originRates) return { rate: 0, isIntrapref: false };
  const sizeRates = originRates[String(appliedSize)];
  if (!sizeRates) return { rate: 0, isIntrapref: false };
  const rate = sizeRates[destination];
  if (rate == null) return { rate: 0, isIntrapref: false };
  return { rate, isIntrapref: false };
}

// ─── Cool Surcharge ─────────────────────────────────────────────────

function yamatoGetCoolSurcharge(appliedSize, coolType, surcharges) {
  if (!coolType || coolType === 'none') return 0;
  if (appliedSize > 120) return null; // Cool service max size is 120
  const coolData = surcharges.cool;
  if (!coolData) return 0;
  return coolData[String(appliedSize)] || 0;
}

// ─── Same-Day Surcharge ─────────────────────────────────────────────

function yamatoGetSameDaySurcharge(sameDay, origin, destination, surcharges) {
  if (!sameDay) return 0;
  const sd = surcharges.same_day;
  if (!sd) return 550;
  if (origin === 'okinawa' || destination === 'okinawa') return sd.okinawa || 330;
  return sd.standard || 550;
}

// ─── Discounts ──────────────────────────────────────────────────────

function yamatoCalcDiscounts(selectedDiscounts, discountDefs) {
  let total = 0;
  const applied = [];

  // member_dropoff replaces standard dropoff
  const hasDropoff = selectedDiscounts.includes('dropoff');
  const hasMemberDropoff = selectedDiscounts.includes('member_dropoff');

  for (const key of selectedDiscounts) {
    // Skip standard dropoff if member dropoff is selected
    if (key === 'dropoff' && hasMemberDropoff) continue;
    const def = discountDefs[key];
    if (def) {
      total += def.amount; // amounts are negative
      applied.push({ key, name: def.name_ja, amount: def.amount });
    }
  }

  return { total, applied };
}

// ─── Line Item Calculation ──────────────────────────────────────────

/**
 * @param {Object} item - { name, L_cm, W_cm, H_cm, weightKg, qty }
 * @param {string} origin - zone id
 * @param {string} destination - zone id
 * @param {string} payment - 'cash' | 'cashless'
 * @param {boolean} samePrefecture
 * @param {string} coolType - 'none' | 'chilled' | 'frozen'
 * @param {boolean} sameDay
 * @param {string[]} selectedDiscounts - ['dropoff', 'digital', ...]
 * @param {Object} ratesCash
 * @param {Object} ratesCashless
 * @param {Object} ratesIntrapref
 * @param {Object} surcharges
 * @param {Object} discounts
 */
function yamatoCalcLineItem(item, origin, destination, payment, samePrefecture, coolType, sameDay, selectedDiscounts, ratesCash, ratesCashless, ratesIntrapref, surcharges, discounts) {
  const { L_cm, W_cm, H_cm, weightKg, qty } = item;

  const size = yamatoCalcSize(L_cm, W_cm, H_cm, weightKg);

  if (size.error) {
    return {
      name: item.name || '',
      L_cm, W_cm, H_cm, weightKg, qty,
      error: true,
      errorReason: size.reason,
      threeSideSum: size.threeSideSum,
      longest: size.longest,
      appliedSize: null,
      baseRate: 0,
      coolSurcharge: 0,
      sameDaySurcharge: 0,
      discountTotal: 0,
      discountDetails: [],
      perPkgTotal: 0,
      lineTotal: 0,
      isIntrapref: false,
    };
  }

  const { rate, isIntrapref } = yamatoLookupRate(
    origin, destination, size.appliedSize, payment,
    ratesCash, ratesCashless, ratesIntrapref, samePrefecture
  );

  const coolSurcharge = yamatoGetCoolSurcharge(size.appliedSize, coolType, surcharges);
  const coolError = coolSurcharge === null;
  const coolAmount = coolError ? 0 : coolSurcharge;

  const sameDaySurcharge = yamatoGetSameDaySurcharge(sameDay, origin, destination, surcharges);

  const discountCalc = yamatoCalcDiscounts(selectedDiscounts, discounts);

  const perPkgTotal = Math.max(0, rate + coolAmount + sameDaySurcharge + discountCalc.total);
  const lineTotal = perPkgTotal * qty;

  return {
    name: item.name || '',
    L_cm, W_cm, H_cm, weightKg, qty,
    error: false,
    threeSideSum: size.threeSideSum,
    longest: size.longest,
    sumTier: size.sumTier,
    weightTier: size.weightTier,
    appliedSize: size.appliedSize,
    sizeSource: size.sizeSource,
    sizeReason: size.reason,
    baseRate: rate,
    isIntrapref,
    coolSurcharge: coolAmount,
    coolError,
    sameDaySurcharge,
    discountTotal: discountCalc.total,
    discountDetails: discountCalc.applied,
    perPkgTotal,
    lineTotal,
  };
}

// ─── Grand Total ────────────────────────────────────────────────────

function yamatoCalcAll(items, origin, destination, payment, samePrefecture, coolType, sameDay, selectedDiscounts, ratesCash, ratesCashless, ratesIntrapref, surcharges, discounts) {
  const lines = items
    .filter(item => item.qty > 0)
    .map(item => yamatoCalcLineItem(
      item, origin, destination, payment, samePrefecture,
      coolType, sameDay, selectedDiscounts,
      ratesCash, ratesCashless, ratesIntrapref, surcharges, discounts
    ));

  const grandTotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const baseSubtotal = lines.reduce((s, l) => s + (l.baseRate * l.qty), 0);
  const coolSubtotal = lines.reduce((s, l) => s + (l.coolSurcharge * l.qty), 0);
  const sameDaySubtotal = lines.reduce((s, l) => s + (l.sameDaySurcharge * l.qty), 0);
  const discountSubtotal = lines.reduce((s, l) => s + (l.discountTotal * l.qty), 0);

  return {
    lines,
    grandTotal,
    baseSubtotal,
    coolSubtotal,
    sameDaySubtotal,
    discountSubtotal,
  };
}

// ─── Exports ────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    yamatoCalcSize, yamatoLookupRate,
    yamatoGetCoolSurcharge, yamatoGetSameDaySurcharge,
    yamatoCalcDiscounts, yamatoCalcLineItem, yamatoCalcAll,
    YAMATO_SIZE_TIERS, YAMATO_WEIGHT_LIMITS,
    YAMATO_MAX_THREE_SIDE_CM, YAMATO_MAX_LONGEST_CM, YAMATO_MAX_WEIGHT_KG,
  };
}
