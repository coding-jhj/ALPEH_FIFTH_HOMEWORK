// 실제 조회 1회 — 외부 호출은 전부 이 서버 라우트 안에서만 일어납니다.
// 브라우저는 이 라우트만 호출하므로 외부 원천 URL 외에 어떤 자격 증명도 브라우저로 나가지 않습니다.

import { NextResponse } from 'next/server';
import { activeProvider, crossCheckProvider, fetchLive, type LiveFetchResult } from '@/lib/source';
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

  // 교차 확인은 저장 신호와 같이 출발시킵니다. 직렬로 두면 버튼 한 번에 최대 8초가 걸립니다.
  const crossProvider = crossCheckProvider();
  const [result, cross] = await Promise.all([
    fetchLive(now).catch((): LiveFetchResult => ({ ok: false, error_code: 'offline' })),
    fetchLive(now, crossProvider).catch((): LiveFetchResult => ({ ok: false, error_code: 'offline' })),
  ]);

  let storeOutcome: string | null = null;
  try {
    if (result.ok && result.reading) {
      storeOutcome = await storeSuccess(result.reading);
    } else {
      await storeFailure(
        provider.signal_id,
        (result.error_code ?? 'offline') as 'timeout' | 'auth' | 'rate_limit' | 'offline' | 'schema_error',
        result.retry_after_seconds ?? null,
        now.toISOString(),
      );
    }
  } catch (error) {
    // 공개 심사 화면이므로 내부 오류 문구를 그대로 내보내지 않습니다.
    console.error('[T04] 저장 실패', error);
    return NextResponse.json(
      { ok: false, message: '저장소에 연결하지 못했습니다. 잠시 뒤 다시 시도하세요.' },
      { status: 500 },
    );
  }

  // 교차 확인은 화면 표시 전용이며 저장하지 않습니다 — 영수증 신호는 하나여야 T04-C22가 성립합니다.
  // 저장 신호 자체가 실패했으면 비교할 대상이 없으므로 표시하지 않습니다.
  const crossCheck =
    result.ok
      ? {
          source_name: crossProvider.source_name,
          value: cross.ok ? (cross.reading?.normalized_value ?? null) : null,
          error_code: cross.error_code ?? 'none',
        }
      : null;

  let board;
  try {
    board = await loadBoard(provider.signal_id);
  } catch (error) {
    console.error('[T04] 조회 실패', error);
    return NextResponse.json(
      { ok: false, message: '저장소를 읽지 못했습니다. 잠시 뒤 다시 시도하세요.' },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: result.ok,
    error_code: result.error_code ?? 'none',
    cross_check: crossCheck,
    // stored | locked | date_cap — 저장값을 실제로 건드렸는지 (T04-C22·C23)
    store_outcome: storeOutcome,
    // 원자료·저장값·화면값 대조용 (T04-C10). 개인정보가 없는 공개 원천 응답만 담깁니다.
    raw_sample: result.raw ?? null,
    reading: result.reading ?? null,
    board,
  });
}
