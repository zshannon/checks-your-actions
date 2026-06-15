import { colorize } from 'consola/utils'
import type { EvaluationResult, MatchedJob, MatchedWorkflow } from './types.ts'

type RenderOptions = {
	all?: boolean
}

export function renderResult(
	result: EvaluationResult,
	options: RenderOptions = {}
): string {
	if (result.matchedWorkflows.length === 0) {
		return colorize(
			'yellow',
			`No workflows would be triggered by ${result.event} on ${result.branch}`
		)
	}

	return options.all ? renderAuditResult(result) : renderActionResult(result)
}

function renderActionResult(result: EvaluationResult): string {
	const lines: string[] = []
	const skippedSummaries: string[] = []

	for (const workflow of result.matchedWorkflows) {
		const jobs = workflow.jobs.filter(shouldRenderByDefault)
		if (jobs.length === 0) {
			const summary = renderSkippedWorkflowSummary(workflow)
			if (summary) {
				skippedSummaries.push(summary)
			}
			continue
		}

		const header = workflow.name
			? `${workflow.fileName} (${workflow.name}):`
			: `${workflow.fileName}:`
		lines.push(colorize('bold', header))

		for (const job of jobs) {
			renderJob(lines, job, { all: false })
		}

		lines.push('')
	}

	if (skippedSummaries.length > 0) {
		if (lines.length === 0) {
			lines.push(
				colorize('yellow', `No actionable jobs for ${result.event} on ${result.branch}`)
			)
		}
		lines.push(colorize('dim', 'Skipped by guards:'))
		for (const summary of skippedSummaries) {
			lines.push(`  ${colorize('dim', summary)}`)
		}
	}

	return lines.join('\n').trimEnd()
}

function renderAuditResult(result: EvaluationResult): string {
	const lines: string[] = []

	for (const workflow of result.matchedWorkflows) {
		const header = workflow.name
			? `${workflow.fileName} (${workflow.name}):`
			: `${workflow.fileName}:`
		lines.push(colorize('bold', header))

		for (const job of workflow.jobs) {
			renderJob(lines, job, { all: true })
		}

		lines.push('')
	}

	return lines.join('\n').trimEnd()
}

function renderJob(lines: string[], job: MatchedJob, options: RenderOptions): void {
	const prediction = job.prediction ?? { status: 'will_run' as const }
	const jobLabel =
		job.name && job.name !== job.id ? `${job.id} (${job.name}):` : `${job.id}:`
	lines.push(`  ${colorize('cyan', jobLabel)} ${renderStatus(prediction.status)}`)

	if (job.if) {
		lines.push(`    ${colorize('dim', `if: ${job.if}`)}`)
	}

	if (prediction.reason) {
		lines.push(`    ${colorize('dim', prediction.reason)}`)
	}

	const outputSummary = renderOutputs(prediction.outputs)
	if (outputSummary) {
		lines.push(`    ${colorize('dim', outputSummary)}`)
	}

	if (prediction.status !== 'will_run') {
		return
	}

	if (isGuardJob(job)) {
		if (options.all) {
			lines.push(`    ${colorize('dim', 'guard/output job')}`)
		}
		return
	}

	if (isResultJob(job)) {
		if (options.all) {
			lines.push(`    ${colorize('dim', 'status aggregator')}`)
		}
		return
	}

	if (job.uses) {
		lines.push(`    ${colorize('dim', `→ ${job.uses}`)}`)
	} else {
		for (const step of job.steps) {
			if (step.run) {
				const runLines = step.run.split('\n').filter(l => l.trim().length > 0)
				if (runLines.length > 0) {
					lines.push(`    - ${runLines[0]}`)
					for (const continuation of runLines.slice(1)) {
						lines.push(`      ${continuation}`)
					}
				}
			} else if (step.uses && options.all) {
				lines.push(`    - ${colorize('dim', step.uses)}`)
			}
		}
	}
}

function shouldRenderByDefault(job: MatchedJob): boolean {
	const prediction = job.prediction ?? { status: 'will_run' as const }
	if (prediction.status === 'will_skip') {
		return false
	}
	if (prediction.status === 'unknown') {
		return true
	}
	return !isGuardJob(job) && !isResultJob(job)
}

function renderStatus(status: 'unknown' | 'will_run' | 'will_skip'): string {
	switch (status) {
		case 'will_run':
			return colorize('green', '[run]')
		case 'will_skip':
			return colorize('yellow', '[skip]')
		case 'unknown':
			return colorize('magenta', '[unknown]')
	}
}

function isGuardJob(job: {
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

function isResultJob(job: { id: string; if?: string }): boolean {
	return job.id === 'result' && job.if === 'always()'
}

function renderSkippedWorkflowSummary(workflow: MatchedWorkflow): string | undefined {
	const label = workflow.name
		? `${workflow.fileName} (${workflow.name})`
		: workflow.fileName
	const guardOutput = workflow.jobs
		.map(job => job.prediction?.outputs)
		.find(outputs => outputs?.should_run === 'false' || outputs?.run_all === 'false')
	if (guardOutput) {
		return `${label}: ${Object.entries(guardOutput)
			.filter(([key]) => key === 'should_run' || key === 'run_all')
			.map(([key, value]) => `${key}=${value}`)
			.join(', ')}`
	}

	const skippedJob = workflow.jobs.find(
		job => job.prediction?.status === 'will_skip' && job.prediction.reason
	)
	if (skippedJob?.prediction?.reason) {
		return `${label}: ${skippedJob.prediction.reason}`
	}

	if (workflow.jobs.every(job => isGuardJob(job) || isResultJob(job))) {
		return `${label}: no actionable jobs`
	}

	return undefined
}

function renderOutputs(outputs: Record<string, string> | undefined): string | undefined {
	if (!outputs || Object.keys(outputs).length === 0) {
		return undefined
	}
	return `outputs: ${Object.entries(outputs)
		.map(([key, value]) => `${key}=${value}`)
		.join(', ')}`
}
