# checks-your-actions (cya)

A CLI tool that determines which GitHub Actions workflows would trigger given the current git state. The primary consumer is Claude Code — so it can know what CI steps to run locally before pushing.

## Architecture

Four layers, each independently testable:

- `src/parse.ts` — Parses `.github/workflows/*.yml` into typed `Workflow` objects. Handles shorthand `on:` syntax (string, array, object), tag extraction, and snake_case to camelCase mapping.
- `src/git-state.ts` — Detects current branch, base branch, and changed files via `Bun.$`. Uses a `GitRunner` interface for testability (dependency injection, no real git in tests).
- `src/evaluate.ts` — Matches workflows against git state using `picomatch`. Handles branch filters, path filters, paths-ignore, branches-ignore, tag-only skip, mutual exclusivity checks, and PR base branch semantics.
- `src/render.ts` — Renders matched workflows as indented text with `consola` colors. Handles multi-line run steps, job-level `if:` conditions, and reusable workflow `uses:` references.
- `src/cli.ts` — Wires everything together with `citty` for arg parsing.
- `src/types.ts` — All shared type definitions.

## Development

```bash
bun install          # install deps
bun test             # run tests (90 tests)
bun run lint         # oxfmt check + oxlint
bun run typecheck    # tsc --noEmit
bun run format       # oxfmt auto-fix
bun run build        # bundle to dist/cli.js
```

## Runtime

This is a Bun project. Use `Bun.$` for shell commands, `Bun.file` for file reads, `bun:test` for testing. Do not use Node.js APIs where Bun equivalents exist.

## Testing

TDD. Tests live in `test/`. Fixtures live in `test/fixtures/`.

- Unit tests mock dependencies (e.g., `GitRunner` interface for git-state tests)
- Pipeline tests (`test/pipeline.test.ts`) exercise parse-to-evaluate against realistic workflow fixtures
- Integration tests (`test/integration.test.ts`) run the actual CLI binary
- Always run `bun run format` before committing test files

## Correctness priorities

This tool's value depends on correctly matching GitHub Actions trigger semantics. When in doubt:

- `pull_request` branch filters check the **base** (target) branch, not the head branch
- `paths-ignore` skips the workflow only if **all** changed files match ignore patterns
- `branches` and `branches-ignore` are mutually exclusive (same for `paths`/`paths-ignore`)
- Tag-only push triggers (no branch/path filters) should be skipped, not false-positive matched
- Shorthand `on: push` and `on: [push, pull_request]` must be normalized before processing
- Empty `changedFiles` with `pathsIgnore` should run the workflow (no files to ignore)

## Publishing

Automated via GitHub Actions OIDC trusted publishing. To release:

```bash
bun run bump         # bumpp prompts for version, commits, tags, pushes
                     # CI runs lint/typecheck/test then publishes to npm
```
