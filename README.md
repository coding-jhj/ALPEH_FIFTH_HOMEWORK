# 오늘의 진짜 정보판 — 데이터가 안 올 때 (ALEPH T04)

공개 원천의 값 하나를 매일 한 줄로 기록하고, 어제와 비교하고, 데이터가 오지 않을 때는 실패 종류별로 다르게 설명하는 정보판입니다.

- 원천: Steam 공개 통계 — 특정 게임의 현재 접속자 수 (인증 키 불필요)
- 기준 시간대: `Asia/Seoul`
- 저장: Supabase Postgres, 고유키 `(signal_id, record_date)`

## 짧은 확인 방법

1. **어디로 가나요** — 배포된 공개 결과물 URL (로그인·인증·초대·비밀번호·OAuth·CAPTCHA 없음)
2. **무엇을 하나요 (3단계 이내)**
   1) 상단 정보판에서 값·단위·출처·출처 시각·조회 시각·기준 시간대를 확인
   2) 합성 검사 패널의 **회복** 버튼 클릭 (D1-A → D1-B → TIMEOUT → RECOVER-D2 자동 재생)
   3) 실패 상태에서 **다시 시도** 클릭
3. **무엇이 보이면 통과인가요** — 여섯 요소가 한 화면에 있고, TIMEOUT 뒤 `stale / timeout` 배지와 함께 마지막 정상값 `105`·행 `1`건이 남으며, 다시 시도 뒤 `fresh / none`·행 `2`건·값 `120`·어제 대비 `15`가 됩니다.
4. **안 될 때 무엇이 보이나요** — 다섯 실패가 각각 다른 문구와 다른 다음 행동을 보여 줍니다 (느린 응답 / 원천 거절 / 호출 제한 / 오프라인 / 형식 변경). 어느 경우에도 마지막 정상값은 지워지지 않고 `오래된 값` 표시가 붙습니다.

## 구조

```
src/lib/core.ts      정규화 검증 · KST 날짜 · upsert 규칙 · 어제 대비 재계산  ← 유일한 계산 경로
src/lib/source.ts    live adapter (실제 공개 원천 호출, 서버 전용)
src/lib/replay.ts    replay adapter (합성 fixture 전송 계층 흉내)
src/lib/store.ts     Supabase 저장 계층
scripts/verify-fixtures.ts   fixture 9종 자동 대조기
supabase/schema.sql  DB 스키마 (유니크 제약으로 하루 한 줄 강제)
public/fixtures/     공개 꾸러미 fixture 원본 사본 (심사자 대조용)
```

live adapter와 replay adapter는 **같은 `core.ts` 함수만** 호출합니다. 오류 화면만 따로 꾸미고 저장 경로는 다르게 두는 실수를 구조적으로 막기 위해서입니다.

### 실패 다섯 갈래 판정 순서

```
전송 실패(offline) → 제한시간 초과(timeout) → 401/403(auth) → 429(rate_limit) → 2xx면 스키마 검증(schema_error)
```

## 실행

```bash
npm install
cp .env.example .env.local   # 값 채우기
npm run verify               # fixture 9종 전수 대조 (네트워크 불필요)
npm run dev
```

Supabase에서 `supabase/schema.sql`을 한 번 실행해 두 테이블을 만듭니다.

### 환경변수

| 이름 | 위치 | 설명 |
|---|---|---|
| `SUPABASE_URL` | 서버 전용 | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용 | 서버 라우트에서만 사용. 브라우저 번들에 포함되지 않습니다 |
| `NEXT_PUBLIC_SIGNAL_PROVIDER` | 공개 | `steam` 또는 `open-meteo` |
| `STEAM_APP_ID` | 서버 | 조회할 게임 appid (기본 730) |
| `LIVE_DEADLINE_MS` | 서버 | 제한시간. 이 시간을 넘기면 `timeout`으로 기록 |

비밀값은 `.env.local`에만 두며 저장소에 커밋하지 않습니다 (`.gitignore` 처리).

## 비밀값·개인정보 점검

```bash
npm run scan          # 소스와 빌드 산출물에서 비밀값 패턴 검색
git log -p | grep -Ei "service_role|api[_-]?key|secret"   # 0건이어야 함
```

브라우저 개발자 도구의 네트워크 탭에서도 `/api/refresh` 응답에 자격 증명이 없는지 확인하세요.

## fixture 계약

이 저장소의 `public/fixtures/*.json`은 공개 꾸러미 `aleph-t04-real-information-board-public-contract-v2`의 파일과 같습니다. `T04-AUTH-401`의 auth는 **외부 원천의 401 거절**을 뜻하며, 이 앱에 로그인을 붙인다는 뜻이 아닙니다. 결과물과 소스 URL은 새 시크릿 창에서 아무 인증 없이 열립니다.

합성 D1/D2는 합성 시계입니다. 서로 다른 실제 KST 날짜의 실제 조회 기록 2건을 대신하지 않습니다.
