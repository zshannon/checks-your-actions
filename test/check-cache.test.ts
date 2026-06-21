import { $ } from 'bun'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
	applyCheckCache,
	buildCheckPlan,
	markChecksSucceeded,
	readLastPlan,
	writeLastPlan,
} from '../src/check-cache.ts'
import { renderResult } from '../src/render.ts'
import type { EvaluationResult } from '../src/types.ts'

const tempDirs: string[] = []

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true }))
	)
})

describe('check cache', () => {
	test('assigns short check ids and renders cached successes', async () => {
		const cwd = await createRepo()
		const first = resultWithJobs(['test'])
		const plan = await applyCheckCache(cwd, first)
		expect(plan.checks.map(check => check.checkId)).toEqual(['test'])
		expect(renderResult(first)).toContain('[test] test: [run]')

		await markChecksSucceeded(cwd, plan, plan.checks)

		const second = resultWithJobs(['test'])
		await applyCheckCache(cwd, second)
		const output = renderResult(second)
		expect(output).toContain('[test] test: [cached success]')
		expect(output).not.toContain('npm test')
	})

	test('invalidates cached success when changed file content changes', async () => {
		const cwd = await createRepo()
		const plan = await applyCheckCache(cwd, resultWithJobs(['test']))
		await markChecksSucceeded(cwd, plan, plan.checks)

		await Bun.write(join(cwd, 'src/index.ts'), 'changed')
		const result = resultWithJobs(['test'])
		await applyCheckCache(cwd, result)

		expect(renderResult(result)).toContain('[test] test: [run]')
	})

	test('uses workflow-qualified ids when job ids are duplicated', async () => {
		const cwd = await createRepo()
		const result: EvaluationResult = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['src/index.ts'],
			event: 'pull_request',
			matchedWorkflows: [
				{ fileName: 'ci.yml', jobs: [{ id: 'test', steps: [{ run: 'npm test' }] }] },
				{ fileName: 'web.yml', jobs: [{ id: 'test', steps: [{ run: 'npm test' }] }] },
			],
		}

		const plan = await buildCheckPlan(cwd, result)
		expect(plan.checks.map(check => check.checkId)).toEqual([
			'ci.yml:test',
			'web.yml:test',
		])
	})

	test('writes and reads the last plan', async () => {
		const cwd = await createRepo()
		const plan = await buildCheckPlan(cwd, resultWithJobs(['test']))
		await writeLastPlan(cwd, plan)

		const stored = await readLastPlan(cwd)
		expect(stored?.hash).toBe(plan.hash)
		expect(stored?.checks.map(check => check.checkId)).toEqual(['test'])
	})
})

async function createRepo(): Promise<string> {
	const cwd = await mkdtemp(join(tmpdir(), 'cya-cache-'))
	tempDirs.push(cwd)
	await mkdir(join(cwd, '.github/workflows'), { recursive: true })
	await mkdir(join(cwd, 'src'), { recursive: true })
	await Bun.write(join(cwd, '.github/workflows/ci.yml'), 'name: CI\non: pull_request\n')
	await Bun.write(join(cwd, '.github/workflows/web.yml'), 'name: Web\non: pull_request\n')
	await Bun.write(join(cwd, 'src/index.ts'), 'initial')
	await $`git -C ${cwd} init`.quiet()
	return cwd
}

function resultWithJobs(jobIds: string[]): EvaluationResult {
	return {
		baseBranch: 'main',
		branch: 'feature-x',
		changedFiles: ['src/index.ts'],
		event: 'pull_request',
		matchedWorkflows: [
			{
				fileName: 'ci.yml',
				jobs: jobIds.map(id => ({ id, steps: [{ run: `npm run ${id}` }] })),
			},
		],
	}
}
