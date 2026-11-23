/**
 * Markdown helpers shared by the reference generator and the documentation
 * check: escaping generated text, reading front matter, and finding the
 * links and heading anchors of a page as wyrd.foo renders it.
 */

/** Splits text into code spans and the prose around them. */
function spans(text: string): Array<{ code: boolean; text: string }> {
  const parts: Array<{ code: boolean; text: string }> = [];
  const pattern = /(`+)([\s\S]*?[^`])\1(?!`)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push({ code: false, text: text.slice(last, match.index) });
    parts.push({ code: true, text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ code: false, text: text.slice(last) });
  return parts;
}

/** Prose from a definition, safe to place in a Markdown paragraph: angle brackets outside code are text. */
export function prose(text: string): string {
  return spans(text.trim())
    .map((part) => (part.code ? part.text : part.text.replaceAll("<", "&lt;")))
    .join("");
}

/** Text safe for one GitHub-flavored Markdown table cell. */
export function cell(text: string): string {
  return prose(text).replace(/\s*\n\s*/g, " ").replaceAll("|", "\\|");
}

/** A code span holding `text`, with a fence long enough for any backticks inside it. */
export function code(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

export function table(headers: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

export interface FrontMatter {
  [key: string]: unknown;
}

/** The front matter and body of a page. A page without front matter has `data` null. */
export function splitFrontMatter(text: string): { data: FrontMatter | null; body: string; bodyLine: number } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { data: null, body: text, bodyLine: 1 };
  const data = (Bun.YAML.parse(match[1]!) ?? {}) as FrontMatter;
  return { data, body: text.slice(match[0].length), bodyLine: match[0].split("\n").length };
}

/** Blanks fenced code blocks and code spans, keeping line numbers, so their contents are not read as links or headings. */
export function withoutCode(body: string): string {
  const lines = body.split("\n");
  let fence: string | null = null;
  const out = lines.map((line) => {
    const opener = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence === null && opener) {
      fence = opener[1]!;
      return "";
    }
    if (fence !== null) {
      if (line.trim().startsWith(fence[0]!.repeat(fence.length)) && line.trim().replace(/[`~]/g, "") === "") fence = null;
      return "";
    }
    return line.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (span) => " ".repeat(span.length));
  });
  return out.join("\n");
}

export interface Link {
  target: string;
  line: number;
  image: boolean;
}

/** Inline links and images, autolinks, reference definitions, and HTML `href`/`src` attributes, outside code. */
export function links(body: string, firstLine = 1): Link[] {
  const found: Link[] = [];
  const text = withoutCode(body);
  const lineOf = (index: number) => firstLine + text.slice(0, index).split("\n").length - 1;
  for (const match of text.matchAll(/(!?)\[(?:[^\[\]]|\[[^\[\]]*\])*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    found.push({ target: match[2]!, line: lineOf(match.index), image: match[1] === "!" });
  }
  for (const match of text.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/gm)) {
    found.push({ target: match[1]!, line: lineOf(match.index), image: false });
  }
  for (const match of text.matchAll(/<(a|img|source)\b[^>]*?\s(href|src|srcset)\s*=\s*"([^"]+)"/gi)) {
    found.push({ target: match[3]!, line: lineOf(match.index), image: match[1]!.toLowerCase() !== "a" });
  }
  for (const match of text.matchAll(/<(https?:\/\/[^<>\s]+)>/gi)) {
    const target = match[1]!;
    const line = lineOf(match.index);
    if (!found.some((link) => link.target === target && link.line === line)) {
      found.push({ target, line, image: false });
    }
  }
  return found;
}

/** The text of a heading as rendered: inline code, emphasis and link syntax removed. */
function headingText(raw: string): string {
  return raw
    .replace(/\s+#+\s*$/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/(\*\*|__|\*|_)(.+?)\1/g, "$2")
    .replace(/<[^>]+>/g, "")
    .trim();
}

/**
 * The anchor of each heading, as github-slugger makes them for Astro's heading
 * ids: lower case, punctuation removed, spaces as hyphens, repeats numbered.
 */
export function anchors(body: string): Set<string> {
  const seen = new Map<string, number>();
  const result = new Set<string>();
  for (const line of withoutCodeBlocksOnly(body).split("\n")) {
    const match = /^\s{0,3}(#{1,6})\s+(.+)$/.exec(line);
    if (!match) continue;
    const base = headingText(match[2]!)
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
      .replace(/ /g, "-");
    let slug = base;
    const count = seen.get(base) ?? 0;
    if (count > 0) slug = `${base}-${count}`;
    seen.set(base, count + 1);
    result.add(slug);
  }
  return result;
}

/** Blanks fenced code blocks only, so headings keep their inline code. */
function withoutCodeBlocksOnly(body: string): string {
  let fence: string | null = null;
  return body
    .split("\n")
    .map((line) => {
      const opener = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (fence === null && opener) {
        fence = opener[1]!;
        return "";
      }
      if (fence !== null) {
        if (line.trim().replace(/[`~]/g, "") === "" && line.trim().startsWith(fence)) fence = null;
        return "";
      }
      return line;
    })
    .join("\n");
}
