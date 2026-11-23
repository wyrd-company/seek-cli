#!/usr/bin/env bash
# Regenerates seek's terminal recordings, docs/user/assets/<name>.gif, from
# docs/captures/<name>.tape. Each recording runs the seek binary this
# checkout builds against the practice server from docs/user/examples/, in a
# container with VHS, so it uses only synthetic values and no credentials.
#
#   scripts/docs/capture.sh               every recording
#   scripts/docs/capture.sh first-search  the named recordings
#
# Needs Bun and Docker.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

if [[ $# -gt 0 ]]; then
  names=("$@")
else
  names=()
  for tape in docs/captures/*.tape; do
    name="$(basename "$tape" .tape)"
    [[ "$name" == _* ]] || names+=("$name")
  done
fi
for name in "${names[@]}"; do
  [[ -f "docs/captures/${name}.tape" ]] || { echo "error: no docs/captures/${name}.tape" >&2; exit 1; }
done

echo "Building dist/seek..."
bun run build >/dev/null

echo "Building the capture image..."
docker build -q -t seek-docs-capture:local docs/captures >/dev/null

docker run --rm \
  --user "$(id -u):$(id -g)" \
  --volume "$PWD:/repo" \
  --workdir /repo \
  --entrypoint bash \
  seek-docs-capture:local \
  scripts/docs/capture-in-container.sh "${names[@]}"
