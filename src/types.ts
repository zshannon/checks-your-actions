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
	id?: string
	if?: string
	name?: string
	run?: string
	uses?: string
	with?: Record<string, unknown>
}

export type Job = {
	id: string
	if?: string
	name?: string
	needs?: string[]
	outputs?: Record<string, string>
	runsOn: string | string[] | undefined
	steps: Step[]
	uses?: string
}

export type Workflow = {
	fileName: string
	jobs: Job[]
	name?: string
	on: {
		push?: WorkflowTrigger
		pullRequest?: WorkflowTrigger
		workflowDispatch?: Record<string, unknown>
	}
}

export type GitEvent = 'push' | 'pull_request' | 'workflow_dispatch'

export type GitState = {
	baseBranch: string
	baseRef?: string
	branch: string
	changedFiles: string[]
	event: GitEvent
	headRef?: string
	turboAffectedPackages?: TurboAffectedPackage[]
}

export type TurboAffectedPackage = {
	name: string
	path: string
}

export type JobPredictionStatus = 'unknown' | 'will_run' | 'will_skip'

export type JobPrediction = {
	outputs?: Record<string, string>
	reason?: string
	status: JobPredictionStatus
}

export type CheckCacheHit = {
	markedAt: string
}

export type MatchedJob = {
	cacheHit?: CheckCacheHit
	checkId?: string
	id: string
	if?: string
	name?: string
	needs?: string[]
	outputs?: Record<string, string>
	prediction?: JobPrediction
	steps: Step[]
	uses?: string
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
