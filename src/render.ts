import { colorize } from 'consola/utils'
import type { EvaluationResult } from './types.ts'

export function renderResult(result: EvaluationResult): string {
	if (result.matchedWorkflows.length === 0) {
		return colorize(
			'yellow',
			`No workflows would be triggered by ${result.event} on ${result.branch}`
		)
	}

	const lines: string[] = []

	for (const workflow of result.matchedWorkflows) {
		const header = workflow.name
			? `${workflow.fileName} (${workflow.name}):`
			: `${workflow.fileName}:`
		lines.push(colorize('bold', header))

		for (const job of workflow.jobs) {
			const jobLabel =
				job.name && job.name !== job.id ? `${job.id} (${job.name}):` : `${job.id}:`
			lines.push(`  ${colorize('cyan', jobLabel)}`)

			if (job.if) {
				lines.push(`    ${colorize('dim', `if: ${job.if}`)}`)
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
					} else if (step.uses) {
						lines.push(`    - ${colorize('dim', step.uses)}`)
					}
				}
			}
		}

		lines.push('')
	}

	return lines.join('\n').trimEnd()
}
