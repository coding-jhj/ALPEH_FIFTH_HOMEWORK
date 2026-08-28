/**
 * fixture 9종 전수 자동 대조기.
 * README의 재생 순서를 그대로 돌려 각 fixture의 expected와 실제 상태를 비교합니다.
 * 실행: npm run verify
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { FIXTURES } from '../src/lib/fixtures';
import { resetEvaluationState, runFixture } from '../src/lib/replay';
import type { BoardState } from '../src/lib/types';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: 실제=${JSON.stringify(actual)} 기대=${JSON.stringify(expected)}`);
}

function assertExpected(state: BoardState, fixtureId: string) {
  const expected = FIXTURES[fixtureId].expected;
  console.log(`\n[${fixtureId}] ${FIXTURES[fixtureId].description_ko}`);
  check('freshness', state.status?.freshness, expected.freshness);
  check('error_code', state.status?.error_code, expected.error_code);
  check('row_count', state.daily_readings.length, expected.row_count);

  const lastGood = state.current_reading?.normalized_value ?? null;
  check('stored_value(마지막 정상값)', lastGood, expected.stored_value);

  const delta = state.comparison.state === 'comparable' ? state.comparison.magnitude : null;
  check('delta(어제 대비 절대값)', delta, expected.delta);

  if (expected.record_date) {
    const row = state.daily_readings.find((r) => r.record_date === expected.record_date);
    check(`record_date ${expected.record_date} 행 존재`, Boolean(row), true);
  }
  if (expected.preserve_last_good) {
    check('마지막 정상값 보존', state.current_reading !== null, true);
  }
}

function play(ids: string[]): BoardState {
  let state = resetEvaluationState();
  for (const id of ids) state = runFixture(state, FIXTURES[id]);
  return state;
}

console.log('=== 0. fixture 사본 무결성: src/fixtures 와 public/fixtures 가 같은가 ===');
{
  const names = fs.readdirSync('src/fixtures').sort();
  check('파일 개수', names.length, 9);
  for (const name of names) {
    const a = crypto.createHash('sha256').update(fs.readFileSync(`src/fixtures/${name}`)).digest('hex');
    const b = crypto.createHash('sha256').update(fs.readFileSync(`public/fixtures/${name}`)).digest('hex');
    check(`${name} 해시 일치`, a, b);
  }
}

console.log('\n=== 1. 정상·일별 저장: reset → D1-A → D1-B → D2 ===');
{
  let state = resetEvaluationState();
  state = runFixture(state, FIXTURES['T04-NORMAL-D1-A']);
  assertExpected(state, 'T04-NORMAL-D1-A');
  const firstRecordId = state.daily_readings[0].record_id;

  state = runFixture(state, FIXTURES['T04-NORMAL-D1-B']);
  assertExpected(state, 'T04-NORMAL-D1-B');
  check('same_record_id_as D1-A (T04-C20)', state.daily_readings[0].record_id, firstRecordId);

  state = runFixture(state, FIXTURES['T04-NORMAL-D2']);
  assertExpected(state, 'T04-NORMAL-D2');
  check('D2 신규 행 생성 (T04-C21)', state.daily_readings.length, 2);
}

console.log('\n=== 2. 같은 KST 날짜 3회 성공 → 행 1건 (T04-C20 실측) ===');
{
  const state = play(['T04-NORMAL-D1-A', 'T04-NORMAL-D1-B', 'T04-NORMAL-D1-B']);
  check('행 수', state.daily_readings.length, 1);
  check('저장값', state.daily_readings[0].normalized_value, 105);
}

console.log('\n=== 3. 실패 5종: reset → D1-A → D1-B → 실패 1개 ===');
for (const id of ['T04-TIMEOUT', 'T04-AUTH-401', 'T04-RATE-429', 'T04-OFFLINE', 'T04-SCHEMA-BREAK']) {
  const state = play(['T04-NORMAL-D1-A', 'T04-NORMAL-D1-B', id]);
  assertExpected(state, id);
  check('실패 뒤 일별 행 보존 (T04-C17)', state.daily_readings[0].normalized_value, 105);
}

console.log('\n=== 4. 오류 뒤 회복: reset → D1-A → D1-B → TIMEOUT → RECOVER-D2 (T04-C19) ===');
{
  let state = play(['T04-NORMAL-D1-A', 'T04-NORMAL-D1-B', 'T04-TIMEOUT']);
  console.log('  [다시 시도 전]');
  check('freshness', state.status?.freshness, 'stale');
  check('error_code', state.status?.error_code, 'timeout');
  check('daily_row_count', state.daily_readings.length, 1);
  check('last_good_value', state.current_reading?.normalized_value, 105);
  check('record_date', state.daily_readings[0].record_date, '2026-08-24');

  const before = state.daily_readings.length;
  state = runFixture(state, FIXTURES['T04-RECOVER-D2']);
  console.log('  [다시 시도 후]');
  check('freshness', state.status?.freshness, 'fresh');
  check('error_code', state.status?.error_code, 'none');
  check('daily_row_count', state.daily_readings.length, 2);
  check('new_next_date_rows', state.daily_readings.length - before, 1);
  check('stored_value', state.current_reading?.normalized_value, 120);
  check('record_date', state.daily_readings[1].record_date, '2026-08-25');
  check('어제 대비 재계산', state.comparison.magnitude, 15);
}

console.log('\n=== 5. 다섯 실패가 서로 다른 error_code인지 (T04-C12~C16) ===');
{
  const codes = ['T04-TIMEOUT', 'T04-AUTH-401', 'T04-RATE-429', 'T04-OFFLINE', 'T04-SCHEMA-BREAK'].map(
    (id) => play(['T04-NORMAL-D1-A', 'T04-NORMAL-D1-B', id]).status?.error_code,
  );
  check('error_code 5종', codes, ['timeout', 'auth', 'rate_limit', 'offline', 'schema_error']);
  check('중복 없음', new Set(codes).size, 5);
}

console.log(`\n${failures === 0 ? '전부 통과' : `실패 ${failures}건`}`);
process.exit(failures === 0 ? 0 : 1);
