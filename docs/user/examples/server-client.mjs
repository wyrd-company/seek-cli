#!/usr/bin/env node
// A client for a seek server: it checks the server's health, then runs one
// Exa search through the server's proxy and prints the results.
//
//   SEEK_SERVER_URL=http://127.0.0.1:8788 SEEK_SERVER_TOKEN_VALUE=practice-token \
//     node server-client.mjs "how do honeybees make honey"
//
// Needs Node.js 18 or later, or Bun. It sends Exa's own request body and
// reads Exa's own response: the server only adds the provider key.

const base = (process.env.SEEK_SERVER_URL ?? "").trim().replace(/\/+$/, "");
const token = (process.env.SEEK_SERVER_TOKEN_VALUE ?? "").trim();
if (!base || !token) {
  process.stderr.write("Set SEEK_SERVER_URL and SEEK_SERVER_TOKEN_VALUE.\n");
  process.exit(1);
}
const query = process.argv.slice(2).join(" ") || "how do honeybees make honey";

const health = await fetch(`${base}/healthz`);
console.log(`GET /healthz -> ${health.status} ${JSON.stringify(await health.json())}`);

const response = await fetch(`${base}/v1/proxy/exa/search`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ query, numResults: 3, contents: { highlights: { numSentences: 1 } } }),
});
const body = await response.json();
console.log(`POST /v1/proxy/exa/search -> ${response.status}`);

if (!response.ok) {
  // Errors the seek server returns itself have one `error` field.
  console.log(`error: ${typeof body.error === "string" ? body.error : JSON.stringify(body)}`);
  process.exit(1);
}
for (const [index, result] of body.results.entries()) {
  console.log(`${index + 1}. ${result.title}`);
  console.log(`   ${result.url}`);
}
