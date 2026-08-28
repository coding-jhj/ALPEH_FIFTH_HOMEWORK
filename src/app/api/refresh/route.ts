// 실제 조회 1회 — 외부 호출은 전부 이 서버 라우트 안에서만 일어납니다.
// 브라우저는 이 라우트만 호출하므로 외부 원천 URL 외에 어떤 자격 증명도 브라우저로 나가지 않습니다.

import { NextResponse } from 'next/server';
import { activeProvider, fetchLive } from '@/lib/source';
import { loadBoard, storeFailure, storeSuccess } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET도 같은 동작을 합니다.
 * 하루 한 번 기록을 외부 스케줄러(또는 브라우저 주소창)에서 눌러 줄 수 있게 하기 위해서입니다.
 * 인증을 걸지 않습니다 — 걸면 결과물 URL의 무로그인 공개 조건(T04-C01·C02·C29~C33)이 깨집니다.
 * 부작용은 "오늘 날짜 행 1건 갱신"뿐이라 반복 호출해도 행이 늘지 않습니다 (T04-C20).
 */
export async function GET() {
  return POST();
}

export async function POST() {
  const provider = activeProvider();
  const now = new Date();

  let result;
  try {
    result = await fetchLive(now);
  } catch {
    result = { ok: false as const, error_code: 'offline' as const };
  }

  try {
    if (result.ok && result.reading) {
      await storeSuccess(result.reading);
    } else {
      await storeFailure(
        provider.signal_id,
        (result.error_code ?? 'offline') as 'timeout' | 'auth' | 'rate_limit' | 'offline' | 'schema_error',
        result.retry_after_seconds ?? null,
        now.toISOString(),
      );
    }
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : '저장 실패' },
      { status: 500 },
    );
  }

  const board = await loadBoard(provider.signal_id);
  return NextResponse.json({
    ok: result.ok,
    error_code: result.error_code ?? 'none',
    // 원자료·저장값·화면값 대조용 (T04-C10). 개인정보가 없는 공개 원천 응답만 담깁니다.
    raw_sample: result.raw ?? null,
    reading: result.reading ?? null,
    board,
  });
}
