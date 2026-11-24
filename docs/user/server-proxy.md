---
title: How the seek server proxies provider calls
product: seek
order: 22
---

A seek server is a narrow, authenticated proxy. A client sends a provider's
own request to the server, and the server sends it on to that provider with
the provider key, so code written against a provider's API works through the
server with a different base URL and a different credential. This page
explains what the server changes and what it leaves alone.

## One route per upstream

Every proxied call has the form `/v1/proxy/<upstream>/<provider path>`. The
upstream names one provider API with its own base URL and key:

| Upstream | Forwards to | Key |
| --- | --- | --- |
| `parallel` | `https://api.parallel.ai` | `providers.parallel.api-key` |
| `exa` | `https://api.exa.ai` | `providers.exa.api-key` |
| `brave-search` | `https://api.search.brave.com/res/v1` | `providers.brave-search.api-key` |
| `brave-answers` | `https://api.search.brave.com/res/v1` | `providers.brave-answers.api-key` |
| `perplexity` | `https://api.perplexity.ai` | `providers.perplexity.api-key` |
| `google` | `https://generativelanguage.googleapis.com/v1beta` | `providers.google.api-key` |
| `firecrawl` | `https://api.firecrawl.dev` | `providers.firecrawl.api-key` |

For example, Exa's `POST /search` is `POST /v1/proxy/exa/search`. The URL
parser resolves `.` and `..` segments before the server reads the path. The
server appends the remaining path and query string to the upstream's fixed
base URL. For an upstream redirect, the client receives the status, and the
response header allowlist drops `Location`. Brave has two upstreams because
Search and Answers use separate keys.

## What the server changes

- **Credentials.** The server accepts a request only with a client token as
  `Authorization: Bearer <token>`, unless its `server.require-token` is false. It removes that header, cookies, and any
  header a provider uses for its key, then adds the provider's own key
  header. A client never holds a provider key, and the provider never sees a
  client token.
- **Connection headers.** Hop-by-hop headers, `Host`, `Content-Length`,
  `Accept-Encoding`, `Forwarded` and `X-Forwarded-*` are not forwarded, so
  the request to the provider describes the server's own connection. Other
  headers, such as `Content-Type` or Google's `Api-Revision`, pass through.
- **Request bodies.** The server reads the whole body before forwarding it,
  and sends none for `GET` and `HEAD`.

## What it leaves alone

- **Responses.** The provider's status, status text and body come back as
  the provider sent them, with its `Content-Type`, `Cache-Control`,
  `Retry-After` and `X-Request-Id` headers. A provider error, such as a 429
  with `Retry-After`, reaches the client as the provider's error.
- **Streaming.** Response bodies stream through as they arrive, so Brave
  Answers' server-sent events reach the client without waiting for the end.
- **Formats.** The server preserves the body format. Each provider's API
  documentation describes its request and response bodies.

## Errors the server returns itself

When the server answers without the provider, the body is a JSON object with
one `error` field:

| Status | When |
| --- | --- |
| 401 | The client token is missing or not accepted. The response has `WWW-Authenticate: Bearer`. |
| 404 | The path is not `/healthz` or under `/v1/proxy/`, or the upstream name is unknown. |
| 503 | The server has no key for the upstream. The message names the variable. |
| 502 | The server could not reach the provider. |

The server checks the token before it looks at the upstream name, so a client
without a valid token learns nothing about which upstreams exist. A provider
can also return 401, 404 or 503 itself; its body is then in the provider's
format.

## Health

`GET /healthz` answers `{"status":"ok"}` with status 200 and needs no token,
so a load balancer or orchestrator can check the server without a
credential.

The [HTTP API reference](reference/http-api.md) lists every route seek's own
commands call, and each response. [Call a seek server from your code](server-client.md)
shows a working client.
