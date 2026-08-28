'use client';

// 실제 조회 화면 — 값·단위·출처·출처 시각·조회 시각·기준 시간대를 한 화면에 고정합니다 (T04-C04~C09).

import { useState } from 'react';
import { FAILURE_COPY, kstDateTime } from '@/lib/core';
import type { Comparison, DailyRow, ErrorCode, ReadingStatus } from '@/lib/types';

export interface BoardPayload {
  rows: DailyRow[];
  current: DailyRow | null;
  status: ReadingStatus;
  comparison: Comparison;
  last_run_at: string | null;
  retry_after_seconds: number | null;
}

interface Props {
  title: string;
  initial: BoardPayload | null;
  loadError: string | null;
}

const DIRECTION_MARK = { increase: '▲', decrease: '▼', unchanged: '＝' } as const;

export default function LiveBoard({ title, initial, loadError }: Props) {
  const [board, setBoard] = useState<BoardPayload | null>(initial);
  const [raw, setRaw] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(loadError);

  async function refresh() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/refresh', { method: 'POST' });
      const data = await response.json();
      if (data.board) setBoard(data.board);
      if (data.raw_sample) setRaw(data.raw_sample);
      if (!response.ok) setMessage(data.message ?? '조회에 실패했습니다.');
    } catch {
      setMessage('조회 요청 자체가 실패했습니다. 네트워크를 확인하세요.');
    } finally {
      setBusy(false);
    }
  }

  const status = board?.status ?? null;
  const current = board?.current ?? null;
  const stale = status?.freshness === 'stale';
  const failure = stale && status ? FAILURE_COPY[status.error_code as Exclude<ErrorCode, 'none'>] : null;
  const comparison = board?.comparison ?? null;

  return (
    <section className="panel">
      <h1>{title}</h1>
      <p className="small">
        기준 시간대 <strong>Asia/Seoul</strong> · 하루 한 줄로 기록합니다.
      </p>

      <div style={{ marginTop: 14 }}>
        {current ? (
          <>
            <span className="value">{current.normalized_value.toLocaleString('ko-KR')}</span>
            <span className="unit">{current.unit}</span>{' '}
            {status && (
              <span className={`badge ${status.freshness}`}>
                {status.freshness === 'fresh' ? '최신 값' : `오래된 값 · ${failure?.label ?? status.error_code}`}
              </span>
            )}
          </>
        ) : (
          <span className="value" style={{ fontSize: 24 }}>
            아직 기록이 없습니다
          </span>
        )}
      </div>

      {comparison && (
        <div
          className={`delta ${comparison.state === 'comparable' && comparison.direction ? comparison.direction : ''}`}
        >
          {comparison.state === 'comparable' && comparison.direction ? (
            <>
              어제 대비 {DIRECTION_MARK[comparison.direction]}{' '}
              {comparison.magnitude?.toLocaleString('ko-KR')} {comparison.unit}
              <span className="small"> (이전 기록 {comparison.previous_record_date})</span>
            </>
          ) : comparison.state === 'unit_mismatch' ? (
            '어제 대비: 단위가 달라 비교하지 않습니다'
          ) : (
            '어제 대비: 비교할 이전 날짜 기록이 아직 없습니다'
          )}
        </div>
      )}

      {failure && (
        <div className="notice">
          <strong>{failure.label}</strong>
          {failure.message} {failure.nextAction}
          {board?.retry_after_seconds ? ` (${board.retry_after_seconds}초 뒤 재시도 권장)` : ''}
          <div className="small" style={{ marginTop: 6, color: 'inherit' }}>
            화면의 값은 마지막 정상값이며 지워지지 않았습니다.
          </div>
        </div>
      )}

      <dl className="meta">
        <dt>값</dt>
        <dd>{current ? current.normalized_value.toLocaleString('ko-KR') : '—'}</dd>
        <dt>단위</dt>
        <dd>{current?.unit ?? '—'}</dd>
        <dt>출처</dt>
        <dd>
          {current ? (
            <>
              {current.source_name}{' '}
              <a href={current.source_url} target="_blank" rel="noreferrer noopener">
                {current.source_url}
              </a>
            </>
          ) : (
            '—'
          )}
        </dd>
        <dt>출처 시각</dt>
        <dd>{kstDateTime(current?.source_time ?? null)}</dd>
        <dt>조회 시각</dt>
        <dd>{kstDateTime(current?.last_fetched_at ?? board?.last_run_at ?? null)}</dd>
        <dt>기준 시간대</dt>
        <dd>Asia/Seoul (KST, UTC+9)</dd>
      </dl>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="primary" onClick={refresh} disabled={busy}>
          {busy ? '조회 중…' : stale ? '다시 시도' : '지금 조회'}
        </button>
      </div>

      {message && <div className="notice">{message}</div>}

      <h2 style={{ marginTop: 24 }}>일별 기록 (KST 날짜별 한 건)</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>날짜</th>
              <th>값</th>
              <th>단위</th>
              <th>출처 시각</th>
              <th>마지막 조회</th>
            </tr>
          </thead>
          <tbody>
            {(board?.rows ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} className="small">
                  아직 저장된 일별 기록이 없습니다.
                </td>
              </tr>
            ) : (
              board!.rows.map((row) => (
                <tr key={row.record_id}>
                  <td>{row.record_date}</td>
                  <td>{row.normalized_value.toLocaleString('ko-KR')}</td>
                  <td>{row.unit}</td>
                  <td>{kstDateTime(row.source_time)}</td>
                  <td>{kstDateTime(row.last_fetched_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {raw ? (
        <>
          <h2 style={{ marginTop: 20 }}>방금 조회한 원자료 (저장값·화면값 대조용)</h2>
          <pre>{JSON.stringify(raw, null, 2)}</pre>
        </>
      ) : null}
    </section>
  );
}
