import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JellyfishRenderer, createPresentationPreview } from '../live2d-unavailable.mjs';

async function fixture(t) {
  const prefix=join(tmpdir(),'aaaagent-macos-public-'),root=await mkdtemp(prefix);
  t.after(async()=>{assert.ok(resolve(root).startsWith(resolve(prefix)));await rm(root,{recursive:true,force:true});});
  for(const name of ['optional-live2d-build.mjs','model-build-options.mjs','live2d-unavailable.mjs'])
    await copyFile(new URL('../'+name,import.meta.url),join(root,name));
  return root;
}
test('public desktop and preview bundle without models or the Cubism SDK', async t => {
  const root=await fixture(t);
  const {optionalLive2dBuild}=await import(pathToFileURL(join(root,'optional-live2d-build.mjs')));
  const selected=await optionalLive2dBuild();assert.equal(selected.available,false);
  const desktop=await build({entryPoints:[fileURLToPath(new URL('../main.mjs',import.meta.url))],bundle:true,format:'esm',platform:'browser',target:'safari17',write:false,metafile:true,plugins:selected.plugins});
  const preview=await build({entryPoints:[selected.previewEntry],bundle:true,format:'esm',platform:'browser',write:false,metafile:true});
  for(const result of [desktop,preview]){
    const inputs=Object.keys(result.metafile.inputs);
    assert.ok(inputs.some(input=>input.endsWith('live2d-unavailable.mjs')));
    assert.ok(inputs.every(input=>!/vendor[\\/]cubism|assets[\\/]jellyfish|cubism-renderer\.mjs/.test(input)));
  }
  assert.ok(Object.keys(desktop.metafile.inputs).some(input=>input.endsWith('video-pet-renderer.mjs')));
  const renderer=new JellyfishRenderer();assert.equal(renderer.ready,false);
  await assert.rejects(renderer.load(),{code:'LIVE2D_RESOURCES_MISSING'});
  const states=[];
  await assert.rejects(createPresentationPreview({onStatus:state=>states.push(state)}),{code:'LIVE2D_RESOURCES_MISSING'});
  assert.deepEqual(states.map(state=>state.state),['error']);
});
test('installed graphics mappings resolve from the ignored local asset directory', async t => {
  const root=await fixture(t),assets=join(root,'assets','local-model');
  await mkdir(assets,{recursive:true});
  await writeFile(join(assets,'presets.json'),'{"synthetic":"catalog"}');
  await writeFile(join(assets,'parameter-map.json'),'{"synthetic":"parameters"}');
  const {modelPlugins}=await import(pathToFileURL(join(root,'model-build-options.mjs')));
  const result=await build({stdin:{contents:"import presets from './assets/jellyfish/presets.json'; import mapping from './config/parameter-map.json'; export {presets,mapping};",resolveDir:root},bundle:true,format:'esm',write:false,metafile:true,plugins:modelPlugins});
  const inputs=Object.keys(result.metafile.inputs).filter(input=>input!=='<stdin>');
  assert.equal(inputs.length,2);assert.ok(inputs.every(input=>input.includes('local-model')));
});
