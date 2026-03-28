import { test, expect } from 'bun:test'
import { $ } from 'bun'

test('cya --help shows usage', async () => {
	const result = await $`bun run src/cli.ts --help`.text()
	expect(result).toContain('cya')
	expect(result).toContain('--base')
	expect(result).toContain('--event')
})
