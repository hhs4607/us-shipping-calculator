#!/usr/bin/env node
/**
 * JP Compliance Test — 공식 규정과의 일치성 감사
 *
 * 이 테스트는 "코드가 일관되게 동작하는지"가 아니라 "공식 운송사 규정과
 * 일치하는지"를 검증합니다. 실패 시 데이터 또는 엔진을 공식 규정에 맞게
 * 수정해야 함.
 *
 * Sources (verified 2026-04):
 *  - Yamato 持込割: kuronekoyamato.co.jp (FAQ id=1782) — ¥100/개
 *  - Yamato 회원 持込割: kuronekoyamato.co.jp/ytc/customer/send/services/takkyubin/ — ¥150/개
 *  - Sagawa 通常配達 30kg 초과: sagawa-exp.co.jp/fare/attention.html — 별도 할증 없음, 50kg 운임 적용
 *  - Sagawa Cool 요금: sagawa-exp.co.jp/fare/cool_faretable.html — 60/80/100/140 = 275/330/440/880, 특대 1320
 *
 * Run: node tests/jp-compliance.test.js
 */

const fs = require('fs');
const path = require('path');

const sg = require('../js/sagawa-calculator.js');
const ym = require('../js/yamato-calculator.js');

const ymDiscounts = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public/data/2025/yamato/discounts.json')));
const sgSurcharges = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public/data/2025/sagawa/surcharges.json')));
const sgRates = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public/data/2025/sagawa/rates.json')));
const ymSurcharges = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public/data/2025/yamato/surcharges.json')));

let pass = 0, fail = 0, warn = 0;
const failures = [];

function check(label, cond, expected, got) {
  if (cond) { console.log('  ✓ ' + label); pass++; }
  else      {
    console.log('  ✗ ' + label + (expected !== undefined ? `  (예상 ${expected}, 실제 ${got})` : ''));
    fail++; failures.push(label);
  }
}
function note(label, msg) {
  console.log('  ⚠ ' + label + ': ' + msg);
  warn++;
}

console.log('═══════ JP 공식 규정 일치성 감사 ═══════\n');

console.log('[A] Yamato 지참할인 (持込割)');
check('일반 지참할인 = -¥100 (공식)', ymDiscounts.dropoff.amount === -100, -100, ymDiscounts.dropoff.amount);
check('회원 지참할인 = -¥150 (공식)', ymDiscounts.member_dropoff.amount === -150, -150, ymDiscounts.member_dropoff.amount);
check('디지털할인 = -¥60', ymDiscounts.digital.amount === -60, -60, ymDiscounts.digital.amount);
check('복수구할인 = -¥100', ymDiscounts.multi_package.amount === -100, -100, ymDiscounts.multi_package.amount);
check('영업소 수취 할인 = -¥60', ymDiscounts.branch_pickup.amount === -60, -60, ymDiscounts.branch_pickup.amount);

console.log('\n[B] Yamato Cool 할증');
check('60 사이즈 Cool = +¥275', ymSurcharges.cool['60'] === 275);
check('80 사이즈 Cool = +¥330', ymSurcharges.cool['80'] === 330);
check('100 사이즈 Cool = +¥440', ymSurcharges.cool['100'] === 440);
check('120 사이즈 Cool = +¥715', ymSurcharges.cool['120'] === 715);

console.log('\n[C] Sagawa 30kg 초과 통상 배송 — 별도 할증 없음 (공식)');
const test35 = sg.sagawaCalcLineItem(
  { name: '35kg', L_cm: 50, W_cm: 50, H_cm: 50, weightKg: 35, qty: 1 },
  'kanto', 'kansai', 'none', false, sgRates, sgSurcharges
);
check('35kg → 라지 서비스 적용', test35.serviceTier === 'large', 'large', test35.serviceTier);
check('35kg → 중량 할증 0 (통상 배송)', test35.weightSurcharge === 0, 0, test35.weightSurcharge);
check('35kg → 합계 == 라지 매트릭스 기본운임 그대로',
  test35.perPkgTotal === test35.baseRate, '동일', `base=${test35.baseRate} total=${test35.perPkgTotal}`);

const test45 = sg.sagawaCalcLineItem(
  { name: '45kg', L_cm: 60, W_cm: 60, H_cm: 60, weightKg: 45, qty: 1 },
  'kanto', 'kansai', 'none', false, sgRates, sgSurcharges
);
check('45kg → 중량 할증 0 (통상 배송)', test45.weightSurcharge === 0, 0, test45.weightSurcharge);

console.log('\n[D] Sagawa Cool 할증');
check('60 사이즈 Cool = +¥275', sgSurcharges.cool['60'] === 275);
check('80 사이즈 Cool = +¥330', sgSurcharges.cool['80'] === 330);
check('100 사이즈 Cool = +¥440', sgSurcharges.cool['100'] === 440);
check('140 사이즈 Cool = +¥880', sgSurcharges.cool['140'] === 880);
check('140 (20-30kg) 특대 Cool = +¥1,320', sgSurcharges.cool.extra_large.fee === 1320);

console.log('\n[E] Sagawa 영업소 반입 할인');
check('영업소 반입 = -¥100', sgSurcharges.branch_dropoff_discount.fee === -100);

console.log('\n[F] Sagawa 사이즈 한도 (공식)');
check('일반 (3변합 ≤160 + 무게 ≤30)', sg.sagawaCalcSize(50, 50, 60, 5).serviceTier === 'standard');
check('일반 무게 30kg 경계', sg.sagawaCalcSize(50, 50, 50, 30).serviceTier === 'standard');
check('대형 (3변합 161~260)', sg.sagawaCalcSize(80, 80, 80, 10).serviceTier === 'large');
check('3변합 >260cm → 에러', sg.sagawaCalcSize(100, 100, 100, 30).error === true);
check('무게 >50kg → 에러', sg.sagawaCalcSize(50, 50, 50, 51).error === true);

console.log('\n[G] Yamato 사이즈 한도 (공식)');
check('야마토 정상 범위', !ym.yamatoCalcSize(60, 70, 70, 25).error);
check('야마토 3변합 >200cm → 에러', ym.yamatoCalcSize(80, 80, 80, 10).error === true);
check('야마토 무게 >30kg → 에러', ym.yamatoCalcSize(50, 50, 50, 31).error === true);
check('야마토 최장변 >170cm → 에러', ym.yamatoCalcSize(180, 10, 10, 5).error === true);

console.log('\n[H] 익일/항공편 중량 할증 정의 (참고용)');
note('Sagawa 익일/오전 +¥2,200/10kg 미구현',
  '통상 배송만 지원. weight_over_30kg.next_day_air_per_10kg = ¥' +
  sgSurcharges.weight_over_30kg.next_day_air_per_10kg + ' (오키나와 ¥' +
  sgSurcharges.weight_over_30kg.next_day_air_okinawa_per_10kg + ') — 데이터 보존됨, UI 미노출');

console.log('\n──────────────────────────────────');
console.log(`Passed: ${pass}   Failed: ${fail}   Warnings: ${warn}`);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('모든 공식 규정 일치성 감사 통과.');
