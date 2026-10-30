#!/usr/bin/env bash
# Secret scan of everything a spec sync commits (the add-paths of spec-sync.yml), with
# the repository's .gitleaks.toml. Run from the repository root with gitleaks on PATH
# (.github/actions/setup-gitleaks). A finding here would land in the history of the
# sync branch and fail the full-history scan of every later pull request, so the spec
# sync stops before it pushes anything.
set -euo pipefail

status=0
for path in api.md openapi src/resources src/types tests/generated; do
  if ! gitleaks dir --config .gitleaks.toml --redact --verbose --no-banner "$path"; then
    status=1
  fi
done
if [ "$status" -ne 0 ]; then
  echo "::error::The secret scan found credential-like values in files the spec sync writes; nothing was pushed. Upstream sample data must not reach openapi/deprecated-operations.json or the generated code: fix codegen/ (detach() in codegen/lib/sync.ts strips examples and x-codeSamples)."
fi
exit "$status"
