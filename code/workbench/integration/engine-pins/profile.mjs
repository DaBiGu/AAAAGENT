import { lstatSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { engineDirectory, sha256, verifyEngineRuntime } from './runtime.mjs';
import { nativePresetHostOverlay } from '../../../desktop-pet/dist/harness/preset.js';

const quoted = s => "'" + s.replaceAll("'", "'\\''") + "'";
export const profilePath = root => join(root, 'artifacts/runtime/engine-profile.json');
export function readEngineProfile(projectRoot) {
  let value;
  try { const file = profilePath(projectRoot); if (lstatSync(file).isSymbolicLink()) throw Error('Engine profile link refused');
    value = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return undefined; throw e; }
  if (value.version !== 1 || value.projectRoot !== projectRoot || value.runtimeRoot !== join(projectRoot, engineDirectory) ||
      value.home !== join(projectRoot, '.local/data/engine-home') || value.dshWebLog !== join(value.home, 'dsh-web.log') ||
      value.codexLauncher !== join(projectRoot, 'artifacts/runtime/engine-bindings/codex'))
    throw Error('Project engine profile changed');
  const userHome = userInfo().homedir;
  value.codexHome ??= join(value.home, '.codex');
  value.dshHome ??= join(value.home, '.dsh');
  for (const [path, allowed] of [[value.codexHome,[join(value.home,'.codex'),join(userHome,'.codex')]],
      [value.dshHome,[join(value.home,'.dsh'),join(userHome,'.dsh')]]]) {
    if (!allowed.includes(path) || realpathSync(path) !== path || lstatSync(path).uid !== process.getuid())
      throw Error('Explicit project engine data home changed');
  }
  const runtime = verifyEngineRuntime(value.runtimeRoot);
  if (sha256(readFileSync(value.codexLauncher)) !== sha256(codexLauncher(runtime, value.home, value.codexHome))) throw Error('Project Codex launcher changed');
  if (value.dshPresetOverlay !== join(projectRoot, 'artifacts/runtime/engine-bindings/dsh-presets.patch.yml') ||
      readFileSync(value.dshPresetOverlay, 'utf8') !== presetOverlay(projectRoot, value.home, runtime.nodeExecutable, value.dshHome))
    throw Error('Project DSH preset overlay changed');
  return { ...value, runtime };
}

export function presetOverlay(root, home, nodeExecutable, dshHome = join(home,'.dsh')) {
  return nativePresetHostOverlay({ dshHome, projectRoot: root, nodeExecutable,
    managementDescriptor: join(root,'.local/model-evaluation/trial/user-trial/management-session.json') });
}

export function codexLauncher(runtime, home, codexHome = join(home, '.codex')) {
  return '#!/bin/sh\nexec /usr/bin/env ' + quoted('HOME=' + home) + ' ' + quoted('CODEX_HOME=' + codexHome) + ' ' + quoted('DSH_HOME=' + join(home, '.dsh')) + ' ' + quoted(runtime.nodeExecutable) + ' ' +
    quoted(resolve(runtime.root, '../../..', 'code/workbench/integration/engine-pins/launch.mjs')) + ' ' + quoted(runtime.root) + ' codex "$@"\n';
}

/** Only for an empty new deployment home; migration of an existing home is a separate explicit step. */
export function projectT3EngineSettings(original, profile) {
  return { ...original, providers: { ...original.providers,
      codex: { ...original.providers?.codex, enabled: false } },
    providerInstances: { ...original.providerInstances,
      codex: { ...original.providerInstances?.codex, driver: 'codex', enabled: true,
        config: { ...original.providerInstances?.codex?.config, binaryPath: profile.codexLauncher, homePath: profile.codexHome } },
      dsh: { ...original.providerInstances?.dsh, driver: 'dsh', enabled: true,
        config: { ...original.providerInstances?.dsh?.config, agentPreset: 'desktop-pet-work-v1' } } } };
}

export function installEngineProfile(projectRoot, runtimeRoot, t3Home, { codexHome, dshHome, preserveSettings = false } = {}) {
  const runtime = verifyEngineRuntime(runtimeRoot), home = join(projectRoot, '.local/data/engine-home');
  if (runtimeRoot !== join(projectRoot, engineDirectory)) throw Error('Project-owned runtime required');
  // Existing homes must be explicitly idle. Unknown/stale owner records also need reconciliation.
  for (const name of ['.aaaagent-t3-host.json','.aaaagent-t3-host.lock','.aaaagent-t3-owner.json']) {
    try { lstatSync(join(t3Home,name)); throw Error('Stop the registered T3 background before binding an existing home'); }
    catch(e) { if(e.code !== 'ENOENT') throw e; }
  }
  const launcher = join(projectRoot, 'artifacts/runtime/engine-bindings/codex');
  mkdirSync(dirname(launcher), { recursive: true, mode: 0o700 });
  writeFileSync(launcher, codexLauncher(runtime, home, codexHome ?? join(home,'.codex')), { flag: 'wx', mode: 0o700 });
  mkdirSync(home, { recursive: true, mode: 0o700 });
  for (const name of ['.codex', '.dsh']) mkdirSync(join(home, name), { mode: 0o700 });
  const dshPresetOverlay=join(projectRoot,'artifacts/runtime/engine-bindings/dsh-presets.patch.yml');
  writeFileSync(dshPresetOverlay,presetOverlay(projectRoot,home,runtime.nodeExecutable,dshHome ?? join(home,'.dsh')),{flag:'wx',mode:0o600});
  const profile = { version: 1, projectRoot, runtimeRoot, home, dshWebLog: join(home, 'dsh-web.log'), codexLauncher: launcher, dshPresetOverlay, codexHome: codexHome ?? join(home,'.codex'), dshHome: dshHome ?? join(home,'.dsh') };
  const settings = join(t3Home, 'userdata/settings.json'); mkdirSync(dirname(settings), { recursive: true, mode: 0o700 });
  const original = preserveSettings ? JSON.parse(readFileSync(settings,'utf8')) : {};
  writeFileSync(settings, JSON.stringify(projectT3EngineSettings(original,profile),null,2)+'\n',
    { ...(preserveSettings ? {} : {flag:'wx'}), mode:0o600 });
  writeFileSync(profilePath(projectRoot), JSON.stringify(profile, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return readEngineProfile(projectRoot);
}

export function verifyT3EngineSettings(t3Home, profile) {
  const settings = JSON.parse(readFileSync(join(t3Home, 'userdata/settings.json'), 'utf8'));
  for (const [id, provider] of Object.entries(settings.providerInstances ?? {})) {
    if (provider.driver !== 'codex' || provider.enabled === false) continue;
    if (provider.config?.binaryPath !== profile.codexLauncher || provider.config?.homePath !== profile.codexHome)
      throw Error('T3 project engine binding changed: ' + id);
  }
  if (settings.providers?.codex?.enabled !== false) throw Error('Legacy Codex fallback must be disabled');
  if (settings.providerInstances?.dsh?.driver !== 'dsh' || settings.providerInstances.dsh.enabled !== true ||
      settings.providerInstances.dsh.config?.agentPreset !== 'desktop-pet-work-v1') throw Error('Project DSH preset binding changed');
}
