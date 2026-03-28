import { test, expect } from 'bun:test'
import { $ } from 'bun'

test('cya prints hello world', async () => {
	const result = await $`bun run src/cli.ts`.text()
	expect(result.trim()).toBe('hello world')
})
