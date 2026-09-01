/** Notepad — text editor with VFS open/save, dirty tracking, Ctrl+S. */

import type { FlashApp } from '../kernel/apps';
import { basename, extname } from '../kernel/vfs';
import { showDialog } from '../ui/dialog';
import { showToast } from '../ui/toast';

const S = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

const FILE_PLUS_SVG = `<svg viewBox="0 0 24 24" ${S} aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 11v6M9 14h6"/></svg>`;

const FOLDER_OPEN_SVG = `<svg viewBox="0 0 24 24" ${S} aria-hidden="true"><path d="M6 4h5l2 2h5a2 2 0 0 1 2 2v1H4.5"/><path d="M4.5 7 3 19a1 1 0 0 0 1 1h15a2 2 0 0 0 2-1.6L22.5 11"/></svg>`;

const SAVE_SVG = `<svg viewBox="0 0 24 24" ${S} aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>`;

const HOME = '/home/guest';

export const notepadApp: FlashApp = {
  id: 'notepad',
  name: 'Notepad',
  iconSvg: `<svg viewBox="0 0 24 24" ${S} aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>`,
  defaultSize: { w: 640, h: 460 },
  mount(container: HTMLElement, ctx, args?: unknown) {
    container.innerHTML = `
      <div class="notepad">
        <div class="notepad-toolbar">
          <button class="tool-btn" data-new title="New">${FILE_PLUS_SVG}<span>New</span></button>
          <button class="tool-btn" data-open title="Open">${FOLDER_OPEN_SVG}<span>Open</span></button>
          <div class="files-sep"></div>
          <button class="tool-btn" data-save title="Save (Ctrl+S)">${SAVE_SVG}<span>Save</span></button>
          <button class="tool-btn" data-saveas title="Save as">Save as…</button>
        </div>
        <textarea class="notepad-area" spellcheck="false" placeholder="Start typing…"></textarea>
        <div class="notepad-status"><span data-counts>Ln 1, Col 1 · 0 chars</span></div>
      </div>`;

    const area = container.querySelector<HTMLTextAreaElement>('.notepad-area')!;
    const counts = container.querySelector<HTMLElement>('[data-counts]')!;
    const newBtn = container.querySelector<HTMLButtonElement>('[data-new]')!;
    const openBtn = container.querySelector<HTMLButtonElement>('[data-open]')!;
    const saveBtn = container.querySelector<HTMLButtonElement>('[data-save]')!;
    const saveAsBtn = container.querySelector<HTMLButtonElement>('[data-saveas]')!;

    let path: string | null = null;
    let dirty = false;

    const displayPath = (): string => (path === null ? 'Untitled' : path);

    function syncTitle(): void {
      const name = path ? basename(path) : 'Untitled';
      ctx.setTitle(`${dirty ? '• ' : ''}${name} — Notepad`);
      void displayPath;
    }

    function updateCounts(): void {
      const value = area.value;
      const upto = area.selectionStart ?? 0;
      const before = value.slice(0, upto);
      const line = before.split('\n').length;
      const col = upto - before.lastIndexOf('\n');
      counts.textContent = `Ln ${line}, Col ${col} · ${value.length} chars`;
    }

    function markDirty(d: boolean): void {
      dirty = d;
      syncTitle();
    }

    area.addEventListener('input', () => {
      if (!dirty) markDirty(true);
      updateCounts();
    });
    area.addEventListener('keyup', updateCounts);
    area.addEventListener('click', updateCounts);

    // ---------- operations ----------

    function newDoc(): void {
      const proceed = (): void => {
        path = null;
        area.value = '';
        markDirty(false);
        updateCounts();
        area.focus();
      };
      if (dirty) {
        void confirmDiscard().then((ok) => {
          if (ok) proceed();
        });
      } else {
        proceed();
      }
    }

    async function save(target?: string): Promise<void> {
      try {
        path = target ?? path;
        if (!path) {
          await saveAs();
          return;
        }
        await ctx.vfs.writeFile(path, area.value, 'text/plain');
        markDirty(false);
        showToast(`Saved ${basename(path)}`, 'success');
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Save failed', 'danger');
      }
    }

    async function saveAs(): Promise<void> {
      const suggested = path ?? `${HOME}/untitled.txt`;
      const next = await showDialog(container, {
        title: 'Save as',
        message: 'Full path for the new file',
        input: { value: suggested, placeholder: '/home/guest/notes.txt' },
        confirmText: 'Save'
      });
      if (next === null || !next.trim()) return;
      const target = next.trim().startsWith('/') ? next.trim() : `${HOME}/${next.trim()}`;
      if (extname(target) === '') {
        showToast('Give the file an extension (e.g. .txt)', 'danger');
        return;
      }
      path = target;
      await save(target);
    }

    async function confirmDiscard(): Promise<boolean> {
      const ok = await showDialog(container, {
        title: 'Unsaved changes',
        message: 'Discard unsaved changes?',
        confirmText: 'Discard',
        danger: true
      });
      return ok !== null;
    }

    async function openPicker(): Promise<void> {
      const all = await ctx.vfs.listAll();
      const items = all
        .filter((n) => n.type === 'file' && (n.mime.startsWith('text/') || extname(n.path) === 'md'))
        .map((n) => ({ label: n.path, value: n.path }));
      const picked = await showDialog(container, {
        title: 'Open file',
        items,
        confirmText: 'Open'
      });
      if (picked) void loadFile(picked);
    }

    async function loadFile(target: string): Promise<void> {
      try {
        if (dirty) {
          const ok = await confirmDiscard();
          if (!ok) return;
        }
        const content = await ctx.vfs.readText(target);
        path = target;
        area.value = content;
        markDirty(false);
        updateCounts();
        area.focus();
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not open file', 'danger');
      }
    }

    newBtn.addEventListener('click', newDoc);
    openBtn.addEventListener('click', () => void openPicker());
    saveBtn.addEventListener('click', () => void save());
    saveAsBtn.addEventListener('click', () => void saveAs());

    container.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopPropagation();
        void save();
      }
    });

    // app-level close guard: block closing while dirty
    ctx.onCloseRequest(() => (dirty ? confirmDiscard() : true));

    // initial load from arg
    if (typeof args === 'string' && args.startsWith('/')) {
      void loadFile(args);
    } else {
      syncTitle();
      updateCounts();
    }

    area.focus();
  }
};
