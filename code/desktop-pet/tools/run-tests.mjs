import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const group = process.argv[2] || 'default';
const paths = [];
async function collect(dir, accepts) {
  for (const file of (await readdir(resolve(root, dir))).sort()) if (accepts(file)) paths.push(resolve(root, dir, file));
}
if (group === 'release') {
  await collect('dist/tests/memory', name => name === 'import-49.test.js' || name === 'context-continuity.test.js' || /^dynamics.*\.test\.js$/.test(name));
  await collect('dist/tests/providers', name => ['qwen-asr.test.js', 'minimax-tts.test.js', 'registered-voices.test.js'].includes(name));
  await collect('dist/tests/wechat', name => name === 'conversation.test.js');
  await collect('dist/tests/integration', name => name === 'memory-import-49.test.js');
  await collect('dist/tests/management', name => name === 'memory-import.test.js');
} else if (group === 'default') {
  for (const dir of ['memory', 'providers']) await collect('dist/tests/' + dir, name => name.endsWith('.test.js'));
} else throw Error('Unknown test group');
const child = spawn(process.execPath, ['--test', '--test-concurrency=2', ...paths], { stdio: 'inherit', windowsHide: true });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
