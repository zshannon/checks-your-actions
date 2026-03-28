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
		diffBase: async baseBranch =>
			splitLines(
				await $`git -C ${cwd} diff --name-only ${baseBranch}...HEAD`
					.text()
					.catch(() => '')
			),
		diffStaged: async () =>
			splitLines(await $`git -C ${cwd} diff --name-only --cached`.text()),
		diffUnstaged: async () => splitLines(await $`git -C ${cwd} diff --name-only`.text()),
		untracked: async () =>
			splitLines(await $`git -C ${cwd} ls-files --others --exclude-standard`.text()),
	}
}

type GitStateOptions = {
	baseBranch?: string
	cwd?: string
	event?: GitEvent
	runner?: GitRunner
}

export async function getGitState(options: GitStateOptions = {}): Promise<GitState> {
	const runner = options.runner ?? createBunGitRunner(options.cwd ?? process.cwd())
	const baseBranch = options.baseBranch ?? 'main'
	const event = options.event ?? 'pull_request'

	const branch = await runner.currentBranch()
	const committed = await runner.diffBase(baseBranch)
	const unstaged = await runner.diffUnstaged()
	const staged = await runner.diffStaged()
	const untracked = await runner.untracked()

	const changedFiles = [...new Set([...committed, ...unstaged, ...staged, ...untracked])]

	return { baseBranch, branch, changedFiles, event }
}
