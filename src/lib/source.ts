// live adapter — 비개인 공개 원천 호출부.
// 여기서는 "원자료를 정규화 형식으로 바꾸는 일"만 하고,
// 저장·비교·상태는 replay adapter와 똑같이 core.ts가 처리합니다.
//
// 비밀키를 쓰지 않는 원천만 씁니다 (T04-C11). 아래 두 provider 모두 인증이 필요 없습니다.

import { kstDate, RECORD_TIMEZONE } from './core';
import type { ErrorCode, NormalizedReading } from './types';

export interface SourceProvider {
  signal_id: string;
  title: string;
  unit: string;
  source_name: string;
  buildUrl(): string;
  /** 원자료(JSON) + 응답 Date 헤더 → 정규화 값 */
  extract(raw: unknown, responseDate: string | null): { value: number; source_time: string | null };
}

const SERVER_HOST = process.env.MC_SERVER_HOST || 'mc.hypixel.net';

/**
 * 저장 신호 — mcstatus.io v2. 인증 키가 필요 없습니다 (문서 명시).
 * 관측 시각을 retrieved_at(유닉스 밀리초)으로 직접 주므로 출처 시각과 조회 시각이 정확히 갈립니다.
 * 2026-08-28 실측: 캐시 TTL 60초, retrieved_at은 호출 시각과 14초 차 — 실시간입니다.
 */
const mcStatusIo: SourceProvider = {
  signal_id: process.env.NEXT_PUBLIC_SIGNAL_ID || 'mc-server-players',
  title: process.env.NEXT_PUBLIC_SIGNAL_TITLE || `${SERVER_HOST} 현재 접속자`,
  unit: '명',
  source_name: 'mcstatus.io',
  buildUrl() {
    return `https://api.mcstatus.io/v2/status/java/${encodeURIComponent(SERVER_HOST)}`;
  },
  extract(raw, responseDate) {
    const body = raw as {
      online?: unknown;
      players?: { online?: unknown };
      retrieved_at?: unknown;
    };
    // 서버가 내려가 있으면 online:false 로 오고 접속자 수는 의미가 없습니다.
    if (body?.online === false) {
      throw new Error('원천이 서버 오프라인으로 보고했습니다');
    }
    const count = body?.players?.online;
    if (typeof count !== 'number' || !Number.isFinite(count)) {
      throw new Error('players.online이 숫자가 아닙니다');
    }
    const retrievedAt = body?.retrieved_at;
    return {
      value: count,
      source_time:
        typeof retrievedAt === 'number' && Number.isFinite(retrievedAt)
          ? new Date(retrievedAt).toISOString()
          : responseDate,
    };
  },
};

/**
 * 교차 확인용 예비 원천 — mcsrvstat.us v3. 역시 인증 키가 필요 없습니다.
 * 관측 시각은 debug.cachetime(유닉스 초)입니다.
 */
const mcSrvStat: SourceProvider = {
  signal_id: process.env.NEXT_PUBLIC_SIGNAL_ID || 'mc-server-players',
  title: process.env.NEXT_PUBLIC_SIGNAL_TITLE || `${SERVER_HOST} 현재 접속자`,
  unit: '명',
  source_name: 'mcsrvstat.us',
  buildUrl() {
    return `https://api.mcsrvstat.us/3/${encodeURIComponent(SERVER_HOST)}`;
  },
  extract(raw, responseDate) {
    const body = raw as {
      online?: unknown;
      players?: { online?: unknown };
      debug?: { cachetime?: unknown };
    };
    if (body?.online === false) {
      throw new Error('원천이 서버 오프라인으로 보고했습니다');
    }
    const count = body?.players?.online;
    if (typeof count !== 'number' || !Number.isFinite(count)) {
      throw new Error('players.online이 숫자가 아닙니다');
    }
    const cacheTime = body?.debug?.cachetime;
    return {
      value: count,
      source_time:
        typeof cacheTime === 'number' && Number.isFinite(cacheTime)
          ? new Date(cacheTime * 1000).toISOString()
          : responseDate,
    };
  },
};

export const PROVIDERS: Record<string, SourceProvider> = {
  mcstatus: mcStatusIo,
  mcsrvstat: mcSrvStat,
};

export function activeProvider(): SourceProvider {
  const key = process.env.NEXT_PUBLIC_SIGNAL_PROVIDER || 'mcstatus';
  return PROVIDERS[key] ?? mcStatusIo;
}

/** 교차 확인 전용 — 저장하지 않고 화면 표시만 합니다. 영수증 신호는 반드시 하나여야 합니다. */
export function crossCheckProvider(): SourceProvider {
  return activeProvider().source_name === 'mcstatus.io' ? mcSrvStat : mcStatusIo;
}

/**
 * 개인 식별 가능 필드 제거 (T04-C25).
 * 실측 확인: 서버 설정에 따라 players.list 에 접속자 이름이 들어옵니다.
 * 저장에도 화면에도 절대 넣지 않습니다.
 */
export function redactRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const clone = structuredClone(raw) as Record<string, unknown>;
  const players = clone.players as Record<string, unknown> | undefined;
  if (players && 'list' in players) {
    players.list = '(개인 식별 가능 필드 — 저장·표시하지 않음)';
  }
  if ('icon' in clone) clone.icon = '(생략)';
  return clone;
}

export interface LiveFetchResult {
  ok: boolean;
  reading?: NormalizedReading;
  error_code?: ErrorCode;
  raw?: unknown;
  http_status?: number | null;
  retry_after_seconds?: number | null;
}

const DEADLINE_MS = Number(process.env.LIVE_DEADLINE_MS || 4000);

/**
 * 실제 조회 1회.
 * 실패 원인을 timeout / auth / rate_limit / offline / schema_error 로 나눠서 돌려줍니다.
 * (합성 재생과 완전히 같은 다섯 갈래입니다.)
 */
export async function fetchLive(now = new Date()): Promise<LiveFetchResult> {
  const provider = activeProvider();
  const url = provider.buildUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEADLINE_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    clearTimeout(timer);
    // 제한시간 초과와 연결 실패를 분리합니다.
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error_code: 'timeout' };
    }
    return { ok: false, error_code: 'offline' };
  }
  clearTimeout(timer);

  const retryAfter = response.headers.get('retry-after');
  if (response.status === 401 || response.status === 403) {
    return { ok: false, error_code: 'auth', http_status: response.status };
  }
  if (response.status === 429) {
    return {
      ok: false,
      error_code: 'rate_limit',
      http_status: 429,
      retry_after_seconds: retryAfter ? Number(retryAfter) : null,
    };
  }
  if (!response.ok) {
    return { ok: false, error_code: 'schema_error', http_status: response.status };
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    return { ok: false, error_code: 'schema_error', http_status: response.status };
  }

  let extracted: { value: number; source_time: string | null };
  try {
    extracted = provider.extract(raw, response.headers.get('date'));
  } catch {
    return { ok: false, error_code: 'schema_error', http_status: response.status, raw: redactRaw(raw) };
  }

  const fetchedAt = now.toISOString();
  const reading: NormalizedReading = {
    signal_id: provider.signal_id,
    normalized_value: extracted.value,
    unit: provider.unit,
    source_name: provider.source_name,
    source_url: url,
    source_time: extracted.source_time ? new Date(extracted.source_time).toISOString() : null,
    fetched_at: fetchedAt,
    record_timezone: RECORD_TIMEZONE,
    record_date: kstDate(fetchedAt), // 반드시 KST 날짜. UTC로 만들면 자정 근처에서 어긋납니다.
  };

  // 원자료를 돌려줄 때도 개인 식별 가능 필드는 제거한 뒤 내보냅니다.
  return { ok: true, reading, raw: redactRaw(raw), http_status: response.status };
}
