---
title: Installation
order: 2
install: true
product: seek
---

Install the native binary with Homebrew or a release archive, or run from
source with Bun during development.

## Homebrew

```bash
brew install wyrd-company/tools/seek-cli
```

This installs a prebuilt single-file `seek` binary on your `PATH`. No Bun
runtime is required.

## Release archives

Each release attaches a `seek` binary for macOS and Linux, on arm64 and x86_64,
as `seek-<os>-<arch>.tar.gz` (`macos` or `linux`; `arm64` or `x86_64`). For
Linux x86_64:

```bash
curl -LO https://github.com/wyrd-company/seek-cli/releases/latest/download/seek-linux-x86_64.tar.gz
tar -xzf seek-linux-x86_64.tar.gz
sudo install seek /usr/local/bin/seek
```

## From source (Bun)

seek is a [Bun](https://bun.sh) + TypeScript project. Bun is the only
prerequisite for running from source.

```bash
git clone https://github.com/wyrd-company/seek-cli
cd seek-cli
bun install
```

Expose the `seek` command on your `PATH`:

```bash
bun link            # links the `seek` bin from package.json
```

Or run it directly without linking:

```bash
bun run src/index.ts web parallel "your query"
# or the dev script, which is the same entrypoint:
bun run dev web parallel "your query"
```

## Build a native binary

Compile a standalone, single-file executable (no Bun needed to run it):

```bash
bun run build       # -> dist/seek
```

A JavaScript bundle target is also available:

```bash
bun run build:js    # -> dist/seek.js
```

## Verify

```bash
seek --version
seek --help
```

`seek --help` lists the top-level commands: `web`, `research`, `scrape`, and
`config`. See [Configuration](config) to add provider API keys before running a
query.
