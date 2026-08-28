// ALEPH T04 코어 — live adapter와 replay adapter가 공유하는 유일한 정규화·저장·비교 경로입니다.
// 실패 처리만 따로 꾸미지 않기 위해, 두 adapter 모두 반드시 이 파일의 함수만 호출합니다.

import type {
  BoardState,
  Comparison,
  DailyRow,
  ErrorCode,
  NormalizedReading,
  ReadingStatus,
} from './types';

export const ERROR_CODES: ErrorCode[] = [
  'timeout',
  'auth',
  'rate_limit',
  'offline',
  'schema_error',
];

export const RECORD_TIMEZONE = 'Asia/Seoul' as const;

const NORMALIZED_KEYS = [
  'signal_id',
  'normalized_value',
  'unit',
  'source_name',
  'source_url',
  'source_time',
  'fetched_at',
  'record_timezone',
  'record_date',
] as const;

/** ISO 시각을 Asia/Seoul 날짜(YYYY-MM-DD)로 바꿉니다. record_date는 항상 이 함수로만 만듭니다. */
export function kstDate(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('유효한 ISO-8601 시각이 아닙니다');
  }
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: RECORD_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const by = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${by.year}-${by.month}-${by.day}`;
}

/** 화면 표시용 KST 시각 문자열 */
export function kstDateTime(isoString: string | null): string {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: RECORD_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const by = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${by.year}-${by.month}-${by.day} ${by.hour}:${by.minute} KST`;
}

export class SchemaError extends Error {}

/**
 * normalized-reading.schema.json 전수 검증.
 * 던지는 예외는 호출부에서 error_code 'schema_error'로 매핑됩니다 (T04-C16).
 */
export function validateNormalizedReading(input: unknown): NormalizedReading {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SchemaError('정규화 값은 객체여야 합니다');
  }
  const reading = input as Record<string, unknown>;

  const actual = Object.keys(reading).sort();
  const expected = [...NORMALIZED_KEYS].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, i) => key !== expected[i])
  ) {
    throw new SchemaError(`필드는 정확히 다음 9개여야 합니다: ${NORMALIZED_KEYS.join(', ')}`);
  }

  if (
    typeof reading.signal_id !== 'string' ||
    reading.signal_id.length > 100 ||
    !/^[a-z0-9][a-z0-9._-]*$/.test(reading.signal_id)
  ) {
    throw new SchemaError('signal_id 형식이 올바르지 않습니다');
  }

  if (
    typeof reading.normalized_value !== 'number' ||
    !Number.isFinite(reading.normalized_value)
  ) {
    // 숫자여야 할 값이 문자열로 오는 형식 변경을 여기서 잡습니다.
    throw new SchemaError('normalized_value는 유한한 숫자여야 합니다');
  }

  for (const field of ['unit', 'source_name'] as const) {
    const value = reading[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new SchemaError(`${field}는 비어 있지 않은 문자열이어야 합니다`);
    }
  }
  if ((reading.unit as string).length > 24) throw new SchemaError('unit이 너무 깁니다');
  if ((reading.source_name as string).length > 120) {
    throw new SchemaError('source_name이 너무 깁니다');
  }

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(String(reading.source_url));
  } catch {
    throw new SchemaError('source_url은 절대 URL이어야 합니다');
  }
  if (sourceUrl.protocol !== 'https:') {
    throw new SchemaError('source_url은 HTTPS여야 합니다');
  }

  if (
    reading.source_time !== null &&
    (typeof reading.source_time !== 'string' ||
      Number.isNaN(new Date(reading.source_time).getTime()))
  ) {
    throw new SchemaError('source_time은 시각 또는 null이어야 합니다');
  }
  if (
    typeof reading.fetched_at !== 'string' ||
    Number.isNaN(new Date(reading.fetched_at).getTime())
  ) {
    throw new SchemaError('fetched_at은 유효한 시각이어야 합니다');
  }
  if (reading.record_timezone !== RECORD_TIMEZONE) {
    throw new SchemaError('record_timezone은 Asia/Seoul이어야 합니다');
  }
  if (
    typeof reading.record_date !== 'string' ||
    !/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(reading.record_date) ||
    reading.record_date !== kstDate(reading.fetched_at as string)
  ) {
    // UTC로 날짜를 만들면 자정 근처에서 여기서 걸립니다.
    throw new SchemaError('record_date는 fetched_at의 Asia/Seoul 날짜여야 합니다');
  }

  return reading as unknown as NormalizedReading;
}

export function validateStatus(status: ReadingStatus): boolean {
  if (status.freshness === 'fresh') return status.error_code === 'none';
  if (status.freshness === 'stale') return ERROR_CODES.includes(status.error_code);
  return false;
}

export function emptyComparison(): Comparison {
  return {
    state: 'insufficient',
    direction: null,
    magnitude: null,
    signed: null,
    unit: null,
    previous_record_date: null,
  };
}

export function emptyState(): BoardState {
  return {
    daily_readings: [],
    current_reading: null,
    status: null,
    comparison: emptyComparison(),
    last_run: null,
    sequence: 0,
  };
}

/**
 * 어제 대비 변화를 두 저장값에서 매번 재계산합니다.
 * 계산 결과를 저장해 두고 재사용하지 않는 것이 T04-C24의 요구입니다.
 */
export function computeComparison(rows: DailyRow[], current: DailyRow | null): Comparison {
  if (!current) return emptyComparison();
  const previous = rows
    .filter((row) => row.signal_id === current.signal_id && row.record_date < current.record_date)
    .sort((a, b) => b.record_date.localeCompare(a.record_date))[0];

  if (!previous) return emptyComparison();
  if (previous.unit !== current.unit) {
    return { ...emptyComparison(), state: 'unit_mismatch', previous_record_date: previous.record_date };
  }
  const signed = current.normalized_value - previous.normalized_value;
  return {
    state: 'comparable',
    direction: signed > 0 ? 'increase' : signed < 0 ? 'decrease' : 'unchanged',
    magnitude: Math.abs(signed),
    signed,
    unit: current.unit,
    previous_record_date: previous.record_date,
  };
}

export function recordIdFor(reading: NormalizedReading): string {
  return `${reading.signal_id}-${reading.record_date}`;
}

export function rowFromReading(reading: NormalizedReading, existing: DailyRow | null): DailyRow {
  return {
    record_id: existing ? existing.record_id : recordIdFor(reading),
    signal_id: reading.signal_id,
    record_date: reading.record_date,
    normalized_value: reading.normalized_value,
    unit: reading.unit,
    source_name: reading.source_name,
    source_url: reading.source_url,
    source_time: reading.source_time,
    first_fetched_at: existing ? existing.first_fetched_at : reading.fetched_at,
    last_fetched_at: reading.fetched_at,
  };
}

/**
 * 성공 반영: (signal_id, record_date)가 같으면 새 행을 만들지 않고 같은 행을 갱신합니다. (T04-C20/C21)
 */
export function applySuccess(
  input: BoardState,
  rawReading: unknown,
  meta: { fixture_id?: string | null; virtual_now?: string | null } = {},
): BoardState {
  const reading = validateNormalizedReading(rawReading);
  const state: BoardState = structuredClone(input);

  const index = state.daily_readings.findIndex(
    (row) => row.signal_id === reading.signal_id && row.record_date === reading.record_date,
  );
  const existing = index >= 0 ? state.daily_readings[index] : null;
  const row = rowFromReading(reading, existing);

  if (index >= 0) state.daily_readings[index] = row;
  else state.daily_readings.push(row);
  state.daily_readings.sort((a, b) => a.record_date.localeCompare(b.record_date));

  state.current_reading = reading;
  state.status = { freshness: 'fresh', error_code: 'none' };
  state.comparison = computeComparison(state.daily_readings, row);
  state.sequence += 1;
  state.last_run = {
    fixture_id: meta.fixture_id ?? null,
    virtual_now: meta.virtual_now ?? reading.fetched_at,
    outcome: 'success',
    error_code: 'none',
    retry_after_seconds: null,
  };
  return state;
}

/**
 * 실패 반영: 일별 기록과 마지막 정상값은 건드리지 않고 status만 stale로 바꿉니다. (T04-C17/C18)
 */
export function applyError(
  input: BoardState,
  errorCode: ErrorCode,
  meta: { fixture_id?: string | null; virtual_now?: string | null; retry_after_seconds?: number | null } = {},
): BoardState {
  if (!ERROR_CODES.includes(errorCode)) {
    throw new TypeError(`지원하지 않는 오류 코드: ${errorCode}`);
  }
  const state: BoardState = structuredClone(input);
  state.status = { freshness: 'stale', error_code: errorCode };
  state.sequence += 1;
  state.last_run = {
    fixture_id: meta.fixture_id ?? null,
    virtual_now: meta.virtual_now ?? null,
    outcome: 'error',
    error_code: errorCode,
    retry_after_seconds: meta.retry_after_seconds ?? null,
  };
  return state;
}

/** 실패 종류별 안내 문구와 다음 행동 — 다섯 종류가 서로 달라야 합니다 (T04-C12~C16) */
export const FAILURE_COPY: Record<
  Exclude<ErrorCode, 'none'>,
  { label: string; message: string; nextAction: string }
> = {
  timeout: {
    label: '느린 응답 (timeout)',
    message: '원천이 제한시간 안에 답하지 않았습니다.',
    nextAction: '잠시 뒤 다시 시도를 누르세요.',
  },
  auth: {
    label: '원천 거절 (401/403)',
    message: '외부 데이터 원천이 접근을 거절했습니다.',
    nextAction: '원천의 접근 정책을 확인한 뒤 다시 시도하세요.',
  },
  rate_limit: {
    label: '호출 제한 (429)',
    message: '외부 원천의 호출 한도를 넘었습니다.',
    nextAction: '안내된 대기 시간이 지난 뒤 다시 시도하세요.',
  },
  offline: {
    label: '오프라인',
    message: '네트워크에 닿지 못했습니다.',
    nextAction: '연결 상태를 확인한 뒤 다시 시도하세요.',
  },
  schema_error: {
    label: '형식 변경 (schema)',
    message: '원천 응답의 형식이 약속과 달라졌습니다.',
    nextAction: '값 매핑을 점검해야 합니다. 다시 시도해도 같은 상태가 반복될 수 있습니다.',
  },
};
