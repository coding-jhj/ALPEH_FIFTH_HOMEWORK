'use client';

// 인포그래픽 — 전부 인라인 SVG입니다. 차트 라이브러리를 쓰지 않습니다.
// 그리는 값은 모두 실제로 조회·저장한 것이며, 없는 값은 그리지 않고 안내 문구를 냅니다.

import { ERROR_CODES, FAILURE_COPY, kstDateTime } from '@/lib/core';
import type { ErrorCode, Observation } from '@/lib/types';

const fmt = (n: number) => n.toLocaleString('ko-KR');

/* ------------------------------------------------------------------ 정원 게이지 */

export function CapacityGauge({
  value,
  capacity,
  unit,
}: {
  value: number;
  capacity: number | null;
  unit: string;
}) {
  if (!capacity || capacity <= 0) {
    return <p className="small">원천이 정원(players.max)을 주지 않아 점유율을 그리지 않습니다.</p>;
  }
  const ratio = Math.min(value / capacity, 1);
  const pct = ratio * 100;

  return (
    <div>
      <div className="chart-head">
        <span className="pixel chart-big">{pct.toFixed(1)}%</span>
        <span className="small">
          {fmt(value)} / {fmt(capacity)} {unit}
        </span>
      </div>
      <svg
        viewBox="0 0 100 10"
        preserveAspectRatio="none"
        className="gauge"
        role="img"
        aria-label={`정원 ${fmt(capacity)}${unit} 중 ${fmt(value)}${unit}, ${pct.toFixed(1)}퍼센트`}
      >
        <rect x="0" y="0" width="100" height="10" className="gauge-track" />
        <rect x="0" y="0" width={ratio * 100} height="10" className="gauge-fill" />
      </svg>
    </div>
  );
}

/* ------------------------------------------------------- 두 원천 대조 막대 */

export function SourceCompare({
  primary,
  secondary,
  unit,
}: {
  primary: { name: string; value: number };
  secondary: { name: string; value: number } | null;
  unit: string;
}) {
  if (!secondary) {
    return <p className="small">조회를 누르면 두 번째 공개 원천과 나란히 견줍니다.</p>;
  }
  const max = Math.max(primary.value, secondary.value) || 1;
  const gap = Math.abs(primary.value - secondary.value);
  const gapPct = (gap / max) * 100;
  const rows = [
    { ...primary, saved: true },
    { ...secondary, saved: false },
  ];

  return (
    <div>
      {rows.map((row) => (
        <div key={row.name} className="bar-row">
          <span className="bar-label small">
            {row.name}
            {row.saved && <strong> · 저장</strong>}
          </span>
          <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="bar" aria-hidden="true">
            <rect x="0" y="0" width="100" height="8" className="gauge-track" />
            <rect
              x="0"
              y="0"
              width={(row.value / max) * 100}
              height="8"
              className={row.saved ? 'gauge-fill' : 'gauge-fill-alt'}
            />
          </svg>
          <span className="pixel bar-value">{fmt(row.value)}</span>
        </div>
      ))}
      <p className="small" style={{ marginTop: 6 }}>
        두 원천 차이 <strong>{fmt(gap)}</strong> {unit} ({gapPct.toFixed(2)}%) — 저장은 {primary.name} 값만
        합니다. 같은 사실을 두 곳이 조금 다르게 말한다는 뜻입니다.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------- 관측 시계열 */

export function Sparkline({ points, unit }: { points: Observation[]; unit: string }) {
  if (points.length < 2) {
    return (
      <p className="small">
        관측 기록이 {points.length}건입니다. 2건 이상 쌓이면 여기에 시계열이 그려집니다. 매일 21:00 KST에 자동으로
        한 건씩 늘어납니다.
      </p>
    );
  }

  const values = points.map((p) => p.normalized_value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // 값이 전부 같으면 선이 바닥에 붙어 빈 상자처럼 보입니다. 그럴 때는 가운데 높이로 그립니다.
  const flat = max === min;
  const span = max - min || 1;
  const W = 100;
  const H = 34;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => (flat ? H / 2 : H - ((v - min) / span) * (H - 4) - 2);

  const line = points.map((p, i) => `${x(i).toFixed(2)},${y(p.normalized_value).toFixed(2)}`).join(' ');
  const area = `0,${H} ${line} ${W},${H}`;
  const last = points[points.length - 1];
  const first = points[0];
  const drift = last.normalized_value - first.normalized_value;

  return (
    <div>
      <div className="chart-head">
        <span className="pixel chart-big">{fmt(last.normalized_value)}</span>
        <span className="small">
          최근 {points.length}건 ·{' '}
          {flat ? `${fmt(min)} ${unit}에서 변화 없음` : `최소 ${fmt(min)} / 최대 ${fmt(max)} ${unit}`}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="spark"
        role="img"
        aria-label={`관측 ${points.length}건 시계열, 최소 ${fmt(min)} 최대 ${fmt(max)} ${unit}`}
      >
        {!flat && <polygon points={area} className="spark-area" />}
        <polyline points={line} className="spark-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="spark-axis small">
        <span>{kstDateTime(first.observed_at)}</span>
        <span>
          {drift > 0 ? '▲' : drift < 0 ? '▼' : '＝'} {fmt(Math.abs(drift))} {unit}
        </span>
        <span>{kstDateTime(last.observed_at)}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------ 실패 다섯 갈래 */

export function FailureMatrix({ active }: { active: ErrorCode | null }) {
  return (
    <div className="matrix">
      {ERROR_CODES.map((code) => {
        const copy = FAILURE_COPY[code as Exclude<ErrorCode, 'none'>];
        return (
          <div
            key={code}
            className={`matrix-cell${active === code ? ' on' : ''}`}
            data-error={code}
          >
            <span className="matrix-icon" aria-hidden="true">
              {copy.icon}
            </span>
            <span className="pixel matrix-code">{code}</span>
            <span className="matrix-next small">{copy.nextAction}</span>
          </div>
        );
      })}
    </div>
  );
}
