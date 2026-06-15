import { describe, expect, test } from 'bun:test'
import { $ } from 'bun'

describe('cya integration', () => {
	test('runs push workflow evaluation', async () => {
		const result = await $`bun run src/cli.ts --base main --event push`.text()
		expect(result.trim().length).toBeGreaterThan(0)
	})

	test('shows no-match for event with no matching triggers', async () => {
		const result = await $`bun run src/cli.ts --event workflow_dispatch`.text()
		expect(result).toContain('No workflow')
	})

	test('--help shows usage info', async () => {
		const result = await $`bun run src/cli.ts --help`.text()
		expect(result).toContain('cya')
		expect(result).toContain('--base')
		expect(result).toContain('--event')
	})

	test('rejects invalid event type', async () => {
		const proc = await $`bun run src/cli.ts --event foobar`.nothrow().quiet()
		expect(proc.exitCode).not.toBe(0)
		expect(proc.stderr.toString()).toContain('Invalid event type')
	})

	test('--version shows version', async () => {
		const result = await $`bun run src/cli.ts --version`.text()
		expect(result.trim()).toMatch(/\d+\.\d+\.\d+/)
	})
})
