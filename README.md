# cya (checks-your-actions)

Know what CI will do before you push.

`cya` reads your `.github/workflows/` directory, looks at your current branch and changed files, and tells you exactly which GitHub Actions workflows and jobs would trigger — without pushing, without waiting, without guessing.

```
$ cya --event push

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

## Why

CI feedback loops are slow. You push, wait for GitHub to pick up the event, wait for runners, then find out you forgot to run lint. Or you're on a branch that doesn't even trigger the workflow you're worried about.

`cya` gives you that information instantly, locally. It evaluates the same trigger rules GitHub uses — branch filters, path filters, event types — against your actual git state right now.

It's also built to be consumed by AI coding tools like Claude Code, so your assistant can know what CI expects before suggesting a push.

## Install

```bash
bun add -g checks-your-actions
```

Requires [Bun](https://bun.sh).

## Usage

```bash
# What would trigger if I opened a PR into main? (default)
cya

# What would trigger on push?
cya --event push

# Compare against a different base branch
cya --base develop

# Check workflow_dispatch triggers
cya --event workflow_dispatch
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--event` | `pull_request` | Event type to simulate: `push`, `pull_request`, `workflow_dispatch` |
| `--base` | `main` | Base branch for comparison (used for diff and PR branch filters) |
| `--help` | | Show usage |
| `--version` | | Show version |

## What it evaluates

`cya` parses your workflow YAML and evaluates these trigger rules against your current git state:

- `push` triggers with `branches`, `branches-ignore`, `paths`, `paths-ignore` filters
- `pull_request` triggers with the same filters (branch filters check the base branch, matching GitHub's behavior)
- `workflow_dispatch` triggers (shown only with `--event workflow_dispatch`)
- Shorthand trigger syntax (`on: push`, `on: [push, pull_request]`)

It also detects and skips:
- Tag-only push triggers (warns instead of false-positive matching)
- Mutually exclusive filters (`branches` + `branches-ignore` on the same trigger)

Changed files are determined by `git diff` against your base branch, plus any staged, unstaged, and untracked files.

## What it doesn't evaluate

- Job-level `if:` conditions (shown in output but not evaluated — they often depend on GitHub context not available locally)
- Matrix strategies (jobs shown once, not expanded per matrix combination)
- `workflow_run`, `schedule`, `release`, and other non-push/PR triggers
- Reusable workflow contents (the `uses:` reference is shown, but the called workflow isn't parsed)
- GitHub expression syntax (`${{ }}`) in any context

## Output

For each matched workflow, `cya` shows:
- Workflow filename and name
- Each job (with name, dependency chain, and `if:` condition if present)
- Each step's `run` command or `uses` action reference
- Reusable workflow references for jobs that call other workflows

If no workflows match, it tells you why.

## Programmatic use

The layers are independently importable:

```ts
import { parseWorkflowsFromDir } from 'checks-your-actions/parse'
import { getGitState } from 'checks-your-actions/git-state'
import { evaluate } from 'checks-your-actions/evaluate'
import { renderResult } from 'checks-your-actions/render'

const workflows = await parseWorkflowsFromDir('.github/workflows')
const gitState = await getGitState({ baseBranch: 'main', event: 'push' })
const result = evaluate(workflows, gitState)
console.log(renderResult(result))
```

## License

MIT
