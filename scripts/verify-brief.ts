/**
 * T05 고정 검사 10개 — 멀티 LLM 요약 브리핑 폴백.
 *
 * 이 파일은 AI A 착수 전에 고정되었습니다. 이후 어떤 작업자도
 * 검사를 삭제·완화하거나 기대값을 바꾸지 않습니다 (T05-C18/C19/C20).
 *
 * 실행: npm run verify:brief
 * 출력: 각 검사 1줄 `PASS/FAIL  <ID>  <설명>` + 마지막에 통과 수
 *
 * 네트워크를 쓰지 않습니다. 진짜 LLM 대신 가짜 제공자를 주입해
 * "실패하면 다음으로 넘어가는가"만 확인하므로 몇 번을 돌려도 결과가 같습니다.
 */
import { emptyState } from '../src/lib/core';
import { FIXTURES } from '../src/lib/fixtures';
import { resetEvaluationState, runFixture } from '../src/lib/replay';
import type { BoardState, Observation } from '../src/lib/types';

// ────────────────────────────────────────────────────────────────
// 검사 대상 계약 — src/lib/brief.ts 가 반드시 내보내야 하는 것들
// ────────────────────────────────────────────────────────────────
interface BriefInput {
  rows: BoardState['daily_readings'];
  current: BoardState['current_reading'];
  status: BoardState['status'];
  comparison: BoardState['comparison'];
  observations: Observation[];
}

interface BriefProvider {
  id: string;
  generate(input: BriefInput, signal: AbortSignal): Promise<string[]>;
}

interface Brief {
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

interface BriefModule {
  buildBrief(input: BriefInput, opts?: BuildOptions): Promise<Brief>;
  briefChain(env?: string): string[];
  resetBriefCache(): void;
  briefBanner(brief: Brief): string;
  BRIEF_PROVIDERS: Record<string, BriefProvider>;
}

// ────────────────────────────────────────────────────────────────
// 채점기
// ────────────────────────────────────────────────────────────────
const RESULTS: { id: string; ok: boolean; detail: string }[] = [];

function report(id: string, desc: string, ok: boolean, detail: string) {
  RESULTS.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ok ? '' : `\n        → ${detail}`}`);
}

async function test(
  id: string,
  desc: string,
  body: (mod: BriefModule) => Promise<string | null>,
) {
  let mod: BriefModule;
  try {
    mod = (await import('../src/lib/brief')) as unknown as BriefModule;
  } catch (error) {
    report(id, desc, false, `src/lib/brief.ts 를 불러올 수 없습니다: ${(error as Error).message}`);
    return;
  }
  try {
    const failure = await body(mod);
    report(id, desc, failure === null, failure ?? '');
  } catch (error) {
    report(id, desc, false, `예외 발생: ${(error as Error).message}`);
  }
}

// ────────────────────────────────────────────────────────────────
// 가짜 제공자 — 이 파일 안에서만 씁니다
// ────────────────────────────────────────────────────────────────
let mockOkCalls = 0;

const mockok: BriefProvider = {
  id: 'mockok',
  async generate() {
    mockOkCalls += 1;
    return ['가짜 요약 첫째 줄', '가짜 요약 둘째 줄', '가짜 요약 셋째 줄'];
  },
};

const mockfail: BriefProvider = {
  id: 'mockfail',
  async generate() {
    throw new Error('mockfail: 의도적 실패');
  },
};

const mockfail2: BriefProvider = {
  id: 'mockfail2',
  async generate() {
    throw new Error('mockfail2: 의도적 실패');
  },
};

/** 5초를 기다리지만 중단 신호가 오면 즉시 포기합니다. deadline이 없으면 검사가 느려집니다. */
const mocktimeout: BriefProvider = {
  id: 'mocktimeout',
  generate(_input, signal) {
    return new Promise<string[]>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('mocktimeout: 5초 경과')), 5000);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('mocktimeout: 중단됨'));
      });
    });
  },
};

const MOCKS = { mockok, mockfail, mockfail2, mocktimeout };

// ────────────────────────────────────────────────────────────────
// 입력 만들기
// ────────────────────────────────────────────────────────────────
function toInput(state: BoardState, observations: Observation[] = []): BriefInput {
  return {
    rows: state.daily_readings,
    current: state.current_reading,
    status: state.status,
    comparison: state.comparison,
    observations,
  };
}

function play(ids: string[]): BoardState {
  let state = resetEvaluationState();
  for (const id of ids) state = runFixture(state, FIXTURES[id]);
  return state;
}

/** 정상 2일치 — T01·T02·T03·T06·T09 공통 입력 */
const NORMAL = () => toInput(play(['T04-NORMAL-D1-A', 'T04-NORMAL-D2']));

function manyObservations(n: number): Observation[] {
  return Array.from({ length: n }, (_, i) => ({
    observed_at: new Date(Date.UTC(2026, 7, 30, 0, i)).toISOString(),
    normalized_value: 400 + (i % 97),
    capacity: 1000,
    unit: '명',
    source_name: 'mcstatus.io',
  }));
}

const LINE_MIN = 1;
const LINE_MAX = 120;
const TOTAL_MAX = 3000;

// ────────────────────────────────────────────────────────────────
// 검사 10개
// ────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== T05 고정 검사 10개 (네트워크 미사용) ===\n');

  await test('T05-T01', '정상 입력 + mockok → 3줄, 각 줄 1~120자', async (m) => {
    m.resetBriefCache();
    const b = await m.buildBrief(NORMAL(), { chain: ['mockok'], providers: MOCKS });
    if (b.lines.length !== 3) return `lines.length=${b.lines.length}, 기대=3`;
    const bad = b.lines.findIndex((l) => l.length < LINE_MIN || l.length > LINE_MAX);
    if (bad >= 0) return `${bad}번째 줄 길이=${b.lines[bad].length}, 기대=${LINE_MIN}~${LINE_MAX}`;
    return null;
  });

  await test('T05-T02', 'mockok 성공 시 provider=mockok, fallback=false', async (m) => {
    m.resetBriefCache();
    const b = await m.buildBrief(NORMAL(), { chain: ['mockok'], providers: MOCKS });
    if (b.provider !== 'mockok') return `provider=${b.provider}, 기대=mockok`;
    if (b.fallback !== false) return `fallback=${b.fallback}, 기대=false`;
    return null;
  });

  await test('T05-T03', 'mockfail,mockok → mockok으로 넘어가고 시도 순서가 기록됨', async (m) => {
    m.resetBriefCache();
    const b = await m.buildBrief(NORMAL(), { chain: ['mockfail', 'mockok'], providers: MOCKS });
    if (b.provider !== 'mockok') return `provider=${b.provider}, 기대=mockok`;
    const actual = JSON.stringify(b.attempts);
    const expected = JSON.stringify(['mockfail', 'mockok']);
    if (actual !== expected) return `attempts=${actual}, 기대=${expected}`;
    return null;
  });

  await test('T05-T04', '전부 실패 → provider=rule, fallback=true, 예외 없음', async (m) => {
    m.resetBriefCache();
    const b = await m.buildBrief(NORMAL(), { chain: ['mockfail', 'mockfail2'], providers: MOCKS });
    if (b.provider !== 'rule') return `provider=${b.provider}, 기대=rule`;
    if (b.fallback !== true) return `fallback=${b.fallback}, 기대=true`;
    if (b.lines.length !== 3) return `lines.length=${b.lines.length}, 기대=3`;
    return null;
  });

  await test('T05-T05', '체인 빈 값 → provider=rule, fallback=true', async (m) => {
    m.resetBriefCache();
    const b = await m.buildBrief(NORMAL(), { chain: m.briefChain(''), providers: MOCKS });
    if (b.provider !== 'rule') return `provider=${b.provider}, 기대=rule`;
    if (b.fallback !== true) return `fallback=${b.fallback}, 기대=true`;
    return null;
  });

  await test('T05-T06', 'mocktimeout,mockok + deadline 800ms → 3초 내 mockok', async (m) => {
    m.resetBriefCache();
    const started = Date.now();
    const b = await m.buildBrief(NORMAL(), {
      chain: ['mocktimeout', 'mockok'],
      providers: MOCKS,
      deadlineMs: 800,
    });
    const elapsed = Date.now() - started;
    if (elapsed >= 3000) return `소요=${elapsed}ms, 기대=3000ms 미만 (deadline 미적용)`;
    if (b.provider !== 'mockok') return `provider=${b.provider}, 기대=mockok`;
    return null;
  });

  await test('T05-T07', '데이터 0건 → 3줄, 첫 줄에 "수집된 항목 없음"', async (m) => {
    m.resetBriefCache();
    const b = await m.buildBrief(toInput(emptyState()), { chain: ['rule'] });
    if (b.lines.length !== 3) return `lines.length=${b.lines.length}, 기대=3`;
    if (!b.lines[0].includes('수집된 항목 없음')) return `lines[0]="${b.lines[0]}"`;
    return null;
  });

  await test('T05-T08', '관측 200건(경계) → 3줄, 전체 3000자 이하, 5초 내', async (m) => {
    m.resetBriefCache();
    const started = Date.now();
    const b = await m.buildBrief(toInput(play(['T04-NORMAL-D1-A', 'T04-NORMAL-D2']), manyObservations(200)), {
      chain: ['rule'],
    });
    const elapsed = Date.now() - started;
    if (b.lines.length !== 3) return `lines.length=${b.lines.length}, 기대=3`;
    const total = b.lines.join('').length;
    if (total > TOTAL_MAX) return `전체 길이=${total}, 기대=${TOTAL_MAX} 이하`;
    if (elapsed >= 5000) return `소요=${elapsed}ms, 기대=5000ms 미만`;
    return null;
  });

  await test('T05-T09', '같은 cacheKey로 2회 → 2회차 cached=true, 제공자 호출 1회', async (m) => {
    m.resetBriefCache();
    mockOkCalls = 0;
    const opts = { chain: ['mockok'], providers: MOCKS, cacheKey: 'T05-T09' };
    const first = await m.buildBrief(NORMAL(), opts);
    const second = await m.buildBrief(NORMAL(), opts);
    if (first.cached !== false) return `1회차 cached=${first.cached}, 기대=false`;
    if (second.cached !== true) return `2회차 cached=${second.cached}, 기대=true`;
    if (mockOkCalls !== 1) return `제공자 호출=${mockOkCalls}회, 기대=1회`;
    return null;
  });

  await test('T05-T10', '폴백 상태 화면 문구에 "요약 폴백: 규칙기반", 비밀값 0건', async (m) => {
    m.resetBriefCache();
    const b = await m.buildBrief(toInput(play(['T04-NORMAL-D1-A', 'T04-SCHEMA-BREAK'])), {
      chain: ['mockfail'],
      providers: MOCKS,
    });
    if (b.provider !== 'rule') return `provider=${b.provider}, 기대=rule`;
    const banner = m.briefBanner(b);
    if (!banner.includes('요약 폴백: 규칙기반')) return `banner="${banner}"`;
    const dump = JSON.stringify(b) + banner;
    const secret = dump.match(/sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|gsk_[A-Za-z0-9]{20,}/);
    if (secret) return `비밀값 형태 문자열 발견: ${secret[0].slice(0, 8)}…`;
    return null;
  });

  const passed = RESULTS.filter((r) => r.ok).length;
  const firstFail = RESULTS.find((r) => !r.ok);
  console.log(`\n통과 ${passed}/10`);
  if (firstFail) console.log(`첫 실패 검사: ${firstFail.id}`);
  process.exit(passed === 10 ? 0 : 1);
}

main();
