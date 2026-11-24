#!/usr/bin/env bun
/**
 * The documentation check, run by `bun run docs:check` and by scripts/ci.sh.
 * It fails when the generated reference differs from what the definitions
 * produce, when an example does not validate, when a link, fragment, image
 * or download would not resolve as wyrd.foo publishes the docs, when a page
 * links into a design document, when navigation leaves a page without one
 * home, or when a listed asset is unused or a published file is unlisted.
 * It prints one line per failure and a pass line only when every check ran
 * and passed.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { anchors, links, splitFrontMatter, withoutCode, type FrontMatter } from "./markdown.ts";
import { CAPTURES_DIR, filesUnder, REFERENCE_DIR, ROOT, USER_DIR } from "./paths.ts";
import { compileDefinitions, EXAMPLES, invalidOpenApiExamples, validateExample, type Validators } from "./validate.ts";

export interface Failure {
  check: string;
  where: string;
  message: string;
}

const PRODUCT = "seek";
const SECTIONS = ["Users", "Administration", "Developers", "References"];
const AUDIENCE_GROUPS = ["Tutorials", "How-to guides", "Explanation"];
const REFERENCE_GROUPS = ["Command line", "Configuration", "API"];
const FRONT_MATTER_KEYS = new Set(["title", "product", "order", "install", "relationships"]);
const RESERVED_SLUGS = new Set(["changelog", "index"]);
/** A link from a published page into the repository's private docs, as a GitHub URL. */
const DESIGN_URL = [
  /^https?:\/\/(?:www\.)?github\.(?:com|dev)\/wyrd-company\/seek-cli\/(?:blob|tree|raw|blame|edit)\/.+?\/docs\/(?!user\/)/i,
  /^https?:\/\/raw\.githubusercontent\.com\/wyrd-company\/seek-cli\/.+?\/docs\/(?!user\/)/i,
];

interface Page {
  file: string;
  slug: string;
  data: FrontMatter | null;
  body: string;
  bodyLine: number;
  anchors: Set<string>;
}

interface Docs {
  docsFile: Record<string, any>;
  pages: Map<string, Page>;
  files: string[];
  assets: string[];
}

function readDocs(root: string, fail: (check: string, where: string, message: string) => void): Docs | null {
  const docsYml = join(root, USER_DIR, "docs.yml");
  let docsFile: Record<string, any>;
  try {
    docsFile = Bun.YAML.parse(readFileSync(docsYml, "utf8")) as Record<string, any>;
  } catch (error) {
    fail("docs.yml", `${USER_DIR}/docs.yml`, `cannot be read: ${(error as Error).message}`);
    return null;
  }
  const files = filesUnder(join(root, USER_DIR));
  const pages = new Map<string, Page>();
  for (const file of files.filter((f) => f.endsWith(".md") && f !== "CHANGELOG.md")) {
    const text = readFileSync(join(root, USER_DIR, file), "utf8");
    const { data, body, bodyLine } = splitFrontMatter(text);
    pages.set(file, { file, slug: posix.basename(file, ".md"), data, body, bodyLine, anchors: anchors(body) });
  }
  return { docsFile, pages, files, assets: Array.isArray(docsFile.assets) ? docsFile.assets : [] };
}

// ---------- Generated reference ----------

async function checkReference(root: string, fail: (check: string, where: string, message: string) => void): Promise<number> {
  let generated: Map<string, Uint8Array>;
  try {
    const { generateReference } = await import("./reference.ts");
    generated = generateReference();
  } catch (error) {
    fail("reference", REFERENCE_DIR, `generation failed: ${(error as Error).message}`);
    return 0;
  }
  const committed = new Set(filesUnder(join(root, REFERENCE_DIR)));
  for (const [path, bytes] of generated) {
    const where = `${REFERENCE_DIR}/${path}`;
    if (!committed.has(path)) {
      fail("reference", where, "is missing: run `bun run docs:reference`");
      continue;
    }
    const current = new Uint8Array(readFileSync(join(root, REFERENCE_DIR, path)));
    if (Buffer.compare(Buffer.from(current), Buffer.from(bytes)) !== 0) {
      fail("reference", where, "differs from its definition: run `bun run docs:reference`");
    }
  }
  for (const path of committed) {
    if (!generated.has(path)) fail("reference", `${REFERENCE_DIR}/${path}`, "is not generated: remove it, or run `bun run docs:reference`");
  }
  return generated.size;
}

// ---------- Definitions and examples ----------

function checkExamples(root: string, fail: (check: string, where: string, message: string) => void): number {
  let validators: Validators;
  try {
    validators = compileDefinitions(root);
  } catch (error) {
    fail("definitions", "docs/specifications", (error as Error).message);
    return 0;
  }
  for (const failure of invalidOpenApiExamples(validators)) fail("definitions", "docs/specifications/http-api.openapi.yml", `example does not validate: ${failure}`);

  const examples = filesUnder(join(root, USER_DIR, "examples")).map((f) => `examples/${f}`);
  for (const example of examples) {
    const where = `${USER_DIR}/${example}`;
    const check = EXAMPLES[example];
    if (!check) {
      fail("examples", where, "has no declared validation in scripts/docs/validate.ts EXAMPLES");
      continue;
    }
    const text = readFileSync(join(root, USER_DIR, example), "utf8");
    if (check.kind === "script") {
      try {
        new Bun.Transpiler({ loader: "js" }).transformSync(text);
      } catch (error) {
        fail("examples", where, `is not valid JavaScript: ${(error as Error).message}`);
      }
      if (!existsSync(join(root, check.test))) fail("examples", where, `names a missing test ${check.test}`);
      continue;
    }
    let value: unknown;
    const yaml = example.endsWith(".yml");
    try {
      value = yaml ? Bun.YAML.parse(text) : JSON.parse(text);
    } catch (error) {
      fail("examples", where, `is not valid ${yaml ? "YAML" : "JSON"}: ${(error as Error).message}`);
      continue;
    }
    try {
      const errors = validateExample(validators, check, value);
      if (errors) fail("examples", where, `does not validate: ${errors}`);
    } catch (error) {
      fail("examples", where, (error as Error).message);
    }
  }
  for (const declared of Object.keys(EXAMPLES)) {
    if (!examples.includes(declared)) fail("examples", `${USER_DIR}/${declared}`, "is declared in EXAMPLES but does not exist");
  }
  return examples.length;
}

// ---------- Pages and navigation ----------

function checkPages(docs: Docs, fail: (check: string, where: string, message: string) => void): void {
  const slugs = new Map<string, string>();
  for (const page of docs.pages.values()) {
    const where = `${USER_DIR}/${page.file}`;
    if (!page.data) {
      fail("pages", where, "has no front matter");
      continue;
    }
    for (const key of Object.keys(page.data)) if (!FRONT_MATTER_KEYS.has(key)) fail("pages", where, `front matter has unknown key ${key}`);
    if (typeof page.data.title !== "string" || !page.data.title.trim()) fail("pages", where, "front matter has no title");
    if (page.data.product !== PRODUCT) fail("pages", where, `front matter product is ${JSON.stringify(page.data.product)}, not ${PRODUCT}`);
    if (RESERVED_SLUGS.has(page.slug.toLowerCase())) fail("pages", where, `uses the reserved slug ${page.slug}`);
    const other = slugs.get(page.slug);
    if (other) fail("pages", where, `has the slug ${page.slug} of ${other}`);
    slugs.set(page.slug, where);

    let level = 1;
    const text = withoutCode(page.body).split("\n");
    text.forEach((line, index) => {
      const heading = /^\s{0,3}(#{1,6})\s/.exec(line);
      if (!heading) return;
      const next = heading[1]!.length;
      const at = `${where}:${page.bodyLine + index}`;
      if (next === 1) fail("pages", at, "has a level-1 heading; the page title is the only one");
      else if (next > level + 1) fail("pages", at, `heading skips from level ${level} to ${next}`);
      level = next;
    });
  }
}

function checkNav(docs: Docs, fail: (check: string, where: string, message: string) => void): void {
  const where = `${USER_DIR}/docs.yml products.${PRODUCT}.nav`;
  const nav = docs.docsFile.products?.[PRODUCT]?.nav;
  if (!Array.isArray(nav)) {
    fail("nav", where, "is missing");
    return;
  }
  const bySlug = new Map([...docs.pages.values()].map((p) => [p.slug, p]));
  const homes = new Map<string, string[]>();
  let lastSection = -1;
  for (const section of nav) {
    const sectionIndex = SECTIONS.indexOf(section?.section);
    if (sectionIndex === -1) fail("nav", where, `section ${JSON.stringify(section?.section)} is not one of ${SECTIONS.join(", ")}`);
    else if (sectionIndex <= lastSection) fail("nav", where, `section ${section.section} is out of order or repeated`);
    lastSection = Math.max(lastSection, sectionIndex);
    const allowedGroups = section?.section === "References" ? REFERENCE_GROUPS : AUDIENCE_GROUPS;
    let lastGroup = -1;
    const groups = Array.isArray(section?.groups) ? section.groups : [];
    if (groups.length === 0) fail("nav", where, `section ${section?.section} has no groups`);
    for (const group of groups) {
      const groupIndex = allowedGroups.indexOf(group?.group);
      const label = `${section?.section} > ${group?.group}`;
      if (groupIndex === -1) fail("nav", where, `group ${label} is not one of ${allowedGroups.join(", ")}`);
      else if (groupIndex <= lastGroup) fail("nav", where, `group ${label} is out of order or repeated`);
      lastGroup = Math.max(lastGroup, groupIndex);
      const pages = Array.isArray(group?.pages) ? group.pages : [];
      if (pages.length === 0) fail("nav", where, `group ${label} has no pages`);
      for (const slug of pages) {
        if (!bySlug.has(slug)) fail("nav", where, `${label} lists ${slug}, which is not a page`);
        homes.set(slug, [...(homes.get(slug) ?? []), label]);
      }
    }
  }
  for (const [slug, places] of homes) if (places.length > 1) fail("nav", where, `${slug} has more than one home: ${places.join("; ")}`);
  for (const page of docs.pages.values()) if (!homes.has(page.slug)) fail("nav", `${USER_DIR}/${page.file}`, "is not in nav");
}

// ---------- Links ----------

/** The path a relative link names, relative to docs/user/, with its fragment; null when it leaves the folder. */
function resolveLink(from: string, target: string): { path: string | null; fragment: string } {
  const at = target.search(/[?#]/);
  const written = at === -1 ? target : target.slice(0, at);
  const hash = target.indexOf("#");
  const fragment = hash === -1 ? "" : target.slice(hash + 1);
  if (written === "") return { path: from, fragment };
  let decoded = written;
  try {
    decoded = written.split("/").map(decodeURIComponent).join("/");
  } catch {
    // Keep the link as written.
  }
  const path = posix.normalize(posix.join(posix.dirname(from), decoded));
  return { path: path.startsWith("../") || path === ".." ? null : path, fragment };
}

function checkLinks(docs: Docs, fail: (check: string, where: string, message: string) => void): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  const listed = new Set(docs.assets);
  const files = new Set(docs.files);
  for (const page of docs.pages.values()) {
    for (const link of links(page.body, page.bodyLine)) {
      const where = `${USER_DIR}/${page.file}:${link.line}`;
      const target = link.target;
      if (DESIGN_URL.some((pattern) => pattern.test(target))) {
        fail("links", where, `links to a design document: ${target}`);
        continue;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) continue;
      if (target.startsWith("/")) {
        fail("links", where, `uses a site-absolute link ${target}; link to the file by its relative path`);
        continue;
      }
      const { path, fragment } = resolveLink(page.file, target);
      if (path === null) {
        const outside = posix.normalize(posix.join(USER_DIR, posix.dirname(page.file), target.replace(/[?#].*$/, "")));
        fail(
          "links",
          where,
          outside.startsWith("docs/") ? `links to a design document or private file: ${target}` : `links outside the published docs: ${target}`,
        );
        continue;
      }
      if (path.endsWith(".md")) {
        const linked = docs.pages.get(path);
        if (path === "CHANGELOG.md" && files.has(path)) continue;
        if (!linked) {
          fail("links", where, `links to a page that does not exist: ${target}`);
          continue;
        }
        if (fragment && !linked.anchors.has(fragment)) fail("links", where, `fragment #${fragment} names no heading of ${path}`);
        continue;
      }
      if (!/\.[^/]+$/.test(path)) {
        fail("links", where, `links to ${target} without its file extension; link to the page file, such as ${target.replace(/[?#].*$/, "")}.md`);
        continue;
      }
      if (!files.has(path)) {
        fail("links", where, `${link.image ? "image" : "download"} does not exist: ${target}`);
        continue;
      }
      if (!listed.has(path)) {
        fail("links", where, `${link.image ? "image" : "download"} ${path} is not listed in docs.yml assets, so it does not publish`);
        continue;
      }
      used.set(path, new Set([...(used.get(path) ?? []), page.file]));
    }
  }
  return used;
}

// ---------- Assets ----------

/** Asset paths, relative to docs/user/, that the product's fields name. */
function productFieldAssets(product: Record<string, any> | undefined): Set<string> {
  const named = new Set<string>();
  if (!product) return named;
  for (const field of ["logo", "logo-dark", "favicon", "social-image"]) if (typeof product[field] === "string") named.add(product[field]);
  for (const item of product.media ?? []) if (typeof item?.src === "string") named.add(item.src);
  for (const kind of product.kinds ?? []) {
    for (const holder of [kind, ...(kind?.install ?? [])]) {
      for (const field of ["compose", "kubernetes"]) if (typeof holder?.[field] === "string") named.add(holder[field]);
    }
  }
  return named;
}

function captureOutputs(root: string): Array<{ tape: string; output: string }> {
  return filesUnder(join(root, CAPTURES_DIR))
    .filter((file) => file.endsWith(".tape"))
    .flatMap((tape) =>
      [...readFileSync(join(root, CAPTURES_DIR, tape), "utf8").matchAll(/^Output\s+"?([^"\s]+)"?\s*$/gm)].map((m) => ({
        tape: `${CAPTURES_DIR}/${tape}`,
        output: m[1]!,
      })),
    );
}

function checkAssets(root: string, docs: Docs, used: Map<string, Set<string>>, fail: (check: string, where: string, message: string) => void): void {
  const where = `${USER_DIR}/docs.yml assets`;
  const listed = new Set<string>();
  const named = productFieldAssets(docs.docsFile.products?.[PRODUCT]);
  for (const asset of docs.assets) {
    if (listed.has(asset)) fail("assets", where, `lists ${asset} twice`);
    listed.add(asset);
    if (!docs.files.includes(asset)) {
      fail("assets", where, `lists ${asset}, which does not exist in ${USER_DIR}`);
      continue;
    }
    if (asset.endsWith(".md")) fail("assets", where, `lists the page ${asset}; pages belong in nav`);
    if (!named.has(asset) && !used.has(asset)) {
      fail("assets", where, `lists ${asset}, but no ${PRODUCT} page links to it by its relative path and no product field names it`);
    }
  }
  for (const field of named) if (!listed.has(field)) fail("assets", where, `does not list ${field}, which a product field names`);

  const mustList = [
    ...filesUnder(join(root, USER_DIR, "examples")).map((f) => `examples/${f}`),
    ...filesUnder(join(root, REFERENCE_DIR)).filter((f) => !f.endsWith(".md")).map((f) => `reference/${f}`),
  ];
  for (const file of mustList) if (!listed.has(file)) fail("assets", `${USER_DIR}/${file}`, "is published with the docs but not listed in docs.yml assets");

  for (const { tape, output } of captureOutputs(root)) {
    if (!output.startsWith(`${USER_DIR}/`)) {
      fail("captures", tape, `writes ${output}, outside ${USER_DIR}`);
      continue;
    }
    const asset = output.slice(USER_DIR.length + 1);
    if (!docs.files.includes(asset)) fail("captures", tape, `output ${output} does not exist: run scripts/docs/capture.sh`);
    else if (!listed.has(asset)) fail("captures", tape, `output ${asset} is not listed in docs.yml assets`);
  }
}

// ---------- Run ----------

export interface Summary {
  failures: Failure[];
  counts: Record<string, number>;
}

export async function checkDocumentation(root = ROOT): Promise<Summary> {
  const failures: Failure[] = [];
  const fail = (check: string, where: string, message: string) => failures.push({ check, where, message });
  const counts: Record<string, number> = {};
  counts.reference = await checkReference(root, fail);
  counts.examples = checkExamples(root, fail);
  const docs = readDocs(root, fail);
  if (docs) {
    checkPages(docs, fail);
    checkNav(docs, fail);
    const used = checkLinks(docs, fail);
    checkAssets(root, docs, used, fail);
    counts.pages = docs.pages.size;
    counts.assets = docs.assets.length;
    counts.captures = captureOutputs(root).length;
  }
  return { failures, counts };
}

if (import.meta.main) {
  const { failures, counts } = await checkDocumentation();
  for (const f of failures) process.stderr.write(`docs:check: ${f.check}: ${f.where}: ${f.message}\n`);
  if (failures.length > 0) {
    process.stderr.write(`docs:check: FAILED with ${failures.length} finding${failures.length === 1 ? "" : "s"}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `docs:check: passed (${counts.pages} pages, ${counts.reference} generated reference files, ` +
      `${counts.examples} examples, ${counts.assets} listed assets, ${counts.captures} captures)\n`,
  );
}
