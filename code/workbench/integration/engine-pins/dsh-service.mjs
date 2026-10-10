import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants, closeSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEngineProfile } from './profile.mjs';

const files = p => ({ lock: join(p.home,'.aaaagent-dsh-host.lock'), descriptor: join(p.home,'.aaaagent-dsh-host.json') });
const sleep = ms => new Promise(done=>setTimeout(done,ms));
export function readDshHost(projectRoot, verifiedProfile) {
  const profile=verifiedProfile ?? readEngineProfile(projectRoot); if(!profile) throw Error('Project engine profile required');
  const {descriptor}=files(profile), st=lstatSync(descriptor);
  if(!st.isFile() || st.isSymbolicLink() || st.mode&0o077 || st.uid!==process.getuid()) throw Error('Unsafe DSH host descriptor');
  const d=JSON.parse(readFileSync(descriptor,'utf8'));
  if(d.version!==1 || d.projectRoot!==projectRoot || d.runtimeRoot!==profile.runtimeRoot ||
     d.home!==profile.home || d.dataHome!==profile.dshHome || d.inventorySha256!==profile.runtime.inventorySha256 || !Number.isSafeInteger(d.pid) ||
     !Number.isSafeInteger(d.childPid) || d.childPid<1 || d.pid<1 ||
     !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(d.origin)) throw Error('DSH host identity changed');
  process.kill(d.pid,0);process.kill(d.childPid,0);return d;
}

/** A native DSH Host in the pinned project home. An uncertain lease is never stolen or replayed. */
export async function ensureDshHost(projectRoot) {
  try{return readDshHost(projectRoot);}catch(e){if(e.code!=='ENOENT')throw e;}
  const profile=readEngineProfile(projectRoot);if(!profile)throw Error('Project engine profile required');
  const {lock}=files(profile);mkdirSync(profile.home,{recursive:true,mode:0o700});const nonce=randomUUID();let owned=false;
  try{const fd=openSync(lock,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
    try{writeFileSync(fd,JSON.stringify({nonce,launcherPid:process.pid}));owned=true;}finally{closeSync(fd);}}
  catch(e){if(e.code!=='EEXIST')throw e;}
  if(owned){
    const worker=spawn(profile.runtime.nodeExecutable,[fileURLToPath(new URL('./dsh-worker.mjs',import.meta.url))],
      {detached:true,stdio:['ignore','ignore','ignore','pipe'],env:{PATH:profile.runtime.root+'/node/bin:/usr/bin:/bin',LANG:'en_US.UTF-8'}});
    try{await new Promise((done,reject)=>{worker.once('spawn',done);worker.once('error',reject);});
      worker.stdio[3].end(JSON.stringify({projectRoot,nonce})+'\n');worker.unref();}
    catch(e){try{if(JSON.parse(readFileSync(lock,'utf8')).nonce===nonce)unlinkSync(lock);}catch{}throw e;}
  }
  const deadline=Date.now()+40000;
  while(Date.now()<deadline){try{return readDshHost(projectRoot);}catch(e){if(e.code!=='ENOENT')throw e;}await sleep(100);}
  throw Error('DSH project startup incomplete; reconcile its registered owner before another launch');
}

export async function stopDshHost(projectRoot) {
  const d=readDshHost(projectRoot);process.kill(d.pid,'SIGTERM');
  const deadline=Date.now()+8000;
  while(Date.now()<deadline){try{process.kill(d.pid,0);}catch(e){if(e.code==='ESRCH')return;throw e;}await sleep(100);}
  throw Error('DSH exit unconfirmed; no forced replacement');
}
