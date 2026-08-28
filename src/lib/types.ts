// ALEPH T04 공통 타입
// normalized-reading.schema.json / reading-status.schema.json 을 그대로 옮긴 것입니다.

export type ErrorCode =
  | 'none'
  | 'timeout'
  | 'auth'
  | 'rate_limit'
  | 'offline'
  | 'schema_error';

export type Freshness = 'fresh' | 'stale';

/** reading-status.schema.json */
export interface ReadingStatus {
  freshness: Freshness;
  error_code: ErrorCode;
}

/** normalized-reading.schema.json — 필드 9개 고정 */
export interface NormalizedReading {
  signal_id: string;
  normalized_value: number;
  unit: string;
  source_name: string;
  source_url: string;
  source_time: string | null;
  fetched_at: string;
  record_timezone: 'Asia/Seoul';
  record_date: string;
}

/** 일별 저장 행 */
export interface DailyRow {
  record_id: string;
  signal_id: string;
  record_date: string;
  normalized_value: number;
  unit: string;
  source_name: string;
  source_url: string;
  source_time: string | null;
  first_fetched_at: string;
  last_fetched_at: string;
}

export type ComparisonState = 'insufficient' | 'unit_mismatch' | 'comparable';

/** 어제 대비 비교 결과 — 저장하지 않고 두 저장값에서 매번 재계산합니다 (T04-C24) */
export interface Comparison {
  state: ComparisonState;
  direction: 'increase' | 'decrease' | 'unchanged' | null;
  magnitude: number | null;
  signed: number | null;
  unit: string | null;
  previous_record_date: string | null;
}

export interface BoardState {
  daily_readings: DailyRow[];
  current_reading: NormalizedReading | null;
  status: ReadingStatus | null;
  comparison: Comparison;
  last_run: {
    fixture_id: string | null;
    virtual_now: string | null;
    outcome: 'success' | 'error';
    error_code: ErrorCode;
    retry_after_seconds: number | null;
  } | null;
  sequence: number;
}
