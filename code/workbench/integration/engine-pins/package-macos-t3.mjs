import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineInventory, here, sha256 } from './runtime.mjs';

const ignored = new Set(['node_modules', '.git', 'dist', 'dist-exe', '.generated', '.vite', '.turbo', 'coverage', '.aaaagent-prepared.json', '.aaa-native-ui.json']);
const inside = (root, file) => { const value = relative(root, file); return !isAbsolute(value) && value !== '..' && !value.startsWith('../') && !value.startsWith('..\\'); };

function sourceInventory(root) {
  const files = {};
  function visit(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (ignored.has(entry.name)) continue;
      const key = prefix + entry.name, file = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw Error('Source fingerprint requires ordinary files');
      if (entry.isDirectory()) visit(file, key + '/');
      else if (entry.isFile()) files[key] = sha256(readFileSync(file));
    }
  }
  visit(root); return files;
}

function patchInventory(projectRoot, expected) {
  const files = {}, digest = createHash('sha256');
  for (const directory of ['code/workbench/patches', 'code/workbench/integration/patches']) {
    for (const name of readdirSync(join(projectRoot, directory)).filter(name => name.endsWith('.patch')).sort()) {
      const key = directory + '/' + name, bytes = readFileSync(join(projectRoot, key));
      digest.update(key); digest.update(bytes); files[key] = sha256(bytes);
    }
  }
  if (digest.digest('hex') !== expected) throw Error('Native session source patch set changed');
  return files;
}

function locatePackage(name, from, sourceRoot) {
  for (const base of createRequire(join(from, 'package.json')).resolve.paths(name) ?? []) {
    const file = join(base, name, 'package.json');
    if (existsSync(file)) return realpathSync(dirname(file));
  }
  const store = join(sourceRoot, 'node_modules/.pnpm');
  const matches = existsSync(store) ? readdirSync(store).filter(entry => entry.startsWith(name.replace('/', '+') + '@'))
    .map(entry => join(store, entry, 'node_modules', name)).filter(path => existsSync(join(path, 'package.json'))) : [];
  if (matches.length === 1) return realpathSync(matches[0]);
  throw Error('Missing installed runtime dependency: ' + name);
}

function platformMatches(value, actual) {
  if (!Array.isArray(value)) return true;
  if (value.includes('!' + actual)) return false;
  const positive = value.filter(item => !item.startsWith('!'));
  return !positive.length || positive.includes(actual);
}

function requireOrdinaryTree(directory) {
  if (!lstatSync(directory).isDirectory()) throw Error('Build output directory must not be linked');
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw Error('Build output links are not accepted');
    if (entry.isDirectory()) requireOrdinaryTree(file);
    else if (!entry.isFile()) throw Error('Unexpected build output entry');
  }
}

/** Package existing Apple Silicon build outputs; no installer, build, service or model is invoked. */
export function packageMacosT3Runtime(source, target) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('macOS arm64 packaging required');
  source = realpathSync(source); target = resolve(target);
  if (inside(source, target) || inside(target, source)) throw Error('Source and runtime target must be separate');
  if (existsSync(target)) throw Error('Runtime target already exists; retain it and choose a fresh target');
  for (const name of ['apps/server/dist/bin.mjs', 'apps/web/dist/index.html']) {
    if (!lstatSync(join(source, name)).isFile()) throw Error('Build output missing or linked');
  }
  for (const directory of ['apps/server/dist', 'apps/web/dist']) requireOrdinaryTree(join(source, directory));
  if (/\/native\/assets\//.test(readFileSync(join(source, 'apps/web/dist/index.html'), 'utf8')))
    throw Error('The standalone workbench requires the normal web build');
  const projectRoot = resolve(here, '../../../..');
  const sourceLockBytes = readFileSync(join(here, '../t3-source.json'));
  const sourceLock = JSON.parse(sourceLockBytes);
  const nativeLockBytes = readFileSync(join(here, 'native-sync-source.json'));
  const nativeLock = JSON.parse(nativeLockBytes);
  if (sourceLock.commit !== nativeLock.upstream_commit || sha256(readFileSync(join(source, 'LICENSE'))) !== sourceLock.licenseSha256)
    throw Error('T3 source or license pin changed');
  const patches = patchInventory(projectRoot, nativeLock.patch_sha256), sourceFiles = sourceInventory(source);
  const adapterFile = join(here, 't3-adapter-source.json'), adapterBytes = readFileSync(adapterFile);
  const adapter = JSON.parse(adapterBytes);
  if (adapter.sourceCommit !== sourceLock.commit) throw Error('T3 adapter source pin changed');
  mkdirSync(dirname(target), { recursive: true });
  const stage = target + '.stage-' + randomUUID(), packages = new Map();
  mkdirSync(stage);
  try {
    cpSync(join(source, 'apps/server/dist'), join(stage, 'apps/server/dist'), { recursive: true, dereference: true });
    cpSync(join(source, 'apps/web/dist'), join(stage, 'apps/web/dist'), { recursive: true, dereference: true });
    cpSync(join(source, 'apps/web/dist'), join(stage, 'apps/server/dist/client'), { recursive: true, dereference: true });
    cpSync(join(source, 'apps/server/package.json'), join(stage, 'apps/server/package.json'));
    cpSync(join(source, 'LICENSE'), join(stage, 'LICENSE'));
    const modules = join(stage, 'apps/server/node_modules');
    function copyPackage(name, from, optional = false) {
      if (!/^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..')
        throw Error('Invalid runtime dependency name');
      let directory;
      try { directory = locatePackage(name, from, source); } catch (error) { if (optional) return; throw error; }
      const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      if (pkg.name !== name || !platformMatches(pkg.os, 'darwin') || !platformMatches(pkg.cpu, 'arm64')) {
        if (optional) return;
        throw Error('Runtime dependency has the wrong identity or platform: ' + name);
      }
      if (packages.has(name)) {
        if (packages.get(name) !== pkg.version) throw Error('Runtime dependency version conflict: ' + name);
        return;
      }
      packages.set(name, pkg.version);
      cpSync(directory, join(modules, name), { recursive: true, dereference: true,
        filter: path => path === directory || !['node_modules', '.git'].includes(path.slice(directory.length + 1).split(/[\\/]/)[0]) });
      for (const child of Object.keys(pkg.dependencies ?? {}).sort()) copyPackage(child, directory);
      for (const child of Object.keys(pkg.optionalDependencies ?? {}).sort()) copyPackage(child, directory, true);
    }
    for (const name of ['node-pty', '@ff-labs/fff-node', 'ws']) copyPackage(name, join(source, 'apps/server'));
    const marker = { commit: sourceLock.commit, licenseSha256: sourceLock.licenseSha256, patchSha256: nativeLock.patch_sha256 };
    writeFileSync(join(stage, '.aaaagent-prepared.json'), JSON.stringify(marker, null, 2) + '\n');
    const receipt = { version: 1, platform: 'darwin', arch: 'arm64', sourceCommit: sourceLock.commit,
      importedProjectRevision: '3798c0e6da49fc03dec6a0b05bb4beb46d99edfe', patchSha256: nativeLock.patch_sha256,
      nativeSourceLockSha256: sha256(nativeLockBytes), upstreamSourceLockSha256: sha256(sourceLockBytes), patches,
      files: sourceFiles, packages: Object.fromEntries([...packages].sort()) };
    const receiptBytes = JSON.stringify(receipt, null, 2) + '\n', inventory = engineInventory(realpathSync(stage));
    adapter.macosRuntime = { version: 1, package: 'AAAAGENT-MACOS-T3-20261010', platform: 'darwin', arch: 'arm64',
      sourceCommit: sourceLock.commit, sourceLockSha256: sha256(receiptBytes), inventorySha256: sha256(JSON.stringify(inventory)),
      nativeSourceLockSha256: sha256(nativeLockBytes), upstreamSourceLockSha256: sha256(sourceLockBytes),
      serverBundleSha256: sha256(readFileSync(join(stage, 'apps/server/dist/bin.mjs'))),
      markerSha256: sha256(readFileSync(join(stage, '.aaaagent-prepared.json'))) };
    // Only publish locks after every file and dependency has been copied successfully.
    const receiptFile = join(here, 'macos-t3-source.json');
    const previousReceipt = existsSync(receiptFile) ? readFileSync(receiptFile) : undefined;
    renameSync(stage, target);
    try {
      writeFileSync(receiptFile, receiptBytes);
      writeFileSync(adapterFile, JSON.stringify(adapter, null, 2) + '\n');
    } catch (error) {
      writeFileSync(adapterFile, adapterBytes);
      if (previousReceipt) writeFileSync(receiptFile, previousReceipt); else rmSync(receiptFile, { force: true });
      throw error; // Keep the complete, unregistered target for inspection rather than deleting it.
    }
    return { target, packageCount: packages.size, fileCount: Object.keys(inventory).length,
      sourceFileCount: Object.keys(sourceFiles).length, inventorySha256: adapter.macosRuntime.inventorySha256 };
  } finally {
    // This name was created by this invocation, beside the explicitly selected target.
    if (dirname(stage) !== dirname(target) || !stage.startsWith(target + '.stage-')) throw Error('Invalid owned stage');
    rmSync(stage, { recursive: true, force: true });
  }
}

/** Register the exact packaged public source for the existing /native/ renderer builder. */
export function prepareMacosNativeReadAssembly(source) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('macOS arm64 packaging required');
  source = realpathSync(source);
  const receiptBytes = readFileSync(join(here, 'macos-t3-source.json')), receipt = JSON.parse(receiptBytes);
  const adapter = JSON.parse(readFileSync(join(here, 't3-adapter-source.json'), 'utf8')).macosRuntime;
  const patches = patchInventory(resolve(here, '../../../..'), receipt.patchSha256);
  if (!adapter || adapter.platform !== 'darwin' || adapter.arch !== 'arm64' ||
      sha256(receiptBytes) !== adapter.sourceLockSha256 ||
      sha256(readFileSync(join(here, 'native-sync-source.json'))) !== adapter.nativeSourceLockSha256 ||
      sha256(readFileSync(join(here, '../t3-source.json'))) !== adapter.upstreamSourceLockSha256 ||
      JSON.stringify(patches) !== JSON.stringify(receipt.patches) ||
      JSON.stringify(sourceInventory(source)) !== JSON.stringify(receipt.files))
    throw Error('Public source changed after normal runtime packaging');
  const marker = { version: 1, package: adapter.package, output: source, upstream_commit: receipt.sourceCommit,
    patch_sha256: receipt.patchSha256, publicSourceLockSha256: adapter.sourceLockSha256, env_auth_state_copied: false };
  const file = join(source, '.aaa-native-ui.json'), bytes = JSON.stringify(marker, null, 2) + '\n';
  if (existsSync(file)) {
    if (!lstatSync(file).isFile() || readFileSync(file, 'utf8') !== bytes) throw Error('Existing native-read assembly changed');
  } else writeFileSync(file, bytes, { flag: 'wx' });
  return marker;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(here, '../../../..'), args = process.argv.slice(2);
  if (args[0] === '--prepare-native-read') {
    if (args.length > 2) throw Error('Usage: package-macos-t3.mjs --prepare-native-read [SOURCE_DIR]');
    console.log(JSON.stringify(prepareMacosNativeReadAssembly(args[1] ?? join(root, 't3-source'))));
  } else {
    if (args.length > 2) throw Error('Usage: package-macos-t3.mjs [SOURCE_DIR [NEW_RUNTIME_DIR]]');
    console.log(JSON.stringify(packageMacosT3Runtime(args[0] ?? join(root, 't3-source'),
      args[1] ?? join(root, 'artifacts/runtime/engine-pin-54/t3-runtime'))));
  }
}
