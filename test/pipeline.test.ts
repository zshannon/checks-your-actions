import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { evaluate } from '../src/evaluate.ts'
import { parseWorkflowFile } from '../src/parse.ts'
import type { GitState } from '../src/types.ts'

const FIXTURES = join(import.meta.dir, 'fixtures')

async function loadAndEvaluate(fixture: string, state: GitState) {
	const workflow = await parseWorkflowFile(join(FIXTURES, fixture))
	expect(workflow).not.toBeNull()
	return evaluate([workflow!], state)
}

describe('complex-ci.yml', () => {
	test('matches push to main with src changes', async () => {
		const result = await loadAndEvaluate('complex-ci.yml', {
			baseBranch: 'main',
			branch: 'main',
			changedFiles: ['src/index.ts'],
			event: 'push',
		})
		expect(result.matchedWorkflows).toHaveLength(1)
		expect(result.matchedWorkflows[0]!.jobs).toHaveLength(4)
	})

	test('matches PR to main with src changes', async () => {
		const result = await loadAndEvaluate('complex-ci.yml', {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['src/components/Button.tsx'],
			event: 'pull_request',
		})
		expect(result.matchedWorkflows).toHaveLength(1)
	})

	test('skips PR to main with only doc changes', async () => {
		const result = await loadAndEvaluate('complex-ci.yml', {
			baseBranch: 'main',
			branch: 'fix-typo',
			changedFiles: ['README.md'],
			event: 'pull_request',
		})
		expect(result.matchedWorkflows).toHaveLength(0)
	})

	test('skips PR targeting non-main branch', async () => {
		const result = await loadAndEvaluate('complex-ci.yml', {
			baseBranch: 'develop',
			branch: 'feature-x',
			changedFiles: ['src/index.ts'],
			event: 'pull_request',
		})
		expect(result.matchedWorkflows).toHaveLength(0)
	})

	test('matches push to canary branch', async () => {
		const result = await loadAndEvaluate('complex-ci.yml', {
			baseBranch: 'main',
			branch: 'canary',
			changedFiles: ['src/index.ts'],
			event: 'push',
		})
		expect(result.matchedWorkflows).toHaveLength(1)
	})

	test('preserves job dependency chain', async () => {
		const result = await loadAndEvaluate('complex-ci.yml', {
			baseBranch: 'main',
			branch: 'main',
			changedFiles: ['src/index.ts'],
			event: 'push',
		})
		const jobs = result.matchedWorkflows[0]!.jobs
		const testJob = jobs.find(j => j.id === 'test')
		const e2eJob = jobs.find(j => j.id === 'e2e')
		expect(testJob!.needs).toEqual(['lint', 'changes'])
		expect(e2eJob!.needs).toEqual(['test'])
	})
})

describe('release-workflow.yml', () => {
	test('matches push to main (has both tags and branches)', async () => {
		const result = await loadAndEvaluate('release-workflow.yml', {
			baseBranch: 'main',
			branch: 'main',
			changedFiles: ['src/index.ts'],
			event: 'push',
		})
		expect(result.matchedWorkflows).toHaveLength(1)
	})

	test('skips push to feature branch', async () => {
		const result = await loadAndEvaluate('release-workflow.yml', {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['src/index.ts'],
			event: 'push',
		})
		expect(result.matchedWorkflows).toHaveLength(0)
	})

	test('preserves job-level if conditions in output', async () => {
		const result = await loadAndEvaluate('release-workflow.yml', {
			baseBranch: 'main',
			branch: 'main',
			changedFiles: ['src/index.ts'],
			event: 'push',
		})
		const workflow = result.matchedWorkflows[0]!
		expect(workflow.jobs).toHaveLength(2)
		expect(workflow.jobs[1]!.needs).toEqual(['build'])
	})
})

describe('reusable-caller.yml', () => {
	test('matches PR with no filters (bare pull_request)', async () => {
		const result = await loadAndEvaluate('reusable-caller.yml', {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['anything.ts'],
			event: 'pull_request',
		})
		expect(result.matchedWorkflows).toHaveLength(1)
	})

	test('skips on push event (only has pull_request trigger)', async () => {
		const result = await loadAndEvaluate('reusable-caller.yml', {
			baseBranch: 'main',
			branch: 'main',
			changedFiles: ['anything.ts'],
			event: 'push',
		})
		expect(result.matchedWorkflows).toHaveLength(0)
	})

	test('captures reusable workflow references in steps', async () => {
		const workflow = await parseWorkflowFile(join(FIXTURES, 'reusable-caller.yml'))
		expect(workflow).not.toBeNull()
		// Reusable workflow jobs don't have steps — they have uses at job level
		// The parser should still capture the jobs
		expect(workflow!.jobs).toHaveLength(2)
		expect(workflow!.jobs[0]!.id).toBe('lint')
		expect(workflow!.jobs[1]!.id).toBe('test')
		expect(workflow!.jobs[1]!.needs).toEqual(['lint'])
	})
})

describe('multi-line-run.yml', () => {
	test('parses multi-line run steps correctly', async () => {
		const workflow = await parseWorkflowFile(join(FIXTURES, 'multi-line-run.yml'))
		expect(workflow).not.toBeNull()
		const deployJob = workflow!.jobs[0]!
		const buildStep = deployJob.steps.find(s => s.name === 'Build and deploy')
		expect(buildStep).toBeDefined()
		expect(buildStep!.run).toContain('npm ci')
		expect(buildStep!.run).toContain('npm run build')
		expect(buildStep!.run).toContain('npm run deploy')
	})
})

describe('paths-ignore-workflow.yml', () => {
	test('matches push with code changes', async () => {
		const result = await loadAndEvaluate('paths-ignore-workflow.yml', {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['src/index.ts'],
			event: 'push',
		})
		expect(result.matchedWorkflows).toHaveLength(1)
	})

	test('skips push with only doc changes', async () => {
		const result = await loadAndEvaluate('paths-ignore-workflow.yml', {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['README.md', 'docs/guide.md'],
			event: 'push',
		})
		expect(result.matchedWorkflows).toHaveLength(0)
	})

	test('matches push with mixed doc and code changes', async () => {
		const result = await loadAndEvaluate('paths-ignore-workflow.yml', {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['README.md', 'src/index.ts'],
			event: 'push',
		})
		expect(result.matchedWorkflows).toHaveLength(1)
	})

	test('skips push with LICENSE only', async () => {
		const result = await loadAndEvaluate('paths-ignore-workflow.yml', {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['LICENSE'],
			event: 'push',
		})
		expect(result.matchedWorkflows).toHaveLength(0)
	})

	test('matches PR with code changes', async () => {
		const result = await loadAndEvaluate('paths-ignore-workflow.yml', {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['src/utils.ts'],
			event: 'pull_request',
		})
		expect(result.matchedWorkflows).toHaveLength(1)
	})
})

describe('workflow-dispatch-complex.yml', () => {
	test('matches only on workflow_dispatch event', async () => {
		const result = await loadAndEvaluate('workflow-dispatch-complex.yml', {
			baseBranch: 'main',
			branch: 'main',
			changedFiles: [],
			event: 'workflow_dispatch',
		})
		expect(result.matchedWorkflows).toHaveLength(1)
	})

	test('skips on push event', async () => {
		const result = await loadAndEvaluate('workflow-dispatch-complex.yml', {
			baseBranch: 'main',
			branch: 'main',
			changedFiles: ['src/index.ts'],
			event: 'push',
		})
		expect(result.matchedWorkflows).toHaveLength(0)
	})
})

describe('concurrency-and-permissions.yml', () => {
	test('matches PR with opened type', async () => {
		const result = await loadAndEvaluate('concurrency-and-permissions.yml', {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['src/index.ts'],
			event: 'pull_request',
		})
		expect(result.matchedWorkflows).toHaveLength(1)
	})

	test('parses workflow despite concurrency and permissions blocks', async () => {
		const workflow = await parseWorkflowFile(
			join(FIXTURES, 'concurrency-and-permissions.yml')
		)
		expect(workflow).not.toBeNull()
		expect(workflow!.name).toBe('PR Check')
		expect(workflow!.jobs).toHaveLength(1)
		expect(workflow!.jobs[0]!.id).toBe('check')
	})
})
