import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { firstRunDraft } from '../../app/self-setup.js';
import { companionDatabaseFile, assertCompanionDataConfiguration } from '../../app/companion-data.js';
import { trialFiles, verifyTrialRuntime } from '../../app/trial-launcher.js';
import { collectFirstRunRuntimePins } from '../../app/runtime-pins.js';
import { validateTrialConfiguration } from '../../app/trial-config.js';
import { projectTerminalConfigurationFile } from '../../management/project-terminal-configuration.js';

const root = resolve(tmpdir(), 'aaaagent-public-macos-path-contract');
const draft = () => firstRunDraft(root, resolve(tmpdir(), 'aaaagent-public-macos-credential-metadata'));
const ready = () => ({
  ...draft(), sourceRevision: 'a'.repeat(40),
  runtimeFiles: Object.fromEntries([
    'dist/app/trial-backend.js', 'dist/app/trial-launcher.js', 'desktop/build/renderer.js',
    'desktop/build/星月陪伴.app/Contents/MacOS/DesktopPet',
  ].map(file => ['code/desktop-pet/' + file, 'b'.repeat(64)])),
});

test('Mac public setup, launch, companion data and project settings share the private .local layout', () => {
  const config = ready();
  assert.equal(config.database, companionDatabaseFile(root));
  assert.equal(config.database, resolve(root, '.local/data/companion.sqlite'));
  assert.equal(config.budgetFile, resolve(root, '.local/model-evaluation/budget.json'));
  assert.deepEqual(trialFiles(root), {
    configFile: resolve(root, '.local/model-evaluation/trial/user-trial/config.json'),
    activationFile: resolve(root, '.local/model-evaluation/trial/user-trial/activation.json'),
  });
  assert.equal(projectTerminalConfigurationFile(root), resolve(root, '.local/data/project-terminal-processing.json'));
  assert.doesNotThrow(() => assertCompanionDataConfiguration(config));
  assert.deepEqual(validateTrialConfiguration(config), config);
  assert.equal('localSpeech' in config, false);
  assert.equal('localDialogue' in config, false);
});

test('public layout does not relax the exact data, budget, runtime or credential boundaries', () => {
  const config = ready();
  assert.throws(() => assertCompanionDataConfiguration({ ...config, database: resolve(root, 'data/desktop-pet/companion.sqlite') }));
  assert.throws(() => validateTrialConfiguration({ ...config, budgetFile: resolve(root, 'artifacts/W0-I/model-evaluation/budget.json') }));
  assert.throws(() => validateTrialConfiguration({ ...config, runtimeFiles: { ...config.runtimeFiles, '.local/data/companion.sqlite': 'b'.repeat(64) } }));
  assert.throws(() => validateTrialConfiguration({ ...config, models: { ...config.models, dialogue: { ...config.models.dialogue, credentialFile: resolve(root, '.local/key') } } }));
  assert.throws(() => validateTrialConfiguration({ ...config, memory: { ...config.memory, mode: 'legacy' } }));
});

async function runtimeFixture(t: test.TestContext) {
  const directory = await realpath(await mkdtemp(resolve(tmpdir(), 'public-runtime-pins-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const write = async (path: string, text = 'synthetic bytes, never executed') => {
    const file = resolve(directory, path); await mkdir(dirname(file), { recursive: true }); await writeFile(file, text);
  };
  for (const file of Object.keys(ready().runtimeFiles)) await write(file);
  return { directory, write };
}

test('fresh public setup registers installed management and native UI files without reading account state', async t => {
  const f = await runtimeFixture(t);
  const assets = ['code/desktop-pet/management/ui/index.html', 'code/desktop-pet/workbench/native-mount/server.mjs',
    'code/desktop-pet/t3-native/apps/web/dist/index.html', 'code/desktop-pet/t3-native/apps/web/dist/aaa-native-read-build.json'];
  for (const path of assets) await f.write(path);
  await f.write('.local/data/t3-home/userdata/settings.json', 'private account state is not a runtime pin');
  const pins = await collectFirstRunRuntimePins(f.directory);
  for (const path of assets) assert.equal(pins[path], createHash('sha256').update(await readFile(resolve(f.directory, path))).digest('hex'));
  assert.equal(Object.keys(pins).some(path => path.startsWith('.local/')), false);
  const config = { ...ready(), projectRoot: f.directory, runtimeFiles: pins };
  await verifyTrialRuntime(config);
  await f.write(assets[0]!, 'changed asset');
  await assert.rejects(verifyTrialRuntime(config));
});

test('fresh setup pins a present Mac project engine registration and fails closed when incomplete', async t => {
  const f = await runtimeFixture(t);
  await f.write('artifacts/runtime/engine-profile.json', '{}');
  await assert.rejects(collectFirstRunRuntimePins(f.directory), { code: 'ENOENT' });
  const paths = ['code/workbench/integration/engine-pins/profile.mjs', 'code/workbench/integration/engine-pins/macos-t3-source.json',
    'code/workbench/integration/t3-source.json', 'artifacts/runtime/engine-bindings/codex',
    'artifacts/runtime/engine-bindings/dsh-presets.patch.yml',
    'artifacts/runtime/engines-codex-0.160.0-dsh-0.2.0-rc.2-darwin-arm64/.aaaagent-engine.json',
    'artifacts/runtime/engines-codex-0.160.0-dsh-0.2.0-rc.2-darwin-arm64/node/bin/node',
    'artifacts/runtime/engine-pin-54/t3-runtime/.aaaagent-prepared.json',
    'artifacts/runtime/engine-pin-54/t3-runtime/apps/server/dist/bin.mjs',
    'artifacts/runtime/engine-pin-54/t3-runtime/apps/web/dist/index.html'];
  for (const path of paths) await f.write(path);
  const pins = await collectFirstRunRuntimePins(f.directory);
  for (const path of paths) assert.match(pins[path]!, /^[a-f0-9]{64}$/);
  assert.equal(pins['artifacts/runtime/engine-profile.json'], createHash('sha256').update('{}').digest('hex'));
});

test('first-run runtime collection rejects linked build directories', async t => {
  const f = await runtimeFixture(t), target = resolve(f.directory, 'synthetic-link-target');
  await mkdir(target);
  await symlink(target, resolve(f.directory, 'code/desktop-pet/desktop/linked-build'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(collectFirstRunRuntimePins(f.directory), /runtime_symlink/);
});
