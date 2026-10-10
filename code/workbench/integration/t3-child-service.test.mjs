import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T3LocalService } from './t3-local-service.mjs';
import { T3ChildService } from './t3-child-service.mjs';

const lock = JSON.parse(readFileSync(new URL('./t3-source.json', import.meta.url)));
const patch = 'a'.repeat(64);
const fake = `import {readFileSync} from 'node:fs';import {createServer} from 'node:http';
const boot=JSON.parse(readFileSync(3,'utf8'));const s=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/oauth/token'?{access_token:'synthetic-token-'.repeat(4),token_type:'Bearer',expires_in:3600}:{environmentId:'synthetic'}));});s.listen(boot.port,boot.host);process.on('SIGTERM',()=>s.close(()=>process.exit(0)));`;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aaa-t3-runtime-source-'));
  const sourceDir = join(root, 'logical'), runtimeSourceDir = join(root, 'runtime');
  mkdirSync(sourceDir); mkdirSync(join(runtimeSourceDir, 'apps/server/dist'), { recursive: true });
  writeFileSync(join(runtimeSourceDir, '.aaaagent-prepared.json'), JSON.stringify({ ...lock, patchSha256: patch }));
  writeFileSync(join(runtimeSourceDir, 'apps/server/dist/bin.mjs'), fake);
  return { root, options: { sourceDir, runtimeSourceDir, runtimePatchSha256: patch, nodeExecutable: process.execPath,
    baseDir: join(root, 'home'), logFile: join(root, 'host.log') } };
}
test('bounded runtime source preserves logical installed identity and shares one original-home backend', async () => {
  const {root,options} = fixture(); const candidate = new T3LocalService(options);
  const {runtimeSourceDir: _source, runtimePatchSha256: _patch, ...installedOptions} = options;
  const installed = new T3LocalService(installedOptions);
  try {
    const current = await candidate.start(); const other = await installed.start();
    assert.equal(other.pid, current.pid); assert.equal(other.sourceDir, options.runtimeSourceDir);
    assert.equal(other.patchSha256, patch);
    const descriptor = JSON.parse(readFileSync(join(options.baseDir, '.aaaagent-t3-host.json')));
    assert.equal(descriptor.sourceDir, options.sourceDir); assert.equal(descriptor.runtimeSourceDir, options.runtimeSourceDir);
    await assert.rejects(new T3ChildService(options).start(), /already has an owner/);
    await installed.stop(); assert.equal((await candidate.start()).pid, current.pid);
  } finally { await candidate.stopBackground().catch(()=>{}); rmSync(root,{recursive:true,force:true}); }
});
test('an unpinned or mismatched runtime source never acquires the original-home lease', async () => {
  const {root,options} = fixture();
  try {
    assert.throws(()=>new T3ChildService({...options,runtimePatchSha256:undefined}), /exact patch fingerprint/);
    await assert.rejects(new T3ChildService({...options,runtimePatchSha256:'b'.repeat(64)}).start(), /runtime patch mismatch/);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
