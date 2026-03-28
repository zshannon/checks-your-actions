#!/usr/bin/env bun

import { defineCommand, runMain } from 'citty'
import pkg from '../package.json' with { type: 'json' }
import { evaluate } from './evaluate.ts'
import { getGitState } from './git-state.ts'
import { parseWorkflowsFromDir } from './parse.ts'
import { renderResult } from './render.ts'

const main = defineCommand({
	meta: {
		description:
			'Determine which GitHub Actions workflows would trigger given the current git state',
		name: 'cya',
		version: pkg.version,
	},
	args: {
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
		const event = args.event as 'push' | 'pull_request' | 'workflow_dispatch'
		const cwd = process.cwd()
		const workflowsDir = `${cwd}/.github/workflows`

		const workflows = await parseWorkflowsFromDir(workflowsDir)
		const gitState = await getGitState({ baseBranch: args.base, cwd, event })
		const result = evaluate(workflows, gitState)
		console.log(renderResult(result))
	},
})

runMain(main)
