import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parse } from 'yaml'
import type { Job, Step, Workflow, WorkflowTrigger } from './types.ts'

function parseTrigger(raw: unknown): WorkflowTrigger {
	if (raw === undefined || raw === null) {
		return {}
	}
	if (typeof raw !== 'object') {
		return {}
	}
	const obj = raw as Record<string, unknown>
	const trigger: WorkflowTrigger = {}
	if (Array.isArray(obj['branches'])) {
		trigger.branches = obj['branches']
	}
	if (Array.isArray(obj['branches-ignore'])) {
		trigger.branchesIgnore = obj['branches-ignore']
	}
	if (Array.isArray(obj['paths'])) {
		trigger.paths = obj['paths']
	}
	if (Array.isArray(obj['paths-ignore'])) {
		trigger.pathsIgnore = obj['paths-ignore']
	}
	if (Array.isArray(obj['tags'])) {
		trigger.tags = obj['tags']
	}
	if (Array.isArray(obj['tags-ignore'])) {
		trigger.tagsIgnore = obj['tags-ignore']
	}
	if (Array.isArray(obj['types'])) {
		trigger.types = obj['types']
	}
	return trigger
}

function toOptionalString(value: unknown): string | undefined {
	if (value == null) {
		return undefined
	}
	return String(value)
}

function parseStep(raw: Record<string, unknown>): Step {
	return {
		name: toOptionalString(raw['name']),
		run: toOptionalString(raw['run']),
		uses: toOptionalString(raw['uses']),
	}
}

function parseJob(id: string, raw: Record<string, unknown>): Job {
	const steps = Array.isArray(raw['steps'])
		? (raw['steps'] as Record<string, unknown>[]).map(parseStep)
		: []
	const needs = raw['needs']
	return {
		id,
		if: raw['if'] as string | undefined,
		name: raw['name'] as string | undefined,
		needs: Array.isArray(needs) ? needs : typeof needs === 'string' ? [needs] : undefined,
		runsOn: raw['runs-on'] as string | string[],
		steps,
	}
}

function normalizeOn(raw: unknown): Record<string, unknown> | null {
	if (typeof raw === 'string') {
		return { [raw]: {} }
	}
	if (Array.isArray(raw)) {
		return Object.fromEntries(raw.map(event => [String(event), {}]))
	}
	if (raw && typeof raw === 'object') {
		return raw as Record<string, unknown>
	}
	return null
}

export async function parseWorkflowFile(filePath: string): Promise<Workflow | null> {
	try {
		const content = await Bun.file(filePath).text()
		const doc = parse(content) as Record<string, unknown>
		if (!doc || typeof doc !== 'object') {
			return null
		}

		const on = normalizeOn(doc['on'])
		if (!on) {
			return null
		}

		const jobsRaw = (doc['jobs'] ?? {}) as Record<string, Record<string, unknown>>
		const jobs = Object.entries(jobsRaw).map(([id, raw]) => parseJob(id, raw))

		return {
			fileName: basename(filePath),
			jobs,
			name: doc['name'] as string | undefined,
			on: {
				pullRequest: 'pull_request' in on ? parseTrigger(on['pull_request']) : undefined,
				push: 'push' in on ? parseTrigger(on['push']) : undefined,
				workflowDispatch: on['workflow_dispatch'] as Record<string, unknown> | undefined,
			},
		}
	} catch {
		console.warn(`Warning: failed to parse ${basename(filePath)}`)
		return null
	}
}

export async function parseWorkflowsFromDir(dirPath: string): Promise<Workflow[]> {
	let entries: string[]
	try {
		entries = await readdir(dirPath)
	} catch (error: unknown) {
		const code = (error as { code?: string }).code
		if (code === 'ENOENT' || code === 'ENOTDIR') {
			return []
		}
		throw error
	}
	const yamlFiles = entries.filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
	const results = await Promise.all(
		yamlFiles.map(f => parseWorkflowFile(join(dirPath, f)))
	)
	return results.filter((w): w is Workflow => w !== null)
}
