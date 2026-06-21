import { $ } from 'bun'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { isActionableJob } from './job-kind.ts'
import type { EvaluationResult, GitEvent, MatchedJob } from './types.ts'

const CACHE_VERSION = 1

type FileFingerprint =
	| {
			hash: string
			path: string
			status: 'file'
	  }
	| {
			path: string
			status: 'missing'
	  }

export type CheckPlanEntry = {
	checkId: string
	fingerprint: string
	jobId: string
	key: string
	workflowFileName: string
}

export type CheckPlan = {
	baseBranch: string
	branch: string
	checks: CheckPlanEntry[]
	createdAt: string
	event: GitEvent
	hash: string
	version: 1
}

type CheckSuccessRecord = CheckPlanEntry & {
	baseBranch: string
	branch: string
	event: GitEvent
	markedAt: string
}

type SuccessCache = {
	successes: Record<string, CheckSuccessRecord>
	version: 1
}

type PlannedJob = {
	entry: CheckPlanEntry
	job: MatchedJob
}

export async function applyCheckCache(
	cwd: string,
	result: EvaluationResult
): Promise<CheckPlan> {
	const { plan, plannedJobs } = await buildCheckPlanWithJobs(cwd, result)
	const cache = await readSuccessCache(cwd)

	for (const { entry, job } of plannedJobs) {
		const record = cache.successes[entry.key]
		if (record?.fingerprint === entry.fingerprint) {
			job.cacheHit = { markedAt: record.markedAt }
		} else {
			delete job.cacheHit
		}
	}

	return plan
}

export async function buildCheckPlan(
	cwd: string,
	result: EvaluationResult
): Promise<CheckPlan> {
	return (await buildCheckPlanWithJobs(cwd, result)).plan
}

export async function markChecksSucceeded(
	cwd: string,
	plan: CheckPlan,
	entries: CheckPlanEntry[]
): Promise<CheckPlanEntry[]> {
	const cache = await readSuccessCache(cwd)
	const markedAt = new Date().toISOString()

	for (const entry of entries) {
		cache.successes[entry.key] = {
			...entry,
			baseBranch: plan.baseBranch,
			branch: plan.branch,
			event: plan.event,
			markedAt,
		}
	}

	await writeSuccessCache(cwd, cache)
	return entries
}

export async function readLastPlan(cwd: string): Promise<CheckPlan | undefined> {
	const plan = await readJson<CheckPlan | undefined>(cwd, 'last-plan.json', undefined)
	if (!plan || plan.version !== CACHE_VERSION || !Array.isArray(plan.checks)) {
		return undefined
	}
	return plan
}

export async function writeLastPlan(cwd: string, plan: CheckPlan): Promise<void> {
	await writeJson(cwd, 'last-plan.json', plan)
}

function buildCheckId(
	jobId: string,
	duplicateJobIds: Set<string>,
	workflowFileName: string
): string {
	return duplicateJobIds.has(jobId) ? `${workflowFileName}:${jobId}` : jobId
}

async function buildCheckPlanWithJobs(
	cwd: string,
	result: EvaluationResult
): Promise<{ plan: CheckPlan; plannedJobs: PlannedJob[] }> {
	const actionableJobs = collectActionableJobs(result)
	const duplicateJobIds = findDuplicateJobIds(actionableJobs.map(({ job }) => job.id))
	const changedFiles = await fingerprintChangedFiles(cwd, result.changedFiles)
	const workflowHashes = await fingerprintWorkflowFiles(cwd, actionableJobs)
	const plannedJobs: PlannedJob[] = []

	for (const { job, workflowFileName } of actionableJobs) {
		const checkId = buildCheckId(job.id, duplicateJobIds, workflowFileName)
		const key = buildCheckKey(result.event, result.baseBranch, workflowFileName, job.id)
		const workflowHash = workflowHashes.get(workflowFileName) ?? {
			status: 'missing' as const,
		}
		const fingerprint = hashJson({
			baseBranch: result.baseBranch,
			branch: result.branch,
			changedFiles,
			event: result.event,
			key,
			version: CACHE_VERSION,
			workflow: {
				fileName: workflowFileName,
				...workflowHash,
			},
		})
		const entry = {
			checkId,
			fingerprint,
			jobId: job.id,
			key,
			workflowFileName,
		}
		job.checkId = checkId
		plannedJobs.push({ entry, job })
	}

	const checks = plannedJobs.map(({ entry }) => entry)
	const hash = hashJson({
		baseBranch: result.baseBranch,
		branch: result.branch,
		checks: checks.map(entry => ({
			checkId: entry.checkId,
			fingerprint: entry.fingerprint,
			key: entry.key,
		})),
		event: result.event,
		version: CACHE_VERSION,
	})

	return {
		plan: {
			baseBranch: result.baseBranch,
			branch: result.branch,
			checks,
			createdAt: new Date().toISOString(),
			event: result.event,
			hash,
			version: CACHE_VERSION,
		},
		plannedJobs,
	}
}

function buildCheckKey(
	event: GitEvent,
	baseBranch: string,
	workflowFileName: string,
	jobId: string
): string {
	return [event, baseBranch, workflowFileName, jobId].map(encodeURIComponent).join(':')
}

function collectActionableJobs(
	result: EvaluationResult
): { job: MatchedJob; workflowFileName: string }[] {
	const jobs: { job: MatchedJob; workflowFileName: string }[] = []
	for (const workflow of result.matchedWorkflows) {
		for (const job of workflow.jobs) {
			if (isActionableJob(job)) {
				jobs.push({ job, workflowFileName: workflow.fileName })
			}
		}
	}
	return jobs
}

function findDuplicateJobIds(jobIds: string[]): Set<string> {
	const counts = new Map<string, number>()
	for (const jobId of jobIds) {
		counts.set(jobId, (counts.get(jobId) ?? 0) + 1)
	}
	return new Set([...counts].filter(([, count]) => count > 1).map(([jobId]) => jobId))
}

async function fingerprintChangedFiles(
	cwd: string,
	changedFiles: string[]
): Promise<FileFingerprint[]> {
	const uniqueFiles = [...new Set(changedFiles)].sort()
	return Promise.all(
		uniqueFiles.map(async path => {
			const hash = await hashExistingFile(join(cwd, path))
			return hash
				? { hash, path, status: 'file' as const }
				: { path, status: 'missing' as const }
		})
	)
}

async function fingerprintWorkflowFiles(
	cwd: string,
	jobs: { workflowFileName: string }[]
): Promise<Map<string, { hash: string; status: 'file' } | { status: 'missing' }>> {
	const workflowFileNames = [...new Set(jobs.map(job => job.workflowFileName))].sort()
	const entries = await Promise.all(
		workflowFileNames.map(async fileName => {
			const hash = await hashExistingFile(join(cwd, '.github/workflows', fileName))
			return [
				fileName,
				hash ? { hash, status: 'file' as const } : { status: 'missing' as const },
			] as const
		})
	)
	return new Map(entries)
}

async function hashExistingFile(path: string): Promise<string | undefined> {
	const file = Bun.file(path)
	if (!(await file.exists())) {
		return undefined
	}
	return hashBytes(new Uint8Array(await file.arrayBuffer()))
}

function hashBytes(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex')
}

function hashJson(value: unknown): string {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

async function readSuccessCache(cwd: string): Promise<SuccessCache> {
	return readJson<SuccessCache>(cwd, 'success.json', {
		successes: {},
		version: CACHE_VERSION,
	})
}

async function writeSuccessCache(cwd: string, cache: SuccessCache): Promise<void> {
	await writeJson(cwd, 'success.json', cache)
}

async function readJson<T>(cwd: string, fileName: string, fallback: T): Promise<T> {
	try {
		return (await Bun.file(await cacheFilePath(cwd, fileName)).json()) as T
	} catch {
		return fallback
	}
}

async function writeJson(cwd: string, fileName: string, value: unknown): Promise<void> {
	const path = await cacheFilePath(cwd, fileName)
	await mkdir(dirname(path), { recursive: true })
	await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function cacheFilePath(cwd: string, fileName: string): Promise<string> {
	return join(await cacheDir(cwd), fileName)
}

async function cacheDir(cwd: string): Promise<string> {
	const gitDir = (await $`git -C ${cwd} rev-parse --git-dir`.text()).trim()
	return join(isAbsolute(gitDir) ? gitDir : join(cwd, gitDir), 'cya')
}
