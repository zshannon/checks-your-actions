import type { MatchedJob } from './types.ts'

export function isActionableJob(job: MatchedJob): boolean {
	const prediction = job.prediction ?? { status: 'will_run' as const }
	if (prediction.status === 'will_skip') {
		return false
	}
	if (prediction.status === 'unknown') {
		return true
	}
	return !isGuardJob(job) && !isResultJob(job)
}

export function isGuardJob(job: {
	id: string
	outputs?: Record<string, string>
	steps: { run?: string; uses?: string }[]
}): boolean {
	return (
		job.id === 'changes' ||
		Object.keys(job.outputs ?? {}).some(
			output => output === 'should_run' || output === 'run_all'
		) ||
		job.steps.some(
			step =>
				step.run?.includes('turbo@2 query affected') ||
				step.uses?.startsWith('dorny/paths-filter@')
		)
	)
}

export function isResultJob(job: { id: string; if?: string }): boolean {
	return job.id === 'result' && job.if === 'always()'
}
