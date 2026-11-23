#!/usr/bin/env bash
# Runs inside the capture container (see capture.sh): records each named tape
# with a fresh practice server and a synthetic, empty home directory.
set -euo pipefail

export HOME=/tmp/capture-home
bin=/tmp/capture-bin
work=/tmp/seek-docs
mkdir -p "$HOME" "$bin"
ln -sf /repo/dist/seek "$bin/seek"

for name in "$@"; do
  rm -rf "$work" "$HOME"
  mkdir -p "$work" "$HOME"
  cp docs/user/examples/practice-server.mjs docs/user/examples/server-client.mjs "$work/"
  (cd "$work" && exec node practice-server.mjs >/tmp/practice.log 2>&1) &
  practice=$!
  for _ in $(seq 100); do
    curl -sf http://127.0.0.1:8788/healthz >/dev/null && break
    sleep 0.1
  done

  echo "Recording ${name}..."
  env -i HOME="$HOME" PATH="$bin:/usr/local/bin:/usr/bin:/bin" TERM=xterm-256color LANG=C.UTF-8 \
    VHS_NO_SANDBOX=true SEEK_DOCS_DIR="$work" \
    vhs "docs/captures/${name}.tape"

  kill "$practice" 2>/dev/null || true
  wait "$practice" 2>/dev/null || true
done
