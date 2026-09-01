#!/usr/bin/env bash
# Everything that has to hold before this is published.
#
#   ./release.sh --check    verify only, change nothing
#   ./release.sh            build, then verify
#
# --check does not rebuild on purpose. The failure it exists to catch is a
# content change committed without the data/ it produces, and a check that
# rebuilds first can never see it.
#
# Validation against the real tools needs the network, and the GPU backend
# needs a runner you deployed. Both are reported as skipped rather than
# silently passing: a check that passes what it did not run is worse than one
# that does not run.

set -uo pipefail
cd "$(dirname "$0")"

CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

FAIL=0
SKIPPED=()

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  ok    %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; FAIL=1; }
skip() { printf '  skip  %s\n' "$1"; SKIPPED+=("$1"); }

run() {  # run <label> <command...>
  local label="$1"; shift
  local out
  if out=$("$@" 2>&1); then
    ok "$label"
    [ -n "${VERBOSE:-}" ] && printf '%s\n' "$out"
  else
    bad "$label"
    printf '%s\n' "$out" | sed 's/^/        /'
  fi
}

data_digest() { find data -type f -exec shasum -a 256 {} + 2>/dev/null | sort | shasum -a 256; }

if [ "$CHECK_ONLY" -eq 0 ]; then
  step "Build"
  run "build.py" python3 build.py
else
  step "Freshness"
  run "data/ is current with content/" python3 build.py --stale
  BEFORE=$(data_digest)
fi

step "Tests"
run "test_build.py"      python3 test_build.py
run "test_sim.mjs"       node test_sim.mjs
run "test_workbench.mjs" node test_workbench.mjs
run "test_vim.mjs"       node test_vim.mjs
run "prose.py selfcheck" python3 prose.py
run "track.py validate"  python3 -c "import track; track.validate()"
run "contrast.py"        python3 contrast.py
run "check-routes.mjs"   node tools/check-routes.mjs

step "Syntax"
for f in assets/*.js tools/*.js *.mjs; do
  [ -e "$f" ] || continue
  run "$f" node --check "$f"
done

step "Shape"
if [ -s index.html ] && [ -d data ] && [ -f data/manifest.json ]; then
  ok "index.html and data/manifest.json exist"
else
  bad "index.html or data/manifest.json is missing"
fi
# `command grep` throughout: an interactive shell here has grep wrapped as a
# function, and a release check must behave the same in a terminal as in CI.
LEFTOVERS=$(command grep -rn "TODO\|FIXME\|XXX" assets/*.js ./*.py content 2>/dev/null)
if [ -n "$LEFTOVERS" ]; then
  bad "a TODO, FIXME or XXX is left in the source"
  printf '%s\n' "$LEFTOVERS" | sed 's/^/        /'
else
  ok "no TODO, FIXME or XXX left in the source"
fi
# The key, not the word: exercise prose says "solution" all the time.
LEAKED=$(command grep -l '"solution":' data/ex/*.json 2>/dev/null)
if [ -n "$LEAKED" ]; then
  bad "a solution reaches data/, which ships to the browser: $LEAKED"
else
  ok "no solution reaches data/"
fi

step "Against the real tools"
if [ -n "${HH_OFFLINE:-}" ]; then
  skip "validation (HH_OFFLINE is set)"
elif ! curl -sf -m 8 -o /dev/null https://godbolt.org/api/compilers/c++; then
  skip "validation (no network, or Compiler Explorer is not answering)"
else
  if [ -z "${HH_MODAL_SUBMIT:-}" ]; then
    skip "the GPU backend (no runner configured; set HH_MODAL_SUBMIT, HH_MODAL_POLL, HH_MODAL_TOKEN)"
  fi
  run "build.py --validate" python3 build.py --validate
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  step "Unchanged"
  # --check says it changes nothing, so check it. --validate rebuilds on its
  # way to the tools, and this is what makes that harmless rather than merely
  # believed to be.
  if [ "$BEFORE" = "$(data_digest)" ]; then
    ok "data/ is byte for byte what it was before this run"
  else
    bad "this run modified data/, which --check must never do"
  fi
fi

step "Result"
if [ ${#SKIPPED[@]} -gt 0 ]; then
  printf '  %d check(s) skipped and not verified:\n' "${#SKIPPED[@]}"
  for s in "${SKIPPED[@]}"; do printf '    %s\n' "$s"; done
fi
if [ "$FAIL" -eq 0 ]; then
  printf '  everything that ran, passed\n'
else
  printf '  \033[1mnot releasable\033[0m\n'
fi
exit "$FAIL"
