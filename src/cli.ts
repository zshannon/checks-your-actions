#!/usr/bin/env bun

import { defineCommand, renderUsage, runMain, type ArgsDef, type CommandDef } from 'citty'
import pkg from '../package.json' with { type: 'json' }
import {
	applyCheckCache,
	buildCheckPlan,
	markChecksSucceeded,
	readLastPlan,
	writeLastPlan,
	type CheckPlan,
	type CheckPlanEntry,
} from './check-cache.ts'
import { evaluate } from './evaluate.ts'
import { getGitState } from './git-state.ts'
import { parseWorkflowsFromDir } from './parse.ts'
import { renderResult } from './render.ts'
import type { EvaluationResult, GitEvent } from './types.ts'

const validEvents = ['pull_request', 'push', 'workflow_dispatch'] as const

type LoadEvaluationOptions = {
	baseBranch: string
	cwd: string
	event: GitEvent
}

const main = defineCommand({
	meta: {
		description:
			'Determine which GitHub Actions workflows and jobs would run given the current git state',
		name: 'cya',
		version: pkg.version,
	},
	args: {
		all: {
			default: false,
			description: 'Show skipped and bookkeeping jobs',
			type: 'boolean',
		},
		base: {
			default: 'main',
			description: 'Base branch for comparison',
			type: 'string',
		},
		event: {
			default: 'pull_request',
			description: 'Simulate event type: push, pull_request, workflow_dispatch',
			type: 'string',
		},
	},
	async run({ args }) {
		if (args._[0] === 'ok') {
			await runOk(args._[1], args.all)
			return
		}
		if (args._.length > 0) {
			fail(`Unknown command: ${args._[0]}`)
		}

		const event = parseEvent(args.event)
		const cwd = process.cwd()
		const result = await loadEvaluation({ baseBranch: args.base, cwd, event })
		if (!result) {
			console.log('No workflow files found in .github/workflows/')
			return
		}

		const plan = await applyCheckCache(cwd, result)
		await writeLastPlan(cwd, plan)
		console.log(renderResult(result, { all: args.all }))
	},
})

runMain(main, { showUsage: showCyaUsage })

async function showCyaUsage<T extends ArgsDef = ArgsDef>(
	cmd: CommandDef<T>,
	parent?: CommandDef<T>
): Promise<void> {
	const usage = await renderUsage(cmd, parent)
	console.log(`${usage}
${renderOkUsage()}`)
}

function renderOkUsage(): string {
	return `COMMANDS

  ok <check-id>    Mark one check from the last unchanged cya plan as succeeded
  ok --all         Mark every check from the last unchanged cya plan as succeeded

EXAMPLES

  cya
  cya ok swift-test
  cya ok --all
`
}

async function runOk(checkId: string | undefined, all: boolean): Promise<void> {
	const cwd = process.cwd()
	if (all && checkId) {
		fail('Use either `cya ok <check-id>` or `cya ok --all`, not both.')
	}
	if (!all && !checkId) {
		fail('Usage: cya ok <check-id> or cya ok --all')
	}

	const lastPlan = await readLastPlan(cwd)
	if (!lastPlan) {
		fail('Run `cya` before marking checks succeeded.')
	}

	const result = await loadEvaluation({
		baseBranch: lastPlan.baseBranch,
		cwd,
		event: lastPlan.event,
	})
	if (!result) {
		fail('No workflow files found in .github/workflows/.')
	}

	const currentPlan = await buildCheckPlan(cwd, result)
	if (currentPlan.hash !== lastPlan.hash) {
		fail('The CYA plan changed since the last run. Run `cya` again before `cya ok`.')
	}

	const entries = selectEntries(currentPlan, checkId, all)
	if (entries.length === 0) {
		console.log('No checks to mark.')
		return
	}

	await markChecksSucceeded(cwd, currentPlan, entries)
	if (all) {
		const noun = entries.length === 1 ? 'check' : 'checks'
		console.log(`Marked ${entries.length} ${noun} succeeded.`)
	} else {
		console.log(`Marked ${entries[0]!.checkId} succeeded.`)
	}
}

async function loadEvaluation(
	options: LoadEvaluationOptions
): Promise<EvaluationResult | undefined> {
	const workflowsDir = `${options.cwd}/.github/workflows`
	const workflows = await parseWorkflowsFromDir(workflowsDir)
	if (workflows.length === 0) {
		return undefined
	}
	const gitState = await getGitState({
		baseBranch: options.baseBranch,
		cwd: options.cwd,
		event: options.event,
		includeTurboAffectedPackages: workflows.some(workflow =>
			workflow.jobs.some(job =>
				job.steps.some(step => step.run?.includes('turbo@2 query affected'))
			)
		),
	})
	return evaluate(workflows, gitState)
}

function fail(message: string): never {
	console.error(message)
	process.exit(1)
}

function parseEvent(rawEvent: string): GitEvent {
	if (!validEvents.includes(rawEvent as GitEvent)) {
		fail(`Invalid event type: "${rawEvent}". Must be one of: ${validEvents.join(', ')}`)
	}
	return rawEvent as GitEvent
}

function selectEntries(
	plan: CheckPlan,
	checkId: string | undefined,
	all: boolean
): CheckPlanEntry[] {
	if (all) {
		return plan.checks
	}

	const entry = plan.checks.find(candidate => candidate.checkId === checkId)
	if (!entry) {
		const available = plan.checks.map(candidate => candidate.checkId).join(', ')
		fail(
			available
				? `Unknown check: ${checkId}. Available checks: ${available}`
				: `Unknown check: ${checkId}. No checks are in the current plan.`
		)
	}
	return [entry]
}
