---
docs: true
title: Installation
order: 2
install: true
---

Install the native binary with Homebrew, or run from source with Bun during
development.

## Homebrew

```bash
brew install wyrd-company/tools/seek-cli
```

This installs a prebuilt single-file `seek` binary on your `PATH`. No Bun
runtime is required.

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
