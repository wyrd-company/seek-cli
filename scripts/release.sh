#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

APP_NAME="${APP_NAME:-seek}"
PROJECT_REPO="${PROJECT_REPO:-${GITHUB_REPOSITORY:-wyrd-company/seek-cli}}"
RELEASE_DIR="${RELEASE_DIR:-dist/release}"
RELEASE_TARGETS="${RELEASE_TARGETS:-macos-arm64,macos-x86_64,linux-arm64,linux-x86_64}"
RUN_CI="${RUN_CI:-1}"
PUBLISH_GITHUB_RELEASE="${PUBLISH_GITHUB_RELEASE:-0}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: missing required command: $1" >&2
    exit 1
  fi
}

bun_target_for() {
  case "$1" in
    macos-arm64) echo "bun-darwin-arm64" ;;
    macos-x86_64) echo "bun-darwin-x64" ;;
    linux-arm64) echo "bun-linux-arm64" ;;
    linux-x86_64) echo "bun-linux-x64" ;;
    *)
      echo "error: unsupported release target: $1" >&2
      exit 1
      ;;
  esac
}

need bun
need tar

VERSION="${VERSION:-$(bun -p "require('./package.json').version")}"
TAG="${TAG:-${GITHUB_REF_NAME:-${VERSION}}}"

if [[ "$TAG" != "${VERSION}" && "${ALLOW_VERSION_MISMATCH:-0}" != "1" ]]; then
  echo "error: release tag ${TAG} does not match package version ${VERSION}" >&2
  echo "Set ALLOW_VERSION_MISMATCH=1 to override." >&2
  exit 1
fi

if [[ "$RUN_CI" == "1" ]]; then
  ./scripts/ci.sh
fi

rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

IFS=',' read -ra TARGETS <<<"$RELEASE_TARGETS"
for target in "${TARGETS[@]}"; do
  bun_target="$(bun_target_for "$target")"
  staging_dir="${RELEASE_DIR}/staging/${target}"
  binary_path="${staging_dir}/${APP_NAME}"
  archive_path="${RELEASE_DIR}/${APP_NAME}-${target}.tar.gz"

  mkdir -p "$staging_dir"
  echo "Building ${target}..."
  bun build src/index.ts --compile --target="$bun_target" --outfile "$binary_path"
  chmod 755 "$binary_path"
  tar -C "$staging_dir" -czf "$archive_path" "$APP_NAME"
done

echo "Release artifacts:"
ls -1 "${RELEASE_DIR}"/*.tar.gz

if [[ "$PUBLISH_GITHUB_RELEASE" == "1" ]]; then
  need gh

  echo "Publishing GitHub release ${TAG}..."
  if gh release view "$TAG" --repo "$PROJECT_REPO" >/dev/null 2>&1; then
    gh release upload "$TAG" "${RELEASE_DIR}"/*.tar.gz --repo "$PROJECT_REPO" --clobber
  else
    gh release create "$TAG" "${RELEASE_DIR}"/*.tar.gz \
      --repo "$PROJECT_REPO" \
      --title "$TAG" \
      --notes "Release ${TAG}"
  fi
fi
