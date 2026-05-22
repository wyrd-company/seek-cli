#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

APP_NAME="${APP_NAME:-seek}"
FORMULA_NAME="${FORMULA_NAME:-seek-cli}"
ARTIFACT_ROOT="${ARTIFACT_ROOT:-artifacts}"
TAP_DIR="${TAP_DIR:-homebrew-tools}"
REPOSITORY="${REPOSITORY:-${GITHUB_REPOSITORY:-wyrd-company/seek-cli}}"
TAG="${TAG:-${GITHUB_REF_NAME:-}}"

if [[ -z "$TAG" ]]; then
  TAG="$(git describe --tags --exact-match 2>/dev/null || true)"
fi

if [[ -z "$TAG" ]]; then
  echo "error: TAG is required when the current commit is not exactly tagged" >&2
  exit 1
fi

VERSION="${VERSION:-${TAG}}"

if [[ "$TAG" != "${VERSION}" && "${ALLOW_VERSION_MISMATCH:-0}" != "1" ]]; then
  echo "error: release tag ${TAG} does not match formula version ${VERSION}" >&2
  echo "Set ALLOW_VERSION_MISMATCH=1 to override." >&2
  exit 1
fi

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "error: missing sha256sum or shasum" >&2
    exit 1
  fi
}

archive_for() {
  local target="$1"
  local archive="${APP_NAME}-${target}.tar.gz"
  local nested="${ARTIFACT_ROOT}/${APP_NAME}-${target}/${archive}"
  local flat="${ARTIFACT_ROOT}/${archive}"

  if [[ -f "$nested" ]]; then
    echo "$nested"
  elif [[ -f "$flat" ]]; then
    echo "$flat"
  else
    echo "error: missing expected release artifact: ${nested} or ${flat}" >&2
    exit 1
  fi
}

LINUX_X86_64_ARCHIVE="$(archive_for linux-x86_64)"
LINUX_ARM64_ARCHIVE="$(archive_for linux-arm64)"
MACOS_X86_64_ARCHIVE="$(archive_for macos-x86_64)"
MACOS_ARM64_ARCHIVE="$(archive_for macos-arm64)"

LINUX_X86_64_SHA256="$(sha256_file "$LINUX_X86_64_ARCHIVE")"
LINUX_ARM64_SHA256="$(sha256_file "$LINUX_ARM64_ARCHIVE")"
MACOS_X86_64_SHA256="$(sha256_file "$MACOS_X86_64_ARCHIVE")"
MACOS_ARM64_SHA256="$(sha256_file "$MACOS_ARM64_ARCHIVE")"

if [[ ! -d "$TAP_DIR/.git" ]]; then
  echo "error: tap checkout not found at ${TAP_DIR}" >&2
  exit 1
fi

mkdir -p "${TAP_DIR}/Formula"

cat >"${TAP_DIR}/Formula/${FORMULA_NAME}.rb" <<EOF
class SeekCli < Formula
  desc "Agent-friendly CLI for web search, deep research, and scraping"
  homepage "https://github.com/${REPOSITORY}"
  version "${VERSION}"

  on_macos do
    on_arm do
      url "https://github.com/${REPOSITORY}/releases/download/${TAG}/${APP_NAME}-macos-arm64.tar.gz"
      sha256 "${MACOS_ARM64_SHA256}"
    end

    on_intel do
      url "https://github.com/${REPOSITORY}/releases/download/${TAG}/${APP_NAME}-macos-x86_64.tar.gz"
      sha256 "${MACOS_X86_64_SHA256}"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/${REPOSITORY}/releases/download/${TAG}/${APP_NAME}-linux-arm64.tar.gz"
      sha256 "${LINUX_ARM64_SHA256}"
    end

    on_intel do
      url "https://github.com/${REPOSITORY}/releases/download/${TAG}/${APP_NAME}-linux-x86_64.tar.gz"
      sha256 "${LINUX_X86_64_SHA256}"
    end
  end

  def install
    bin.install "${APP_NAME}"
    prefix.install_metafiles
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/${APP_NAME} --version")
  end
end
EOF

cd "$TAP_DIR"

git config user.name "${GIT_AUTHOR_NAME:-github-actions[bot]}"
git config user.email "${GIT_AUTHOR_EMAIL:-github-actions[bot]@users.noreply.github.com}"

git add "Formula/${FORMULA_NAME}.rb"

if git diff --cached --quiet -- "Formula/${FORMULA_NAME}.rb"; then
  echo "Formula already up to date."
  exit 0
fi

git commit -m "${FORMULA_NAME} ${VERSION}"

if [[ "${PUSH_TAP:-1}" == "1" ]]; then
  git push origin HEAD
fi
