# docs

seek's design documents and its published documentation. The design documents describe the product as built and are the contracts the code is held to: when code and a design document disagree, the change that makes them agree changes both, in the same pull request.

## Layout

| Path | Holds |
|---|---|
| `concepts/seek.yml` | What seek is and does. Start here. |
| `terms/` | Words with one meaning in seek, in the names the interface uses. |
| `specifications/` | The contracts: `command-line`, `http-api`, `configuration` and `research-job-envelope`, each a `<slug>.yml` with its flat definitions beside it. |
| `technical-designs/` | How seek is built: `architecture`, `server`, `secret-resolution`, `research-jobs`, and `documentation`, which generates the published reference. |
| `user/` | The published documentation, which wyrd.foo publishes. Nothing else under `docs/` is published. `user/reference/` is generated; `user/examples/` holds the downloadable examples, including the practice server the tutorials use. |
| `captures/` | One VHS tape per recording in `user/assets/`, `<name>.tape` for `<name>.gif`, the shared `_settings.tape`, and the `Dockerfile` of the container that records them. |

A design document is an immediate `docs/<folder>/<slug>.yml` file whose name has no further dot. A file such as `specifications/http-api.openapi.yml` is a definition, not a design document.

## Definitions are the source

| Contract | Definition | Bound to the code by |
|---|---|---|
| Command line | `createProgram()` in `src/program.ts`, from the Commander declarations in `src/commands/`, and `EXIT_STATUSES` in `src/lib/exit-status.ts` | `tests/program.test.ts`, `tests/cli.test.ts` |
| HTTP API | `specifications/http-api.openapi.yml` | `tests/http-api.test.ts` |
| Configuration | `specifications/configuration.file.schema.json`, `specifications/configuration.environment.schema.json` | `tests/configuration.test.ts` |
| Research job envelope | `specifications/research-job-envelope.schema.json` | `tests/research-job-envelope.test.ts` |

Change a definition and the code together; the tests fail when they disagree. Published reference and public copies of the definitions are generated from these inputs, as `technical-designs/documentation.yml` describes; never edit a generated file by hand.

## Check

Run the tests with Bun 1.4.5 after any change to a definition:

```sh
bun run test
```

Validate the definitions with their own tools:

```sh
npm exec --yes --package=@seriousme/openapi-schema-validator@2.12.0 -- validate-api docs/specifications/http-api.openapi.yml
npm exec --yes --package=@redocly/cli@2.82.0 -- redocly lint --extends recommended docs/specifications/http-api.openapi.yml
npm exec --yes --package=ajv-cli@5.0.0 --package=ajv-formats@3.0.1 -- ajv compile --spec=draft2020 --strict=true -c ajv-formats -s docs/specifications/configuration.file.schema.json -s docs/specifications/configuration.environment.schema.json -s docs/specifications/research-job-envelope.schema.json
```

Redocly reports two warnings, which are expected: the repository has no licence for `info.license` to name, and `/healthz` has no 4XX response because it always returns 200.

## Published documentation

Pages in `user/` link only to other published pages, published assets and public product surfaces, never to a design document here, by a relative path or a GitHub URL. A reader who needs what a design document says gets it from a published explanation page or the generated reference. Examples and recordings use synthetic values and no credentials.

Each page has one home in the `nav` of `user/docs.yml`: **Users** or **Developers**, then **Tutorials**, **How-to guides**, **Explanation** or **Reference**. Link pages by their file, `other.md#heading`. List every example, definition copy and recording in `assets`, and link it from a page.

| Command | Does |
|---|---|
| `bun run docs:reference` | Regenerates `user/reference/` from the definitions. Run it after changing a command, an exit status or a definition. |
| `bun run docs:check` | Fails on stale reference, invalid examples, broken links, fragments and downloads, design-document links, navigation without one home per page, and unused or unlisted assets. CI runs it. |
| `bun run docs:capture` | Records every tape in `captures/` again, in a container; needs Docker. `scripts/docs/capture.sh <name>` records one. Run it when output a recording shows changes. |

`tests/documentation.test.ts` runs the tutorials and guides as written against the practice server and a real `seek serve`, so a page whose commands or output drift fails the tests. It also breaks each guard of `docs:check` in a copy of the repository to prove it fails. Add a step there when a page gains a command with shown output, and a mutation when the check gains a guard.

Before handing over published documentation, also run the wyrd.foo publisher validation from a wyrd.foo checkout at `origin/main`: `task validate:repo -- <this repository>`.
