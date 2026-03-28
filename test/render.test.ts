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
					name: 'CI',
					jobs: [
						{ id: 'test', steps: [{ uses: 'actions/checkout@v4' }, { run: 'npm test' }] },
					],
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
				{ fileName: 'ci.yml', jobs: [{ id: 'test', steps: [{ run: 'npm test' }] }] },
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
					name: 'CI',
					jobs: [
						{
							id: 'test',
							steps: [{ name: 'just a name, no action' }, { run: 'npm test' }],
						},
					],
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
					name: 'CI',
					jobs: [{ id: 'test', name: 'Run Tests', steps: [{ run: 'npm test' }] }],
				},
			],
		}
		const output = renderResult(result)
		expect(output).toContain('Run Tests')
	})
})
