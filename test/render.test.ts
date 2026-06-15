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
		expect(output).not.toContain('actions/checkout@v4')
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

	test('renders job-level if condition', () => {
		const result: EvaluationResult = {
			baseBranch: 'main',
			branch: 'main',
			changedFiles: ['src/index.ts'],
			event: 'push',
			matchedWorkflows: [
				{
					fileName: 'release.yml',
					jobs: [
						{
							id: 'publish',
							if: "startsWith(github.ref, 'refs/tags/v')",
							steps: [{ run: 'npm publish' }],
						},
					],
					name: 'Release',
				},
			],
		}
		const output = renderResult(result)
		expect(output).toContain("if: startsWith(github.ref, 'refs/tags/v')")
	})

	test('renders reusable workflow job with uses reference', () => {
		const result: EvaluationResult = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: [],
			event: 'pull_request',
			matchedWorkflows: [
				{
					fileName: 'build.yml',
					jobs: [
						{
							id: 'lint',
							steps: [],
							uses: './.github/workflows/reusable-lint.yml',
						},
					],
					name: 'Build',
				},
			],
		}
		const output = renderResult(result)
		expect(output).toContain('reusable-lint.yml')
	})

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
							steps: [{ run: 'echo "hello"\necho "world"' }],
						},
					],
					name: 'CI',
				},
			],
		}
		const output = renderResult(result)
		const lines = output.split('\n')
		const runLineIndex = lines.findIndex(l => l.includes('echo "hello"'))
		expect(runLineIndex).toBeGreaterThan(-1)
		expect(lines[runLineIndex + 1]).toContain('echo "world"')
		expect(lines[runLineIndex + 1]!.startsWith('      ')).toBe(true)
	})

	test('renders multiple matched workflows', () => {
		const result: EvaluationResult = {
			baseBranch: 'main',
			branch: 'main',
			changedFiles: ['src/index.ts'],
			event: 'push',
			matchedWorkflows: [
				{
					fileName: 'ci.yml',
					jobs: [{ id: 'test', steps: [{ run: 'npm test' }] }],
					name: 'CI',
				},
				{
					fileName: 'deploy.yml',
					jobs: [{ id: 'deploy', steps: [{ run: 'npm run deploy' }] }],
					name: 'Deploy',
				},
			],
		}
		const output = renderResult(result)
		expect(output).toContain('ci.yml')
		expect(output).toContain('deploy.yml')
		expect(output).toContain('npm test')
		expect(output).toContain('npm run deploy')
	})

	test('summarizes skipped workflows without rendering skipped jobs by default', () => {
		const result: EvaluationResult = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['yarn.lock'],
			event: 'pull_request',
			matchedWorkflows: [
				{
					fileName: 'ios.yml',
					jobs: [
						{
							id: 'build',
							if: "needs.changes.outputs.should_run == 'true'",
							prediction: {
								reason: 'if condition evaluated false',
								status: 'will_skip',
							},
							steps: [],
							uses: './.github/workflows/ios-build-debug.yml',
						},
					],
				},
			],
		}

		const output = renderResult(result)
		expect(output).toContain('No actionable jobs')
		expect(output).toContain('Skipped by guards')
		expect(output).toContain('if condition evaluated false')
		expect(output).not.toContain('[skip]')
		expect(output).not.toContain('ios-build-debug.yml')
	})

	test('renders unknown jobs without their commands', () => {
		const result: EvaluationResult = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['yarn.lock'],
			event: 'pull_request',
			matchedWorkflows: [
				{
					fileName: 'ios.yml',
					jobs: [
						{
							id: 'build',
							prediction: {
								reason: 'dependency changes has unknown result',
								status: 'unknown',
							},
							steps: [{ run: 'yarn build:ios' }],
						},
					],
				},
			],
		}

		const output = renderResult(result)
		expect(output).toContain('[unknown]')
		expect(output).toContain('dependency changes has unknown result')
		expect(output).not.toContain('yarn build:ios')
	})

	test('hides guard jobs without rendering their scripts by default', () => {
		const result: EvaluationResult = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['yarn.lock'],
			event: 'pull_request',
			matchedWorkflows: [
				{
					fileName: 'ios.yml',
					jobs: [
						{
							id: 'changes',
							outputs: { should_run: '${{ steps.affected.outputs.should_run }}' },
							prediction: {
								outputs: { should_run: 'false' },
								status: 'will_run',
							},
							steps: [{ run: 'npx turbo@2 query affected --packages' }],
						},
					],
				},
			],
		}

		const output = renderResult(result)
		expect(output).toContain('Skipped by guards')
		expect(output).toContain('should_run=false')
		expect(output).not.toContain('guard/output job')
		expect(output).not.toContain('npx turbo@2 query affected')
	})

	test('hides result jobs without rendering their scripts by default', () => {
		const result: EvaluationResult = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['yarn.lock'],
			event: 'pull_request',
			matchedWorkflows: [
				{
					fileName: 'ios.yml',
					jobs: [
						{
							id: 'result',
							if: 'always()',
							prediction: { status: 'will_run' },
							steps: [{ run: 'exit 1' }],
						},
					],
				},
			],
		}

		const output = renderResult(result)
		expect(output).toContain('No actionable jobs')
		expect(output).not.toContain('status aggregator')
		expect(output).not.toContain('exit 1')
	})

	test('renders skipped and bookkeeping jobs with all option', () => {
		const result: EvaluationResult = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['yarn.lock'],
			event: 'pull_request',
			matchedWorkflows: [
				{
					fileName: 'ios.yml',
					jobs: [
						{
							id: 'changes',
							outputs: { should_run: '${{ steps.affected.outputs.should_run }}' },
							prediction: {
								outputs: { should_run: 'false' },
								status: 'will_run',
							},
							steps: [{ run: 'npx turbo@2 query affected --packages' }],
						},
						{
							id: 'build',
							if: "needs.changes.outputs.should_run == 'true'",
							prediction: {
								reason: 'if condition evaluated false',
								status: 'will_skip',
							},
							steps: [],
							uses: './.github/workflows/ios-build-debug.yml',
						},
						{
							id: 'result',
							if: 'always()',
							prediction: { status: 'will_run' },
							steps: [{ run: 'exit 1' }],
						},
					],
				},
			],
		}

		const output = renderResult(result, { all: true })
		expect(output).toContain('[skip]')
		expect(output).toContain('guard/output job')
		expect(output).toContain('status aggregator')
		expect(output).not.toContain('ios-build-debug.yml')
		expect(output).not.toContain('exit 1')
	})

	test('renders step-level uses with all option', () => {
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
							steps: [{ uses: 'actions/checkout@v4' }, { run: 'npm test' }],
						},
					],
				},
			],
		}

		const output = renderResult(result, { all: true })
		expect(output).toContain('actions/checkout@v4')
		expect(output).toContain('npm test')
	})
})
