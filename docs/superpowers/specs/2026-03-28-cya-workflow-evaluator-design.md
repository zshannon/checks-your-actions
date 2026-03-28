# CYA — GitHub Actions Workflow Trigger Evaluator

## Purpose

`cya` determines which GitHub Actions workflows and jobs would run if you pushed your current branch right now. The primary consumer is Claude Code, which uses the output to know what CI steps to run locally before pushing. Humans can also read it.

## Architecture

Four layers, each independently testable:

```
Parse → Git State → Evaluate → Render
```

### Layer 1: Parse (`src/parse.ts`)

Finds all `.github/workflows/*.yml` files relative to the repo root. Parses each with the `yaml` package into typed structures.

**Types:**

```ts
type WorkflowTrigger = {
  branches?: string[]
  branchesIgnore?: string[]
  paths?: string[]
  pathsIgnore?: string[]
  types?: string[]
}

type Step = {
  name?: string
  run?: string
  uses?: string
}

type Job = {
  name?: string
  id: string
  needs?: string[]
  runsOn: string | string[]
  steps: Step[]
  if?: string
}

type Workflow = {
  name?: string
  fileName: string
  on: {
    push?: WorkflowTrigger
    pullRequest?: WorkflowTrigger
    workflowDispatch?: Record<string, unknown>
  }
  jobs: Job[]
}
```

**Behavior:**
- Reads all `*.yml` and `*.yaml` files in `.github/workflows/`
- Ignores workflow files that fail to parse (warns to stderr)
- Only extracts `push`, `pull_request`, and `workflow_dispatch` triggers; other triggers are ignored
- Maps snake_case YAML keys (`pull_request`, `branches-ignore`, `paths-ignore`) to camelCase TypeScript

**Out of scope:** `tags` and `tags-ignore` filters on `push` triggers. Workflows that only have tag filters on `push` (no `branches` or `paths`) are skipped with a warning.

### Layer 2: Git State (`src/git-state.ts`)

Uses `Bun.$` shell to run git commands directly (no wrapper library needed for three simple commands).

**Types:**

```ts
type GitEvent = 'push' | 'pull_request' | 'workflow_dispatch'

type GitState = {
  branch: string
  baseBranch: string
  changedFiles: string[]
  event: GitEvent
}
```

**Behavior:**
- `branch`: current branch name from `Bun.$`git rev-parse --abbrev-ref HEAD``
- `baseBranch`: `--base <branch>` CLI arg, or defaults to `main`
- `changedFiles`: `git diff --name-only <baseBranch>...HEAD` plus any uncommitted changes from `git diff --name-only` and `git ls-files --others --exclude-standard`
- `event`: defaults to `pull_request`, overridden by `--event <type>` CLI arg

### Layer 3: Evaluate (`src/evaluate.ts`)

Takes parsed workflows and git state, returns which workflows/jobs match.

**Types:**

```ts
type MatchedJob = {
  id: string
  name?: string
  needs?: string[]
  steps: Step[]
}

type MatchedWorkflow = {
  name?: string
  fileName: string
  jobs: MatchedJob[]
}

type EvaluationResult = {
  event: GitEvent
  branch: string
  baseBranch: string
  changedFiles: string[]
  matchedWorkflows: MatchedWorkflow[]
}
```

**Trigger matching logic:**

1. Check if the workflow has a trigger for the current `event`. If not, skip.
2. For `workflow_dispatch`: match only when `--event workflow_dispatch` is explicitly passed. Include all jobs.
3. For `push` and `pull_request`:
   a. **Branch filter**: `branches` and `branches-ignore` are mutually exclusive per GitHub's spec. If `branches` is set, the branch must match at least one pattern. If `branches-ignore` is set, the branch must not match any pattern. If a workflow specifies both, warn to stderr and skip.
   b. **Which branch is checked**: for `push` events, the current branch (head). For `pull_request` events, the base branch — this matches GitHub's behavior where PR branch filters apply to the target branch.
   c. **Path filter**: `paths` and `paths-ignore` are mutually exclusive. If `paths` is set, at least one changed file must match a pattern. If `paths-ignore` is set, the workflow runs unless **all** changed files match at least one ignore pattern.
   d. Both branch and path filters must pass for the workflow to match.
4. All jobs in a matched workflow are included (no job-level conditional evaluation for now — `if:` expressions on jobs are noted but not evaluated).

Uses `picomatch` for all glob matching. Branch patterns use `{ dot: true }` to match GitHub's fnmatch semantics where `*` does not match `/` but `**` does.

### Layer 4: Render (`src/render.ts`)

Takes an `EvaluationResult` and produces output using `consola` for styled terminal output.

**Default (human-readable):**

```
publish.yml (Publish to npm):
  publish:
    - actions/checkout@v4
    - oven-sh/setup-bun@v2
    - bun install --frozen-lockfile
    - bun run lint
    - bun run typecheck
    - bun run test
    - actions/setup-node@v4
    - npm publish --provenance --access public
```

Each step shows either the `run` command or the `uses` action reference. Steps with neither are omitted.

**Future:** `--json` flag to output the `EvaluationResult` as JSON for machine consumption.

### CLI (`src/cli.ts`)

Wires the layers together. Uses `citty` for arg parsing — TypeScript-first, auto-generated help, from the unjs ecosystem (pairs with `consola`).

**Usage:**

```
cya [options]

Options:
  --base <branch>    Base branch for comparison (default: main)
  --event <type>     Simulate event type: push, pull_request, workflow_dispatch
                     (default: pull_request)
  --help             Show help
  --version          Show version
```

**Flow:**

1. Parse args via `citty`
2. Find and parse workflow files
3. Detect git state (with arg overrides)
4. Evaluate triggers
5. Render output via `consola`

If no workflows match, print a message saying so and exit 0.

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `citty` | ^0.2.1 | CLI arg parsing, TypeScript-first, auto help |
| `consola` | ^3.4.2 | Styled terminal output, log levels |
| `picomatch` | ^4.0.4 | Glob matching for branch/path filters |
| `yaml` | ^2.8.3 | Parse workflow YAML files with built-in TS types |

Git operations use `Bun.$` directly — no wrapper library needed.

## Testing Strategy

Test-driven development. Tests use `bun:test`.

- **Parse tests**: fixture YAML files in `test/fixtures/` → verify parsed `Workflow` objects
- **Evaluate tests**: hardcoded `Workflow[]` + `GitState` → verify `EvaluationResult`
- **Git state tests**: mock `Bun.$` or test against actual git commands in a temp repo
- **Render tests**: hardcoded `EvaluationResult` → verify string output
- **CLI integration test**: fixture repo with workflows → run `cya` → verify output

Each layer is tested in isolation with its own test file.

## Extensibility

The layered design supports future additions without restructuring:
- **Matrix expansion**: add a transform between Evaluate and Render that expands matrix configs
- **Job conditionals**: add expression evaluation in the Evaluate layer
- **New triggers**: add trigger types to `WorkflowTrigger` and matching logic (e.g. tags)
- **New output formats**: add renderers (JSON, markdown, etc.)
- **Programmatic use**: import `parse`, `evaluate` directly without the CLI
