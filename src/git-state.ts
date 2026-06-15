import { $ } from 'bun'
import type { GitEvent, GitState, TurboAffectedPackage } from './types.ts'

export type GitRunner = {
	currentBranch: () => Promise<string>
	currentHeadRef?: () => Promise<string>
	diffBase: (baseBranch: string) => Promise<string[]>
	diffStaged: () => Promise<string[]>
	diffUnstaged: () => Promise<string[]>
	resolveBaseRef?: (baseBranch: string) => Promise<string>
	turboAffectedPackages?: (
		baseRef: string,
		headRef: string
	) => Promise<TurboAffectedPackage[] | undefined>
	untracked: () => Promise<string[]>
}

function splitLines(output: string): string[] {
	return output
		.trim()
		.split('\n')
		.filter(f => f.length > 0)
}

export function createBunGitRunner(cwd: string): GitRunner {
	async function resolveBaseRef(baseBranch: string): Promise<string> {
		const refExists = await $`git -C ${cwd} rev-parse --verify ${baseBranch}`
			.quiet()
			.nothrow()
		return refExists.exitCode === 0 ? baseBranch : `origin/${baseBranch}`
	}

	return {
		currentBranch: async () =>
			(await $`git -C ${cwd} rev-parse --abbrev-ref HEAD`.text()).trim(),
		currentHeadRef: async () =>
			(await $`git -C ${cwd} rev-parse HEAD`.text()).trim() || 'HEAD',
		diffBase: async baseBranch => {
			const ref = await resolveBaseRef(baseBranch)
			return splitLines(
				await $`git -C ${cwd} diff --name-only ${ref}...HEAD`.text().catch(() => '')
			)
		},
		diffStaged: async () =>
			splitLines(await $`git -C ${cwd} diff --name-only --cached`.text()),
		diffUnstaged: async () => splitLines(await $`git -C ${cwd} diff --name-only`.text()),
		resolveBaseRef,
		turboAffectedPackages: async (baseRef, headRef) => {
			const proc =
				await $`cd ${cwd} && npx turbo@2 query affected --packages --base ${baseRef} --head ${headRef}`
					.nothrow()
					.quiet()
			if (proc.exitCode !== 0) {
				return undefined
			}
			try {
				const parsed = JSON.parse(proc.stdout.toString()) as {
					data?: { affectedPackages?: { items?: TurboAffectedPackage[] } }
				}
				return parsed.data?.affectedPackages?.items
			} catch {
				return undefined
			}
		},
		untracked: async () =>
			splitLines(await $`git -C ${cwd} ls-files --others --exclude-standard`.text()),
	}
}

type GitStateOptions = {
	baseBranch?: string
	cwd?: string
	event?: GitEvent
	includeTurboAffectedPackages?: boolean
	runner?: GitRunner
}

export async function getGitState(options: GitStateOptions = {}): Promise<GitState> {
	const runner = options.runner ?? createBunGitRunner(options.cwd ?? process.cwd())
	const baseBranch = options.baseBranch ?? 'main'
	const event = options.event ?? 'pull_request'

	const branch = await runner.currentBranch()
	const baseRef = runner.resolveBaseRef
		? await runner.resolveBaseRef(baseBranch)
		: baseBranch
	const headRef = runner.currentHeadRef ? await runner.currentHeadRef() : 'HEAD'
	const committed = await runner.diffBase(baseBranch)
	const unstaged = await runner.diffUnstaged()
	const staged = await runner.diffStaged()
	const untracked = await runner.untracked()

	const changedFiles = [...new Set([...committed, ...unstaged, ...staged, ...untracked])]
	const turboAffectedPackages =
		options.includeTurboAffectedPackages && runner.turboAffectedPackages
			? await runner.turboAffectedPackages(baseRef, headRef)
			: undefined

	return {
		baseBranch,
		baseRef,
		branch,
		changedFiles,
		event,
		headRef,
		turboAffectedPackages,
	}
}
