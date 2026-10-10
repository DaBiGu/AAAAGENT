#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Open the actual running backend's loopback page; no second backend or model probe.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
try {
  const session = JSON.parse(await readFile(resolve(root, '.local/model-evaluation/trial/user-trial/management-session.json'), 'utf8'));
  const url = new URL(session.url);
  if (session.version !== 1 || !Number.isSafeInteger(session.pid) || session.pid <= 0 || url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
    || url.username || url.password || url.pathname !== '/' || url.search || !url.port || !/^#token=[a-f0-9]{64}$/.test(url.hash)) throw new Error();
  process.kill(session.pid, 0);
  const response = await fetch(url.origin + '/api/snapshot', { headers: { Authorization: 'Bearer ' + url.hash.slice(7) }, signal: AbortSignal.timeout(2000), redirect: 'error' });
  if (!response.ok) throw new Error();
  const snapshot = await response.json();
  if (snapshot.apiVersion !== 1 || snapshot.runtime?.instanceId !== session.instanceId || snapshot.runtime?.pid !== session.pid
    || snapshot.runtime?.sourceRevision !== session.sourceRevision) throw new Error();
  const child = spawn('/usr/bin/open', [url.href], { stdio: 'ignore' });
  await new Promise((done, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? done() : reject(new Error())); });
  process.stdout.write('已打开当前桌宠的本机管理页面。\n');
} catch { process.stderr.write('请先启动已安装的桌宠，再打开运行管理页面。\n'); process.exitCode = 1; }
