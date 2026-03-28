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
	jobs: [{ id: 'deploy', runsOn: 'ubuntu-latest', steps: [{ run: 'npm run deploy' }] }],
	name: 'Deploy',
	on: { push: { branches: ['main', 'release/*'] } },
}

const pathsWorkflow: Workflow = {
	fileName: 'docs.yml',
	jobs: [
		{ id: 'build-docs', runsOn: 'ubuntu-latest', steps: [{ run: 'npm run build:docs' }] },
	],
	name: 'Docs',
	on: { push: { paths: ['docs/**', '*.md'] } },
}

const pathsIgnoreWorkflow: Workflow = {
	fileName: 'test.yml',
	jobs: [{ id: 'test', runsOn: 'ubuntu-latest', steps: [{ run: 'npm test' }] }],
	name: 'Test',
	on: { push: { pathsIgnore: ['docs/**', '*.md'] } },
}

const prWorkflow: Workflow = {
	fileName: 'pr.yml',
	jobs: [{ id: 'test', runsOn: 'ubuntu-latest', steps: [{ run: 'npm test' }] }],
	name: 'PR Test',
	on: { pullRequest: { branches: ['main'] } },
}

const dispatchWorkflow: Workflow = {
	fileName: 'manual.yml',
	jobs: [{ id: 'deploy', runsOn: 'ubuntu-latest', steps: [{ run: 'npm run deploy' }] }],
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
			branch: 'feature-x',
			changedFiles: ['src/index.ts'],
			event: 'pull_request',
		}
		const result = evaluate([basicWorkflow], state)
		expect(result.matchedWorkflows).toHaveLength(0)
	})

	test('includes all jobs from matched workflow', () => {
		const multiJobWorkflow: Workflow = {
			fileName: 'multi.yml',
			jobs: [
				{ id: 'build', runsOn: 'ubuntu-latest', steps: [{ run: 'npm run build' }] },
				{
					id: 'test',
					needs: ['build'],
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
		expect(result.matchedWorkflows).toHaveLength(1)
		expect(result.matchedWorkflows[0].jobs).toHaveLength(2)
		expect(result.matchedWorkflows[0].jobs[1].needs).toEqual(['build'])
	})

	test('matches branches-ignore when branch is not ignored', () => {
		const branchesIgnoreWorkflow: Workflow = {
			fileName: 'ignore.yml',
			jobs: [{ id: 'test', runsOn: 'ubuntu-latest', steps: [{ run: 'npm test' }] }],
			name: 'Ignore',
			on: { push: { branchesIgnore: ['docs/*', 'dependabot/*'] } },
		}
		const state: GitState = {
			baseBranch: 'main',
			branch: 'feature-x',
			changedFiles: ['src/index.ts'],
			event: 'push',
		}
		const result = evaluate([branchesIgnoreWorkflow], state)
		expect(result.matchedWorkflows).toHaveLength(1)
	})

	test('skips branches-ignore when branch is ignored', () => {
		const branchesIgnoreWorkflow: Workflow = {
			fileName: 'ignore.yml',
			jobs: [{ id: 'test', runsOn: 'ubuntu-latest', steps: [{ run: 'npm test' }] }],
			name: 'Ignore',
			on: { push: { branchesIgnore: ['docs/*', 'dependabot/*'] } },
		}
		const state: GitState = {
			baseBranch: 'main',
			branch: 'dependabot/npm-updates',
			changedFiles: ['package.json'],
			event: 'push',
		}
		const result = evaluate([branchesIgnoreWorkflow], state)
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
