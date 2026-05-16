export type OutputFormat = "text" | "json";

export interface OutputOptions {
  json?: boolean;
}

export function resolveFormat(opts: OutputOptions): OutputFormat {
  return opts.json ? "json" : "text";
}

export function emit(data: unknown, opts: OutputOptions): void {
  if (resolveFormat(opts) === "json") {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    return;
  }
  if (typeof data === "string") {
    process.stdout.write(data.endsWith("\n") ? data : data + "\n");
    return;
  }
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function emitText(text: string): void {
  process.stdout.write(text.endsWith("\n") ? text : text + "\n");
}

export function renderSearchResults(
  results: Array<{
    title?: string;
    url?: string;
    snippet?: string;
    content?: string;
    score?: number;
  }>,
): string {
  if (results.length === 0) return "(no results)";
  return results
    .map((r, i) => {
      const lines: string[] = [];
      const header = `${i + 1}. ${r.title ?? "(untitled)"}`;
      lines.push(header);
      if (r.url) lines.push(`   ${r.url}`);
      if (typeof r.score === "number") lines.push(`   score: ${r.score.toFixed(3)}`);
      const body = r.content ?? r.snippet;
      if (body) {
        const truncated = body.length > 1200 ? body.slice(0, 1200) + "…" : body;
        lines.push("");
        lines.push(indent(truncated, "   "));
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

export function renderCitations(citations: string[] | undefined): string {
  if (!citations || citations.length === 0) return "";
  const lines = ["", "Citations:"];
  citations.forEach((c, i) => lines.push(`  [${i + 1}] ${c}`));
  return lines.join("\n");
}
