# CYA Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI tool that determines which GitHub Actions workflows would trigger given the current git state.

**Architecture:** Four layers — Parse (YAML to typed objects), Git State (branch/changed files via `Bun.$`), Evaluate (trigger matching via picomatch), Render (styled output via consola). CLI wired with citty.

**Tech Stack:** Bun, TypeScript, citty, consola, picomatch, yaml

**Spec:** `docs/superpowers/specs/2026-03-28-cya-workflow-evaluator-design.md`

**Note:** After writing any source file, run `bun run format` before committing. The formatter enforces `arrowParens: "avoid"` and other style rules that may differ from the code snippets in this plan.

---

## File Structure

```
src/
  cli.ts              — CLI entry point, citty arg parsing, wires layers together
  types.ts            — All shared type definitions
  parse.ts            — YAML workflow file parsing
  git-state.ts        — Git state detection via Bun.$
  evaluate.ts         — Trigger matching logic
  render.ts           — Terminal output formatting
test/
  fixtures/
    basic.yml         — Simple push trigger workflow
    paths-filter.yml  — Workflow with paths/paths-ignore
    branches.yml      — Workflow with branch filters
    multi-trigger.yml — Workflow with push + pull_request
    dispatch.yml      — workflow_dispatch only
    invalid.yml       — Malformed YAML for error handling
  cli.test.ts         — CLI integration test (moved from src/)
  parse.test.ts       — Parse layer tests
  evaluate.test.ts    — Evaluate layer tests
  git-state.test.ts   — Git state tests
  render.test.ts      — Render layer tests
  integration.test.ts — End-to-end test against own repo
```

**Important:** The `format` and `lint` scripts in `package.json` currently target `src/` only. Update them to cover `test/` too early in implementation:
- `"format": "oxfmt --write src/ test/"`
- `"lint": "oxfmt --check src/ test/ && oxlint src/ test/"`

---

## Chunk 1: Setup and Types

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime dependencies**

```bash
bun add citty consola picomatch yaml
```

- [ ] **Step 2: Install picomatch types**

```bash
bun add -d @types/picomatch
```

- [ ] **Step 3: Update format/lint scripts to cover test/**

In `package.json`, update:
- `"format": "oxfmt --write src/ test/"`
- `"lint": "oxfmt --check src/ test/ && oxlint src/ test/"`

Also add `"version": "0.0.1"` after `"name"`.

- [ ] **Step 4: Verify install**

Run: `bun run typecheck`
Expected: PASS (no errors)

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock
git commit -m "Add runtime dependencies: citty, consola, picomatch, yaml"
```

### Task 2: Define shared types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Create types file**

```ts
export type WorkflowTrigger = {
	branches?: string[]
	branchesIgnore?: string[]
	paths?: string[]
	pathsIgnore?: string[]
	types?: string[]
}

export type Step = {
	name?: string
	run?: string
	uses?: string
}

export type Job = {
	id: string
	if?: string
	name?: string
	needs?: string[]
	runsOn: string | string[]
	steps: Step[]
}

export type Workflow = {
	fileName: string
	name?: string
	on: {
		push?: WorkflowTrigger
		pullRequest?: WorkflowTrigger
		workflowDispatch?: Record<string, unknown>
	}
	jobs: Job[]
}

export type GitEvent = 'push' | 'pull_request' | 'workflow_dispatch'

export type GitState = {
	baseBranch: string
	branch: string
	changedFiles: string[]
	event: GitEvent
}

export type MatchedJob = {
	id: string
	name?: string
	needs?: string[]
	steps: Step[]
}

export type MatchedWorkflow = {
	fileName: string
	jobs: MatchedJob[]
	name?: string
}

export type EvaluationResult = {
	baseBranch: string
	branch: string
	changedFiles: string[]
	event: GitEvent
	matchedWorkflows: MatchedWorkflow[]
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "Add shared type definitions"
```

---

## Chunk 2: Parse Layer

### Task 3: Create test fixtures

**Files:**
- Create: `test/fixtures/basic.yml`
- Create: `test/fixtures/paths-filter.yml`
- Create: `test/fixtures/branches.yml`
- Create: `test/fixtures/multi-trigger.yml`
- Create: `test/fixtures/dispatch.yml`
- Create: `test/fixtures/invalid.yml`

- [ ] **Step 1: Create basic.yml**

```yaml
name: CI
on:
  push:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
```

- [ ] **Step 2: Create paths-filter.yml**

```yaml
name: Docs
on:
  push:
    paths:
      - "docs/**"
      - "*.md"

jobs:
  build-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run build:docs
```

- [ ] **Step 3: Create branches.yml**

```yaml
name: Deploy
on:
  push:
    branches:
      - main
      - "release/*"

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run deploy
```

- [ ] **Step 4: Create multi-trigger.yml**

```yaml
name: Test
on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main
    paths:
      - "src/**"

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run lint
  test:
    runs-on: ubuntu-latest
    needs: [lint]
    steps:
      - uses: actions/checkout@v4
      - run: npm test
```

- [ ] **Step 5: Create dispatch.yml**

```yaml
name: Manual Deploy
on:
  workflow_dispatch:
    inputs:
      environment:
        description: "Target environment"
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run deploy
```

- [ ] **Step 6: Create invalid.yml**

```
this is not: valid: yaml: [
```

- [ ] **Step 7: Commit**

```bash
git add test/fixtures/
git commit -m "Add test fixture workflow files"
```

### Task 4: Write parse tests

**Files:**
- Create: `test/parse.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { parseWorkflowFile, parseWorkflowsFromDir } from '../src/parse.ts'

const FIXTURES = join(import.meta.dir, 'fixtures')

describe('parseWorkflowFile', () => {
	test('parses basic push workflow', async () => {
		const workflow = await parseWorkflowFile(join(FIXTURES, 'basic.yml'))
		expect(workflow).not.toBeNull()
		expect(workflow!.name).toBe('CI')
		expect(workflow!.fileName).toBe('basic.yml')
		expect(workflow!.on.push).toEqual({})
		expect(workflow!.on.pullRequest).toBeUndefined()
		expect(workflow!.jobs).toHaveLength(1)
		expect(workflow!.jobs[0]!.id).toBe('test')
		expect(workflow!.jobs[0]!.runsOn).toBe('ubuntu-latest')
		expect(workflow!.jobs[0]!.steps).toHaveLength(2)
		expect(workflow!.jobs[0]!.steps[0]!.uses).toBe('actions/checkout@v4')
		expect(workflow!.jobs[0]!.steps[1]!.run).toBe('npm test')
	})

	test('parses workflow with paths filter', async () => {
		const workflow = await parseWorkflowFile(
			join(FIXTURES, 'paths-filter.yml')
		)
		expect(workflow).not.toBeNull()
		expect(workflow!.on.push?.paths).toEqual(['docs/**', '*.md'])
	})

	test('parses workflow with branch filters', async () => {
		const workflow = await parseWorkflowFile(join(FIXTURES, 'branches.yml'))
		expect(workflow).not.toBeNull()
		expect(workflow!.on.push?.branches).toEqual(['main', 'release/*'])
	})

	test('parses workflow with multiple triggers', async () => {
		const workflow = await parseWorkflowFile(
			join(FIXTURES, 'multi-trigger.yml')
		)
		expect(workflow).not.toBeNull()
		expect(workflow!.on.push?.branches).toEqual(['main'])
		expect(workflow!.on.pullRequest?.branches).toEqual(['main'])
		expect(workflow!.on.pullRequest?.paths).toEqual(['src/**'])
		expect(workflow!.jobs).toHaveLength(2)
		expect(workflow!.jobs[1]!.needs).toEqual(['lint'])
	})

	test('parses workflow_dispatch trigger', async () => {
		const workflow = await parseWorkflowFile(join(FIXTURES, 'dispatch.yml'))
		expect(workflow).not.toBeNull()
		expect(workflow!.on.workflowDispatch).toBeDefined()
		expect(workflow!.on.push).toBeUndefined()
	})

	test('returns null for invalid YAML', async () => {
		const workflow = await parseWorkflowFile(join(FIXTURES, 'invalid.yml'))
		expect(workflow).toBeNull()
	})
})

describe('parseWorkflowsFromDir', () => {
	test('parses all valid workflows from directory', async () => {
		const workflows = await parseWorkflowsFromDir(FIXTURES)
		// Should skip invalid.yml but parse the rest
		expect(workflows.length).toBeGreaterThanOrEqual(5)
		expect(workflows.every((w) => w.fileName !== 'invalid.yml')).toBe(true)
	})
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/parse.test.ts`
Expected: FAIL — `parseWorkflowFile` not found

- [ ] **Step 3: Commit**

```bash
git add test/parse.test.ts
git commit -m "Add parse layer tests (red)"
```

### Task 5: Implement parse layer

**Files:**
- Create: `src/parse.ts`

- [ ] **Step 1: Implement parseWorkflowFile and parseWorkflowsFromDir**

```ts
import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parse } from 'yaml'
import type { Job, Step, Workflow, WorkflowTrigger } from './types.ts'

function parseTrigger(raw: unknown): WorkflowTrigger | undefined {
	if (raw === undefined || raw === null) return undefined
	if (typeof raw !== 'object') return {}
	const obj = raw as Record<string, unknown>
	const trigger: WorkflowTrigger = {}
	if (Array.isArray(obj['branches'])) trigger.branches = obj['branches']
	if (Array.isArray(obj['branches-ignore']))
		trigger.branchesIgnore = obj['branches-ignore']
	if (Array.isArray(obj['paths'])) trigger.paths = obj['paths']
	if (Array.isArray(obj['paths-ignore']))
		trigger.pathsIgnore = obj['paths-ignore']
	if (Array.isArray(obj['types'])) trigger.types = obj['types']
	return trigger
}

function parseStep(raw: Record<string, unknown>): Step {
	return {
		name: raw['name'] as string | undefined,
		run: raw['run'] as string | undefined,
		uses: raw['uses'] as string | undefined,
	}
}

function parseJob(id: string, raw: Record<string, unknown>): Job {
	const steps = Array.isArray(raw['steps'])
		? (raw['steps'] as Record<string, unknown>[]).map(parseStep)
		: []
	const needs = raw['needs']
	return {
		id,
		if: raw['if'] as string | undefined,
		name: raw['name'] as string | undefined,
		needs: Array.isArray(needs)
			? needs
			: typeof needs === 'string'
				? [needs]
				: undefined,
		runsOn: raw['runs-on'] as string | string[],
		steps,
	}
}

export async function parseWorkflowFile(
	filePath: string
): Promise<Workflow | null> {
	try {
		const content = await Bun.file(filePath).text()
		const doc = parse(content) as Record<string, unknown>
		if (!doc || typeof doc !== 'object') return null

		const on = doc['on'] as Record<string, unknown> | undefined
		if (!on) return null

		const jobsRaw = (doc['jobs'] ?? {}) as Record<
			string,
			Record<string, unknown>
		>
		const jobs = Object.entries(jobsRaw).map(([id, raw]) =>
			parseJob(id, raw)
		)

		return {
			fileName: basename(filePath),
			jobs,
			name: doc['name'] as string | undefined,
			on: {
				pullRequest: parseTrigger(on['pull_request']),
				push: parseTrigger(on['push']),
				workflowDispatch: on['workflow_dispatch'] as
					| Record<string, unknown>
					| undefined,
			},
		}
	} catch {
		console.warn(`Warning: failed to parse ${basename(filePath)}`)
		return null
	}
}

export async function parseWorkflowsFromDir(
	dirPath: string
): Promise<Workflow[]> {
	const entries = await readdir(dirPath)
	const yamlFiles = entries.filter(
		(f) => f.endsWith('.yml') || f.endsWith('.yaml')
	)
	const results = await Promise.all(
		yamlFiles.map((f) => parseWorkflowFile(join(dirPath, f)))
	)
	return results.filter((w): w is Workflow => w !== null)
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun test test/parse.test.ts`
Expected: PASS — all tests green

- [ ] **Step 3: Run lint and typecheck**

Run: `bun run lint && bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/parse.ts
git commit -m "Implement parse layer"
```

---

## Chunk 3: Evaluate Layer

### Task 6: Write evaluate tests

**Files:**
- Create: `test/evaluate.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, expect, test } from 'bun:test'
import { evaluate } from '../src/evaluate.ts'
import type { GitState, Workflow } from '../src/types.ts'

const basicWorkflow: Workflow = {
	fileName: 'ci.yml',
	jobs: [
		{
			id: 'test',
			runsOn: 'ubuntu-latest',
			steps: [{ uses: 'actions/checkout@v4' }, { run: 'npm test' }],
		},
	],
	name: 'CI',
	on: { push: {} },
}

const branchFilterWorkflow: Workflow = {
	fileName: 'deploy.yml',
	jobs: [
		{
			id: 'deploy',
			runsOn: 'ubuntu-latest',
			steps: [{ run: 'npm run deploy' }],
		},
	],
	name: 'Deploy',
	on: { push: { branches: ['main', 'release/*'] } },
}

const pathsWorkflow: Workflow = {
	fileName: 'docs.yml',
	jobs: [
		{
			id: 'build-docs',
			runsOn: 'ubuntu-latest',
			steps: [{ run: 'npm run build:docs' }],
		},
	],
	name: 'Docs',
	on: { push: { paths: ['docs/**', '*.md'] } },
}

const pathsIgnoreWorkflow: Workflow = {
	fileName: 'test.yml',
	jobs: [
		{
			id: 'test',
			runsOn: 'ubuntu-latest',
			steps: [{ run: 'npm test' }],
		},
	],
	name: 'Test',
	on: { push: { pathsIgnore: ['docs/**', '*.md'] } },
}

const prWorkflow: Workflow = {
	fileName: 'pr.yml',
	jobs: [
		{
			id: 'test',
			runsOn: 'ubuntu-latest',
			steps: [{ run: 'npm test' }],
		},
	],
	name: 'PR Test',
	on: { pullRequest: { branches: ['main'] } },
}

const dispatchWorkflow: Workflow = {
	fileName: 'manual.yml',
	jobs: [
		{
			id: 'deploy',
			runsOn: 'ubuntu-latest',
			steps: [{ run: 'npm run deploy' }],
		},
	],
	name: 'Manual',
	on: { workflowDispatch: {} },
}

describe('evaluate', () => {
	test('matches workflow with no filters on push event', () => {
		const state: GitState = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['src/index.ts'],
			event: 'push',
		}
		const result = evaluate([basicWorkflow], state)
		expect(result.matchedWorkflows).toHaveLength(1)
		expect(result.matchedWorkflows[0]!.fileName).toBe('ci.yml')
	})

	test('matches branch filter when branch matches', () => {
		const state: GitState = {
			baseBranch: 'main',
			branch: 'main',
			changedFiles: ['src/index.ts'],
			event: 'push',
		}
		const result = evaluate([branchFilterWorkflow], state)
		expect(result.matchedWorkflows).toHaveLength(1)
	})

	test('matches branch wildcard pattern', () => {
		const state: GitState = {
			baseBranch: 'main',
			branch: 'release/v1.0',
			changedFiles: ['src/index.ts'],
			event: 'push',
		}
		const result = evaluate([branchFilterWorkflow], state)
		expect(result.matchedWorkflows).toHaveLength(1)
	})

	test('skips workflow when branch does not match filter', () => {
		const state: GitState = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['src/index.ts'],
			event: 'push',
		}
		const result = evaluate([branchFilterWorkflow], state)
		expect(result.matchedWorkflows).toHaveLength(0)
	})

	test('matches when changed files match paths filter', () => {
		const state: GitState = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['docs/guide.md'],
			event: 'push',
		}
		const result = evaluate([pathsWorkflow], state)
		expect(result.matchedWorkflows).toHaveLength(1)
	})

	test('skips when no changed files match paths filter', () => {
		const state: GitState = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['src/index.ts'],
			event: 'push',
		}
		const result = evaluate([pathsWorkflow], state)
		expect(result.matchedWorkflows).toHaveLength(0)
	})

	test('skips when ALL changed files match paths-ignore', () => {
		const state: GitState = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['docs/guide.md', 'README.md'],
			event: 'push',
		}
		const result = evaluate([pathsIgnoreWorkflow], state)
		expect(result.matchedWorkflows).toHaveLength(0)
	})

	test('matches when some changed files do NOT match paths-ignore', () => {
		const state: GitState = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['docs/guide.md', 'src/index.ts'],
			event: 'push',
		}
		const result = evaluate([pathsIgnoreWorkflow], state)
		expect(result.matchedWorkflows).toHaveLength(1)
	})

	test('pull_request branch filter checks baseBranch not branch', () => {
		const state: GitState = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['src/index.ts'],
			event: 'pull_request',
		}
		const result = evaluate([prWorkflow], state)
		expect(result.matchedWorkflows).toHaveLength(1)
	})

	test('pull_request skips when baseBranch does not match', () => {
		const state: GitState = {
			baseBranch: 'develop',
			branch: 'feature-x',
			changedFiles: ['src/index.ts'],
			event: 'pull_request',
		}
		const result = evaluate([prWorkflow], state)
		expect(result.matchedWorkflows).toHaveLength(0)
	})

	test('skips workflow_dispatch unless event is workflow_dispatch', () => {
		const state: GitState = {
			baseBranch: 'main',
			branch: 'main',
			changedFiles: [],
			event: 'push',
		}
		const result = evaluate([dispatchWorkflow], state)
		expect(result.matchedWorkflows).toHaveLength(0)
	})

	test('matches workflow_dispatch when event is workflow_dispatch', () => {
		const state: GitState = {
			baseBranch: 'main',
			branch: 'main',
			changedFiles: [],
			event: 'workflow_dispatch',
		}
		const result = evaluate([dispatchWorkflow], state)
		expect(result.matchedWorkflows).toHaveLength(1)
	})

	test('skips workflow when event type has no matching trigger', () => {
		const state: GitState = {
			baseBranch: 'main',
			branch: 'main',
			changedFiles: ['src/index.ts'],
			event: 'pull_request',
		}
		// basicWorkflow only has push trigger
		const result = evaluate([basicWorkflow], state)
		expect(result.matchedWorkflows).toHaveLength(0)
	})

	test('includes all jobs from matched workflow', () => {
		const multiJobWorkflow: Workflow = {
			fileName: 'multi.yml',
			jobs: [
				{
					id: 'lint',
					runsOn: 'ubuntu-latest',
					steps: [{ run: 'npm run lint' }],
				},
				{
					id: 'test',
					needs: ['lint'],
					runsOn: 'ubuntu-latest',
					steps: [{ run: 'npm test' }],
				},
			],
			name: 'Multi',
			on: { push: {} },
		}
		const state: GitState = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['src/index.ts'],
			event: 'push',
		}
		const result = evaluate([multiJobWorkflow], state)
		expect(result.matchedWorkflows[0]!.jobs).toHaveLength(2)
		expect(result.matchedWorkflows[0]!.jobs[1]!.needs).toEqual(['lint'])
	})

	test('matches branches-ignore when branch is not ignored', () => {
		const workflow: Workflow = {
			fileName: 'skip-docs.yml',
			jobs: [
				{
					id: 'test',
					runsOn: 'ubuntu-latest',
					steps: [{ run: 'npm test' }],
				},
			],
			name: 'Skip Docs',
			on: { push: { branchesIgnore: ['docs/*', 'dependabot/*'] } },
		}
		const state: GitState = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['src/index.ts'],
			event: 'push',
		}
		const result = evaluate([workflow], state)
		expect(result.matchedWorkflows).toHaveLength(1)
	})

	test('skips branches-ignore when branch is ignored', () => {
		const workflow: Workflow = {
			fileName: 'skip-docs.yml',
			jobs: [
				{
					id: 'test',
					runsOn: 'ubuntu-latest',
					steps: [{ run: 'npm test' }],
				},
			],
			name: 'Skip Docs',
			on: { push: { branchesIgnore: ['docs/*', 'dependabot/*'] } },
		}
		const state: GitState = {
			baseBranch: 'main',
			branch: 'dependabot/npm-updates',
			changedFiles: ['src/index.ts'],
			event: 'push',
		}
		const result = evaluate([workflow], state)
		expect(result.matchedWorkflows).toHaveLength(0)
	})

	test('result contains git state metadata', () => {
		const state: GitState = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['src/index.ts'],
			event: 'push',
		}
		const result = evaluate([basicWorkflow], state)
		expect(result.baseBranch).toBe('main')
		expect(result.branch).toBe('feature-x')
		expect(result.changedFiles).toEqual(['src/index.ts'])
		expect(result.event).toBe('push')
	})
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/evaluate.test.ts`
Expected: FAIL — `evaluate` not found

- [ ] **Step 3: Commit**

```bash
git add test/evaluate.test.ts
git commit -m "Add evaluate layer tests (red)"
```

### Task 7: Implement evaluate layer

**Files:**
- Create: `src/evaluate.ts`

- [ ] **Step 1: Implement evaluate function**

```ts
import picomatch from 'picomatch'
import type {
	EvaluationResult,
	GitState,
	MatchedJob,
	MatchedWorkflow,
	Workflow,
	WorkflowTrigger,
} from './types.ts'

function matchesBranch(
	branch: string,
	trigger: WorkflowTrigger
): boolean {
	if (trigger.branches && trigger.branchesIgnore) {
		console.warn(
			'Warning: branches and branches-ignore are mutually exclusive, skipping'
		)
		return false
	}
	if (trigger.branches) {
		return trigger.branches.some((pattern) =>
			picomatch.isMatch(branch, pattern, { dot: true })
		)
	}
	if (trigger.branchesIgnore) {
		return !trigger.branchesIgnore.some((pattern) =>
			picomatch.isMatch(branch, pattern, { dot: true })
		)
	}
	return true
}

function matchesPaths(
	changedFiles: string[],
	trigger: WorkflowTrigger
): boolean {
	if (trigger.paths && trigger.pathsIgnore) {
		console.warn(
			'Warning: paths and paths-ignore are mutually exclusive, skipping'
		)
		return false
	}
	if (trigger.paths) {
		return changedFiles.some((file) =>
			trigger.paths!.some((pattern) =>
				picomatch.isMatch(file, pattern, { dot: true })
			)
		)
	}
	if (trigger.pathsIgnore) {
		const allIgnored = changedFiles.every((file) =>
			trigger.pathsIgnore!.some((pattern) =>
				picomatch.isMatch(file, pattern, { dot: true })
			)
		)
		return !allIgnored
	}
	return true
}

function matchesTrigger(
	workflow: Workflow,
	state: GitState
): boolean {
	if (state.event === 'workflow_dispatch') {
		return workflow.on.workflowDispatch !== undefined
	}

	const trigger =
		state.event === 'push'
			? workflow.on.push
			: workflow.on.pullRequest

	if (!trigger) return false

	// For push: check head branch. For pull_request: check base branch.
	const branchToCheck =
		state.event === 'push' ? state.branch : state.baseBranch

	if (!matchesBranch(branchToCheck, trigger)) return false
	if (!matchesPaths(state.changedFiles, trigger)) return false

	return true
}

export function evaluate(
	workflows: Workflow[],
	state: GitState
): EvaluationResult {
	const matchedWorkflows: MatchedWorkflow[] = []

	for (const workflow of workflows) {
		if (!matchesTrigger(workflow, state)) continue

		const jobs: MatchedJob[] = workflow.jobs.map((job) => ({
			id: job.id,
			name: job.name,
			needs: job.needs,
			steps: job.steps,
		}))

		matchedWorkflows.push({
			fileName: workflow.fileName,
			jobs,
			name: workflow.name,
		})
	}

	return {
		baseBranch: state.baseBranch,
		branch: state.branch,
		changedFiles: state.changedFiles,
		event: state.event,
		matchedWorkflows,
	}
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun test test/evaluate.test.ts`
Expected: PASS — all tests green

- [ ] **Step 3: Run lint and typecheck**

Run: `bun run lint && bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/evaluate.ts
git commit -m "Implement evaluate layer"
```

---

## Chunk 4: Git State and Render

### Task 8: Write git-state tests

**Files:**
- Create: `test/git-state.test.ts`

- [ ] **Step 1: Write tests**

The git-state module uses dependency injection — it accepts a `GitRunner` interface so tests can mock all git commands without touching the filesystem or requiring git.

```ts
import { describe, expect, test } from 'bun:test'
import { getGitState } from '../src/git-state.ts'
import type { GitRunner } from '../src/git-state.ts'

function mockRunner(overrides: Partial<GitRunner> = {}): GitRunner {
	return {
		currentBranch: async () => 'feature-branch',
		diffBase: async () => ['src/index.ts', 'src/utils.ts'],
		diffStaged: async () => [],
		diffUnstaged: async () => [],
		untracked: async () => [],
		...overrides,
	}
}

describe('getGitState', () => {
	test('detects current branch from runner', async () => {
		const runner = mockRunner({ currentBranch: async () => 'my-branch' })
		const state = await getGitState({ runner })
		expect(state.branch).toBe('my-branch')
	})

	test('uses provided baseBranch', async () => {
		const state = await getGitState({
			baseBranch: 'develop',
			runner: mockRunner(),
		})
		expect(state.baseBranch).toBe('develop')
	})

	test('defaults baseBranch to main', async () => {
		const state = await getGitState({ runner: mockRunner() })
		expect(state.baseBranch).toBe('main')
	})

	test('defaults event to pull_request', async () => {
		const state = await getGitState({ runner: mockRunner() })
		expect(state.event).toBe('pull_request')
	})

	test('uses provided event', async () => {
		const state = await getGitState({
			event: 'push',
			runner: mockRunner(),
		})
		expect(state.event).toBe('push')
	})

	test('collects committed diff files', async () => {
		const runner = mockRunner({
			diffBase: async () => ['src/index.ts', 'lib/utils.ts'],
		})
		const state = await getGitState({ runner })
		expect(state.changedFiles).toContain('src/index.ts')
		expect(state.changedFiles).toContain('lib/utils.ts')
	})

	test('includes unstaged changes', async () => {
		const runner = mockRunner({
			diffBase: async () => ['src/index.ts'],
			diffUnstaged: async () => ['src/dirty.ts'],
		})
		const state = await getGitState({ runner })
		expect(state.changedFiles).toContain('src/dirty.ts')
	})

	test('includes staged changes', async () => {
		const runner = mockRunner({
			diffBase: async () => [],
			diffStaged: async () => ['src/staged.ts'],
		})
		const state = await getGitState({ runner })
		expect(state.changedFiles).toContain('src/staged.ts')
	})

	test('includes untracked files', async () => {
		const runner = mockRunner({
			diffBase: async () => [],
			untracked: async () => ['newfile.ts'],
		})
		const state = await getGitState({ runner })
		expect(state.changedFiles).toContain('newfile.ts')
	})

	test('deduplicates files across all sources', async () => {
		const runner = mockRunner({
			diffBase: async () => ['src/index.ts'],
			diffStaged: async () => ['src/index.ts'],
			diffUnstaged: async () => ['src/index.ts'],
			untracked: async () => [],
		})
		const state = await getGitState({ runner })
		const count = state.changedFiles.filter(
			f => f === 'src/index.ts'
		).length
		expect(count).toBe(1)
	})

	test('passes baseBranch to diffBase runner', async () => {
		let receivedBase = ''
		const runner = mockRunner({
			diffBase: async (base) => {
				receivedBase = base
				return []
			},
		})
		await getGitState({ baseBranch: 'develop', runner })
		expect(receivedBase).toBe('develop')
	})
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/git-state.test.ts`
Expected: FAIL — `getGitState` not found

- [ ] **Step 3: Commit**

```bash
git add test/git-state.test.ts
git commit -m "Add git-state layer tests (red)"
```

### Task 9: Implement git-state layer

**Files:**
- Create: `src/git-state.ts`

- [ ] **Step 1: Implement getGitState with GitRunner interface**

```ts
import { $ } from 'bun'
import type { GitEvent, GitState } from './types.ts'

export type GitRunner = {
	currentBranch: () => Promise<string>
	diffBase: (baseBranch: string) => Promise<string[]>
	diffStaged: () => Promise<string[]>
	diffUnstaged: () => Promise<string[]>
	untracked: () => Promise<string[]>
}

function splitLines(output: string): string[] {
	return output
		.trim()
		.split('\n')
		.filter(f => f.length > 0)
}

export function createBunGitRunner(cwd: string): GitRunner {
	return {
		currentBranch: async () =>
			(await $`git -C ${cwd} rev-parse --abbrev-ref HEAD`.text()).trim(),
		diffBase: async (baseBranch) =>
			splitLines(
				await $`git -C ${cwd} diff --name-only ${baseBranch}...HEAD`
					.text()
					.catch(() => '')
			),
		diffStaged: async () =>
			splitLines(await $`git -C ${cwd} diff --name-only --cached`.text()),
		diffUnstaged: async () =>
			splitLines(await $`git -C ${cwd} diff --name-only`.text()),
		untracked: async () =>
			splitLines(
				await $`git -C ${cwd} ls-files --others --exclude-standard`.text()
			),
	}
}

type GitStateOptions = {
	baseBranch?: string
	cwd?: string
	event?: GitEvent
	runner?: GitRunner
}

export async function getGitState(
	options: GitStateOptions = {}
): Promise<GitState> {
	const runner =
		options.runner ?? createBunGitRunner(options.cwd ?? process.cwd())
	const baseBranch = options.baseBranch ?? 'main'
	const event = options.event ?? 'pull_request'

	const branch = await runner.currentBranch()
	const committed = await runner.diffBase(baseBranch)
	const unstaged = await runner.diffUnstaged()
	const staged = await runner.diffStaged()
	const untracked = await runner.untracked()

	const changedFiles = [
		...new Set([...committed, ...unstaged, ...staged, ...untracked]),
	]

	return {
		baseBranch,
		branch,
		changedFiles,
		event,
	}
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun test test/git-state.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/git-state.ts
git commit -m "Implement git-state layer with injectable GitRunner"
```

### Task 10: Write render tests

**Files:**
- Create: `test/render.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, expect, test } from 'bun:test'
import { renderResult } from '../src/render.ts'
import type { EvaluationResult } from '../src/types.ts'

describe('renderResult', () => {
	test('renders matched workflows with jobs and steps', () => {
		const result: EvaluationResult = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['src/index.ts'],
			event: 'push',
			matchedWorkflows: [
				{
					fileName: 'ci.yml',
					jobs: [
						{
							id: 'test',
							steps: [
								{ uses: 'actions/checkout@v4' },
								{ run: 'npm test' },
							],
						},
					],
					name: 'CI',
				},
			],
		}
		const output = renderResult(result)
		expect(output).toContain('ci.yml')
		expect(output).toContain('CI')
		expect(output).toContain('test')
		expect(output).toContain('actions/checkout@v4')
		expect(output).toContain('npm test')
	})

	test('renders workflow without name using just filename', () => {
		const result: EvaluationResult = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: [],
			event: 'push',
			matchedWorkflows: [
				{
					fileName: 'ci.yml',
					jobs: [
						{
							id: 'test',
							steps: [{ run: 'npm test' }],
						},
					],
				},
			],
		}
		const output = renderResult(result)
		expect(output).toContain('ci.yml')
		expect(output).not.toContain('(')
	})

	test('renders no-match message when no workflows match', () => {
		const result: EvaluationResult = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: [],
			event: 'push',
			matchedWorkflows: [],
		}
		const output = renderResult(result)
		expect(output).toContain('No workflows would be triggered')
	})

	test('skips steps with neither run nor uses', () => {
		const result: EvaluationResult = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: [],
			event: 'push',
			matchedWorkflows: [
				{
					fileName: 'ci.yml',
					jobs: [
						{
							id: 'test',
							steps: [
								{ name: 'just a name, no action' },
								{ run: 'npm test' },
							],
						},
					],
					name: 'CI',
				},
			],
		}
		const output = renderResult(result)
		expect(output).not.toContain('just a name')
		expect(output).toContain('npm test')
	})

	test('shows job name if different from id', () => {
		const result: EvaluationResult = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: [],
			event: 'push',
			matchedWorkflows: [
				{
					fileName: 'ci.yml',
					jobs: [
						{
							id: 'test',
							name: 'Run Tests',
							steps: [{ run: 'npm test' }],
						},
					],
					name: 'CI',
				},
			],
		}
		const output = renderResult(result)
		expect(output).toContain('Run Tests')
	})
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/render.test.ts`
Expected: FAIL — `renderResult` not found

- [ ] **Step 3: Commit**

```bash
git add test/render.test.ts
git commit -m "Add render layer tests (red)"
```

### Task 11: Implement render layer

**Files:**
- Create: `src/render.ts`

- [ ] **Step 1: Implement renderResult**

```ts
import { colorize } from 'consola/utils'
import type { EvaluationResult } from './types.ts'

export function renderResult(result: EvaluationResult): string {
	if (result.matchedWorkflows.length === 0) {
		return colorize(
			'yellow',
			`No workflows would be triggered by ${result.event} on ${result.branch}`
		)
	}

	const lines: string[] = []

	for (const workflow of result.matchedWorkflows) {
		const header = workflow.name
			? `${workflow.fileName} (${workflow.name}):`
			: `${workflow.fileName}:`
		lines.push(colorize('bold', header))

		for (const job of workflow.jobs) {
			const jobLabel =
				job.name && job.name !== job.id
					? `${job.id} (${job.name}):`
					: `${job.id}:`
			lines.push(`  ${colorize('cyan', jobLabel)}`)

			for (const step of job.steps) {
				if (step.run) {
					lines.push(`    - ${step.run}`)
				} else if (step.uses) {
					lines.push(`    - ${colorize('dim', step.uses)}`)
				}
			}
		}

		lines.push('')
	}

	return lines.join('\n').trimEnd()
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun test test/render.test.ts`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `bun test`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/render.ts
git commit -m "Implement render layer"
```

---

## Chunk 5: CLI Integration

### Task 12: Wire up CLI with citty

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Update cli.ts**

Replace the entire contents of `src/cli.ts`:

```ts
#!/usr/bin/env bun

import { defineCommand, runMain } from 'citty'
import pkg from '../package.json' with { type: 'json' }
import { evaluate } from './evaluate.ts'
import { getGitState } from './git-state.ts'
import { parseWorkflowsFromDir } from './parse.ts'
import { renderResult } from './render.ts'

const main = defineCommand({
	meta: {
		description:
			'Determine which GitHub Actions workflows would trigger given the current git state',
		name: 'cya',
		version: pkg.version,
	},
	args: {
		base: {
			default: 'main',
			description: 'Base branch for comparison',
			type: 'string',
		},
		event: {
			default: 'pull_request',
			description:
				'Simulate event type: push, pull_request, workflow_dispatch',
			type: 'string',
		},
	},
	async run({ args }) {
		const event = args.event as 'push' | 'pull_request' | 'workflow_dispatch'
		const cwd = process.cwd()
		const workflowsDir = `${cwd}/.github/workflows`

		const workflows = await parseWorkflowsFromDir(workflowsDir)
		const gitState = await getGitState({ baseBranch: args.base, cwd, event })
		const result = evaluate(workflows, gitState)
		console.log(renderResult(result))
	},
})

runMain(main)
```

- [ ] **Step 2: Add version field to package.json**

The CLI imports `version` from package.json. Add a version field:

Add `"version": "0.0.1"` to `package.json` (after `"name"`).

- [ ] **Step 3: Enable resolveJsonModule in tsconfig**

Add `"resolveJsonModule": true` to `compilerOptions` in `tsconfig.json`.

- [ ] **Step 4: Move CLI test to test/ and update it**

Delete `src/cli.test.ts` and create `test/cli.test.ts` with the new behavior:

```ts
import { test, expect } from 'bun:test'
import { $ } from 'bun'

test('cya --help shows usage', async () => {
	const result = await $`bun run src/cli.ts --help`.text()
	expect(result).toContain('cya')
	expect(result).toContain('--base')
	expect(result).toContain('--event')
})
```

- [ ] **Step 5: Run all tests**

Run: `bun test`
Expected: ALL PASS

- [ ] **Step 6: Run lint and typecheck**

Run: `bun run lint && bun run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git rm src/cli.test.ts
git add src/cli.ts test/cli.test.ts package.json tsconfig.json
git commit -m "Wire up CLI with citty, consola, and all layers"
```

### Task 13: Add integration test

**Files:**
- Create: `test/integration.test.ts`

- [ ] **Step 1: Write integration test**

This test runs `cya` against the project's own `.github/workflows/` directory.

```ts
import { describe, expect, test } from 'bun:test'
import { $ } from 'bun'

describe('cya integration', () => {
	test('reports workflows for current repo on pull_request', async () => {
		const result =
			await $`bun run src/cli.ts --base main --event pull_request`.text()
		// Our own publish.yml has a push trigger on main but no PR trigger,
		// so this tests that the tool runs without crashing and produces output
		expect(result).toBeDefined()
	})

	test('shows no-match message for workflow_dispatch without dispatch workflows', async () => {
		const result =
			await $`bun run src/cli.ts --event workflow_dispatch`.text()
		// Our repo has no workflow_dispatch workflows
		expect(result).toContain('No workflows would be triggered')
	})

	test('--help shows usage info', async () => {
		const result = await $`bun run src/cli.ts --help`.text()
		expect(result).toContain('--base')
		expect(result).toContain('--event')
	})
})
```

- [ ] **Step 2: Run all tests**

Run: `bun test`
Expected: ALL PASS

- [ ] **Step 3: Run full lint/typecheck/test suite**

Run: `bun run lint && bun run typecheck && bun test`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add test/integration.test.ts
git commit -m "Add integration test"
```
