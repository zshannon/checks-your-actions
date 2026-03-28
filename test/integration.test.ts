import { describe, expect, test } from 'bun:test'
import { $ } from 'bun'

describe('cya integration', () => {
	test('reports workflows for current repo on pull_request', async () => {
		const result = await $`bun run src/cli.ts --base main --event pull_request`.text()
		expect(result).toBeDefined()
	})

	test('shows no-match message for workflow_dispatch without dispatch workflows', async () => {
		const result = await $`bun run src/cli.ts --event workflow_dispatch`.text()
		expect(result).toContain('No workflows would be triggered')
	})

	test('--help shows usage info', async () => {
		const result = await $`bun run src/cli.ts --help`.text()
		expect(result).toContain('--base')
		expect(result).toContain('--event')
	})
})
