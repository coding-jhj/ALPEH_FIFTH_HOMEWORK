'use client';

// 실제 조회 화면 — 값·단위·출처·출처 시각·조회 시각·기준 시간대를 한 화면에 고정합니다 (T04-C04~C09).

import { useState } from 'react';
import { FAILURE_COPY, kstDateTime } from '@/lib/core';
import type { Comparison, DailyRow, ErrorCode, ReadingStatus } from '@/lib/types';

export interface BoardPayload {
  rows: DailyRow[];
  current: DailyRow | null;
  /** null = 아직 조회 전. 실패와 구분합니다. */
  status: ReadingStatus | null;
  comparison: Comparison;
  last_run_at: string | null;
  retry_after_seconds: number | null;
}

interface CrossCheck {
  source_name: string;
  value: number | null;
  error_code: string;
}

/** 기준 기록 시각 — 접속자 수는 조회 시각에 좌우되므로 매일 같은 시각 근처에 기록합니다. */
const BASELINE_HOUR_KST = 21;

/** 두 ISO 시각의 하루 중 시각 차이를 분으로 (날짜는 무시) */
function minutesOfDayKst(iso: string): number {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const by = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return Number(by.hour) * 60 + Number(by.minute);
}

function hhmmKst(iso: string): string {
  return kstDateTime(iso).slice(11, 16);
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
  const [crossCheck, setCrossCheck] = useState<CrossCheck | null>(null);
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
      setCrossCheck(data.cross_check ?? null);
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
  const neverRun = !status && !current;

  // 출처 시각과 조회 시각의 실제 간격 — 이 원천은 캐시를 주므로 둘이 벌어집니다 (C07·C08).
  const cacheLagSeconds =
    current?.source_time && current?.last_fetched_at
      ? Math.round(
          (new Date(current.last_fetched_at).getTime() - new Date(current.source_time).getTime()) / 1000,
        )
      : null;

  // 어제 대비의 비교 조건 — 두 기록을 몇 시에 쟀는지, 시각 차가 얼마인지.
  const previousRow =
    comparison?.previous_record_date
      ? (board?.rows ?? []).find((r) => r.record_date === comparison.previous_record_date)
      : undefined;
  const compareGapMinutes =
    previousRow && current
      ? Math.abs(minutesOfDayKst(current.last_fetched_at) - minutesOfDayKst(previousRow.last_fetched_at))
      : null;
  const compareGapWarn = compareGapMinutes !== null && compareGapMinutes > 60;

  // T04-C22는 실제 날짜 기록이 정확히 2건일 것을 봅니다.
  const rowCount = board?.rows.length ?? 0;

  return (
    <section className="panel">
      <h1>{title}</h1>
      <p className="small">
        기준 시간대 <strong>Asia/Seoul</strong> · 하루 한 줄로 기록합니다 · 기준 기록 시각{' '}
        <strong>{BASELINE_HOUR_KST}:00 KST 근처</strong>
        <br />
        접속자 수는 <strong>몇 시에 쟀는지에 좌우됩니다.</strong> 그래서 어제 대비 옆에 두 기록의 측정 시각과 그
        차이를 함께 적습니다.
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
            {neverRun ? '아직 조회 전입니다' : '아직 기록이 없습니다'}
          </span>
        )}
      </div>

      {neverRun && (
        <p className="small" style={{ marginTop: 8 }}>
          아래 <strong>지금 조회</strong>를 누르면 공개 원천에서 값을 한 번 가져옵니다. 이 상태는 실패가 아닙니다.
        </p>
      )}

      {comparison && (
        <div
          className={`delta ${comparison.state === 'comparable' && comparison.direction ? comparison.direction : ''}`}
        >
          {comparison.state === 'comparable' && comparison.direction ? (
            <>
              어제 대비 {DIRECTION_MARK[comparison.direction]}{' '}
              {comparison.magnitude?.toLocaleString('ko-KR')} {comparison.unit}
              {previousRow && current && (
                <div className="small" style={{ fontWeight: 400 }}>
                  비교 조건: {previousRow.record_date} {hhmmKst(previousRow.last_fetched_at)} vs{' '}
                  {current.record_date} {hhmmKst(current.last_fetched_at)}
                  {compareGapMinutes !== null && ` (${compareGapMinutes}분 차)`}
                  {compareGapWarn && ' — 측정 시각이 많이 어긋나 비교가 흔들릴 수 있습니다'}
                </div>
              )}
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
        <dd>
          {kstDateTime(current?.last_fetched_at ?? board?.last_run_at ?? null)}
          {cacheLagSeconds !== null && (
            <span className="small"> · 캐시 지연 {cacheLagSeconds}초 (출처가 관측한 시각과의 차이)</span>
          )}
        </dd>
        <dt>기준 시간대</dt>
        <dd>Asia/Seoul (KST, UTC+9)</dd>
        <dt>교차 확인</dt>
        <dd>
          {crossCheck ? (
            crossCheck.value !== null ? (
              <>
                {crossCheck.source_name} {crossCheck.value.toLocaleString('ko-KR')} {current?.unit}
                {current && crossCheck.value !== current.normalized_value && (
                  <span className="small">
                    {' '}
                    · 두 원천이 {Math.abs(crossCheck.value - current.normalized_value).toLocaleString('ko-KR')}만큼
                    다릅니다 (저장은 {current.source_name} 값만)
                  </span>
                )}
              </>
            ) : (
              <>
                {crossCheck.source_name} 조회 실패 ({crossCheck.error_code})
              </>
            )
          ) : (
            <span className="small">조회를 누르면 두 번째 원천과 대조합니다 (저장하지 않음)</span>
          )}
        </dd>
      </dl>

      {rowCount > 2 && (
        <div className="notice">
          <strong>일별 기록이 {rowCount}건입니다</strong>
          제출 조건은 서로 다른 실제 날짜 기록 <strong>정확히 2건</strong>을 봅니다. 3건 이상 쌓였다면 어느 2건을
          제출 근거로 삼을지 정하고, 필요하면 나머지 행을 정리하세요.
        </div>
      )}

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
