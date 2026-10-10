import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { isTrialRuntimePath } from './trial-config.js';

const engine = 'artifacts/runtime/engines-codex-0.160.0-dsh-0.2.0-rc.2-darwin-arm64';
const excluded = new Set(['node_modules', '.cache', '.git', 'tests']);

/** Register installed public build inputs only. No private state or account data is read. */
export async function collectFirstRunRuntimePins(projectRoot: string): Promise<Record<string, string>> {
  const root = await realpath(projectRoot), files: Record<string, string> = {};
  async function inspect(path: string, optional = false) {
    const file = resolve(root, path);
    for (let parent = file; parent !== root; parent = dirname(parent)) {
      try { if ((await lstat(parent)).isSymbolicLink()) throw Error('runtime_symlink'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    try { return await lstat(file); }
    catch (error) { if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
  async function pin(path: string, optional = false): Promise<void> {
    const info = await inspect(path, optional);
    if (!info) return;
    if (!info.isFile() || !isTrialRuntimePath(path)) throw Error('invalid_runtime_file');
    files[path] = createHash('sha256').update(await readFile(resolve(root, path))).digest('hex');
  }
  async function scan(path: string, optional = false): Promise<void> {
    const info = await inspect(path, optional);
    if (!info) return;
    if (!info.isDirectory()) throw Error('invalid_runtime_directory');
    for (const entry of (await readdir(resolve(root, path), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (excluded.has(entry.name) || /\.test\.[cm]?[jt]s$/.test(entry.name)) continue;
      const child = relative(root, resolve(root, path, entry.name)).split('\\').join('/');
      if (entry.isSymbolicLink()) throw Error('runtime_symlink');
      if (entry.isDirectory()) await scan(child);
      else if (isTrialRuntimePath(child)) await pin(child);
    }
  }
  await scan('code/desktop-pet/dist');
  await scan('code/desktop-pet/desktop');
  for (const path of ['management/ui', 'workbench', 'tools/engine-pins', 't3-native/apps/web/dist'])
    await scan('code/desktop-pet/' + path, true);

  if (await inspect('artifacts/runtime/engine-profile.json', true)) {
    await pin('artifacts/runtime/engine-profile.json');
    await scan('code/workbench/integration');
    for (const path of ['artifacts/runtime/engine-bindings/codex', 'artifacts/runtime/engine-bindings/dsh-presets.patch.yml',
      engine + '/.aaaagent-engine.json', engine + '/node/bin/node',
      'artifacts/runtime/engine-pin-54/t3-runtime/.aaaagent-prepared.json',
      'artifacts/runtime/engine-pin-54/t3-runtime/apps/server/dist/bin.mjs']) await pin(path);
    await pin(engine + '/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js', true);
    await pin('artifacts/runtime/engine-pin-54/t3-runtime/.aaaagent-native-sync-build.json', true);
    await scan('artifacts/runtime/engine-pin-54/t3-runtime/apps/server/dist');
    await scan('artifacts/runtime/engine-pin-54/t3-runtime/apps/web/dist');
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b, 'en')));
}
