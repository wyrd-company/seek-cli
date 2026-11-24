---
title: How seek is organized
product: seek
order: 10
---

seek is one command line over several search, research and extraction APIs.
It is built so that a caller, often an agent, says what kind of answer it
wants, and then chooses the provider whose trade-off fits.

![Terminal recording: seek searches the web, accepts a research job and reads its status, and extracts a page, all against the practice server.](assets/demo.gif)

## Commands are grouped by intent

seek's provider commands sit in three groups, each named for what the caller
wants rather than for a vendor:

| Group | Intent | Typical wait |
| --- | --- | --- |
| `seek web` | Real-time search and short answers, as context for a prompt | Seconds |
| `seek research` | Multi-step research that browses, checks and writes a cited report | Seconds to 25 minutes, by provider |
| `seek scrape` | The content of pages whose URLs you already have | Seconds |

Within a group, each command is named for its provider: `seek web exa`,
`seek research google`, `seek scrape firecrawl`. Changing provider changes one
word, and the rest of the command keeps its shape: the query or URLs, then
options. [Choosing a provider](providers.md) compares them.

Three more commands support the groups: `seek config` manages the
configuration file, `seek serve` runs a seek server, and `seek skill` prints
the agent skill that ships with seek.

## Output for people and for programs

Every provider command prints a readable result by default: numbered search
results, a report with its citations, or the text of each page. With
`--json`, it prints the provider's own response instead, unchanged, so a
program gets every field the provider returned.

Resumable research is the one place where seek adds its own JSON. A provider
holds the job, and seek wraps the provider's status in an envelope whose
fields are the same for every provider; see
[How research jobs work](research-jobs.md).

## Keys stay with the caller or with a server

Each provider needs its own API key. In direct mode, the CLI reads the key
from the source its configuration names, such as a file or a credential
helper, and calls the provider itself. In server mode, set by `server.url`,
the CLI sends every call to a seek
server with a client token, and only the server holds provider keys. Commands
and their output are the same in both modes, so a machine can move from one
to the other without changing what it runs.
[How seek finds keys and tokens](credentials.md) describes both.

## One binary

seek ships as a single native binary for macOS and Linux, and as a container
image for the server. It keeps no database and runs no background process: a
research job lives with its provider, and seek reconnects to it with the job's
provider and ID.
