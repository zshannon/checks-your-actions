import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { evaluate } from '../src/evaluate.ts'
import { parseWorkflowFile } from '../src/parse.ts'
import type { GitState, JobPrediction, MatchedJob } from '../src/types.ts'

const FIXTURES = join(import.meta.dir, 'fixtures')

async function evaluateFixture(fixture: string, state: GitState) {
	const workflow = await parseWorkflowFile(join(FIXTURES, fixture))
	expect(workflow).not.toBeNull()
	return evaluate([workflow!], state).matchedWorkflows[0]!
}

function prediction(job: MatchedJob): JobPrediction {
	expect(job.prediction).toBeDefined()
	return job.prediction!
}

describe('job prediction', () => {
	test('skips guarded turbo build when only yarn.lock wakes the workflow', async () => {
		const workflow = await evaluateFixture('turbo-guard.yml', {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['yarn.lock'],
			event: 'pull_request',
			turboAffectedPackages: [{ name: '@flickfyi/core', path: 'packages/core' }],
		})

		const changes = workflow.jobs.find(job => job.id === 'changes')!
		const build = workflow.jobs.find(job => job.id === 'build')!
		const result = workflow.jobs.find(job => job.id === 'result')!

		expect(prediction(changes).status).toBe('will_run')
		expect(prediction(changes).outputs).toEqual({ should_run: 'false' })
		expect(prediction(build).status).toBe('will_skip')
		expect(prediction(build).reason).toContain('if condition evaluated false')
		expect(prediction(result).status).toBe('will_run')
	})

	test('runs guarded turbo build when an affected package matches the predicate', async () => {
		const workflow = await evaluateFixture('turbo-guard.yml', {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['yarn.lock'],
			event: 'pull_request',
			turboAffectedPackages: [{ name: '@flickfyi/photon', path: 'swift/Photon' }],
		})

		const build = workflow.jobs.find(job => job.id === 'build')!
		expect(prediction(build).status).toBe('will_run')
	})

	test('runs guarded turbo build when a config path matches the guard', async () => {
		const workflow = await evaluateFixture('turbo-guard.yml', {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['.github/workflows/ios-build-debug.yml'],
			event: 'pull_request',
			turboAffectedPackages: [],
		})

		const changes = workflow.jobs.find(job => job.id === 'changes')!
		const build = workflow.jobs.find(job => job.id === 'build')!

		expect(prediction(changes).outputs).toEqual({ should_run: 'true' })
		expect(prediction(build).status).toBe('will_run')
	})

	test('marks guarded turbo build unknown when affected package data is unavailable', async () => {
		const workflow = await evaluateFixture('turbo-guard.yml', {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['yarn.lock'],
			event: 'pull_request',
		})

		const changes = workflow.jobs.find(job => job.id === 'changes')!
		const build = workflow.jobs.find(job => job.id === 'build')!

		expect(prediction(changes).status).toBe('will_run')
		expect(prediction(changes).outputs).toEqual({})
		expect(prediction(build).status).toBe('unknown')
		expect(prediction(build).reason).toContain('needs.changes.outputs.should_run')
	})

	test('evaluates dorny paths-filter outputs used by dependent jobs', async () => {
		const workflow = await evaluateFixture('complex-ci.yml', {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['src/index.ts'],
			event: 'pull_request',
		})

		const changes = workflow.jobs.find(job => job.id === 'changes')!
		const testJob = workflow.jobs.find(job => job.id === 'test')!

		expect(prediction(changes).outputs).toEqual({ src: 'true' })
		expect(prediction(testJob).status).toBe('will_run')
	})
})
