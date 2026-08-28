// 공개 fixture 9종 — 합성 시험값 전용입니다 (T04-C26).
// 파일 내용은 공개 꾸러미 t04-real-information-board-public-v1 와 바이트 단위로 같습니다.
// 같은 파일 사본이 /public/fixtures 아래에도 있어 심사자가 직접 대조할 수 있습니다.

import auth401 from '@/fixtures/auth-401.json';
import normalD1A from '@/fixtures/normal-d1-a.json';
import normalD1B from '@/fixtures/normal-d1-b.json';
import normalD2 from '@/fixtures/normal-d2.json';
import offline from '@/fixtures/offline.json';
import rate429 from '@/fixtures/rate-429.json';
import recoverD2 from '@/fixtures/recover-d2.json';
import schemaBreak from '@/fixtures/schema-break.json';
import timeout from '@/fixtures/timeout.json';

export interface Fixture {
  fixture_id: string;
  contract_version: string;
  description_ko: string;
  virtual_now: string;
  transport: {
    mode: 'http' | 'timeout' | 'offline';
    status: number | null;
    delay_ms: number;
    deadline_ms: number;
    headers: Record<string, string>;
  };
  payload: unknown;
  expected: {
    freshness: 'fresh' | 'stale';
    error_code: string;
    row_count: number;
    stored_value: number | null;
    delta: number | null;
    preserve_last_good: boolean;
    same_record_id_as?: string;
    record_date?: string;
  };
}

export const FIXTURES: Record<string, Fixture> = Object.fromEntries(
  ([
    normalD1A,
    normalD1B,
    normalD2,
    timeout,
    auth401,
    rate429,
    offline,
    schemaBreak,
    recoverD2,
  ] as unknown as Fixture[]).map((f) => [f.fixture_id, f]),
);

/** 심사 패널 버튼 순서 */
export const FIXTURE_ORDER = [
  'T04-NORMAL-D1-A',
  'T04-NORMAL-D1-B',
  'T04-NORMAL-D2',
  'T04-TIMEOUT',
  'T04-AUTH-401',
  'T04-RATE-429',
  'T04-OFFLINE',
  'T04-SCHEMA-BREAK',
  'T04-RECOVER-D2',
] as const;
