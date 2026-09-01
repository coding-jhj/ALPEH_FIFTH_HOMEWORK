BASE_COMMIT: b6043fa36a0edd7e01a4468f322d1c479a5e2533

## 1. 목표

저장소: https://github.com/coding-jhj/ALPEH_FIFTH_HOMEWORK

마인크래프트 서버 접속자 수 정보판의 멀티 LLM 요약 브리핑 기능인 `src/lib/brief.ts`를 `docs/t05-contract.md`의 2절 계약에 맞게 구현한다. 계약의 5절에서 정한 작업자별 범위를 지키고, 6절의 금지 파일과 기존 T04 폴백·상태 로직은 변경하지 않는다.

## 2. 현재 상태

현재 코드는 AI A 범위의 6/10 구현 상태다. `src/lib/brief.ts`에는 다음 항목이 구현되어 있다.

- `BriefInput`, `BriefProvider`, `Brief` 인터페이스
- 규칙기반 `rule` 제공자와 `BRIEF_PROVIDERS`
- 쉼표로 구분된 제공자 체인을 배열로 변환하는 `briefChain`
- 제공자 순차 시도와 전체 실패 시 규칙기반 폴백
- `cacheKey` 기반 브리핑 캐시와 `resetBriefCache`
- 기본 제공자 배너 골격

현재 검사 결과: 통과 6/10, 첫 실패 검사 T05-T03

## 3. 실행 명령

```bash
npm ci
npm run verify:brief
```

## 4. 통과 검사


* T05-T01
* T05-T02
* T05-T04
* T05-T05
* T05-T07
* T05-T09

## 5. 남은 문제

다음 4개는 아직 구현하지 않은 작업자 범위다.

* T05-T03 → `attempts=[], 기대=["mockfail","mockok"]`
* T05-T06 → `소요=5006ms, 기대=3000ms 미만 (deadline 미적용)`
* T05-T08 → `전체 길이=7927, 기대=3000 이하`
* T05-T10 → `banner="요약 제공자: rule", 기대: "요약 폴백: 규칙기반" 포함`

## 6. 다음 행동

`docs/t05-contract.md`의 2절 계약과 5절 작업 범위를 다시 확인한 뒤, `src/lib/brief.ts`에서 다음 AI B 범위만 이어서 구현한다.

1. T05-T03: 시도한 제공자 id를 실제 시도 순서대로 `attempts`에 기록한다.
2. T05-T06: `deadlineMs`를 제공자별 제한시간으로 적용하고 중단 신호를 전달한다.
3. T05-T08: 관측 200건 경계에서 브리핑 전체 길이를 3000자 이하로 절단한다.
4. T05-T10: 폴백 배너에 `요약 폴백: 규칙기반` 문구를 포함한다.

구현 후 `npm run verify:brief`를 다시 실행한다. 검사 10개와 기대값은 고정되어 있으므로 검사 파일이나 기대값을 수정하지 않는다.
## 7. 건드리지 말 것


* `scripts/verify-brief.ts`
* `scripts/verify-fixtures.ts`
* `src/fixtures/*`
* `public/fixtures/*`
* `src/lib/core.ts`
* `src/lib/replay.ts`
* `src/lib/source.ts`
* `src/lib/store.ts`
* 기존 T04 폴백·상태 로직 전체

검사 파일을 고치거나 기대값을 바꾸지 않는다.
