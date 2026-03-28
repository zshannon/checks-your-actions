# CYA Bugfix Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 correctness bugs found in code review and close all test coverage gaps.

**Architecture:** Each bug is fixed independently with TDD — failing test first, then minimal fix, then verify. Bugs are ordered by dependency: types first, then parse, evaluate, render, CLI.

**Tech Stack:** Bun, TypeScript, picomatch, yaml, consola

**Spec:** `docs/superpowers/specs/2026-03-28-cya-bugfix-design.md`

**Note:** After writing any source/test file, run `bun run format` before committing. Run `bun test` after each implementation step to confirm no regressions.

---

## File Structure

```
Modified:
  src/types.ts         — Add tags, tagsIgnore to WorkflowTrigger
  src/parse.ts         — Normalize shorthand on:; extract tags; handle missing dir
  src/evaluate.ts      — Skip tag-only push; fix empty changedFiles + pathsIgnore
  src/render.ts        — Handle multi-line run steps
  src/cli.ts           — Validate --event; handle empty workflows
  test/parse.test.ts   — Add shorthand, tags, branches-ignore, needs-string, missing dir tests
  test/evaluate.test.ts — Add tag-only, empty changedFiles, mutual exclusivity tests
  test/render.test.ts  — Add multi-line run test
  test/integration.test.ts — Add invalid event test

Created:
  test/fixtures/shorthand-string.yml
  test/fixtures/shorthand-array.yml
  test/fixtures/tags-only.yml
  test/fixtures/branches-ignore.yml
  test/fixtures/needs-string.yml

Deleted:
  test/cli.test.ts     — Duplicate of integration test
```

---

## Chunk 1: Types + Parse Fixes (Bugs 1, 2 partial, 5)

### Task 1: Add tags/tagsIgnore to WorkflowTrigger type

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add tags and tagsIgnore fields**

In `src/types.ts`, add `tags` and `tagsIgnore` to `WorkflowTrigger` (alphabetical order):

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

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "Add tags and tagsIgnore to WorkflowTrigger type"
```

### Task 2: Create new fixture files

**Files:**
- Create: `test/fixtures/shorthand-string.yml`
- Create: `test/fixtures/shorthand-array.yml`
- Create: `test/fixtures/tags-only.yml`
- Create: `test/fixtures/branches-ignore.yml`
- Create: `test/fixtures/needs-string.yml`

- [ ] **Step 1: Create shorthand-string.yml**

```yaml
name: Simple CI
on: push

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
```

- [ ] **Step 2: Create shorthand-array.yml**

```yaml
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
```

- [ ] **Step 3: Create tags-only.yml**

```yaml
name: Release
on:
  push:
    tags:
      - "v*"

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm publish
```

- [ ] **Step 4: Create branches-ignore.yml**

```yaml
name: CI
on:
  push:
    branches-ignore:
      - "dependabot/**"
    paths-ignore:
      - "docs/**"

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
```

- [ ] **Step 5: Create needs-string.yml**

```yaml
name: Pipeline
on:
  push:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: npm run build
  test:
    runs-on: ubuntu-latest
    needs: build
    steps:
      - run: npm test
```

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/
git commit -m "Add fixture files for shorthand, tags, branches-ignore, needs-string"
```

### Task 3: Write failing parse tests for Bug 1 (shorthand on:) and additional coverage

**Files:**
- Modify: `test/parse.test.ts`

- [ ] **Step 1: Add tests to the end of the `parseWorkflowFile` describe block**

Add these tests inside `describe('parseWorkflowFile', () => { ... })`, after the existing tests:

```ts
	test('parses shorthand string on: push', async () => {
		const workflow = await parseWorkflowFile(
			join(FIXTURES, 'shorthand-string.yml')
		)
		expect(workflow).not.toBeNull()
		expect(workflow!.name).toBe('Simple CI')
		expect(workflow!.on.push).toEqual({})
		expect(workflow!.on.pullRequest).toBeUndefined()
		expect(workflow!.jobs).toHaveLength(1)
		expect(workflow!.jobs[0]!.id).toBe('test')
		expect(workflow!.jobs[0]!.steps).toHaveLength(2)
	})

	test('parses shorthand array on: [push, pull_request]', async () => {
		const workflow = await parseWorkflowFile(
			join(FIXTURES, 'shorthand-array.yml')
		)
		expect(workflow).not.toBeNull()
		expect(workflow!.on.push).toEqual({})
		expect(workflow!.on.pullRequest).toEqual({})
		expect(workflow!.jobs).toHaveLength(1)
	})

	test('parses tags in push trigger', async () => {
		const workflow = await parseWorkflowFile(
			join(FIXTURES, 'tags-only.yml')
		)
		expect(workflow).not.toBeNull()
		expect(workflow!.on.push?.tags).toEqual(['v*'])
	})

	test('parses branches-ignore and paths-ignore', async () => {
		const workflow = await parseWorkflowFile(
			join(FIXTURES, 'branches-ignore.yml')
		)
		expect(workflow).not.toBeNull()
		expect(workflow!.on.push?.branchesIgnore).toEqual(['dependabot/**'])
		expect(workflow!.on.push?.pathsIgnore).toEqual(['docs/**'])
	})

	test('normalizes needs string to array', async () => {
		const workflow = await parseWorkflowFile(
			join(FIXTURES, 'needs-string.yml')
		)
		expect(workflow).not.toBeNull()
		expect(workflow!.jobs[1]!.needs).toEqual(['build'])
	})
```

- [ ] **Step 2: Add test for missing directory to `parseWorkflowsFromDir` describe block**

Add inside `describe('parseWorkflowsFromDir', () => { ... })`:

```ts
	test('returns empty array for nonexistent directory', async () => {
		const workflows = await parseWorkflowsFromDir('/tmp/nonexistent-dir-cya-test')
		expect(workflows).toEqual([])
	})
```

- [ ] **Step 3: Run tests to verify the new tests fail**

Run: `bun test test/parse.test.ts`
Expected: FAIL — shorthand tests return null, tags test missing tags field, missing dir throws

- [ ] **Step 4: Commit**

```bash
git add test/parse.test.ts
git commit -m "Add parse tests for shorthand on:, tags, branches-ignore, needs-string, missing dir (red)"
```

### Task 4: Fix parse.ts — normalize shorthand on:, extract tags, handle missing dir

**Files:**
- Modify: `src/parse.ts`

- [ ] **Step 1: Add tags/tags-ignore extraction to parseTrigger**

In `src/parse.ts`, inside `parseTrigger`, after the `types` check (line 28), add:

```ts
	if (Array.isArray(obj['tags'])) {
		trigger.tags = obj['tags']
	}
	if (Array.isArray(obj['tags-ignore'])) {
		trigger.tagsIgnore = obj['tags-ignore']
	}
```

- [ ] **Step 2: Add normalizeOn function before parseWorkflowFile**

Add this function before `parseWorkflowFile`:

```ts
function normalizeOn(
	raw: unknown
): Record<string, unknown> | null {
	if (typeof raw === 'string') {
		return { [raw]: {} }
	}
	if (Array.isArray(raw)) {
		return Object.fromEntries(
			raw.map(event => [String(event), {}])
		)
	}
	if (raw && typeof raw === 'object') {
		return raw as Record<string, unknown>
	}
	return null
}
```

- [ ] **Step 3: Update parseWorkflowFile to use normalizeOn**

Replace lines 64-67 (the `on` handling) in `parseWorkflowFile`:

```ts
		const on = normalizeOn(doc['on'])
		if (!on) {
			return null
		}
```

This replaces the old `const on = doc['on'] as Record<string, unknown> | undefined` cast.

- [ ] **Step 4: Wrap readdir in parseWorkflowsFromDir with try/catch**

Replace the `parseWorkflowsFromDir` function body:

```ts
export async function parseWorkflowsFromDir(
	dirPath: string
): Promise<Workflow[]> {
	let entries: string[]
	try {
		entries = await readdir(dirPath)
	} catch (error: unknown) {
		const code = (error as { code?: string }).code
		if (code === 'ENOENT' || code === 'ENOTDIR') {
			return []
		}
		throw error
	}
	const yamlFiles = entries.filter(
		f => f.endsWith('.yml') || f.endsWith('.yaml')
	)
	const results = await Promise.all(
		yamlFiles.map(f => parseWorkflowFile(join(dirPath, f)))
	)
	return results.filter((w): w is Workflow => w !== null)
}
```

- [ ] **Step 5: Run format**

Run: `bun run format`

- [ ] **Step 6: Run parse tests**

Run: `bun test test/parse.test.ts`
Expected: ALL PASS

- [ ] **Step 7: Run full suite**

Run: `bun test && bun run lint && bun run typecheck`
Expected: ALL PASS — no regressions

- [ ] **Step 8: Commit**

```bash
git add src/parse.ts
git commit -m "Fix shorthand on: syntax, extract tags, handle missing workflows dir"
```

---

## Chunk 2: Evaluate Fixes (Bugs 2, 3)

### Task 5: Write failing evaluate tests for Bugs 2 and 3

**Files:**
- Modify: `test/evaluate.test.ts`

- [ ] **Step 1: Add test fixtures and tests at the end of the describe block**

Add these inside `describe('evaluate', () => { ... })`:

```ts
	test('skips tag-only push workflow', () => {
		const tagOnlyWorkflow: Workflow = {
			fileName: 'release.yml',
			jobs: [
				{
					id: 'publish',
					runsOn: 'ubuntu-latest',
					steps: [{ run: 'npm publish' }],
				},
			],
			name: 'Release',
			on: { push: { tags: ['v*'] } },
		}
		const state: GitState = {
			baseBranch: 'main',
			branch: 'main',
			changedFiles: ['src/index.ts'],
			event: 'push',
		}
		const result = evaluate([tagOnlyWorkflow], state)
		expect(result.matchedWorkflows).toHaveLength(0)
	})

	test('skips tags-ignore-only push workflow', () => {
		const tagsIgnoreWorkflow: Workflow = {
			fileName: 'release.yml',
			jobs: [
				{
					id: 'publish',
					runsOn: 'ubuntu-latest',
					steps: [{ run: 'npm publish' }],
				},
			],
			name: 'Release',
			on: { push: { tagsIgnore: ['beta*'] } },
		}
		const state: GitState = {
			baseBranch: 'main',
			branch: 'main',
			changedFiles: ['src/index.ts'],
			event: 'push',
		}
		const result = evaluate([tagsIgnoreWorkflow], state)
		expect(result.matchedWorkflows).toHaveLength(0)
	})

	test('workflow with tags AND branches uses branch filter', () => {
		const mixedWorkflow: Workflow = {
			fileName: 'mixed.yml',
			jobs: [
				{
					id: 'test',
					runsOn: 'ubuntu-latest',
					steps: [{ run: 'npm test' }],
				},
			],
			name: 'Mixed',
			on: {
				push: { branches: ['main'], tags: ['v*'] },
			},
		}
		const stateOnMain: GitState = {
			baseBranch: 'main',
			branch: 'main',
			changedFiles: ['src/index.ts'],
			event: 'push',
		}
		const stateOnFeature: GitState = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['src/index.ts'],
			event: 'push',
		}
		expect(evaluate([mixedWorkflow], stateOnMain).matchedWorkflows).toHaveLength(1)
		expect(evaluate([mixedWorkflow], stateOnFeature).matchedWorkflows).toHaveLength(0)
	})

	test('empty changedFiles with pathsIgnore runs workflow', () => {
		const state: GitState = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: [],
			event: 'push',
		}
		const result = evaluate([pathsIgnoreWorkflow], state)
		expect(result.matchedWorkflows).toHaveLength(1)
	})

	test('empty changedFiles with paths skips workflow', () => {
		const state: GitState = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: [],
			event: 'push',
		}
		const result = evaluate([pathsWorkflow], state)
		expect(result.matchedWorkflows).toHaveLength(0)
	})

	test('branches and branches-ignore mutual exclusivity skips workflow', () => {
		const mutualExclusiveWorkflow: Workflow = {
			fileName: 'bad.yml',
			jobs: [
				{
					id: 'test',
					runsOn: 'ubuntu-latest',
					steps: [{ run: 'npm test' }],
				},
			],
			name: 'Bad',
			on: {
				push: {
					branches: ['main'],
					branchesIgnore: ['develop'],
				},
			},
		}
		const state: GitState = {
			baseBranch: 'main',
			branch: 'main',
			changedFiles: ['src/index.ts'],
			event: 'push',
		}
		const result = evaluate([mutualExclusiveWorkflow], state)
		expect(result.matchedWorkflows).toHaveLength(0)
	})

	test('paths and paths-ignore mutual exclusivity skips workflow', () => {
		const mutualExclusiveWorkflow: Workflow = {
			fileName: 'bad.yml',
			jobs: [
				{
					id: 'test',
					runsOn: 'ubuntu-latest',
					steps: [{ run: 'npm test' }],
				},
			],
			name: 'Bad',
			on: {
				push: {
					paths: ['src/**'],
					pathsIgnore: ['docs/**'],
				},
			},
		}
		const state: GitState = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['src/index.ts'],
			event: 'push',
		}
		const result = evaluate([mutualExclusiveWorkflow], state)
		expect(result.matchedWorkflows).toHaveLength(0)
	})
```

- [ ] **Step 2: Run tests to verify the new tests fail**

Run: `bun test test/evaluate.test.ts`
Expected: FAIL — tag-only test expects 0 matches but gets 1; empty changedFiles + pathsIgnore expects 1 but gets 0

- [ ] **Step 3: Commit**

```bash
git add test/evaluate.test.ts
git commit -m "Add evaluate tests for tag-only, empty changedFiles, mutual exclusivity (red)"
```

### Task 6: Fix evaluate.ts — tag-only skip + empty changedFiles guard

**Files:**
- Modify: `src/evaluate.ts`

- [ ] **Step 1: Add tag-only detection in matchesTrigger**

In `src/evaluate.ts`, in `matchesTrigger`, after `if (!trigger) { return false }` (line 55-57), add:

```ts
	// Skip tag-only push workflows (we don't evaluate tag triggers)
	if (state.event === 'push') {
		const hasTagFilter = trigger.tags || trigger.tagsIgnore
		const hasBranchOrPathFilter =
			trigger.branches ||
			trigger.branchesIgnore ||
			trigger.paths ||
			trigger.pathsIgnore
		if (hasTagFilter && !hasBranchOrPathFilter) {
			console.warn(
				`Warning: ${workflow.fileName} has tag-only push trigger, skipping`
			)
			return false
		}
	}
```

- [ ] **Step 2: Add empty changedFiles guard in matchesPaths**

In `matchesPaths`, inside the `if (trigger.pathsIgnore)` block (line 39), add at the very beginning of the block, before the `every()` call:

```ts
		if (changedFiles.length === 0) {
			return true
		}
```

- [ ] **Step 3: Run format**

Run: `bun run format`

- [ ] **Step 4: Run evaluate tests**

Run: `bun test test/evaluate.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Run full suite**

Run: `bun test && bun run lint && bun run typecheck`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/evaluate.ts
git commit -m "Fix tag-only push false positive and empty changedFiles vacuous truth"
```

---

## Chunk 3: Render + CLI Fixes (Bugs 4, 6) and Cleanup

### Task 7: Write failing render test for Bug 6 (multi-line run)

**Files:**
- Modify: `test/render.test.ts`

- [ ] **Step 1: Add test at the end of the describe block**

```ts
	test('renders multi-line run steps with proper indentation', () => {
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
							name: 'Test',
							steps: [
								{
									run: 'echo "hello"\necho "world"',
								},
							],
						},
					],
					name: 'CI',
				},
			],
		}
		const output = renderResult(result)
		const lines = output.split('\n')
		const runLineIndex = lines.findIndex(l =>
			l.includes('echo "hello"')
		)
		expect(runLineIndex).toBeGreaterThan(-1)
		expect(lines[runLineIndex + 1]).toContain('echo "world"')
		// Continuation line should be indented
		expect(lines[runLineIndex + 1]!.startsWith('      ')).toBe(true)
	})
```

- [ ] **Step 2: Run tests to verify it fails**

Run: `bun test test/render.test.ts`
Expected: FAIL — continuation line not indented

- [ ] **Step 3: Commit**

```bash
git add test/render.test.ts
git commit -m "Add render test for multi-line run steps (red)"
```

### Task 8: Fix render.ts — multi-line run indentation

**Files:**
- Modify: `src/render.ts`

- [ ] **Step 1: Replace the run step rendering**

In `src/render.ts`, replace lines 25-27:

```ts
			for (const step of job.steps) {
				if (step.run) {
					lines.push(`    - ${step.run}`)
```

With:

```ts
			for (const step of job.steps) {
				if (step.run) {
					const runLines = step.run
						.split('\n')
						.filter(l => l.trim().length > 0)
					if (runLines.length > 0) {
						lines.push(`    - ${runLines[0]}`)
						for (const continuation of runLines.slice(1)) {
							lines.push(`      ${continuation}`)
						}
					}
```

- [ ] **Step 2: Run format**

Run: `bun run format`

- [ ] **Step 3: Run render tests**

Run: `bun test test/render.test.ts`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/render.ts
git commit -m "Fix multi-line run step rendering indentation"
```

### Task 9: Fix cli.ts — validate event + handle empty workflows

**Files:**
- Modify: `src/cli.ts`
- Modify: `test/integration.test.ts`
- Delete: `test/cli.test.ts`

- [ ] **Step 1: Add invalid event integration test**

In `test/integration.test.ts`, add inside the `describe` block:

```ts
	test('rejects invalid event type', async () => {
		const proc = await $`bun run src/cli.ts --event foobar`
			.nothrow()
			.quiet()
		expect(proc.exitCode).not.toBe(0)
		expect(proc.stderr.toString()).toContain('Invalid event type')
	})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/integration.test.ts`
Expected: FAIL — process exits 0 with no error

- [ ] **Step 3: Update cli.ts run function**

Replace the `async run({ args })` body in `src/cli.ts`:

```ts
	async run({ args }) {
		const validEvents = [
			'pull_request',
			'push',
			'workflow_dispatch',
		] as const
		type ValidEvent = (typeof validEvents)[number]
		if (!validEvents.includes(args.event as ValidEvent)) {
			console.error(
				`Invalid event type: "${args.event}". Must be one of: ${validEvents.join(', ')}`
			)
			process.exit(1)
		}
		const event = args.event as ValidEvent
		const cwd = process.cwd()
		const workflowsDir = `${cwd}/.github/workflows`

		const workflows = await parseWorkflowsFromDir(workflowsDir)
		if (workflows.length === 0) {
			console.log('No workflow files found in .github/workflows/')
			return
		}
		const gitState = await getGitState({
			baseBranch: args.base,
			cwd,
			event,
		})
		const result = evaluate(workflows, gitState)
		console.log(renderResult(result))
	},
```

- [ ] **Step 4: Delete cli.test.ts**

```bash
git rm test/cli.test.ts
```

- [ ] **Step 5: Run format**

Run: `bun run format`

- [ ] **Step 6: Run full suite**

Run: `bun test && bun run lint && bun run typecheck`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts test/integration.test.ts
git commit -m "Validate --event arg, handle empty workflows, delete duplicate cli test"
```

### Task 10: Final verification

- [ ] **Step 1: Run all tests**

Run: `bun test`
Expected: ALL PASS — should be ~55+ tests across 5 files

- [ ] **Step 2: Run lint and typecheck**

Run: `bun run lint && bun run typecheck`
Expected: PASS

- [ ] **Step 3: Run the CLI manually**

Run: `bun run src/cli.ts --base main --event push`
Expected: Shows publish.yml workflow

Run: `bun run src/cli.ts --event foobar`
Expected: Error message and non-zero exit

- [ ] **Step 4: Commit any remaining formatting changes**

If `bun run format` changed anything, commit it:

```bash
git add -u
git commit -m "Format cleanup"
```
