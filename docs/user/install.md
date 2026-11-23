---
title: Install seek
product: seek
order: 2
install: true
---

Install the native `seek` binary with Homebrew or a release archive, or run
it from source with Bun.

![Terminal recording: seek --version prints the installed version, and seek --help lists the commands skill, web, research, scrape, config and serve.](assets/install.gif)

## With Homebrew

On macOS or Linux:

```sh
brew install wyrd-company/tools/seek-cli
```

This installs a single-file `seek` binary on your `PATH`. It needs no Bun
runtime.

## From a release archive

Each release attaches a `seek` binary for macOS and Linux, on arm64 and
x86_64, as `seek-<os>-<arch>.tar.gz`, where `<os>` is `macos` or `linux` and
`<arch>` is `arm64` or `x86_64`. For Linux on x86_64:

```sh
curl -LO https://github.com/wyrd-company/seek-cli/releases/latest/download/seek-linux-x86_64.tar.gz
tar -xzf seek-linux-x86_64.tar.gz
sudo install seek /usr/local/bin/seek
```

## From source

Running from source needs [Bun](https://bun.sh) 1.4.4 or later and Git.

```sh
git clone https://github.com/wyrd-company/seek-cli
cd seek-cli
bun install
bun link
```

`bun link` puts the `seek` command from the clone on your `PATH`. To build a
single-file binary instead, run `bun run build`, which writes `dist/seek`.

## Check the installation

```sh
seek --version
seek --help
```

`seek --version` prints the version, and `seek --help` lists the commands
`skill`, `web`, `research`, `scrape`, `config` and `serve`.

Next, [set up provider keys](config.md), or try seek without any key in
[Run your first search](first-search.md).
