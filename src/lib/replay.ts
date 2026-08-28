// replay adapter — 합성 fixture를 live adapter와 똑같은 코어 경로로 흘려보냅니다.
// 여기서 하는 일은 "전송 계층 흉내"뿐이고, 정규화·저장·비교는 전부 core.ts가 합니다.

import { applyError, applySuccess, emptyState } from './core';
import type { Fixture } from './fixtures';
import type { BoardState } from './types';

/** reset 계약: 합성 평가 상태만 빈 상태로 되돌립니다. 실제 live 기록은 건드리지 않습니다. */
export function resetEvaluationState(): BoardState {
  return emptyState();
}

export function runFixture(input: BoardState, fixture: Fixture): BoardState {
  const meta = {
    fixture_id: fixture.fixture_id,
    virtual_now: fixture.virtual_now,
    retry_after_seconds: fixture.transport.headers['retry-after']
      ? Number(fixture.transport.headers['retry-after'])
      : null,
  };

  const { mode, status, delay_ms, deadline_ms } = fixture.transport;

  // 1) 전송 자체가 안 된 경우를 HTTP 상태와 먼저 분리합니다.
  if (mode === 'offline') return applyError(input, 'offline', meta);
  if (mode === 'timeout' || delay_ms > deadline_ms) return applyError(input, 'timeout', meta);

  // 2) HTTP 상태로 거절/제한을 나눕니다.
  if (status === 401 || status === 403) return applyError(input, 'auth', meta);
  if (status === 429) return applyError(input, 'rate_limit', meta);

  // 3) 2xx면 스키마 검사로 형식 변경을 잡습니다.
  if (typeof status === 'number' && status >= 200 && status < 300) {
    try {
      return applySuccess(input, fixture.payload, meta);
    } catch {
      return applyError(input, 'schema_error', meta);
    }
  }

  return applyError(input, 'schema_error', meta);
}
