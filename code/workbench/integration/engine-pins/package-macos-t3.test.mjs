import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { packageMacosT3Runtime } from './package-macos-t3.mjs';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (file, bytes) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes); };
const writeJson = (file, value) => write(file, JSON.stringify(value) + '\n');

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'aaaagent-macos-package-test-'));
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(), 'aaaagent-macos-package-test-')));
    rmSync(root, { recursive: true, force: true });
  });
  const pins = join(root, 'code/workbench/integration/engine-pins');
  mkdirSync(pins, { recursive: true });
  for (const name of ['package-macos-t3.mjs', 'prepare-t3-adapter.mjs', 'runtime.mjs'])
    cpSync(join(moduleDirectory, name), join(pins, name));
  const patch = 'code/workbench/integration/patches/0007-explicit-strict-policy-0160.patch';
  const patchBytes = 'synthetic strict policy patch\n';
  mkdirSync(join(root, 'code/workbench/patches'), { recursive: true });
  write(join(root, patch), patchBytes);
  const patchSha = createHash('sha256').update(patch).update(patchBytes).digest('hex');
  const license = 'Synthetic test license; no upstream content.\n';
  writeJson(join(pins, 'engine-lock.json'), { codex: { version: '0.160.0' }, dsh: { version: '0.2.0-rc.2' }, target: 'darwin-arm64' });
  writeJson(join(pins, '../t3-source.json'), { commit: 'synthetic-upstream', licenseSha256: sha(license) });
  writeJson(join(pins, 'native-sync-source.json'), { upstream_commit: 'synthetic-upstream', patch_sha256: patchSha });
  writeJson(join(pins, 't3-adapter-source.json'), { sourceCommit: 'synthetic-upstream', strictPolicySourcePatchSha256: sha(patchBytes),
    nativeSyncRuntime: { package: 'preserved-legacy-lock', inventorySha256: 'not-this-fixture' } });
  const source = join(root, 't3-source'), target = join(root, 'artifacts/runtime/engine-pin-54/t3-runtime');
  write(join(source, 'LICENSE'), license);
  write(join(source, 'apps/server/dist/bin.mjs'), '/* synthetic server; never executed */\n');
  write(join(source, 'apps/server/dist/worker.mjs'), '/* synthetic worker */\n');
  write(join(source, 'apps/web/dist/index.html'), '<script src="/assets/entry.js"></script>');
  write(join(source, 'apps/web/dist/assets/entry.js'), '/* synthetic web */\n');
  writeJson(join(source, 'apps/server/package.json'), { name: 't3', version: 'test' });
  writeJson(join(source, 'package.json'), { name: 'fixture' });
  const packageFile = name => join(source, 'node_modules', name, 'package.json');
  for (const [name, extra] of [
    ['node-pty', { dependencies: { 'node-addon-api': '1' } }],
    ['node-addon-api', {}],
    ['@ff-labs/fff-node', { optionalDependencies: { '@ff-labs/fff-darwin-arm64': '1', '@ff-labs/fff-win32-x64': '1', 'absent-optional': '1' } }],
    ['@ff-labs/fff-darwin-arm64', { os: ['darwin'], cpu: ['arm64'] }],
    ['@ff-labs/fff-win32-x64', { os: ['win32'], cpu: ['x64'] }],
    ['ws', {}],
  ]) {
    writeJson(packageFile(name), { name, version: '1.0.0', ...extra });
    write(join(dirname(packageFile(name)), 'index.js'), '/* synthetic dependency */\n');
    write(join(dirname(packageFile(name)), 'LICENSE'), 'Synthetic dependency license.\n');
  }
  const pack = await import(pathToFileURL(join(pins, 'package-macos-t3.mjs')).href);
  const verify = await import(pathToFileURL(join(pins, 'prepare-t3-adapter.mjs')).href);
  return { root, pins, patch: join(root, patch), source, target, packageFile, ...pack, ...verify };
}

// A simulated platform exercises file-copy/lock logic only. It never executes native binaries.
function onMockMac(operation) {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform'), arch = Object.getOwnPropertyDescriptor(process, 'arch');
  Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' });
  Object.defineProperty(process, 'arch', { ...arch, value: 'arm64' });
  try { return operation(); }
  finally { Object.defineProperty(process, 'platform', platform); Object.defineProperty(process, 'arch', arch); }
}

test('real unsupported host cannot package a macOS runtime', { skip: process.platform === 'darwin' && process.arch === 'arm64' }, () => {
  assert.throws(() => packageMacosT3Runtime('does-not-exist', 'must-not-be-created'), /macOS arm64/);
});

test('mock Mac packages the dependency closure, licenses, client and complete pins', async t => {
  const f = await fixture(t);
  onMockMac(() => {
    const result = f.packageMacosT3Runtime(f.source, f.target);
    assert.equal(result.packageCount, 5);
    assert.ok(existsSync(join(f.target, 'apps/server/dist/client/assets/entry.js')));
    assert.ok(existsSync(join(f.target, 'apps/server/node_modules/node-addon-api/LICENSE')));
    assert.ok(existsSync(join(f.target, 'apps/server/node_modules/@ff-labs/fff-darwin-arm64/index.js')));
    assert.ok(!existsSync(join(f.target, 'apps/server/node_modules/@ff-labs/fff-win32-x64')));
    const receipt = JSON.parse(readFileSync(join(f.pins, 'macos-t3-source.json')));
    assert.ok(receipt.files['apps/server/package.json']);
    assert.ok(!Object.keys(receipt.files).some(path => /node_modules|\/dist\//.test(path)));
    const adapter = JSON.parse(readFileSync(join(f.pins, 't3-adapter-source.json')));
    assert.equal(adapter.nativeSyncRuntime.package, 'preserved-legacy-lock');
    assert.equal(f.verifyT3EngineAdapter(f.target).inventorySha256, result.inventorySha256);
    for (const file of [join(f.target, 'apps/server/node_modules/ws/index.js'), join(f.target, 'apps/server/dist/client/index.html'),
      join(f.target, '.aaaagent-prepared.json'), join(f.pins, 'macos-t3-source.json'), join(f.pins, 'native-sync-source.json'), f.patch]) {
      const original = readFileSync(file); writeFileSync(file, Buffer.concat([original, Buffer.from('changed')]));
      assert.throws(() => f.verifyT3EngineAdapter(f.target));
      writeFileSync(file, original);
    }
    assert.equal(f.verifyT3EngineAdapter(f.target).inventorySha256, result.inventorySha256);
    assert.throws(() => f.packageMacosT3Runtime(f.source, f.target), /already exists/);
  });
});

test('mock Mac refuses wrong required native platform without publishing files or locks', async t => {
  const f = await fixture(t), adapter = readFileSync(join(f.pins, 't3-adapter-source.json'));
  writeJson(f.packageFile('node-pty'), { name: 'node-pty', version: '1', os: ['win32'] });
  onMockMac(() => assert.throws(() => f.packageMacosT3Runtime(f.source, f.target), /wrong identity or platform/));
  assert.ok(!existsSync(f.target));
  assert.ok(!existsSync(join(f.pins, 'macos-t3-source.json')));
  assert.deepEqual(readFileSync(join(f.pins, 't3-adapter-source.json')), adapter);
  assert.deepEqual(readdirSync(dirname(f.target)), []);
});

test('mock Mac refuses incomplete, native-read and changed-source candidates', async t => {
  const f = await fixture(t), index = join(f.source, 'apps/web/dist/index.html');
  onMockMac(() => {
    assert.throws(() => f.packageMacosT3Runtime(f.source, join(f.source, 'nested-runtime')), /separate/);
    const normal = readFileSync(index); writeFileSync(index, '<script src="/native/assets/entry.js"></script>');
    assert.throws(() => f.packageMacosT3Runtime(f.source, f.target), /normal web/); writeFileSync(index, normal);
    const patch = readFileSync(f.patch); writeFileSync(f.patch, 'changed source patch');
    assert.throws(() => f.packageMacosT3Runtime(f.source, f.target), /patch set changed/); writeFileSync(f.patch, patch);
    rmSync(join(f.source, 'apps/server/dist/bin.mjs'));
    assert.throws(() => f.packageMacosT3Runtime(f.source, f.target));
    assert.ok(!existsSync(f.target));
  });
});

test('mock Mac registers native-read assembly only from the exact packaged source', async t => {
  const f = await fixture(t);
  onMockMac(() => {
    assert.throws(() => f.prepareMacosNativeReadAssembly(f.source));
    f.packageMacosT3Runtime(f.source, f.target);
    const marker = f.prepareMacosNativeReadAssembly(f.source);
    assert.equal(marker.output, f.source);
    assert.equal(marker.env_auth_state_copied, false);
    assert.deepEqual(f.prepareMacosNativeReadAssembly(f.source), marker);
    const file = join(f.source, 'apps/server/package.json'), original = readFileSync(file);
    writeFileSync(file, 'changed');
    assert.throws(() => f.prepareMacosNativeReadAssembly(f.source), /source changed/);
    writeFileSync(file, original);
    writeFileSync(join(f.source, '.aaa-native-ui.json'), '{}');
    assert.throws(() => f.prepareMacosNativeReadAssembly(f.source), /assembly changed/);
  });
});
