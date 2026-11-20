// Bundles tests/*.test.ts with esbuild (already a dev dependency) and runs them
// with Node's built-in test runner. 'obsidian' is replaced by tests/obsidian-stub.ts.
import esbuild from 'esbuild';
import { readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const outdir = '.test-out';
rmSync(outdir, { recursive: true, force: true });
const entryPoints = readdirSync('tests')
	.filter((f) => f.endsWith('.test.ts'))
	.map((f) => `tests/${f}`);

await esbuild.build({
	entryPoints,
	outdir,
	bundle: true,
	platform: 'node',
	format: 'esm',
	outExtension: { '.js': '.mjs' },
	alias: { obsidian: './tests/obsidian-stub.ts' },
	logLevel: 'warning',
});

const files = entryPoints.map((f) => `${outdir}/${f.slice('tests/'.length).replace(/\.ts$/, '.mjs')}`);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
