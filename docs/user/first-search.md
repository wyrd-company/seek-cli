---
title: Run your first search
product: seek
order: 1
---

In this tutorial we run a web search with seek and read its results, first as
text and then as JSON. We use the seek practice server, a small program that
answers like a seek server with made-up results, so we need no provider
account or API key, and we see the same output as this page.

You need seek installed (see [Install seek](install.md)) and
[Node.js](https://nodejs.org/) 18 or later to run the practice server. If you
use [Bun](https://bun.sh), run the example with `bun` in place of `node`.

![Terminal recording: the tutorial's search runs against the practice server and prints three numbered results, then one result as JSON.](assets/first-search.gif)

## Start the practice server

Download [practice-server.mjs](examples/practice-server.mjs) into an empty
folder. Open a terminal in that folder and start it:

```sh
node practice-server.mjs
```

It prints its address and the client token it accepts:

```text
seek practice server listening on http://127.0.0.1:8788
client token: practice-token
```

Leave it running. Each request it answers adds a line to this terminal.

## Point seek at the server

Open a second terminal. seek sends its searches to a seek server when
`SEEK_SERVER_URL` is set, with the token in `SEEK_SERVER_TOKEN_VALUE`, so we
set both:

```sh
export SEEK_SERVER_URL=http://127.0.0.1:8788
export SEEK_SERVER_TOKEN_VALUE=practice-token
```

These commands print nothing. They last until we close this terminal.

## Search

Now we search. `seek web` is the group of search commands, and `parallel` is
the provider that answers:

```sh
seek web parallel "how do honeybees make honey"
```

seek prints the results:

```text
1. Practice result 1 for "how do honeybees make honey"
   https://example.com/practice/result-1

   A made-up excerpt about "how do honeybees make honey". The practice server wrote it; Parallel did not.

2. Practice result 2 for "how do honeybees make honey"
   https://example.com/practice/result-2

   A made-up excerpt about "how do honeybees make honey". The practice server wrote it; Parallel did not.

3. Practice result 3 for "how do honeybees make honey"
   https://example.com/practice/result-3

   A made-up excerpt about "how do honeybees make honey". The practice server wrote it; Parallel did not.
```

Each result has a number, a title, its URL and an excerpt. Our question came
back in every title, so we know the search reached the server. In the first
terminal, the server printed `POST parallel/v1/search -> 200`.

## Ask for one result as JSON

Options change what a search asks for. `-n` sets the number of results, and
`--json` prints the provider's response as JSON, which a script or an agent
can read:

```sh
seek web parallel "how do honeybees make honey" -n 1 --json
```

```json
{
  "search_id": "search_practice_1",
  "results": [
    {
      "url": "https://example.com/practice/result-1",
      "title": "Practice result 1 for \"how do honeybees make honey\"",
      "excerpts": [
        "A made-up excerpt about \"how do honeybees make honey\". The practice server wrote it; Parallel did not."
      ],
      "publish_date": "2026-01-01"
    }
  ]
}
```

The same fields are there: `title`, `url` and the excerpt in `excerpts`, now
one result instead of three.

## Stop the practice server

Press Ctrl+C in the first terminal. In the second, unset
the two variables, so that seek goes back to calling providers itself:

```sh
unset SEEK_SERVER_URL SEEK_SERVER_TOKEN_VALUE
```

## What we did

We ran a search through seek, read its results as text, and asked for fewer
results as JSON. Every seek search, research and scrape command works the
same way: a group, a provider, the question or URLs, and options.

Next:

- [Set up provider keys](config.md) to search the real web.
- [Use a seek server from the CLI](connect-to-a-server.md) to search through
  a server your team runs.
- [Search the web](web.md) with each search provider.
- [Run a research job](research.md), which the practice server also answers.
- Look up the options we used in the
  [`seek web parallel` reference](reference/commands/seek-web-parallel.md),
  or read [how seek is organized](overview.md).
