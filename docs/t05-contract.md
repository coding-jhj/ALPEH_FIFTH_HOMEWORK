# T05 고정 계약 — 작업 착수 전 확정

이 문서와 `scripts/verify-brief.ts`는 **AI A 착수 전에 커밋**되었습니다.
이후 어떤 작업자도 검사를 삭제·완화하거나 기대값을 바꾸지 않습니다 (T05-C18/C19/C20).

## 1. 개선 대상 (기능 1개)
`src/lib/brief.ts` — **멀티 LLM 요약 브리핑 + 제공자 폴백**

정보판 데이터를 3줄로 요약한다. LLM 제공자를 여러 개 순서대로 시도하고,
앞이 실패하면 다음으로 넘어가고, 전부 실패하면 LLM 없이 규칙기반 3줄을 만든다.
`src/lib/source.ts`의 `PROVIDERS` + `activeProvider()` 패턴을 그대로 따른다.

## 2. 반드시 내보내야 하는 계약 (검사가 이것만 봅니다)

```ts
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
  lines: string[];        // 항상 정확히 3줄
  provider: string;       // 실제로 성공한 제공자 id
  attempts: string[];     // 시도한 제공자 id를 순서대로
  fallback: boolean;      // rule로 떨어졌으면 true
  cached: boolean;        // 캐시에서 꺼냈으면 true
  generated_at: string;   // ISO-8601
}

export const BRIEF_PROVIDERS: Record<string, BriefProvider>;  // 최소한 'rule' 포함
export function briefChain(env?: string): string[];            // 쉼표 목록 → 배열. 빈 값이면 []
export function resetBriefCache(): void;
export function briefBanner(brief: Brief): string;             // fallback이면 '요약 폴백: 규칙기반' 포함
export function buildBrief(
  input: BriefInput,
  opts?: {
    chain?: string[];                             // 없으면 briefChain(process.env.BRIEF_PROVIDERS_ENV)
    providers?: Record<string, BriefProvider>;    // 없으면 BRIEF_PROVIDERS
    deadlineMs?: number;                          // 제공자 1개당 제한시간
    cacheKey?: string;
  },
): Promise<Brief>;
```

규칙:
- `buildBrief`는 **어떤 경우에도 예외를 던지지 않는다.** 전부 실패하면 `rule`로 떨어진다.
- `rule` 제공자는 네트워크를 쓰지 않는다. 숫자 계산만으로 3줄을 만든다.
- 데이터가 0건이면 `lines[0]`에 `수집된 항목 없음`을 넣는다.
- 실제 API 키는 `.env.example`에 이름만 등록한다. 원문 커밋 0건.

## 3. 고정 검사 10개
실행: `npm run verify:brief` (네트워크 미사용, 몇 번 돌려도 같은 결과)

| ID | 입력 | 관찰 가능한 기대값 |
|---|---|---|
| T05-T01 | 정상 2일치 + 체인 `mockok` | `lines.length === 3`, 각 줄 1~120자 |
| T05-T02 | 위와 같음 | `provider === "mockok"`, `fallback === false` |
| T05-T03 | 체인 `mockfail,mockok` | `provider === "mockok"`, `attempts === ["mockfail","mockok"]` |
| T05-T04 | 체인 `mockfail,mockfail2` | `provider === "rule"`, `fallback === true`, 예외 없음, 3줄 |
| T05-T05 | `briefChain("")` (빈 체인) | `provider === "rule"`, `fallback === true` |
| T05-T06 | 체인 `mocktimeout,mockok`, `deadlineMs: 800` | 총 소요 < 3000ms, `provider === "mockok"` |
| T05-T07 | 데이터 0건, 체인 `rule` | `lines.length === 3`, `lines[0]`에 `수집된 항목 없음` |
| T05-T08 | 관측 200건(경계), 체인 `rule` | `lines.length === 3`, 전체 3000자 이하, 5초 내 |
| T05-T09 | 같은 `cacheKey`로 2회 | 1회차 `cached===false`, 2회차 `cached===true`, 제공자 호출 1회 |
| T05-T10 | 폴백 상태 | `briefBanner()`에 `요약 폴백: 규칙기반`, 비밀값 형태 문자열 0건 |

경계값: T05-T07(0건), T05-T08(200건)

## 4. 공통 사용 상한 (A·B 동일 적용)
- **시간 상한: 120분**
- **요청·호출 수 상한: 60회**

## 5. A/B 분할선

| 작업자 | 범위 | 목표 |
|---|---|---|
| **AI A** | `BriefProvider` 인터페이스 · `BRIEF_PROVIDERS`(rule) · `briefChain` · `buildBrief` 순차 시도 · 캐시 · `briefBanner` 골격 | **6/10** — T01·T02·T04·T05·T07·T09 |
| **AI B** | `attempts` 순서 기록 · 제공자별 `deadlineMs` 중단 · 200건 입력 3000자 절단 · 폴백 배너 문구 | **10/10** — T03·T06·T08·T10 추가 |

AI A는 6/10에서 **의도적으로 멈춘다.** 10/10을 만들면 과제 구조가 성립하지 않는다.

## 6. 건드리지 말 것 (두 작업자 공통)
- `scripts/verify-brief.ts`
- `scripts/verify-fixtures.ts`
- `src/fixtures/*.json`, `public/fixtures/*.json`
- `src/lib/core.ts`, `src/lib/replay.ts`, `src/lib/source.ts`, `src/lib/store.ts`
- 기존 T04 폴백·상태 로직 전체

## 7. 두 모델에 똑같이 줄 최초 요청 (원문)

> 이 저장소는 마인크래프트 서버 접속자 수 정보판입니다.
> `docs/t05-contract.md`의 2절 계약을 그대로 구현한 `src/lib/brief.ts`를 새로 만드세요.
> 검사는 `npm run verify:brief`로 확인합니다.
> 5절의 자기 범위만 구현하고, 6절 파일은 절대 수정하지 마세요.
> 검사 파일을 고치거나 기대값을 바꾸면 실패로 처리됩니다.

## 8. 오류 회차 세는 법 (T05-C25)
`npm run verify:brief` 1회 실행 = 1회차. 10개 중 하나라도 FAIL이면 그 회차를 오류 1로 센다.
기록은 `docs/t05-runs.md`.
