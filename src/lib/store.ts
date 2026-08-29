// 저장 계층 — Supabase Postgres.
// 같은 (signal_id, record_date)에는 새 행을 만들지 않고 원자적으로 갱신합니다 (T04-C20).
// 실패는 daily_readings를 절대 건드리지 않습니다 (T04-C17).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { computeComparison, rowFromReading } from './core';
import type { Comparison, DailyRow, ErrorCode, NormalizedReading, ReadingStatus } from './types';

let client: SupabaseClient | null = null;

/**
 * 서버 전용 클라이언트. service role 키는 서버 환경변수에서만 읽으며
 * 브라우저 번들·네트워크 응답에 절대 나가지 않습니다 (T04-C11).
 */
export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다');
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export interface LiveBoard {
  rows: DailyRow[];
  current: DailyRow | null;
  /** null = 아직 한 번도 조회하지 않음. 실패(stale)와 반드시 구분합니다. */
  status: ReadingStatus | null;
  comparison: Comparison;
  last_run_at: string | null;
  retry_after_seconds: number | null;
}

export async function loadBoard(signalId: string): Promise<LiveBoard> {
  const supabase = db();

  const { data: rowData, error: rowError } = await supabase
    .from('daily_readings')
    .select('*')
    .eq('signal_id', signalId)
    .order('record_date', { ascending: true });
  if (rowError) throw new Error(rowError.message);

  const rows = (rowData ?? []) as DailyRow[];
  const current = rows.length > 0 ? rows[rows.length - 1] : null;

  const { data: statusData } = await supabase
    .from('reading_status')
    .select('*')
    .eq('signal_id', signalId)
    .maybeSingle();

  // 한 번도 조회하지 않은 상태를 실패로 표시하면 심사자가 첫 화면에서 거짓 오류를 봅니다.
  // 기록이 없으면 status는 null로 두고, 화면에서 "아직 조회 전"으로 그립니다.
  const status: ReadingStatus | null = statusData
    ? { freshness: statusData.freshness, error_code: statusData.error_code }
    : null;

  return {
    rows,
    current,
    status,
    // 어제 대비는 저장하지 않고 매번 두 저장값에서 다시 계산합니다 (T04-C24).
    comparison: computeComparison(rows, current),
    last_run_at: statusData?.last_run_at ?? null,
    retry_after_seconds: statusData?.retry_after_seconds ?? null,
  };
}

/**
 * 저장 결과.
 * stored   = 일별 행을 쓰거나 갱신했다
 * locked   = RECORD_LOCKED=true — 조회는 했지만 저장값을 건드리지 않았다 (T04-C23)
 * date_cap = MAX_RECORD_DATES 상한에 걸려 새 날짜 행을 만들지 않았다
 */
export type StoreOutcome = 'stored' | 'locked' | 'date_cap';

/** 봉인 뒤 저장값 동결 스위치. 2일차 영수증을 봉인한 다음 켭니다. */
export function recordLocked(): boolean {
  return process.env.RECORD_LOCKED === 'true';
}

/**
 * 보존할 서로 다른 날짜 수의 상한. 비워 두면 무제한으로 매일 쌓습니다.
 * 앱 저장 기록 자체를 2건으로 묶고 싶을 때만 2를 넣습니다.
 */
export function maxRecordDates(): number | null {
  const raw = process.env.MAX_RECORD_DATES;
  if (!raw || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** 쓰기 여부 판정만 떼어 낸 순수 함수 — DB 없이 시험합니다. */
export function storeDecision(opts: {
  locked: boolean;
  rowExists: boolean;
  distinctDates: number;
  maxDates: number | null;
}): StoreOutcome {
  if (opts.locked) return 'locked';
  if (!opts.rowExists && opts.maxDates !== null && opts.distinctDates >= opts.maxDates) {
    return 'date_cap';
  }
  return 'stored';
}

/**
 * 성공 저장: upsert 한 번으로 같은 날 중복 행을 막습니다.
 * 봉인된 영수증 payload와 저장값이 어긋나지 않도록 두 가지를 막습니다.
 *  - RECORD_LOCKED=true 면 일별 행을 아예 쓰지 않습니다 (T04-C23).
 *  - MAX_RECORD_DATES를 넘는 새 날짜 행은 만들지 않습니다 (기본값 무제한).
 * 두 경우 모두 조회 자체는 성공이므로 status는 fresh/none으로 갱신합니다.
 */
export async function storeSuccess(reading: NormalizedReading): Promise<StoreOutcome> {
  const supabase = db();
  const locked = recordLocked();

  let existing: DailyRow | null = null;
  let distinctDates = 0;
  if (!locked) {
    const { data: dateRows, error: dateError } = await supabase
      .from('daily_readings')
      .select('*')
      .eq('signal_id', reading.signal_id);
    if (dateError) throw new Error(dateError.message);
    const rows = (dateRows ?? []) as DailyRow[];
    existing = rows.find((r) => String(r.record_date) === reading.record_date) ?? null;
    distinctDates = new Set(rows.map((r) => String(r.record_date))).size;
  }

  const outcome = storeDecision({
    locked,
    rowExists: existing !== null,
    distinctDates,
    maxDates: maxRecordDates(),
  });

  if (outcome === 'stored') {
    const row = rowFromReading(reading, existing);
    const { error } = await supabase
      .from('daily_readings')
      .upsert(row, { onConflict: 'signal_id,record_date' });
    if (error) throw new Error(error.message);
  }

  await supabase.from('reading_status').upsert(
    {
      signal_id: reading.signal_id,
      freshness: 'fresh',
      error_code: 'none',
      last_run_at: reading.fetched_at,
      retry_after_seconds: null,
    },
    { onConflict: 'signal_id' },
  );

  return outcome;
}

/** 실패 기록: status만 갱신합니다. daily_readings는 읽지도 쓰지도 않습니다. */
export async function storeFailure(
  signalId: string,
  errorCode: Exclude<ErrorCode, 'none'>,
  retryAfterSeconds: number | null,
  at: string,
): Promise<void> {
  const supabase = db();
  const { error } = await supabase.from('reading_status').upsert(
    {
      signal_id: signalId,
      freshness: 'stale',
      error_code: errorCode,
      last_run_at: at,
      retry_after_seconds: retryAfterSeconds,
    },
    { onConflict: 'signal_id' },
  );
  if (error) throw new Error(error.message);
}
