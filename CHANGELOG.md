# Changelog

## 0.3.1

### Fixes

- Adopt Intentional as the version and release authority; release versions now come from intents, `package.json` is a committed projection, and release tags remain bare SemVer.

## 0.3.0

### Features

- `seek serve` runs seek as a back-end, so that provider API keys stay on one server. The `seek-server` container image packages it.

## 0.2.0

### Features

- Deep research jobs are resumable: start a job, then check its status or get its report later by job id.
- Add the `seek` agent skill with provider-selection guidance.

### Fixes

- Google research composes the instructions into the input.
- Research commands keep provider job ids unchanged.
- Research jobs report their terminal states consistently.

## 0.1.1

### Fixes

- The release workflow keeps the full tag when it reads the version.

## 0.1.0

### Features

- Initial release: `web`, `research`, and `scrape` commands over multiple provider APIs.
- Read API keys from `~/.config/seek/config.json`. When a key is missing, show the sibling providers that can do the same job.
- `--objective` option for `web` and `scrape`.
