/** Virtual file system — POSIX-ish tree persisted in IndexedDB via idb. Every mutation emits vfs:changed. */

import { openDB, type IDBPDatabase } from 'idb';
import type { Bus } from './events';

export interface VfsNode {
  path: string;
  type: 'file' | 'dir';
  content: string | Blob;
  mime: string;
  createdAt: number;
  modifiedAt: number;
}

export interface VFS {
  readFile(path: string): Promise<string | Blob | undefined>;
  readText(path: string): Promise<string>;
  writeFile(path: string, content: string | Blob, mime?: string): Promise<VfsNode>;
  mkdir(path: string): Promise<VfsNode>;
  readdir(path: string): Promise<VfsNode[]>;
  stat(path: string): Promise<VfsNode | undefined>;
  rm(path: string): Promise<void>;
  mv(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  listAll(): Promise<VfsNode[]>;
}

interface VfsDeps {
  events: Bus;
}

const DB_NAME = 'flashos-vfs';
const DB_VERSION = 1;
const STORE = 'nodes';
const PARENT_INDEX = 'parent';
const HOME = '/home/guest';

// ---------- path utilities ----------

export function normalizePath(p: string): string {
  if (!p.startsWith('/')) {
    throw new Error(`path must be absolute: "${p}"`);
  }
  const stack: string[] = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return '/' + stack.join('/');
}

export function joinPath(base: string, rel: string): string {
  return normalizePath(base.replace(/\/$/, '') + '/' + rel.replace(/^\/+/, ''));
}

export function parentPath(p: string): string {
  const norm = normalizePath(p);
  const idx = norm.lastIndexOf('/');
  return idx <= 0 ? '/' : norm.slice(0, idx);
}

export function basename(p: string): string {
  const norm = normalizePath(p);
  return norm === '/' ? '/' : norm.slice(norm.lastIndexOf('/') + 1);
}

export function extname(p: string): string {
  const b = basename(p);
  const idx = b.lastIndexOf('.');
  return idx <= 0 ? '' : b.slice(idx + 1).toLowerCase();
}

// ---------- database ----------

async function openVfsDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore(STORE, { keyPath: 'path' });
      store.createIndex(PARENT_INDEX, 'parent');
    }
  });
}

interface StoredNode extends VfsNode {
  parent: string;
}

function toStored(node: VfsNode): StoredNode {
  return { ...node, parent: parentPath(node.path) };
}

function fromStored(node: StoredNode): VfsNode {
  const { parent: _parent, ...rest } = node;
  return rest;
}

function guessMime(path: string, explicit?: string): string {
  if (explicit) return explicit;
  switch (extname(path)) {
    case 'txt':
      return 'text/plain';
    case 'md':
      return 'text/markdown';
    case 'json':
      return 'application/json';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

export function createVfs(deps: VfsDeps): VFS {
  let dbPromise: Promise<IDBPDatabase> | null = null;

  const db = (): Promise<IDBPDatabase> => {
    if (!dbPromise) dbPromise = openVfsDb();
    return dbPromise;
  };

  const emitChanged = (path: string): void => {
    deps.events.emit('vfs:changed', path);
  };

  async function ensureParents(path: string, now: number): Promise<void> {
    const parts = normalizePath(path).split('/').slice(1, -1); // segments above the final node
    let current = '';
    for (const part of parts) {
      current += '/' + part;
      const existing = await (await db()).get(STORE, current);
      if (!existing) {
        const dir: VfsNode = {
          path: current,
          type: 'dir',
          content: '',
          mime: 'inode/directory',
          createdAt: now,
          modifiedAt: now
        };
        await (await db()).put(STORE, toStored(dir));
      } else if (existing.type !== 'dir') {
        throw new Error(`"${current}" exists and is not a directory`);
      }
    }
  }

  async function descendantsOf(dirPath: string): Promise<StoredNode[]> {
    const all = (await (await db()).getAll(STORE)) as StoredNode[];
    const prefix = dirPath === '/' ? '/' : dirPath + '/';
    return all.filter((n) => n.path.startsWith(prefix));
  }

  const vfs: VFS = {
    async readFile(path) {
      const node = (await (await db()).get(STORE, normalizePath(path))) as StoredNode | undefined;
      if (!node) return undefined;
      if (node.type === 'dir') throw new Error(`"${path}" is a directory`);
      return node.content;
    },

    async readText(path) {
      const content = await vfs.readFile(path);
      if (typeof content !== 'string') throw new Error(`"${path}" is not a text file`);
      return content;
    },

    async writeFile(path, content, mime) {
      const now = Date.now();
      const norm = normalizePath(path);
      if (norm === '/') throw new Error('cannot write to "/"');
      await ensureParents(norm, now);
      const existing = (await (await db()).get(STORE, norm)) as StoredNode | undefined;
      if (existing?.type === 'dir') throw new Error(`"${norm}" is a directory`);
      const node: StoredNode = {
        path: norm,
        type: 'file',
        content,
        mime: guessMime(norm, mime),
        createdAt: existing?.createdAt ?? now,
        modifiedAt: now,
        parent: parentPath(norm)
      };
      await (await db()).put(STORE, node);
      emitChanged(norm);
      return fromStored(node);
    },

    async mkdir(path) {
      const now = Date.now();
      const norm = normalizePath(path);
      if (norm === '/') throw new Error('"/" already exists');
      await ensureParents(norm, now);
      const existing = (await (await db()).get(STORE, norm)) as StoredNode | undefined;
      if (existing) throw new Error(`"${norm}" already exists`);
      const node: StoredNode = {
        path: norm,
        type: 'dir',
        content: '',
        mime: 'inode/directory',
        createdAt: now,
        modifiedAt: now,
        parent: parentPath(norm)
      };
      await (await db()).put(STORE, node);
      emitChanged(norm);
      return fromStored(node);
    },

    async readdir(path) {
      const norm = normalizePath(path);
      if (norm === '/') {
        const top = (await (await db()).getAllFromIndex(STORE, PARENT_INDEX, '/')) as StoredNode[];
        return top.map(fromStored).sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
          return basename(a.path).localeCompare(basename(b.path));
        });
      }
      const node = (await (await db()).get(STORE, norm)) as StoredNode | undefined;
      if (!node) throw new Error(`no such directory: "${norm}"`);
      if (node.type !== 'dir') throw new Error(`"${norm}" is not a directory`);
      const children = (await (await db()).getAllFromIndex(STORE, PARENT_INDEX, norm)) as StoredNode[];
      return children.map(fromStored).sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return basename(a.path).localeCompare(basename(b.path));
      });
    },

    async stat(path) {
      const norm = normalizePath(path);
      if (norm === '/') {
        return {
          path: '/',
          type: 'dir',
          content: '',
          mime: 'inode/directory',
          createdAt: 0,
          modifiedAt: 0
        };
      }
      const node = (await (await db()).get(STORE, norm)) as StoredNode | undefined;
      return node ? fromStored(node) : undefined;
    },

    async rm(path) {
      const norm = normalizePath(path);
      if (norm === '/') throw new Error('cannot remove "/"');
      const node = (await (await db()).get(STORE, norm)) as StoredNode | undefined;
      if (!node) throw new Error(`no such file or directory: "${norm}"`);
      const d = (await db());
      const doomed = await descendantsOf(norm);
      doomed.push(node);
      const tx = d.transaction(STORE, 'readwrite');
      for (const n of doomed) await tx.store.delete(n.path);
      await tx.done;
      emitChanged(norm);
    },

    async mv(from, to) {
      const src = normalizePath(from);
      const dst = normalizePath(to);
      if (src === '/') throw new Error('cannot move "/"');
      if (dst === '/' || dst.startsWith(src + '/')) throw new Error('cannot move a directory into itself');
      const now = Date.now();
      const d = (await db());
      const node = (await d.get(STORE, src)) as StoredNode | undefined;
      if (!node) throw new Error(`no such file or directory: "${src}"`);
      await ensureParents(dst, now);
      const dstExisting = (await d.get(STORE, dst)) as StoredNode | undefined;
      if (dstExisting && dstExisting.type === 'dir' && node.type === 'file') {
        throw new Error(`"${dst}" is a directory`);
      }
      const moving = node.type === 'dir' ? [node, ...(await descendantsOf(src))] : [node];
      const tx = d.transaction(STORE, 'readwrite');
      const dstParent = parentPath(dst);
      for (const n of moving) {
        await tx.store.delete(n.path);
        const newPath = dst + n.path.slice(src.length);
        const newParent = n.path === src ? dstParent : dst + parentPath(n.path).slice(src.length);
        await tx.store.put({ ...n, path: newPath, parent: newParent, modifiedAt: now });
      }
      await tx.done;
      emitChanged(dst);
      emitChanged(src);
    },

    async exists(path) {
      try {
        const node = (await (await db()).get(STORE, normalizePath(path))) as StoredNode | undefined;
        return node !== undefined;
      } catch {
        return false;
      }
    },

    async listAll() {
      const all = (await (await db()).getAll(STORE)) as StoredNode[];
      return all.map(fromStored).sort((a, b) => a.path.localeCompare(b.path));
    }
  };

  return vfs;
}

// ---------- first-boot seeding ----------

const WELCOME = `Welcome to FlashOS!

Everything you see here — the window manager, the file system
you're browsing right now, and every app — was written by GLM-5.3 Flash,
an AI model. No human wrote a single line of this code.

Your files live in /home/guest and persist across reboots.
Try opening the Terminal and typing "help".

— FlashOS 1.0`;

export async function seedVfs(vfs: VFS): Promise<void> {
  const welcomeExists = await vfs.exists(`${HOME}/welcome.txt`);
  if (welcomeExists) return;

  await vfs.mkdir(HOME);
  await vfs.mkdir(`${HOME}/docs`);
  await vfs.mkdir(`${HOME}/pictures`);
  await vfs.mkdir(`${HOME}/music`);
  await vfs.writeFile(`${HOME}/welcome.txt`, WELCOME, 'text/plain');
}
