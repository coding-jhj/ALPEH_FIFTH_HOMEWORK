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

/** Steam 공개 통계 — 특정 게임의 현재 동시 접속자 수. 인증 키가 필요 없습니다. */
const steamPlayers: SourceProvider = {
  signal_id: process.env.NEXT_PUBLIC_SIGNAL_ID || 'steam-cs2-players',
  title: process.env.NEXT_PUBLIC_SIGNAL_TITLE || 'Counter-Strike 2 현재 접속자',
  unit: '명',
  source_name: 'Steam 공개 통계 (ISteamUserStats)',
  buildUrl() {
    const appid = process.env.STEAM_APP_ID || '730';
    return `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`;
  },
  extract(raw, responseDate) {
    const body = raw as { response?: { player_count?: unknown; result?: unknown } };
    const count = body?.response?.player_count;
    if (typeof count !== 'number' || !Number.isFinite(count)) {
      throw new Error('player_count가 숫자가 아닙니다');
    }
    // 이 원천은 본문에 관측 시각이 없어, 원천이 응답에 붙인 Date 헤더를 출처 시각으로 씁니다.
    return { value: count, source_time: responseDate };
  },
};

/** 예비 원천 — Open-Meteo 대구 현재 기온. 인증 키가 필요 없습니다. */
const openMeteoTemp: SourceProvider = {
  signal_id: 'daegu-temp-2m',
  title: '대구 현재 기온',
  unit: '°C',
  source_name: 'Open-Meteo',
  buildUrl() {
    return 'https://api.open-meteo.com/v1/forecast?latitude=35.8714&longitude=128.6014&current=temperature_2m&timezone=Asia%2FSeoul';
  },
  extract(raw) {
    const body = raw as { current?: { time?: unknown; temperature_2m?: unknown } };
    const value = body?.current?.temperature_2m;
    const time = body?.current?.time;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error('temperature_2m가 숫자가 아닙니다');
    }
    return {
      value,
      source_time: typeof time === 'string' ? new Date(`${time}:00+09:00`).toISOString() : null,
    };
  },
};

export const PROVIDERS: Record<string, SourceProvider> = {
  steam: steamPlayers,
  'open-meteo': openMeteoTemp,
};

export function activeProvider(): SourceProvider {
  const key = process.env.NEXT_PUBLIC_SIGNAL_PROVIDER || 'steam';
  return PROVIDERS[key] ?? steamPlayers;
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
    return { ok: false, error_code: 'schema_error', http_status: response.status, raw };
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

  return { ok: true, reading, raw, http_status: response.status };
}
