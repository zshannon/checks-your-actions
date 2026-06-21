import { $ } from 'bun'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { stripVTControlCharacters } from 'node:util'

const tempDirs: string[] = []

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true }))
	)
})

describe('cya integration', () => {
	test('runs push workflow evaluation', async () => {
		const result = await $`bun run src/cli.ts --base main --event push`.text()
		expect(result.trim().length).toBeGreaterThan(0)
	})

	test('shows no-match for event with no matching triggers', async () => {
		const result = await $`bun run src/cli.ts --event workflow_dispatch`.text()
		expect(result).toContain('No workflow')
	})

	test('marks all checks succeeded from the last unchanged plan', async () => {
		const cwd = await createRepo()
		const cli = join(import.meta.dir, '../src/cli.ts')

		const first = stripVTControlCharacters(
			await $`bun run ${cli} --event push`.cwd(cwd).text()
		)
		expect(first).toContain('[test] test: [run]')

		const ok = await $`bun run ${cli} ok --all`.cwd(cwd).text()
		expect(ok).toContain('Marked 1 check succeeded.')

		const second = stripVTControlCharacters(
			await $`bun run ${cli} --event push`.cwd(cwd).text()
		)
		expect(second).toContain('[test] test: [cached success]')
		expect(second).not.toContain('npm test')
	})

	test('--help shows usage info', async () => {
		const result = await $`bun run src/cli.ts --help`.text()
		expect(result).toContain('cya')
		expect(result).toContain('--base')
		expect(result).toContain('--event')
		expect(result).toContain('ok <check-id>')
		expect(result).toContain('ok --all')
	})

	test('rejects invalid event type', async () => {
		const proc = await $`bun run src/cli.ts --event foobar`.nothrow().quiet()
		expect(proc.exitCode).not.toBe(0)
		expect(proc.stderr.toString()).toContain('Invalid event type')
	})

	test('rejects unknown positional commands', async () => {
		const proc = await $`bun run src/cli.ts nope`.nothrow().quiet()
		expect(proc.exitCode).not.toBe(0)
		expect(proc.stderr.toString()).toContain('Unknown command: nope')
	})

	test('--version shows version', async () => {
		const result = await $`bun run src/cli.ts --version`.text()
		expect(result.trim()).toMatch(/\d+\.\d+\.\d+/)
	})
})

async function createRepo(): Promise<string> {
	const cwd = await mkdtemp(join(tmpdir(), 'cya-cli-'))
	tempDirs.push(cwd)
	await mkdir(join(cwd, '.github/workflows'), { recursive: true })
	await mkdir(join(cwd, 'src'), { recursive: true })
	await Bun.write(
		join(cwd, '.github/workflows/ci.yml'),
		'name: CI\non:\n  push:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n'
	)
	await Bun.write(join(cwd, 'src/index.ts'), 'initial')
	await $`git -C ${cwd} init`.quiet()
	await $`git -C ${cwd} add .`.quiet()
	await $`git -C ${cwd} -c user.name=cya -c user.email=cya@example.com commit -m init`.quiet()
	await Bun.write(join(cwd, 'src/index.ts'), 'changed')
	return cwd
}
