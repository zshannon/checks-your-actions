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
		const state = await getGitState({ baseBranch: 'develop', runner: mockRunner() })
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
		const state = await getGitState({ event: 'push', runner: mockRunner() })
		expect(state.event).toBe('push')
	})

	test('collects committed diff files', async () => {
		const runner = mockRunner({ diffBase: async () => ['src/index.ts', 'lib/utils.ts'] })
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
		const count = state.changedFiles.filter(f => f === 'src/index.ts').length
		expect(count).toBe(1)
	})

	test('passes baseBranch to diffBase runner', async () => {
		let receivedBase = ''
		const runner = mockRunner({
			diffBase: async base => {
				receivedBase = base
				return []
			},
		})
		await getGitState({ baseBranch: 'develop', runner })
		expect(receivedBase).toBe('develop')
	})
})
