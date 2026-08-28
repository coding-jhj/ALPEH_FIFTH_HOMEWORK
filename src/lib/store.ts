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
  status: ReadingStatus;
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

  const status: ReadingStatus = statusData
    ? { freshness: statusData.freshness, error_code: statusData.error_code }
    : { freshness: 'stale', error_code: 'offline' };

  return {
    rows,
    current,
    status: rows.length === 0 && !statusData ? { freshness: 'stale', error_code: 'offline' } : status,
    // 어제 대비는 저장하지 않고 매번 두 저장값에서 다시 계산합니다 (T04-C24).
    comparison: computeComparison(rows, current),
    last_run_at: statusData?.last_run_at ?? null,
    retry_after_seconds: statusData?.retry_after_seconds ?? null,
  };
}

/** 성공 저장: upsert 한 번으로 같은 날 중복 행을 막습니다. */
export async function storeSuccess(reading: NormalizedReading): Promise<void> {
  const supabase = db();

  const { data: existingData } = await supabase
    .from('daily_readings')
    .select('*')
    .eq('signal_id', reading.signal_id)
    .eq('record_date', reading.record_date)
    .maybeSingle();

  const row = rowFromReading(reading, (existingData as DailyRow | null) ?? null);

  const { error } = await supabase
    .from('daily_readings')
    .upsert(row, { onConflict: 'signal_id,record_date' });
  if (error) throw new Error(error.message);

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
