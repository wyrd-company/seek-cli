#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "Installing dependencies..."
bun install --frozen-lockfile

echo "Running typecheck..."
bun run typecheck

echo "Running tests..."
bun run test

echo "Building native binary..."
bun run build

echo "Checking built binary..."
expected_version="$(bun -p "require('./package.json').version")"
actual_version="$(./dist/seek --version)"
if [[ "$actual_version" != "$expected_version" ]]; then
  echo "error: built binary version ${actual_version} does not match package version ${expected_version}" >&2
  exit 1
fi
echo "$actual_version"
