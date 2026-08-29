#!/usr/bin/env bash
# 비밀값 노출 점검 (T04-C11). 소스 + 빌드 산출물(브라우저로 나가는 파일)을 함께 봅니다.
#
# 이 스크립트는 걸린 값을 절대 출력하지 않습니다. 위치(파일:줄)만 알립니다.
# 스캐너가 비밀값을 화면·로그에 다시 뿌리면 점검이 곧 유출 경로가 됩니다.
set -u
PATTERN='service_role|sb_secret_[A-Za-z0-9._-]{8,}|SUPABASE_SERVICE_ROLE_KEY=[A-Za-z0-9._-]+|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|(api[_-]?key|secret|token)[\"'\'' ]*[:=][\"'\'' ]*[A-Za-z0-9._-]{16,}'
fail=0

# 점검 스크립트 자신과 문서의 예시 문구는 제외합니다.
# .env* 는 .gitignore 대상이라 저장소·번들에 나가지 않으므로 4번 항목에서 추적 여부만 봅니다.
EXCLUDES=(--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next
          --exclude=scan-secrets.sh --exclude=README.md --exclude='.env*')

echo "== 1. 소스 트리 =="
hits=$(grep -rInE "$PATTERN" "${EXCLUDES[@]}" . 2>/dev/null || true)
if [ -n "$hits" ]; then
  printf '%s\n' "$hits" | cut -d: -f1,2 | sed 's/^/  검토 필요: /'
  fail=1
else echo "  0건"; fi

echo "== 2. 브라우저 번들(.next/static) =="
if [ -d .next/static ]; then
  bundle=$(grep -rlE "$PATTERN" .next/static 2>/dev/null || true)
  if [ -n "$bundle" ]; then printf '%s\n' "$bundle" | sed 's/^/  검토 필요: /'; fail=1
  else echo "  0건"; fi
else echo "  0건 (빌드 산출물 없음)"; fi

echo "== 3. Git 기록 =="
if git rev-parse --git-dir >/dev/null 2>&1; then
  count=$(git log -p --all -- . ':(exclude)scripts/scan-secrets.sh' ':(exclude)README.md' ':(exclude).env.example' 2>/dev/null \
          | grep -cE "^\+.*($PATTERN)" || true)
  if [ "${count:-0}" -gt 0 ]; then echo "  검토 필요: 추가된 줄 ${count}건"; fail=1
  else echo "  0건"; fi
else echo "  0건 (git 저장소 아님)"; fi

echo "== 4. .env 파일이 추적되고 있는지 =="
tracked=$(git ls-files 2>/dev/null | grep -E '^\.env' | grep -v example || true)
if [ -n "$tracked" ]; then printf '%s\n' "$tracked" | sed 's/^/  추적 중: /'; fail=1
else echo "  0건"; fi

[ "$fail" -eq 0 ] && echo "결과: 비밀값 0건" || echo "결과: 확인 필요 항목 있음"
exit $fail
