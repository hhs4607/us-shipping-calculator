/**
 * Sagawa (사가와) — 일반 택배 + 대형 택배 계산 엔진
 *
 * 두 가지 서비스 등급을 단일 매트릭스로 처리:
 *   일반 택배:  3변 합 ≤160cm AND 무게 ≤30kg → 사이즈 60/80/100/140/160
 *   대형 택배:  3변 합 >160cm OR 무게 >30kg  → 사이즈 170/180/200/220/240/260
 *
 * 일반 등급 결정: applied = MAX(3변 합 tier, 무게 tier)
 * 대형 등급 결정: applied = 3변 합 tier; 무게 30~40kg +¥270, 40~50kg +¥540
 *
 * 한도: 3변 합 ≤260cm, 최장변 ≤170cm, 무게 ≤50kg
 */

// ─── Tier Tables ────────────────────────────────────────────────────

const SAGAWA_STD_TIERS = [60, 80, 100, 140, 160];
const SAGAWA_LARGE_TIERS = [170, 180, 200, 220, 240, 260];
const SAGAWA_ALL_TIERS = [...SAGAWA_STD_TIERS, ...SAGAWA_LARGE_TIERS];

const SAGAWA_STD_WEIGHT_LIMITS = { 60: 2, 80: 5, 100: 10, 140: 20, 160: 30 };

const SAGAWA_MAX_THREE_SIDE_CM = 260;
const SAGAWA_MAX_LONGEST_CM = 170;
const SAGAWA_MAX_WEIGHT_KG = 50;
const SAGAWA_STD_THREE_SIDE_LIMIT_CM = 160;
const SAGAWA_STD_WEIGHT_LIMIT_KG = 30;

// ─── Tier Helpers ───────────────────────────────────────────────────

function sagawaSumToTier(sumCm) {
  for (const tier of SAGAWA_ALL_TIERS) {
    if (sumCm <= tier) return tier;
  }
  return null;
}

function sagawaWeightToStdTier(weightKg) {
  for (const tier of SAGAWA_STD_TIERS) {
    if (weightKg <= SAGAWA_STD_WEIGHT_LIMITS[tier]) return tier;
  }
  return null;
}

// ─── Size Determination ─────────────────────────────────────────────

function sagawaCalcSize(L_cm, W_cm, H_cm, weightKg) {
  const dims = [L_cm, W_cm, H_cm].sort((a, b) => b - a);
  const longest = dims[0];
  const threeSideSum = L_cm + W_cm + H_cm;

  if (longest > SAGAWA_MAX_LONGEST_CM) {
    return { error: true, reason: `최장변 ${longest.toFixed(0)}cm > ${SAGAWA_MAX_LONGEST_CM}cm 초과`, threeSideSum, longest };
  }
  if (threeSideSum > SAGAWA_MAX_THREE_SIDE_CM) {
    return { error: true, reason: `3변 합 ${threeSideSum.toFixed(0)}cm > ${SAGAWA_MAX_THREE_SIDE_CM}cm 초과`, threeSideSum, longest };
  }
  if (weightKg > SAGAWA_MAX_WEIGHT_KG) {
    return { error: true, reason: `중량 ${weightKg.toFixed(1)}kg > ${SAGAWA_MAX_WEIGHT_KG}kg 초과`, threeSideSum, longest };
  }

  const isStandard = threeSideSum <= SAGAWA_STD_THREE_SIDE_LIMIT_CM && weightKg <= SAGAWA_STD_WEIGHT_LIMIT_KG;
  const sumTier = sagawaSumToTier(threeSideSum);
  if (!sumTier) {
    return { error: true, reason: '사이즈 초과', threeSideSum, longest };
  }

  let appliedSize, sizeSource, weightTier = null, reason;

  if (isStandard) {
    weightTier = sagawaWeightToStdTier(weightKg);
    appliedSize = Math.max(sumTier, weightTier);
    sizeSource = sumTier >= weightTier ? 'sum' : 'weight';
    reason = sizeSource === 'sum'
      ? `3변 합 ${threeSideSum.toFixed(0)}cm → 사이즈 ${sumTier}`
      : `중량 ${weightKg.toFixed(1)}kg → 사이즈 ${weightTier}`;
  } else {
    // 대형 서비스: 3변 합 기준만 사용. 3변 합 ≤160이고 무게 >30kg이면 최소 170 강제
    appliedSize = sumTier < 170 ? 170 : sumTier;
    sizeSource = appliedSize === sumTier ? 'sum' : 'weight_force';
    reason = sizeSource === 'sum'
      ? `3변 합 ${threeSideSum.toFixed(0)}cm → 사이즈 ${sumTier} (대형)`
      : `중량 ${weightKg.toFixed(1)}kg > 30kg → 사이즈 170 (대형)`;
  }

  return {
    error: false,
    threeSideSum: Math.round(threeSideSum * 10) / 10,
    longest: Math.round(longest * 10) / 10,
    sumTier,
    weightTier,
    appliedSize,
    sizeSource,
    serviceTier: isStandard ? 'standard' : 'large',
    reason,
  };
}

// ─── Rate Lookup ────────────────────────────────────────────────────

function sagawaLookupRate(origin, destination, appliedSize, rates) {
  const originRates = rates[origin];
  if (!originRates) return 0;
  const sizeRates = originRates[String(appliedSize)];
  if (!sizeRates) return 0;
  return sizeRates[destination] || 0;
}

// ─── Surcharges ─────────────────────────────────────────────────────

function sagawaGetCoolSurcharge(appliedSize, weightKg, coolType, surcharges) {
  if (!coolType || coolType === 'none') return 0;
  const cool = surcharges.cool;
  if (!cool) return 0;
  // Cool service unavailable above 140-size or above 30kg.
  if (appliedSize > 140 || weightKg > 30) return null;
  // Special "extra_large" 140-size with up to 30kg
  if (appliedSize === 140 && weightKg > 20 && cool.extra_large) {
    return cool.extra_large.fee || cool[String(appliedSize)] || 0;
  }
  return cool[String(appliedSize)] || 0;
}

function sagawaGetWeightSurcharge(weightKg, serviceTier, surcharges) {
  if (serviceTier !== 'large') return 0;
  const w = surcharges.weight_over_30kg;
  if (!w) return 0;
  if (weightKg > 40) return w['40_to_50_kg'] || 540;
  if (weightKg > 30) return w['30_to_40_kg'] || 270;
  return 0;
}

function sagawaGetBranchDropoffDiscount(branchDropoff, surcharges) {
  if (!branchDropoff) return 0;
  const d = surcharges.branch_dropoff_discount;
  if (!d) return -100;
  return d.fee || -100;
}

// ─── Line Item Calculation ──────────────────────────────────────────

function sagawaCalcLineItem(item, origin, destination, coolType, branchDropoff, rates, surcharges) {
  const { L_cm, W_cm, H_cm, weightKg, qty } = item;
  const size = sagawaCalcSize(L_cm, W_cm, H_cm, weightKg);

  if (size.error) {
    return {
      name: item.name || '',
      L_cm, W_cm, H_cm, weightKg, qty,
      error: true,
      errorReason: size.reason,
      threeSideSum: size.threeSideSum,
      longest: size.longest,
      appliedSize: null,
      serviceTier: null,
      baseRate: 0,
      coolSurcharge: 0,
      coolError: false,
      weightSurcharge: 0,
      branchDiscount: 0,
      perPkgTotal: 0,
      lineTotal: 0,
    };
  }

  const baseRate = sagawaLookupRate(origin, destination, size.appliedSize, rates);
  const coolRaw = sagawaGetCoolSurcharge(size.appliedSize, weightKg, coolType, surcharges);
  const coolError = coolRaw === null;
  const coolSurcharge = coolError ? 0 : coolRaw;
  const weightSurcharge = sagawaGetWeightSurcharge(weightKg, size.serviceTier, surcharges);
  const branchDiscount = sagawaGetBranchDropoffDiscount(branchDropoff, surcharges);

  const perPkgTotal = Math.max(0, baseRate + coolSurcharge + weightSurcharge + branchDiscount);
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
    serviceTier: size.serviceTier,
    baseRate,
    coolSurcharge,
    coolError,
    weightSurcharge,
    branchDiscount,
    perPkgTotal,
    lineTotal,
  };
}

function sagawaCalcAll(items, origin, destination, coolType, branchDropoff, rates, surcharges) {
  const lines = items
    .filter(item => item.qty > 0)
    .map(item => sagawaCalcLineItem(item, origin, destination, coolType, branchDropoff, rates, surcharges));

  const grandTotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const baseSubtotal = lines.reduce((s, l) => s + (l.baseRate * l.qty), 0);
  const coolSubtotal = lines.reduce((s, l) => s + (l.coolSurcharge * l.qty), 0);
  const weightSubtotal = lines.reduce((s, l) => s + (l.weightSurcharge * l.qty), 0);
  const branchSubtotal = lines.reduce((s, l) => s + (l.branchDiscount * l.qty), 0);

  return {
    lines,
    grandTotal,
    baseSubtotal,
    coolSubtotal,
    weightSubtotal,
    branchSubtotal,
  };
}

// ─── Region mapping (Sagawa 13 → Yamato 12) ─────────────────────────
// Used by JP UI to drive both carriers from a single origin/dest selector.

const SAGAWA_TO_YAMATO_REGION = {
  hokkaido: 'hokkaido',
  kita_tohoku: 'kita_tohoku',
  minami_tohoku: 'minami_tohoku',
  kanto: 'kanto',
  shin_etsu: 'shin_etsu',
  tokai: 'chubu',          // Same prefectures, different label
  hokuriku: 'hokuriku',
  kansai: 'kansai',
  chugoku: 'chugoku',
  shikoku: 'shikoku',
  kita_kyushu: 'kyushu',   // Yamato collapses Kyushu
  minami_kyushu: 'kyushu',
  okinawa: 'okinawa',
};

// ─── Exports ────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sagawaCalcSize, sagawaLookupRate,
    sagawaGetCoolSurcharge, sagawaGetWeightSurcharge, sagawaGetBranchDropoffDiscount,
    sagawaCalcLineItem, sagawaCalcAll,
    SAGAWA_STD_TIERS, SAGAWA_LARGE_TIERS, SAGAWA_ALL_TIERS,
    SAGAWA_STD_WEIGHT_LIMITS,
    SAGAWA_MAX_THREE_SIDE_CM, SAGAWA_MAX_LONGEST_CM, SAGAWA_MAX_WEIGHT_KG,
    SAGAWA_TO_YAMATO_REGION,
  };
}
