import { assertCompanionDataConfiguration } from './companion-data.js';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readActiveTrialConfiguration, TrialNotReadyError, type TrialConfiguration } from './trial-config.js';

export function trialFiles(projectRoot: string) {
  const directory = resolve(projectRoot, '.local/model-evaluation/trial/user-trial');
  return { configFile: resolve(directory, 'config.json'), activationFile: resolve(directory, 'activation.json') };
}

/** Pin the actual launch artifacts, including ignored compiled output, before starting a process. */
export async function verifyTrialRuntime(configuration: TrialConfiguration): Promise<void> {
  for (const [path, digest] of Object.entries(configuration.runtimeFiles)) {
    try {
      const directory = path.startsWith('code/desktop-pet/') ? 'code/desktop-pet'
        : path.startsWith('code/workbench/integration/') ? 'code/workbench/integration' : 'artifacts/runtime';
      const root = await realpath(resolve(configuration.projectRoot, directory));
      const actual = await realpath(resolve(configuration.projectRoot, path));
      const local = relative(root, actual);
      if (!local || local.startsWith('..') || local.startsWith('/')) throw new Error('Outside runtime');
      if (createHash('sha256').update(await readFile(actual)).digest('hex') !== digest) throw new Error('Changed runtime');
    } catch { throw new TrialNotReadyError('试用程序文件缺失或已变化，请使用集成后的同一版本。'); }
  }
}

export async function preparedWorkbenchEnvironment(configuration: TrialConfiguration): Promise<NodeJS.ProcessEnv> {
  const paths = Object.keys(configuration.runtimeFiles);
  if (paths.includes('artifacts/runtime/engine-profile.json')) {
    try {
      const required = ['engine-lock.json','runtime-source.json','package-lock.json','runtime.mjs','profile.mjs',
        'launch.mjs','prepare-t3-adapter.mjs','t3-adapter-source.json','dsh-service.mjs','dsh-worker.mjs'];
      if (!required.every(name => paths.includes('code/workbench/integration/engine-pins/' + name)) ||
          !['artifacts/runtime/engine-bindings/codex','artifacts/runtime/engine-bindings/dsh-presets.patch.yml',
            'code/desktop-pet/dist/harness/preset.js',
            'artifacts/runtime/engines-codex-0.160.0-dsh-0.2.0-rc.2-darwin-arm64/.aaaagent-engine.json',
            'artifacts/runtime/engines-codex-0.160.0-dsh-0.2.0-rc.2-darwin-arm64/node/bin/node',
            'artifacts/runtime/engine-pin-54/t3-runtime/apps/server/dist/bin.mjs'].every(path => paths.includes(path)))
        throw Error('Incomplete project engine registration');
      const { readEngineProfile } = await import(new URL('../../../workbench/integration/engine-pins/profile.mjs', import.meta.url).href);
      const { verifyT3EngineAdapter } = await import(new URL('../../../workbench/integration/engine-pins/prepare-t3-adapter.mjs', import.meta.url).href);
      const profile = readEngineProfile(configuration.projectRoot);
      if (!profile) throw Error('Project engine profile unavailable');
      const sourceDir = resolve(configuration.projectRoot, 'artifacts/runtime/engine-pin-54/t3-runtime');
      verifyT3EngineAdapter(sourceDir);
      return { AAAAGENT_T3_PREPARED_DIR: sourceDir, AAAAGENT_T3_NODE_EXECUTABLE: profile.runtime.nodeExecutable,
        AAAAGENT_ENGINE_PROJECT_ROOT: configuration.projectRoot };
    } catch { throw new TrialNotReadyError('项目引擎运行文件缺失或已变化。'); }
  }
  const markers = paths.filter(path => /^artifacts\/runtime\/t3-[a-f0-9]{8}-[a-f0-9]{12}\/\.aaaagent-prepared\.json$/.test(path));
  const nodes = paths.filter(path => /^artifacts\/runtime\/(?:toolchain\/node-v24\.13\.1-darwin-arm64|engines-codex-0\.160\.0-dsh-0\.2\.0-rc\.2-darwin-arm64\/node)\/bin\/node$/.test(path));
  if (paths.some(path => path.startsWith('artifacts/runtime/codex-') || path === 'code/workbench/integration/codex-source.json') &&
      !markers.length) throw new TrialNotReadyError('工作台运行文件登记不完整。');
  if (!markers.length && !nodes.length) return {}; // Existing B55 installation has no workbench runtime.
  if (markers.length !== 1 || nodes.length !== 1 ||
      !['t3-source.json', 't3-local-service.mjs', 't3-http-client.mjs', 't3-child-service.mjs', 't3-host.mjs', 't3-browser.mjs'].every(name =>
        paths.includes(`code/workbench/integration/${name}`)))
    throw new TrialNotReadyError('工作台运行文件登记不完整。');
  try {
    const sourceDir = resolve(configuration.projectRoot, dirname(markers[0]!));
    const nodeExecutable = resolve(configuration.projectRoot, nodes[0]!);
    const marker = JSON.parse(await readFile(resolve(sourceDir, '.aaaagent-prepared.json'), 'utf8'));
    const lock = JSON.parse(await readFile(resolve(configuration.projectRoot, 'code/workbench/integration/t3-source.json'), 'utf8'));
    if (marker.commit !== lock.commit || marker.licenseSha256 !== lock.licenseSha256 ||
        !Array.isArray(marker.patches) || !/^[a-f0-9]{64}$/.test(marker.patchSha256) ||
        !/^[a-f0-9]{64}$/.test(marker.appliedDiffSha256) ||
        dirname(markers[0]!) !== `artifacts/runtime/t3-${lock.commit.slice(0, 8)}-${marker.patchSha256.slice(0, 12)}`)
      throw new Error('Prepared marker disagrees with source lock');
    const patchDigest = createHash('sha256');
    for (const path of marker.patches) {
      if (typeof path !== 'string' || !/^code\/workbench\/(?:integration\/)?patches\/[a-zA-Z0-9-]+\.patch$/.test(path))
        throw new Error('Unexpected prepared patch');
      patchDigest.update(path);
      patchDigest.update(await readFile(resolve(configuration.projectRoot, path)));
    }
    if (patchDigest.digest('hex') !== marker.patchSha256 ||
        execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceDir, encoding: 'utf8' }).trim() !== lock.commit ||
        createHash('sha256').update(await readFile(resolve(sourceDir, 'LICENSE'))).digest('hex') !== lock.licenseSha256 ||
        createHash('sha256').update(execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: sourceDir, encoding: 'utf8' }).trim()).digest('hex') !== marker.appliedDiffSha256)
      throw new Error('Prepared source changed');
    await readFile(resolve(sourceDir, 'apps/server/dist/bin.mjs'));
    const codexMarkers = paths.filter(path => path.endsWith('/.aaaagent-codex.json'));
    if ((codexMarkers.length || paths.includes('code/workbench/integration/codex-source.json'))) {
      if (codexMarkers.length !== 1 || !paths.includes('code/workbench/integration/codex-source.json')) throw Error('Incomplete Codex pins');
      const codex = JSON.parse(await readFile(resolve(configuration.projectRoot, codexMarkers[0]!), 'utf8'));
      const source = JSON.parse(await readFile(resolve(configuration.projectRoot, 'code/workbench/integration/codex-source.json'), 'utf8'));
      const directory = dirname(codexMarkers[0]!);
      if (JSON.stringify(codex.source) !== JSON.stringify(source) ||
          directory !== `artifacts/runtime/codex-${source.version}-${source.target}-${source.archiveSha256.slice(0,12)}` ||
          source.entrypoint !== 'bin/codex' || !codex.files?.['bin/codex'] || !codex.files?.['bin/codex-code-mode-host'] ||
          Object.entries(codex.files).some(([file, hash]) => configuration.runtimeFiles[`${directory}/${file}`] !== hash))
        throw Error('Codex runtime pins changed');
    }
    return { AAAAGENT_T3_PREPARED_DIR: sourceDir, AAAAGENT_T3_NODE_EXECUTABLE: nodeExecutable };
  } catch { throw new TrialNotReadyError('工作台本地运行文件缺失或已变化，请联系集成任务。'); }
}

export async function prepareTrialLaunch(projectRoot: string, nodePath: string, environment: NodeJS.ProcessEnv = {}) {
  const files = trialFiles(projectRoot);
  const configuration = await readActiveTrialConfiguration(files.configFile, files.activationFile);
  if (configuration.purpose !== 'user-trial') throw new TrialNotReadyError('当前是集成检查配置，用户试用入口尚未启用。');
  assertCompanionDataConfiguration(configuration);
  if (resolve(configuration.projectRoot) !== resolve(projectRoot)) throw new TrialNotReadyError('试用配置与当前项目不一致。');
  await verifyTrialRuntime(configuration);
  const workbenchEnvironment = await preparedWorkbenchEnvironment(configuration);
  const { AAAAGENT_T3_PREPARED_DIR: _oldT3Dir, AAAAGENT_T3_NODE_EXECUTABLE: _oldT3Node, AAAAGENT_ENGINE_PROJECT_ROOT: _oldEngineRoot, ...launchEnvironment } = environment;
  const desktop = resolve(projectRoot, 'code/desktop-pet/desktop');
  return {
    version: configuration.sourceRevision,
    executable: resolve(desktop, 'build/星月陪伴.app/Contents/MacOS/DesktopPet'),
    arguments: ['--root', desktop, '--backend', resolve(projectRoot, 'code/desktop-pet/dist/app/trial-backend.js'), '--node', nodePath],
    environment: { ...launchEnvironment, ...workbenchEnvironment, PET_TRIAL_CONFIG: files.configFile, PET_TRIAL_ACTIVATION: files.activationFile },
  };
}

export async function launchTrial(projectRoot: string): Promise<void> {
  const plan = await prepareTrialLaunch(projectRoot, process.execPath, process.env);
  process.stdout.write(`正在启动AAAAGENT试用版 ${plan.version.slice(0, 7)}。退出请用应用菜单或 Command-Q。\n`);
  const child = spawn(plan.executable, plan.arguments, { env: plan.environment, stdio: 'inherit' });
  await new Promise<void>((done, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done() : reject(new TrialNotReadyError('试用程序未正常退出，请保留这个窗口的信息。')));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  launchTrial(root).catch(error => {
    process.stderr.write((error instanceof TrialNotReadyError ? error.message : '试用启动失败，请检查已登记的程序与配置。') + '\n');
    process.exitCode = 1;
  });
}
