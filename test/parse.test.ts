import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { parseWorkflowFile, parseWorkflowsFromDir } from '../src/parse.ts'

const FIXTURES = join(import.meta.dir, 'fixtures')

describe('parseWorkflowFile', () => {
	test('parses basic push workflow', async () => {
		const workflow = await parseWorkflowFile(join(FIXTURES, 'basic.yml'))
		expect(workflow).not.toBeNull()
		expect(workflow!.name).toBe('CI')
		expect(workflow!.fileName).toBe('basic.yml')
		expect(workflow!.on.push).toEqual({})
		expect(workflow!.on.pullRequest).toBeUndefined()
		expect(workflow!.jobs).toHaveLength(1)
		expect(workflow!.jobs[0]!.id).toBe('test')
		expect(workflow!.jobs[0]!.runsOn).toBe('ubuntu-latest')
		expect(workflow!.jobs[0]!.steps).toHaveLength(2)
		expect(workflow!.jobs[0]!.steps[0]!.uses).toBe('actions/checkout@v4')
		expect(workflow!.jobs[0]!.steps[1]!.run).toBe('npm test')
	})

	test('parses workflow with paths filter', async () => {
		const workflow = await parseWorkflowFile(join(FIXTURES, 'paths-filter.yml'))
		expect(workflow).not.toBeNull()
		expect(workflow!.on.push?.paths).toEqual(['docs/**', '*.md'])
	})

	test('parses workflow with branch filters', async () => {
		const workflow = await parseWorkflowFile(join(FIXTURES, 'branches.yml'))
		expect(workflow).not.toBeNull()
		expect(workflow!.on.push?.branches).toEqual(['main', 'release/*'])
	})

	test('parses workflow with multiple triggers', async () => {
		const workflow = await parseWorkflowFile(join(FIXTURES, 'multi-trigger.yml'))
		expect(workflow).not.toBeNull()
		expect(workflow!.on.push?.branches).toEqual(['main'])
		expect(workflow!.on.pullRequest?.branches).toEqual(['main'])
		expect(workflow!.on.pullRequest?.paths).toEqual(['src/**'])
		expect(workflow!.jobs).toHaveLength(2)
		expect(workflow!.jobs[1]!.needs).toEqual(['lint'])
	})

	test('parses workflow_dispatch trigger', async () => {
		const workflow = await parseWorkflowFile(join(FIXTURES, 'dispatch.yml'))
		expect(workflow).not.toBeNull()
		expect(workflow!.on.workflowDispatch).toBeDefined()
		expect(workflow!.on.push).toBeUndefined()
	})

	test('returns null for invalid YAML', async () => {
		const workflow = await parseWorkflowFile(join(FIXTURES, 'invalid.yml'))
		expect(workflow).toBeNull()
	})
})

describe('parseWorkflowsFromDir', () => {
	test('parses all valid workflows from directory', async () => {
		const workflows = await parseWorkflowsFromDir(FIXTURES)
		expect(workflows.length).toBeGreaterThanOrEqual(5)
		expect(workflows.every(w => w.fileName !== 'invalid.yml')).toBe(true)
	})
})
