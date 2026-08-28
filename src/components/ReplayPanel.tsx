'use client';

// 합성 검사 패널 — 공개 fixture 9종을 실제 조회와 똑같은 코어 함수로 재생합니다.
// 여기의 상태는 브라우저 안에만 있어, reset이 실제 일별 기록을 건드리지 않습니다.

import { useState } from 'react';
import { FAILURE_COPY } from '@/lib/core';
import { FIXTURES, FIXTURE_ORDER } from '@/lib/fixtures';
import { resetEvaluationState, runFixture } from '@/lib/replay';
import type { BoardState, ErrorCode } from '@/lib/types';

const SEQUENCES: { label: string; ids: string[] }[] = [
  { label: '정상 저장 (D1-A → D1-B → D2)', ids: ['T04-NORMAL-D1-A', 'T04-NORMAL-D1-B', 'T04-NORMAL-D2'] },
  { label: '실패 준비 (D1-A → D1-B)', ids: ['T04-NORMAL-D1-A', 'T04-NORMAL-D1-B'] },
  {
    label: '회복 (D1-A → D1-B → TIMEOUT → RECOVER-D2)',
    ids: ['T04-NORMAL-D1-A', 'T04-NORMAL-D1-B', 'T04-TIMEOUT', 'T04-RECOVER-D2'],
  },
];

export default function ReplayPanel() {
  const [state, setState] = useState<BoardState>(resetEvaluationState());
  const [log, setLog] = useState<string[]>([]);

  function push(line: string) {
    setLog((prev) => [...prev.slice(-9), line]);
  }

  function play(id: string) {
    setState((prev) => {
      const next = runFixture(prev, FIXTURES[id]);
      push(
        `${id} → ${next.status?.freshness}/${next.status?.error_code} · 행 ${next.daily_readings.length}건 · 마지막 정상값 ${next.current_reading?.normalized_value ?? '없음'}`,
      );
      return next;
    });
  }

  function playSequence(ids: string[]) {
    let next = resetEvaluationState();
    const lines: string[] = ['reset → 합성 상태 비움'];
    for (const id of ids) {
      next = runFixture(next, FIXTURES[id]);
      lines.push(
        `${id} → ${next.status?.freshness}/${next.status?.error_code} · 행 ${next.daily_readings.length}건 · 마지막 정상값 ${next.current_reading?.normalized_value ?? '없음'}`,
      );
    }
    setState(next);
    setLog(lines.slice(-10));
  }

  function reset() {
    setState(resetEvaluationState());
    setLog(['reset → 합성 상태 비움 (실제 일별 기록은 건드리지 않음)']);
  }

  const status = state.status;
  const stale = status?.freshness === 'stale';
  const failure = stale && status ? FAILURE_COPY[status.error_code as Exclude<ErrorCode, 'none'>] : null;

  return (
    <section className="panel">
      <h1>합성 검사 패널</h1>
      <p className="small">
        공개 꾸러미 <code>aleph-t04-real-information-board-public-contract-v2</code>의 fixture 9종을 재생합니다. 여기
        쓰이는 값은 전부 합성 시험값이며 실제 원천 조회나 실제 날짜 기록을 대신하지 않습니다.
      </p>

      <h2 style={{ marginTop: 16 }}>한 번에 재생</h2>
      <div className="row">
        <button onClick={reset}>reset</button>
        {SEQUENCES.map((seq) => (
          <button key={seq.label} onClick={() => playSequence(seq.ids)}>
            {seq.label}
          </button>
        ))}
      </div>

      <h2 style={{ marginTop: 16 }}>fixture 하나씩</h2>
      <div className="row">
        {FIXTURE_ORDER.map((id) => (
          <button key={id} onClick={() => play(id)}>
            {id.replace('T04-', '')}
          </button>
        ))}
      </div>

      <h2 style={{ marginTop: 20 }}>현재 합성 상태</h2>
      <dl className="meta">
        <dt>freshness</dt>
        <dd>{status?.freshness ?? '—'}</dd>
        <dt>error_code</dt>
        <dd>{status?.error_code ?? '—'}</dd>
        <dt>일별 행 수</dt>
        <dd>{state.daily_readings.length}</dd>
        <dt>마지막 정상값</dt>
        <dd>
          {state.current_reading
            ? `${state.current_reading.normalized_value} ${state.current_reading.unit}`
            : '없음'}
        </dd>
        <dt>어제 대비</dt>
        <dd>
          {state.comparison.state === 'comparable'
            ? `${state.comparison.signed! > 0 ? '+' : ''}${state.comparison.signed} ${state.comparison.unit} (절대값 ${state.comparison.magnitude})`
            : state.comparison.state === 'unit_mismatch'
              ? '단위 불일치'
              : '이전 기록 없음'}
        </dd>
      </dl>

      {failure && (
        <div className="notice">
          <strong>{failure.label}</strong>
          {failure.message} {failure.nextAction}
          {state.last_run?.retry_after_seconds
            ? ` (${state.last_run.retry_after_seconds}초 뒤 재시도 권장)`
            : ''}
          <div className="small" style={{ marginTop: 8, color: 'inherit' }}>
            마지막 정상값 {state.current_reading?.normalized_value ?? '없음'} 은 지워지지 않았습니다.
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" onClick={() => play('T04-RECOVER-D2')}>
              다시 시도 (T04-RECOVER-D2 재생)
            </button>
          </div>
        </div>
      )}

      <h2 style={{ marginTop: 20 }}>합성 일별 기록</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>record_id</th>
              <th>날짜</th>
              <th>값</th>
              <th>단위</th>
            </tr>
          </thead>
          <tbody>
            {state.daily_readings.length === 0 ? (
              <tr>
                <td colSpan={4} className="small">
                  비어 있음
                </td>
              </tr>
            ) : (
              state.daily_readings.map((row) => (
                <tr key={row.record_id}>
                  <td className="small">{row.record_id}</td>
                  <td>{row.record_date}</td>
                  <td>{row.normalized_value}</td>
                  <td>{row.unit}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {log.length > 0 && (
        <>
          <h2 style={{ marginTop: 20 }}>재생 기록</h2>
          <pre>{log.join('\n')}</pre>
        </>
      )}
    </section>
  );
}
