# CYA Bugfix Spec — Correctness Fixes

## Context

A hardcore code review found 6 correctness bugs and significant test gaps in the CYA implementation. This spec describes the exact fixes needed, the expected behavior after each fix, and the tests required to prevent regression.

Reference: original spec at `docs/superpowers/specs/2026-03-28-cya-workflow-evaluator-design.md`

---

## Bug 1: Shorthand `on:` syntax not handled

### Problem

GitHub Actions supports three forms for the `on` key:

```yaml
# Object form (currently handled)
on:
  push:
    branches: [main]

# String shorthand (NOT handled — silently dropped)
on: push

# Array shorthand (NOT handled — silently dropped)
on: [push, pull_request]
```

When `on` is a string or array, `parseWorkflowFile` casts it to `Record<string, unknown>` and the `'push' in on` check fails or misbehaves. The workflow is silently dropped. This is a real-world failure — many workflows use shorthand syntax.

### Fix

In `parse.ts`, normalize the `on` value before processing:

- If `on` is a string (e.g., `"push"`), convert to `{ push: {} }`
- If `on` is an array (e.g., `["push", "pull_request"]`), convert to `{ push: {}, pull_request: {} }`
- If `on` is an object, use as-is
- If `on` is anything else, return null (invalid workflow)

Using `{}` (not `null`) for the normalized values ensures consistency. `parseTrigger({})` returns `{}` (empty trigger = match everything), which is correct for shorthand forms. This also avoids a fragility issue: `workflow_dispatch` is checked with `!== undefined`, so `null` would pass that check by accident — `{}` is the correct, intentional representation.

### Tests

- Fixture: `test/fixtures/shorthand-string.yml` with `on: push`
- Fixture: `test/fixtures/shorthand-array.yml` with `on: [push, pull_request]`
- Parse test: shorthand string parses to `{ push: {} }`, and jobs are still parsed correctly
- Parse test: shorthand array parses to `{ push: {}, pullRequest: {} }`, and jobs are still parsed correctly

---

## Bug 2: Tag-only push workflows false-positive match everything

### Problem

A workflow like:

```yaml
on:
  push:
    tags: ['v*']
```

Gets parsed as `push: {}` (empty trigger = match every push on every branch) because `parseTrigger` ignores `tags` and `tags-ignore`. The spec explicitly says: "Workflows that only have tag filters on `push` (no `branches` or `paths`) are skipped with a warning."

### Fix

1. Add `tags` and `tagsIgnore` fields to `WorkflowTrigger` type (string arrays, optional)
2. In `parseTrigger`, extract `tags` and `tags-ignore` from YAML
3. In `evaluate.ts` `matchesTrigger`, when processing a `push` event: if the trigger has `tags` or `tagsIgnore` but has NO `branches`, `branchesIgnore`, `paths`, or `pathsIgnore`, skip the workflow and warn to stderr

This means tag-filtered workflows are skipped entirely (correct — we don't evaluate tag triggers), and workflows that have BOTH branch/path filters AND tag filters still work on the branch/path filters (the tags portion is just ignored).

### Tests

- Fixture: `test/fixtures/tags-only.yml` with `on: push: tags: ['v*']`
- Evaluate test: tag-only push workflow (with `tags`) is skipped on push event
- Evaluate test: tags-ignore-only push workflow (with `tagsIgnore`) is skipped on push event
- Evaluate test: workflow with both tags and branches uses only branch filter (tags portion ignored)

---

## Bug 3: Empty `changedFiles` with `pathsIgnore` — vacuous truth

### Problem

In `evaluate.ts` `matchesPaths`:

```ts
const allIgnored = changedFiles.every(file => ...)
return !allIgnored
```

When `changedFiles` is empty, `[].every(...)` returns `true` (vacuous truth), so `!true` returns `false`, incorrectly skipping the workflow. If there are no changed files, no files match the ignore pattern, so the workflow should run.

### Fix

In `matchesPaths`, add an early return inside the `pathsIgnore` branch: if `changedFiles` is empty, return `true` (no files to ignore = workflow should run). This guard goes before the `every()` call that produces the vacuous truth bug.

The `paths` branch does NOT need this guard — `[].some(...)` correctly returns `false` (no files match = skip workflow), which is the right behavior when a workflow requires specific paths but nothing changed.

### Tests

- Evaluate test: empty changedFiles with pathsIgnore → workflow runs
- Evaluate test: empty changedFiles with paths → workflow skipped (verify existing behavior still works)

---

## Bug 4: Invalid `--event` value silently accepted

### Problem

```ts
const event = args.event as 'push' | 'pull_request' | 'workflow_dispatch'
```

If someone passes `--event foobar`, the cast lies and the evaluate layer silently matches nothing. The user sees "No workflows would be triggered" with no indication that their event type is invalid.

### Fix

In `cli.ts`, validate the event value before using it:

```ts
const validEvents = ['push', 'pull_request', 'workflow_dispatch'] as const
if (!validEvents.includes(args.event)) {
  console.error(`Invalid event type: "${args.event}". Must be one of: ${validEvents.join(', ')}`)
  process.exit(1)
}
```

### Tests

- Integration test: `--event foobar` exits with non-zero and prints error message

---

## Bug 5: Missing `.github/workflows` directory crashes

### Problem

If `.github/workflows` doesn't exist, `readdir(dirPath)` throws `ENOENT` and the CLI crashes with an unhandled exception stack trace.

### Fix

In `parseWorkflowsFromDir`, wrap `readdir` in a try/catch. On `ENOENT` or `ENOTDIR`, return an empty array.

In `cli.ts`, after parsing workflows, if the array is empty, print a distinct message: "No workflow files found in .github/workflows/" and exit 0. This is distinct from the "no workflows matched" message from the render layer.

### Tests

- Parse test: `parseWorkflowsFromDir` with nonexistent directory returns empty array
- Integration test: verify graceful handling when no workflows directory exists (can test by passing a temp dir via cwd override or by testing `parseWorkflowsFromDir` directly)

---

## Bug 6: Multi-line `run` steps break rendering

### Problem

Many GitHub Actions steps have multi-line `run` values:

```yaml
- run: |
    echo "hello"
    echo "world"
```

The render layer does `lines.push(`    - ${step.run}`)` which produces:

```
    - echo "hello"
echo "world"
```

The continuation lines lose indentation.

### Fix

In `render.ts`, when rendering a `run` step, split by `\n` and indent continuation lines:

```ts
if (step.run) {
  const runLines = step.run.split('\n').filter(l => l.trim().length > 0)
  lines.push(`    - ${runLines[0]}`)
  for (const continuation of runLines.slice(1)) {
    lines.push(`      ${continuation}`)
  }
}
```

### Tests

- Render test: multi-line run step maintains indentation on all lines

---

## Additional Test Coverage

These are test gaps that don't correspond to bugs but prevent future regressions:

1. **`needs` as string (not array)**: parse test with a fixture where `needs: lint` (string, not `[lint]`). Verify it gets normalized to `['lint']`.
2. **`branches` + `branches-ignore` mutual exclusivity**: evaluate test verifying the warning is emitted and the workflow is skipped.
3. **`paths` + `paths-ignore` mutual exclusivity**: same as above.
4. **YAML roundtrip for `branches-ignore` / `paths-ignore`**: parse test with a fixture that has `branches-ignore` and `paths-ignore`, verifying they map to `branchesIgnore` and `pathsIgnore`.
5. **Delete `test/cli.test.ts`**: its only test (`--help` output) is already duplicated in `test/integration.test.ts`. Nothing to merge — just delete.

---

## Type Changes

Add `tags` and `tagsIgnore` to `WorkflowTrigger`:

```ts
export type WorkflowTrigger = {
  branches?: string[]
  branchesIgnore?: string[]
  paths?: string[]
  pathsIgnore?: string[]
  tags?: string[]
  tagsIgnore?: string[]
  types?: string[]
}
```

These fields are parsed from YAML but NOT evaluated for matching. They exist only so the evaluate layer can detect tag-only workflows and skip them. Future tag evaluation support can use them directly.

No other type changes needed.

---

## Files Modified

| File | Changes |
|------|---------|
| `src/types.ts` | Add `tags`, `tagsIgnore` to `WorkflowTrigger` |
| `src/parse.ts` | Normalize shorthand `on:` syntax; extract `tags`/`tags-ignore`; handle missing directory |
| `src/evaluate.ts` | Skip tag-only push workflows; fix empty changedFiles + pathsIgnore; fix empty changedFiles + paths |
| `src/render.ts` | Handle multi-line `run` step indentation |
| `src/cli.ts` | Validate `--event` value; handle empty workflows array |
| `test/fixtures/` | Add: `shorthand-string.yml`, `shorthand-array.yml`, `tags-only.yml`, `branches-ignore.yml`, `needs-string.yml` |
| `test/parse.test.ts` | Add shorthand, tags, branches-ignore, needs-string, missing dir tests |
| `test/evaluate.test.ts` | Add tag-only, empty changedFiles, mutual exclusivity tests |
| `test/render.test.ts` | Add multi-line run test |
| `test/integration.test.ts` | Add invalid event test; absorb cli.test.ts |
| `test/cli.test.ts` | Delete (merged into integration) |
