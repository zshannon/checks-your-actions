import picomatch from 'picomatch'
import type {
	EvaluationResult,
	GitState,
	MatchedJob,
	MatchedWorkflow,
	Workflow,
	WorkflowTrigger,
} from './types.ts'

function matchesBranch(branch: string, trigger: WorkflowTrigger): boolean {
	if (trigger.branches && trigger.branchesIgnore) {
		console.warn('Warning: branches and branches-ignore are mutually exclusive, skipping')
		return false
	}
	if (trigger.branches) {
		return trigger.branches.some(pattern =>
			picomatch.isMatch(branch, pattern, { dot: true })
		)
	}
	if (trigger.branchesIgnore) {
		return !trigger.branchesIgnore.some(pattern =>
			picomatch.isMatch(branch, pattern, { dot: true })
		)
	}
	return true
}

function matchesPaths(changedFiles: string[], trigger: WorkflowTrigger): boolean {
	if (trigger.paths && trigger.pathsIgnore) {
		console.warn('Warning: paths and paths-ignore are mutually exclusive, skipping')
		return false
	}
	if (trigger.paths) {
		return changedFiles.some(file =>
			trigger.paths!.some(pattern => picomatch.isMatch(file, pattern, { dot: true }))
		)
	}
	if (trigger.pathsIgnore) {
		if (changedFiles.length === 0) {
			return true
		}
		const allIgnored = changedFiles.every(file =>
			trigger.pathsIgnore!.some(pattern =>
				picomatch.isMatch(file, pattern, { dot: true })
			)
		)
		return !allIgnored
	}
	return true
}

function matchesTrigger(workflow: Workflow, state: GitState): boolean {
	if (state.event === 'workflow_dispatch') {
		return workflow.on.workflowDispatch !== undefined
	}
	const trigger = state.event === 'push' ? workflow.on.push : workflow.on.pullRequest
	if (!trigger) {
		return false
	}
	// Skip tag-only push workflows (we don't evaluate tag triggers)
	if (state.event === 'push') {
		const hasTagFilter = trigger.tags || trigger.tagsIgnore
		const hasBranchOrPathFilter =
			trigger.branches || trigger.branchesIgnore || trigger.paths || trigger.pathsIgnore
		if (hasTagFilter && !hasBranchOrPathFilter) {
			console.warn(`Warning: ${workflow.fileName} has tag-only push trigger, skipping`)
			return false
		}
	}
	// For push: check head branch. For pull_request: check base branch.
	const branchToCheck = state.event === 'push' ? state.branch : state.baseBranch
	if (!matchesBranch(branchToCheck, trigger)) {
		return false
	}
	if (!matchesPaths(state.changedFiles, trigger)) {
		return false
	}
	return true
}

export function evaluate(workflows: Workflow[], state: GitState): EvaluationResult {
	const matchedWorkflows: MatchedWorkflow[] = []
	for (const workflow of workflows) {
		if (!matchesTrigger(workflow, state)) {
			continue
		}
		const jobs: MatchedJob[] = workflow.jobs.map(job => ({
			id: job.id,
			name: job.name,
			needs: job.needs,
			steps: job.steps,
		}))
		matchedWorkflows.push({ fileName: workflow.fileName, jobs, name: workflow.name })
	}
	return {
		baseBranch: state.baseBranch,
		branch: state.branch,
		changedFiles: state.changedFiles,
		event: state.event,
		matchedWorkflows,
	}
}
