import LiveBoard, { type BoardPayload } from '@/components/LiveBoard';
import ReplayPanel from '@/components/ReplayPanel';
import { activeProvider } from '@/lib/source';
import { loadBoard } from '@/lib/store';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const provider = activeProvider();
  let board: BoardPayload | null = null;
  let loadError: string | null = null;

  try {
    board = (await loadBoard(provider.signal_id)) as BoardPayload;
  } catch (error) {
    // 공개 심사 화면에 내부 오류 문구를 그대로 노출하지 않습니다.
    console.error('[T04] 초기 조회 실패', error);
    loadError = '저장소를 읽지 못했습니다. 아래 조회 버튼을 눌러 다시 시도하세요.';
  }

  return (
    <main>
      <p className="small" style={{ marginTop: 0 }}>
        ALEPH T04 · 오늘의 진짜 정보판 — 데이터가 안 올 때
      </p>

      <LiveBoard title={provider.title} initial={board} loadError={loadError} />
      <ReplayPanel />

      <section className="panel">
        <h1>확인 방법</h1>
        <ol style={{ paddingLeft: 20, margin: '8px 0 0' }}>
          <li>위쪽 정보판에서 값·단위·출처·출처 시각·조회 시각·기준 시간대를 한눈에 봅니다.</li>
          <li>
            합성 검사 패널에서 <strong>회복</strong> 버튼을 누르면 D1-A → D1-B → TIMEOUT → RECOVER-D2가 차례로
            재생됩니다.
          </li>
          <li>
            실패 상태에서 마지막 정상값 105가 남고 <strong>오래된 값</strong> 표시가 붙는지, 다시 시도 뒤
            fresh/none·행 2건·값 120이 되는지 확인합니다.
          </li>
        </ol>
        <p className="small" style={{ marginTop: 12 }}>
          이 화면에는 개인정보나 개인 기록이 없습니다. 외부 원천 호출은 서버 라우트에서만 일어나며 비밀키를 쓰지
          않는 공개 원천만 사용합니다.
        </p>
      </section>
    </main>
  );
}
