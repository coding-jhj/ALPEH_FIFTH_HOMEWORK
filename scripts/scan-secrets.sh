#!/usr/bin/env bash
# 비밀값 노출 점검 (T04-C11). 소스 + 빌드 산출물(브라우저로 나가는 파일)을 함께 봅니다.
set -u
PATTERN='service_role|SUPABASE_SERVICE_ROLE_KEY=[A-Za-z0-9._-]+|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|(api[_-]?key|secret|token)[\"'\'' ]*[:=][\"'\'' ]*[A-Za-z0-9._-]{16,}'
fail=0

echo "== 1. 소스 트리 =="
# 점검 스크립트 자신과 README의 예시 명령은 제외합니다.
if grep -rInE "$PATTERN" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next \
     --exclude=scan-secrets.sh --exclude=README.md . ; then
  echo "  -> 검토 필요"; fail=1
else echo "  0건"; fi

echo "== 2. 브라우저 번들(.next/static) =="
if [ -d .next/static ] && grep -rIlE "$PATTERN" .next/static ; then
  echo "  -> 검토 필요"; fail=1
else echo "  0건"; fi

echo "== 3. Git 기록 =="
if git rev-parse --git-dir >/dev/null 2>&1 && git log -p --all 2>/dev/null | grep -InE "$PATTERN" ; then
  echo "  -> 검토 필요"; fail=1
else echo "  0건"; fi

echo "== 4. .env 파일이 추적되고 있는지 =="
if git ls-files 2>/dev/null | grep -E '^\.env' | grep -v example ; then
  echo "  -> .env가 추적되고 있습니다"; fail=1
else echo "  0건"; fi

[ "$fail" -eq 0 ] && echo "결과: 비밀값 0건" || echo "결과: 확인 필요 항목 있음"
exit $fail
