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
./dist/seek --version
