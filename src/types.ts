export type WorkflowTrigger = {
	branches?: string[]
	branchesIgnore?: string[]
	paths?: string[]
	pathsIgnore?: string[]
	tags?: string[]
	tagsIgnore?: string[]
	types?: string[]
}

export type Step = {
	name?: string
	run?: string
	uses?: string
}

export type Job = {
	id: string
	if?: string
	name?: string
	needs?: string[]
	runsOn: string | string[]
	steps: Step[]
}

export type Workflow = {
	fileName: string
	name?: string
	on: {
		push?: WorkflowTrigger
		pullRequest?: WorkflowTrigger
		workflowDispatch?: Record<string, unknown>
	}
	jobs: Job[]
}

export type GitEvent = 'push' | 'pull_request' | 'workflow_dispatch'

export type GitState = {
	baseBranch: string
	branch: string
	changedFiles: string[]
	event: GitEvent
}

export type MatchedJob = {
	id: string
	name?: string
	needs?: string[]
	steps: Step[]
}

export type MatchedWorkflow = {
	fileName: string
	jobs: MatchedJob[]
	name?: string
}

export type EvaluationResult = {
	baseBranch: string
	branch: string
	changedFiles: string[]
	event: GitEvent
	matchedWorkflows: MatchedWorkflow[]
}
