import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { readPresentationCatalog, PresentationSettingsStore } from '../../management/presentation.js';
import { presentationAssetRoutes } from '../../management/presentation-assets.js';

async function fixture(t: test.TestContext) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'video-presentation-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const base = resolve(root, 'code/desktop-pet/desktop/assets/local-model/dsh-pet');
  await mkdir(resolve(base, 'assets/webm'), { recursive: true });
  const catalog = { nativeActions: [{ id: 'native:idle', video: 'idle', file: 'assets/webm/idle.webm' },
    { id: 'native:happy', video: 'happy', file: 'assets/webm/happy.webm' }],
    actions: [{ id: 'idle', video: 'idle', label: '待机' }, { id: 'happy', video: 'happy', label: '开心' }] };
  await writeFile(resolve(base, 'catalog.json'), JSON.stringify(catalog));
  for (const file of ['idle', 'happy']) await writeFile(resolve(base, 'assets/webm/' + file + '.webm'), 'synthetic never played ' + file);
  return { root, base, catalog };
}

test('video-only first-run catalog and management routes require no Live2D model or SDK', async t => {
  const f = await fixture(t), catalog = await readPresentationCatalog(f.root), routes = await presentationAssetRoutes(f.root);
  assert.equal(catalog.modelId, 'dsh-video-pet');
  assert.ok(catalog.items.some(item => item.id === 'exp-tushe' && item.defaultEnabled));
  assert.deepEqual([...routes.keys()].sort(), ['/presentation-video/exp-tushe.webm', '/presentation-video/exp-xingxingyan.webm', '/presentation-video/video-idle.webm']);
  assert.equal(await readFile(routes.get('/presentation-video/exp-tushe.webm')!, 'utf8'), 'synthetic never played happy');
  const store = await PresentationSettingsStore.open(resolve(f.root, 'policy.json'), catalog);
  assert.ok(store.allowedIntent().presets.some(preset => preset.id === 'exp-tushe'));
});

test('missing video files reject both first-run readiness and management startup', async t => {
  const f = await fixture(t);
  await rm(resolve(f.base, 'assets/webm/happy.webm'));
  await assert.rejects(readPresentationCatalog(f.root), { code: 'ENOENT' });
  await assert.rejects(presentationAssetRoutes(f.root), { code: 'ENOENT' });
});

test('invalid installed video URLs and conflicting aliases are rejected instead of creating routes', async t => {
  const f = await fixture(t);
  f.catalog.nativeActions[1]!.file = 'assets/webm/../private.webm';
  await writeFile(resolve(f.base, 'catalog.json'), JSON.stringify(f.catalog));
  await assert.rejects(readPresentationCatalog(f.root), /Incomplete video catalog/);
  f.catalog.nativeActions[1]!.file = 'assets/webm/happy.webm';
  f.catalog.actions[1]!.id = 'idle';
  await writeFile(resolve(f.base, 'catalog.json'), JSON.stringify(f.catalog));
  await assert.rejects(presentationAssetRoutes(f.root), /Conflicting video catalog alias/);
});

test('upstream-style native IDs may repeat as display aliases for the same video', async t => {
  const f = await fixture(t);
  f.catalog.actions.push({ id: 'native:happy', video: 'happy', label: '同一个视频的显示别名' });
  await writeFile(resolve(f.base, 'catalog.json'), JSON.stringify(f.catalog));
  const catalog = await readPresentationCatalog(f.root), routes = await presentationAssetRoutes(f.root);
  assert.equal(catalog.modelId, 'dsh-video-pet');
  assert.equal(routes.size, 3);
  assert.equal(await readFile(routes.get('/presentation-video/exp-tushe.webm')!, 'utf8'), 'synthetic never played happy');
});

test('dual installations retain the exact Live2D model identity used by Cubism automatic policies', async t => {
  const f = await fixture(t), base = resolve(f.base, '..');
  const manifest = JSON.stringify({ FileReferences: { Moc: 'pet.moc3', Textures: [], Expressions: [], Motions: {} } });
  const moc = 'synthetic Live2D bytes, never loaded', hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const fingerprint = hash('pet.moc3\0' + hash(moc) + '\npet.model3.json\0' + hash(manifest) + '\n');
  await writeFile(resolve(base, 'pet.model3.json'), manifest); await writeFile(resolve(base, 'pet.moc3'), moc);
  await writeFile(resolve(base, 'presets.json'), JSON.stringify({ schemaVersion: 1, modelId: 'own-live2d', modelFingerprint: fingerprint,
    items: [{ id: 'neutral', label: 'Neutral', category: 'idle', source: 'procedural', availability: 'manual', defaultEnabled: false, previewable: false }] }));
  await mkdir(resolve(f.root, 'code/desktop-pet/desktop/vendor/cubism/Framework/Shaders/WebGL'), { recursive: true });
  assert.equal((await readPresentationCatalog(f.root)).modelId, 'own-live2d');
  const routes = await presentationAssetRoutes(f.root);
  assert.equal(routes.has('/presentation-assets/pet.model3.json'), true);
  assert.equal([...routes.keys()].some(path => path.startsWith('/presentation-video/')), false);
});
