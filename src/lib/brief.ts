import type {
  Comparison,
  DailyRow,
  NormalizedReading,
  Observation,
  ReadingStatus,
} from './types';
export interface BriefInput {
  rows: DailyRow[];
  current: NormalizedReading | null;
  status: ReadingStatus | null;
  comparison: Comparison;
  observations: Observation[];
}
export interface BriefProvider {
  id: string;
  generate(input: BriefInput, signal: AbortSignal): Promise<string[]>;
}
export interface Brief {
  lines: string[];
  provider: string;
  attempts: string[];
  fallback: boolean;
  cached: boolean;
  generated_at: string;
}
interface BuildOptions {
  chain?: string[];
  providers?: Record<string, BriefProvider>;
  deadlineMs?: number;
  cacheKey?: string;
}
const briefCache = new Map<string, Brief>();
function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function formatNumber(value: unknown): string {
  if (!finiteNumber(value)) return '—';
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
function normalizeLines(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const lines = value.slice(0, 3);
  if (!lines.every((line) => typeof line === 'string')) return null;
  return lines.map((line) => line.trim());
}
function comparisonLine(comparison: Comparison | null | undefined): string {
  if (!comparison) return '어제 대비 비교 데이터 부족';
  if (comparison.state === 'comparable') {
    const direction =
      comparison.direction === 'increase'
        ? '증가'
        : comparison.direction === 'decrease'
          ? '감소'
          : '변화 없음';
    const unit = comparison.unit ?? '';
    return `어제 대비 ${direction} ${formatNumber(comparison.magnitude)}${unit}`;
  }
  if (comparison.state === 'unit_mismatch') {
    return '어제 대비 비교 불가 (단위 불일치)';
  }
  return '어제 대비 비교 데이터 부족';
}
function observationTrace(observations: Observation[]): string {
  return observations
    .map((observation, index) => {
      const value = formatNumber(observation.normalized_value);
      const capacity = formatNumber(observation.capacity);
      return `${index + 1}:${value}/${capacity}@${observation.observed_at}`;
    })
    .join(' | ');
}
function buildRuleLines(input: BriefInput): string[] {
  const rows = Array.isArray(input?.rows) ? input.rows : [];
  const observations = Array.isArray(input?.observations) ? input.observations : [];
  const current = input?.current;
  const currentValue = current?.normalized_value ?? rows[rows.length - 1]?.normalized_value;
  const unit = current?.unit ?? rows[rows.length - 1]?.unit ?? '';
  if (rows.length === 0) {
    return [
      '수집된 항목 없음',
      '현재 접속자 수를 계산할 기록이 없습니다',
      `관측 ${observations.length}건${observations.length > 0 ? `: ${observationTrace(observations)}` : ''}`,
    ];
  }
  const firstLine = `${rows.length}일 기록 · 현재 ${formatNumber(currentValue)}${unit}`;
  const secondLine = comparisonLine(input?.comparison);
  const trace = observationTrace(observations);
  const thirdLine = `관측 ${observations.length}건${trace ? `: ${trace}` : ''}`;
  return [firstLine, secondLine, thirdLine];
}
const ruleProvider: BriefProvider = {
  id: 'rule',
  async generate(input) {
    try {
      return buildRuleLines(input);
    } catch {
      return ['수집된 항목 없음', '규칙기반 요약을 만들 수 없습니다', '관측 0건'];
    }
  },
};
export const BRIEF_PROVIDERS: Record<string, BriefProvider> = {
  rule: ruleProvider,
};
export function briefChain(env?: string): string[] {
  const raw = env === undefined ? process.env.BRIEF_PROVIDERS_ENV : env;
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  return raw
    .split(',')
    .map((providerId) => providerId.trim())
    .filter((providerId) => providerId.length > 0);
}
function makeBrief(
  lines: string[],
  provider: string,
  fallback: boolean,
  cached = false,
): Brief {
  return {
    lines:
      normalizeLines(lines) ?? [
        '수집된 항목 없음',
        '규칙기반 요약을 만들 수 없습니다',
        '관측 0건',
      ],
    provider,
    attempts: [],
    fallback,
    cached,
    generated_at: new Date().toISOString(),
  };
}
async function makeRuleBrief(input: BriefInput): Promise<Brief> {
  let lines: string[];
  try {
    lines = await ruleProvider.generate(input, new AbortController().signal);
  } catch {
    lines = ['수집된 항목 없음', '규칙기반 요약을 만들 수 없습니다', '관측 0건'];
  }
  return makeBrief(lines, ruleProvider.id, true);
}
export function resetBriefCache(): void {
  briefCache.clear();
}
export function briefBanner(brief: Brief): string {
  const provider = typeof brief?.provider === 'string' ? brief.provider : 'unknown';
  return `요약 제공자: ${provider}`;
}
export async function buildBrief(
  input: BriefInput,
  opts: BuildOptions = {},
): Promise<Brief> {
  const cacheKey = opts?.cacheKey;
  const canCache = typeof cacheKey === 'string';
  if (canCache) {
    const cached = briefCache.get(cacheKey);
    if (cached) return { ...cached, cached: true };
  }
  try {
    const chain = opts?.chain ?? briefChain(process.env.BRIEF_PROVIDERS_ENV);
    const providers = opts?.providers ?? BRIEF_PROVIDERS;
    for (const providerId of chain) {
      const provider = providers[providerId];
      if (!provider || typeof provider.generate !== 'function') continue;
      try {
        const generated = await provider.generate(
          input,
          new AbortController().signal,
        );
        const lines = normalizeLines(generated);
        if (!lines) continue;
        const brief = makeBrief(
          lines,
          provider.id || providerId,
          providerId === 'rule',
        );
        if (canCache) briefCache.set(cacheKey, brief);
        return brief;
      } catch {
        // 한 제공자의 실패는 다음 제공자 시도를 막지 않습니다.
      }
    }
  } catch {
    // 계약상 오류도 규칙기반 결과로 마무리합니다.
  }
  const fallback = await makeRuleBrief(input);
  if (canCache) briefCache.set(cacheKey, fallback);
  return fallback;
}
