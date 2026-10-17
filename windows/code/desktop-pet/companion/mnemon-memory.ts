import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

/**
 * Read-only bridge into the memory store managed by the local dsh-mnemon plugin.
 *
 * The plugin owns its on-disk index and has no standalone HTTP API, so the pet
 * reads the same v1 store the plugin manages: Project Documents under
 * `<root>/documents` plus the small shared working-memory list under
 * `<root>/runtime`. Writes stay with the plugin (and the DSH agent) so the
 * index, content hashes and turn attribution are never corrupted by the pet.
 */
export interface MnemonDocument {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly path: string;
  readonly updatedAt: string;
  body?: string;
}

export interface MnemonEntry {
  readonly title: string;
  readonly description: string;
  readonly snippet: string;
  readonly score: number;
}

export interface MnemonStatus {
  readonly root: string;
  readonly documents: number;
  readonly memories: number;
  readonly updatedAt: string | null;
  readonly error?: string;
}

interface IndexFile {
  readonly version?: number;
  readonly documents?: readonly {
    id?: string; title?: string; description?: string; status?: string; relativePath?: string; updatedAt?: string;
  }[];
}

interface MemoriesFile {
  readonly entries?: readonly { content?: string; target?: string; updated_at?: string }[];
}

const MAX_BODY = 60_000;
const MAX_PROMPT_CHARS = 1_500;

function tokens(text: string): string[] {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const latin = normalized.match(/[a-z0-9][a-z0-9._-]{1,}/g) ?? [];
  const cjk = [...normalized.replace(/[^\u3400-\u9fff]/g, '')];
  const bigrams: string[] = [];
  for (let i = 0; i + 1 < cjk.length; i += 1) bigrams.push(cjk[i]! + cjk[i + 1]!);
  return [...new Set([...latin, ...bigrams])].filter(token => token.length >= 2);
}

function score(haystack: string, needles: readonly string[], weight: number): number {
  if (!haystack || needles.length === 0) return 0;
  const lower = haystack.toLowerCase();
  let total = 0;
  for (const needle of needles) {
    let at = lower.indexOf(needle);
    let hits = 0;
    while (at !== -1 && hits < 8) {
      hits += 1;
      at = lower.indexOf(needle, at + needle.length);
    }
    total += hits * weight;
  }
  return total;
}

function snippetAround(body: string, needles: readonly string[]): string {
  const plain = body
    .replace(/^---[\s\S]*?---\s*/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return '';
  const lower = plain.toLowerCase();
  let at = -1;
  for (const needle of needles) {
    const hit = lower.indexOf(needle);
    if (hit !== -1) { at = hit; break; }
  }
  const start = at === -1 ? 0 : Math.max(0, at - 60);
  return plain.slice(start, start + 260);
}

export class MnemonMemory {
  private documents: MnemonDocument[] = [];
  private memories: { content: string; updatedAt: string }[] = [];
  private loadedAt = '';
  private lastError: string | undefined;
  private readonly root: string;

  constructor(root = process.env.MNEMON_ROOT?.trim() || join(homedir(), '.mnemon')) {
    this.root = resolve(root);
  }

  private inside(path: string): boolean {
    const absolute = resolve(this.root, path);
    return absolute === this.root || absolute.startsWith(this.root + sep);
  }

  async load(): Promise<void> {
    this.lastError = undefined;
    try {
      const index = JSON.parse(await readFile(join(this.root, 'documents', 'index.json'), 'utf8')) as IndexFile;
      const docs: MnemonDocument[] = [];
      for (const item of index.documents ?? []) {
        if (item.status !== 'active' || !item.relativePath || !this.inside(item.relativePath)) continue;
        docs.push({
          id: item.id ?? item.relativePath,
          title: item.title?.trim() || item.relativePath,
          description: item.description?.trim() ?? '',
          path: resolve(this.root, item.relativePath),
          updatedAt: item.updatedAt ?? '',
        });
      }
      this.documents = docs.slice(0, 200);
      for (const doc of this.documents) {
        try {
          doc.body = (await readFile(doc.path, 'utf8')).slice(0, MAX_BODY);
        } catch {
          doc.body = '';
        }
      }
    } catch (error) {
      this.documents = [];
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.lastError = (error as Error).message;
    }
    try {
      const raw = JSON.parse(await readFile(join(this.root, 'runtime', 'memories.json'), 'utf8')) as MemoriesFile;
      this.memories = (raw.entries ?? [])
        .map(entry => ({ content: entry.content?.trim() ?? '', updatedAt: entry.updated_at ?? '' }))
        .filter(entry => entry.content.length > 0);
    } catch (error) {
      this.memories = [];
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !this.lastError) this.lastError = (error as Error).message;
    }
    this.loadedAt = new Date().toISOString();
  }

  status(): MnemonStatus {
    return {
      root: this.root,
      documents: this.documents.length,
      memories: this.memories.length,
      updatedAt: this.loadedAt || null,
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  /** Rank Project Documents and shared working memories by lexical overlap with the turn. */
  recallSync(query: string, limit = 3): MnemonEntry[] {
    const needles = tokens(query);
    if (needles.length === 0) return [];
    if (this.documents.length === 0 && this.memories.length === 0) return [];
    const ranked: MnemonEntry[] = [];
    for (const doc of this.documents) {
      const body = doc.body ?? '';
      const total = score(doc.title, needles, 8) + score(doc.description, needles, 3) + score(body, needles, 1);
      if (total <= 0) continue;
      ranked.push({ title: doc.title, description: doc.description, snippet: snippetAround(body, needles), score: total });
    }
    for (const memory of this.memories) {
      const total = score(memory.content, needles, 2);
      if (total <= 0) continue;
      ranked.push({ title: '共享工作记忆', description: memory.content.slice(0, 220), snippet: '', score: total });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, Math.max(1, limit));
  }

  /** Render recalled entries for the dialogue system prompt; empty string means nothing relevant. */
  recallPromptSync(query: string, limit = 3): string {
    const entries = this.recallSync(query, limit);
    if (entries.length === 0) return '';
    const blocks = entries.map(entry => {
      const description = entry.description.length > 100 ? `${entry.description.slice(0, 100)}…` : entry.description;
      const head = `- ${entry.title}${description ? `：${description}` : ''}`;
      return entry.snippet ? `${head}\n  摘录：${entry.snippet}` : head;
    });
    return blocks.join('\n').slice(0, MAX_PROMPT_CHARS);
  }

  async recallPrompt(query: string, limit = 3): Promise<string> {
    return this.recallPromptSync(query, limit);
  }
}

/** Distinguishes "store absent" from a real error without throwing at startup. */
export async function openMnemonMemory(root?: string): Promise<{ memory: MnemonMemory; status: MnemonStatus }> {
  const memory = new MnemonMemory(root);
  await memory.load();
  return { memory, status: memory.status() };
}
