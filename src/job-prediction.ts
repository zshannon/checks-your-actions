import picomatch from 'picomatch'
import { parse as parseYaml } from 'yaml'
import type {
	GitState,
	Job,
	JobPrediction,
	MatchedJob,
	Step,
	TurboAffectedPackage,
} from './types.ts'

type KnownValue = boolean | null | number | string | string[]

type ExpressionResult =
	| { known: true; value: KnownValue }
	| { known: false; reason: string }

type NeedsValue = {
	outputs: Record<string, string>
	result: 'cancelled' | 'failure' | 'skipped' | 'success' | 'unknown'
}

type StepValue = {
	outputs: Record<string, string>
}

type ExpressionContext = {
	eventName: string
	needs: Record<string, NeedsValue>
	steps: Record<string, StepValue>
}

type PendingJob = {
	job: Job
	needs: string[]
}

const knownTrue: ExpressionResult = { known: true, value: true }
const knownFalse: ExpressionResult = { known: true, value: false }

export function predictJobs(jobs: Job[], state: GitState): MatchedJob[] {
	const pending = new Map<string, PendingJob>(
		jobs.map(job => [job.id, { job, needs: job.needs ?? [] }])
	)
	const predictions = new Map<string, JobPrediction>()
	const matchedJobs = new Map<string, MatchedJob>()

	while (pending.size > 0) {
		const ready = [...pending.values()].filter(({ needs }) =>
			needs.every(need => predictions.has(need) || !pending.has(need))
		)

		if (ready.length === 0) {
			for (const { job } of pending.values()) {
				const prediction: JobPrediction = {
					reason: 'cyclic or unresolved job dependency',
					status: 'unknown',
				}
				predictions.set(job.id, prediction)
				matchedJobs.set(job.id, toMatchedJob(job, prediction))
			}
			break
		}

		for (const { job } of ready) {
			const prediction = predictJob(job, predictions, state)
			predictions.set(job.id, prediction)
			matchedJobs.set(job.id, toMatchedJob(job, prediction))
			pending.delete(job.id)
		}
	}

	return jobs.map(job => matchedJobs.get(job.id)!).filter(Boolean)
}

function predictJob(
	job: Job,
	predictions: Map<string, JobPrediction>,
	state: GitState
): JobPrediction {
	const needs = buildNeedsContext(job, predictions)
	const context: ExpressionContext = {
		eventName: state.event,
		needs,
		steps: {},
	}
	const hasStatusCheck = job.if ? containsStatusCheckFunction(job.if) : false
	const dependencyStatus = dependencyGate(job, needs)

	if (!hasStatusCheck && dependencyStatus.status !== 'will_run') {
		return dependencyStatus
	}

	const ifResult = evaluateJobIf(job.if, context)
	if (!ifResult.known) {
		return { reason: ifResult.reason, status: 'unknown' }
	}
	if (!toBoolean(ifResult.value)) {
		return { reason: `if condition evaluated false: ${job.if}`, status: 'will_skip' }
	}

	const steps = evaluateStepOutputs(job.steps, state)
	const outputContext = { ...context, steps }
	const outputs = evaluateJobOutputs(job.outputs, outputContext)

	return { outputs: outputs.value, status: 'will_run' }
}

function toMatchedJob(job: Job, prediction: JobPrediction): MatchedJob {
	return {
		id: job.id,
		if: job.if,
		name: job.name,
		needs: job.needs,
		outputs: job.outputs,
		prediction,
		steps: job.steps,
		uses: job.uses,
	}
}

function buildNeedsContext(
	job: Job,
	predictions: Map<string, JobPrediction>
): Record<string, NeedsValue> {
	const needs: Record<string, NeedsValue> = {}
	for (const need of job.needs ?? []) {
		const prediction = predictions.get(need)
		needs[need] = {
			outputs: prediction?.outputs ?? {},
			result: toNeedsResult(prediction),
		}
	}
	return needs
}

function toNeedsResult(prediction: JobPrediction | undefined): NeedsValue['result'] {
	if (!prediction) {
		return 'unknown'
	}
	switch (prediction.status) {
		case 'will_run':
			return 'success'
		case 'will_skip':
			return 'skipped'
		case 'unknown':
			return 'unknown'
	}
}

function dependencyGate(job: Job, needs: Record<string, NeedsValue>): JobPrediction {
	for (const [id, need] of Object.entries(needs)) {
		if (need.result === 'unknown') {
			return {
				reason: `dependency ${id} has unknown result`,
				status: 'unknown',
			}
		}
		if (need.result !== 'success') {
			return {
				reason: `dependency ${id} result is ${need.result}`,
				status: 'will_skip',
			}
		}
	}
	return { status: 'will_run', outputs: job.outputs ? {} : undefined }
}

function evaluateJobIf(
	expression: string | undefined,
	context: ExpressionContext
): ExpressionResult {
	if (!expression) {
		return knownTrue
	}
	return evaluateExpression(expression, context)
}

function evaluateJobOutputs(
	outputs: Record<string, string> | undefined,
	context: ExpressionContext
): { value: Record<string, string> } {
	if (!outputs) {
		return { value: {} }
	}

	const resolved: Record<string, string> = {}
	for (const [name, expression] of Object.entries(outputs)) {
		const value = evaluateExpression(expression, context)
		if (value.known) {
			resolved[name] = String(value.value)
		}
	}
	return { value: resolved }
}

function evaluateExpression(
	rawExpression: string,
	context: ExpressionContext
): ExpressionResult {
	const expression = stripExpressionWrapper(rawExpression)
	return evaluateOr(expression, context)
}

function evaluateOr(expression: string, context: ExpressionContext): ExpressionResult {
	const parts = splitTopLevel(expression, '||')
	if (parts.length === 1) {
		return evaluateAnd(expression, context)
	}

	let hasUnknown = false
	for (const part of parts) {
		const result = evaluateAnd(part, context)
		if (!result.known) {
			hasUnknown = true
			continue
		}
		if (toBoolean(result.value)) {
			return knownTrue
		}
	}
	return hasUnknown
		? { known: false, reason: `cannot fully evaluate ${expression}` }
		: knownFalse
}

function evaluateAnd(expression: string, context: ExpressionContext): ExpressionResult {
	const parts = splitTopLevel(expression, '&&')
	if (parts.length === 1) {
		return evaluateComparison(expression, context)
	}

	let hasUnknown = false
	for (const part of parts) {
		const result = evaluateComparison(part, context)
		if (!result.known) {
			hasUnknown = true
			continue
		}
		if (!toBoolean(result.value)) {
			return knownFalse
		}
	}
	return hasUnknown
		? { known: false, reason: `cannot fully evaluate ${expression}` }
		: knownTrue
}

function evaluateComparison(
	expression: string,
	context: ExpressionContext
): ExpressionResult {
	const equality = splitComparison(expression)
	if (!equality) {
		return evaluateTerm(expression, context)
	}

	const left = evaluateTerm(equality.left, context)
	const right = evaluateTerm(equality.right, context)
	if (!left.known) {
		return left
	}
	if (!right.known) {
		return right
	}

	const equal = looseEquals(left.value, right.value)
	return {
		known: true,
		value: equality.operator === '==' ? equal : !equal,
	}
}

function evaluateTerm(expression: string, context: ExpressionContext): ExpressionResult {
	const trimmed = stripOuterParens(expression.trim())
	if (trimmed.length === 0) {
		return knownFalse
	}
	if (trimmed.startsWith('!')) {
		const value = evaluateTerm(trimmed.slice(1), context)
		return value.known ? { known: true, value: !toBoolean(value.value) } : value
	}
	if (trimmed === 'true') {
		return knownTrue
	}
	if (trimmed === 'false') {
		return knownFalse
	}
	if (trimmed === 'null') {
		return { known: true, value: null }
	}
	if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
		return { known: true, value: Number(trimmed) }
	}
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
		return { known: true, value: trimmed.slice(1, -1).replaceAll("''", "'") }
	}

	const functionResult = evaluateFunction(trimmed, context)
	if (functionResult) {
		return functionResult
	}

	return evaluateContextPath(trimmed, context)
}

function evaluateFunction(
	expression: string,
	context: ExpressionContext
): ExpressionResult | undefined {
	if (expression === 'always()') {
		return knownTrue
	}
	if (expression === 'success()') {
		return {
			known: true,
			value: Object.values(context.needs).every(need => need.result === 'success'),
		}
	}
	if (expression === 'failure()') {
		return {
			known: true,
			value: Object.values(context.needs).some(need => need.result === 'failure'),
		}
	}
	if (expression === 'cancelled()') {
		return {
			known: true,
			value: Object.values(context.needs).some(need => need.result === 'cancelled'),
		}
	}

	const containsArgs = parseFunctionArgs(expression, 'contains')
	if (containsArgs) {
		const haystack = evaluateExpression(containsArgs[0]!, context)
		const needle = evaluateExpression(containsArgs[1]!, context)
		if (!haystack.known) {
			return haystack
		}
		if (!needle.known) {
			return needle
		}
		return { known: true, value: containsValue(haystack.value, needle.value) }
	}

	return undefined
}

function evaluateContextPath(path: string, context: ExpressionContext): ExpressionResult {
	if (path === 'github.event_name') {
		return { known: true, value: context.eventName }
	}
	if (path.startsWith('inputs.')) {
		return { known: true, value: false }
	}
	if (path === 'needs.*.result') {
		return {
			known: true,
			value: Object.values(context.needs).map(need => need.result),
		}
	}

	const needsOutputMatch = path.match(/^needs\.([^.]+)\.outputs\.([^.]+)$/)
	if (needsOutputMatch) {
		const [, jobId, outputName] = needsOutputMatch
		const output = context.needs[jobId!]?.outputs[outputName!]
		return output === undefined
			? { known: false, reason: `${path} is not known` }
			: { known: true, value: output }
	}

	const needsResultMatch = path.match(/^needs\.([^.]+)\.result$/)
	if (needsResultMatch) {
		const [, jobId] = needsResultMatch
		const result = context.needs[jobId!]?.result
		return result === undefined
			? { known: false, reason: `${path} is not known` }
			: { known: true, value: result }
	}

	const stepOutputMatch = path.match(/^steps\.([^.]+)\.outputs\.([^.]+)$/)
	if (stepOutputMatch) {
		const [, stepId, outputName] = stepOutputMatch
		const output = context.steps[stepId!]?.outputs[outputName!]
		return output === undefined
			? { known: false, reason: `${path} is not known` }
			: { known: true, value: output }
	}

	return { known: false, reason: `unsupported expression term: ${path}` }
}

function evaluateStepOutputs(steps: Step[], state: GitState): Record<string, StepValue> {
	const values: Record<string, StepValue> = {}
	for (const step of steps) {
		if (!step.id) {
			continue
		}
		const outputs = {
			...evaluatePathsFilterOutputs(step, state),
			...evaluateTurboAffectedOutputs(step, state),
		}
		values[step.id] = { outputs }
	}
	return values
}

function evaluatePathsFilterOutputs(step: Step, state: GitState): Record<string, string> {
	if (!step.uses?.startsWith('dorny/paths-filter@')) {
		return {}
	}
	const filters = step.with?.['filters']
	if (typeof filters !== 'string') {
		return {}
	}

	try {
		const parsed = parseYaml(filters) as Record<string, string[]>
		return Object.fromEntries(
			Object.entries(parsed).map(([name, patterns]) => [
				name,
				state.changedFiles.some(file =>
					patterns.some(pattern => picomatch.isMatch(file, pattern, { dot: true }))
				)
					? 'true'
					: 'false',
			])
		)
	} catch {
		return {}
	}
}

function evaluateTurboAffectedOutputs(
	step: Step,
	state: GitState
): Record<string, string> {
	const run = step.run
	if (!run?.includes('turbo@2 query affected')) {
		return {}
	}
	if (!state.turboAffectedPackages) {
		return {}
	}

	const affectedCount = countTurboAffectedPackages(run, state.turboAffectedPackages)
	const configCount = countConfigPathMatches(run, state.changedFiles)
	if (affectedCount === undefined || configCount === undefined) {
		return {}
	}

	if (run.includes('should_run=') && run.includes('TOTAL')) {
		return {
			should_run: affectedCount + configCount > 0 ? 'true' : 'false',
		}
	}

	return {}
}

function countTurboAffectedPackages(
	run: string,
	packages: TurboAffectedPackage[]
): number | undefined {
	const selectMatch = run.match(/select\(([\s\S]*?)\)\] \| length/)
	if (!selectMatch) {
		return undefined
	}
	const predicate = selectMatch[1]!
	let count = 0
	for (const item of packages) {
		const result = evaluateTurboPredicate(predicate, item)
		if (result === undefined) {
			return undefined
		}
		if (result) {
			count += 1
		}
	}
	return count
}

function evaluateTurboPredicate(
	predicate: string,
	item: TurboAffectedPackage
): boolean | undefined {
	const orParts = predicate.split(/\s+or\s+/)
	if (orParts.length > 1) {
		let matched = false
		for (const part of orParts) {
			const result = evaluateTurboPredicate(part, item)
			if (result === undefined) {
				return undefined
			}
			matched ||= result
		}
		return matched
	}

	const andParts = predicate.split(/\s+and\s+/)
	if (andParts.length > 1) {
		for (const part of andParts) {
			const result = evaluateTurboPredicate(part, item)
			if (result === undefined || !result) {
				return result
			}
		}
		return true
	}

	const normalized = predicate
		.trim()
		.replace(/^\((.*)\)$/, '$1')
		.trim()
	const nameMatch = normalized.match(/^\.name\s*==\s*"([^"]+)"$/)
	if (nameMatch) {
		return item.name === nameMatch[1]
	}
	const pathPrefixMatch = normalized.match(/^\.path\s*\|\s*startswith\("([^"]+)"\)$/)
	if (pathPrefixMatch) {
		return item.path.startsWith(pathPrefixMatch[1]!)
	}
	return undefined
}

function countConfigPathMatches(run: string, changedFiles: string[]): number | undefined {
	const specs = extractGitDiffPathspecs(run)
	if (!specs) {
		return undefined
	}
	return changedFiles.filter(file => specs.some(spec => pathspecMatches(spec, file)))
		.length
}

function extractGitDiffPathspecs(run: string): string[] | undefined {
	const lines = run.split('\n')
	const start = lines.findIndex(line => line.includes('git diff --name-only'))
	if (start === -1) {
		return undefined
	}

	const specs: string[] = []
	for (const line of lines.slice(start + 1)) {
		if (line.includes('| wc -l')) {
			break
		}
		const spec = line.trim().replace(/\\$/, '').trim()
		if (spec.length > 0) {
			specs.push(spec)
		}
	}
	return specs.length > 0 ? specs : undefined
}

function pathspecMatches(spec: string, file: string): boolean {
	if (spec.endsWith('/**')) {
		const prefix = spec.slice(0, -3)
		return file === prefix || file.startsWith(`${prefix}/`)
	}
	return file === spec || file.startsWith(`${spec}/`)
}

function stripExpressionWrapper(expression: string): string {
	const trimmed = expression.trim()
	if (trimmed.startsWith('${{') && trimmed.endsWith('}}')) {
		return stripOuterParens(trimmed.slice(3, -2).trim())
	}
	return stripOuterParens(trimmed)
}

function stripOuterParens(expression: string): string {
	let current = expression.trim()
	while (hasWrappingParens(current)) {
		current = current.slice(1, -1).trim()
	}
	return current
}

function hasWrappingParens(expression: string): boolean {
	if (!expression.startsWith('(') || !expression.endsWith(')')) {
		return false
	}
	let depth = 0
	let quote = false
	for (let index = 0; index < expression.length; index += 1) {
		const char = expression[index]
		if (char === "'") {
			quote = !quote
			continue
		}
		if (quote) {
			continue
		}
		if (char === '(') {
			depth += 1
		}
		if (char === ')') {
			depth -= 1
		}
		if (depth === 0 && index < expression.length - 1) {
			return false
		}
	}
	return depth === 0
}

function splitTopLevel(expression: string, operator: string): string[] {
	const parts: string[] = []
	let depth = 0
	let quote = false
	let start = 0

	for (let index = 0; index < expression.length; index += 1) {
		const char = expression[index]
		if (char === "'") {
			quote = !quote
			continue
		}
		if (quote) {
			continue
		}
		if (char === '(') {
			depth += 1
			continue
		}
		if (char === ')') {
			depth -= 1
			continue
		}
		if (depth === 0 && expression.slice(index, index + operator.length) === operator) {
			parts.push(expression.slice(start, index).trim())
			start = index + operator.length
			index += operator.length - 1
		}
	}

	if (parts.length === 0) {
		return [expression.trim()]
	}
	parts.push(expression.slice(start).trim())
	return parts
}

function splitComparison(
	expression: string
): { left: string; operator: '!=' | '=='; right: string } | undefined {
	let depth = 0
	let quote = false
	for (let index = 0; index < expression.length - 1; index += 1) {
		const char = expression[index]
		if (char === "'") {
			quote = !quote
			continue
		}
		if (quote) {
			continue
		}
		if (char === '(') {
			depth += 1
			continue
		}
		if (char === ')') {
			depth -= 1
			continue
		}
		if (depth === 0) {
			const operator = expression.slice(index, index + 2)
			if (operator === '==' || operator === '!=') {
				return {
					left: expression.slice(0, index).trim(),
					operator,
					right: expression.slice(index + 2).trim(),
				}
			}
		}
	}
	return undefined
}

function parseFunctionArgs(
	expression: string,
	name: string
): [string, string] | undefined {
	const prefix = `${name}(`
	if (!expression.startsWith(prefix) || !expression.endsWith(')')) {
		return undefined
	}
	const args = splitTopLevel(expression.slice(prefix.length, -1), ',')
	return args.length === 2 ? [args[0]!, args[1]!] : undefined
}

function containsStatusCheckFunction(expression: string): boolean {
	return /\b(always|cancelled|failure|success)\(\)/.test(expression)
}

function looseEquals(left: KnownValue, right: KnownValue): boolean {
	if (typeof left === 'string' && typeof right === 'string') {
		return left.toLowerCase() === right.toLowerCase()
	}
	return String(left).toLowerCase() === String(right).toLowerCase()
}

function containsValue(haystack: KnownValue, needle: KnownValue): boolean {
	const needleText = String(needle).toLowerCase()
	if (Array.isArray(haystack)) {
		return haystack.some(value => value.toLowerCase() === needleText)
	}
	return String(haystack).toLowerCase().includes(needleText)
}

function toBoolean(value: KnownValue): boolean {
	if (value === false || value === null || value === 0 || value === '') {
		return false
	}
	return true
}
