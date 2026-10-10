import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { PresentationCatalog, PresentationPreset } from '../contracts/presentation-presets.js';

/** Only installed, fixed catalog entries become routes; no request can supply a filename. */
export async function readVideoPresentation(projectRoot: string): Promise<{ catalog: PresentationCatalog; routes: ReadonlyMap<string, string> } | undefined> {
  const base = resolve(projectRoot, 'code/desktop-pet/desktop/assets/local-model/dsh-pet');
  async function bytes(file: string) {
    for (let parent = file; parent !== resolve(projectRoot); parent = dirname(parent))
      if ((await lstat(parent)).isSymbolicLink()) throw Error('Linked video resource refused');
    if (!(await lstat(file)).isFile()) throw Error('Invalid video resource');
    const value = await readFile(file); if (!value.length) throw Error('Empty video resource'); return value;
  }
  let raw: Buffer;
  try { raw = await bytes(resolve(base, 'catalog.json')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  const source = JSON.parse(raw.toString('utf8'));
  if (!source || !Array.isArray(source.nativeActions) || !Array.isArray(source.actions)) throw Error('Invalid video catalog');
  const rows = [source.nativeActions, source.actions, source.workStates ?? [], source.memes ?? []];
  if (rows.some(row => !Array.isArray(row)) || rows.flat().length > 500 ||
      rows.flat().some(row => !row || typeof row.id !== 'string')) throw Error('Invalid video catalog entries');
  const nativeFiles = new Map<string, string>(), identities = new Map<string, string>();
  for (const row of source.nativeActions) {
    if (nativeFiles.has(row.video) && nativeFiles.get(row.video) !== row.file) throw Error('Conflicting native video file');
    nativeFiles.set(row.video, row.file);
  }
  for (const row of rows.flat()) {
    const file = row.kind === 'meme' ? row.file : nativeFiles.get(row.video);
    if (typeof file !== 'string' || !/^assets\/(?:webm\/[^/\\:%?#\0]+\.webm|memes\/[^/\\:%?#\0]+\.png)$/.test(file) || file.includes('..'))
      throw Error('Incomplete video catalog');
    // The upstream catalog repeats some native IDs as display aliases with different labels.
    // Only the same media/action identity may be shared across sections.
    const identity = JSON.stringify([file, row.video ?? null, row.kind === 'meme' ? 'meme' : 'play', row.icon ?? null, row.text ?? null, row.noMirror ?? false]);
    if (identities.has(row.id) && identities.get(row.id) !== identity) throw Error('Conflicting video catalog alias');
    identities.set(row.id, identity);
  }
  const { catalogEntries, presetActions } = await import(new URL('../../desktop/video-pet-state.mjs', import.meta.url).href);
  const entries = catalogEntries(source) as Map<string, { file: string; label?: string }>;
  if (entries.size !== identities.size || !entries.has('idle')) throw Error('Incomplete video catalog');
  const fingerprint = createHash('sha256').update(raw), installed = new Map<string, string>();
  for (const file of [...new Set([...entries.values()].map(row => row.file))].sort()) {
    const absolute = resolve(base, file);
    fingerprint.update(file).update(createHash('sha256').update(await bytes(absolute)).digest()); installed.set(file, absolute);
  }
  const routes = new Map<string, string>(), items: PresentationPreset[] = [];
  const aliases: Record<string, string> = { 'video-idle': 'idle', ...presetActions };
  for (const [id, action] of Object.entries(aliases)) {
    const entry = entries.get(action); if (!entry || !entry.file.endsWith('.webm')) continue;
    routes.set('/presentation-video/' + id + '.webm', installed.get(entry.file)!);
    items.push({ id, label: entry.label || action, category: id === 'video-idle' ? 'idle' : 'expression', source: 'procedural',
      availability: id === 'video-idle' ? 'manual' : 'automatic', defaultEnabled: id !== 'video-idle', previewable: true });
  }
  if (!routes.has('/presentation-video/video-idle.webm')) throw Error('Missing idle video');
  return { catalog: { schemaVersion: 1, modelId: 'dsh-video-pet', modelFingerprint: fingerprint.digest('hex'), items }, routes };
}
