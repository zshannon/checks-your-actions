# cya (checks-your-actions)

Know what CI will do before you push.

`cya` reads your `.github/workflows/` directory, looks at your current branch and changed files, and tells you exactly which GitHub Actions workflows and jobs would trigger — without pushing, without waiting, without guessing.

```
$ cya --event push

publish.yml (Publish to npm):
  publish: [run]
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

# After running a printed check, mark it succeeded
cya ok test

# After running every printed check, mark the whole unchanged plan succeeded
cya ok --all
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--all` | `false` | Show skipped and bookkeeping jobs |
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
- A conservative subset of job-level `if:` expressions, including `needs.<job>.outputs.<name>`, `needs.*.result`, `always()`, `success()`, `failure()`, `cancelled()`, `contains(...)`, `github.event_name`, and absent `inputs.*` values
- Common guard-output jobs using `dorny/paths-filter` or `npx turbo@2 query affected --packages`

It also detects and skips:
- Tag-only push triggers (warns instead of false-positive matching)
- Mutually exclusive filters (`branches` + `branches-ignore` on the same trigger)

Changed files are determined by `git diff` against your base branch, plus any staged, unstaged, and untracked files. When a matched workflow uses Turbo's affected-package query in a guard job, `cya` runs the same local query and uses its package list to resolve the guard output.

## What it doesn't evaluate

- Arbitrary job-level `if:` expressions outside the supported local subset
- Arbitrary shell scripts or step outputs outside recognized guard-output patterns
- Matrix strategies (jobs shown once, not expanded per matrix combination)
- `workflow_run`, `schedule`, `release`, and other non-push/PR triggers
- Reusable workflow contents (the `uses:` reference is shown, but the called workflow isn't parsed)
- GitHub expression syntax (`${{ }}`) in arbitrary contexts

## Output

For each matched workflow, `cya` shows:
- Workflow filename and name
- Runnable jobs predicted to run
- Unknown jobs that need inspection
- Shell commands from runnable jobs
- Reusable workflow references for jobs predicted to run
- A compact skipped-workflow summary when all actionable jobs in a matched workflow are skipped by guards

By default, `cya` hides skipped jobs, guard-output jobs, status aggregator jobs, and step-level `uses:` actions. Use `--all` to inspect the full audit view with `[run]`, `[skip]`, and `[unknown]` status for every parsed job.

Each actionable job gets a check id in square brackets. `cya ok <check-id>` records that the check succeeded for the last unchanged `cya` plan. `cya ok --all` records every actionable check in that plan. Later `cya` runs show `[cached success]` when the current event, base branch, workflow file, changed file list, and changed file contents still match the recorded success.

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
