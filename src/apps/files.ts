/** Files — two-pane file manager over the VFS. Includes the hidden PNG viewer app. */

import type { FlashApp, AppContext } from '../kernel/apps';
import type { VfsNode } from '../kernel/vfs';
import { basename, extname, joinPath, parentPath } from '../kernel/vfs';
import { showDialog } from '../ui/dialog';
import { showToast } from '../ui/toast';
import { showContextMenu } from '../ui/contextmenu';

const S = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

export const FOLDER_SVG = `<svg viewBox="0 0 24 24" ${S} aria-hidden="true"><path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;

const FILE_TEXT_SVG = `<svg viewBox="0 0 24 24" ${S} aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/></svg>`;

const IMAGE_SVG = `<svg viewBox="0 0 24 24" ${S} aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M3 17l5-4 4 3 4-4 5 5"/></svg>`;

const FILE_SVG = `<svg viewBox="0 0 24 24" ${S} aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>`;

const ARROW_UP_SVG = `<svg viewBox="0 0 24 24" ${S} aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`;

const FOLDER_PLUS_SVG = `<svg viewBox="0 0 24 24" ${S} aria-hidden="true"><path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v6M9 14h6"/></svg>`;

const FILE_PLUS_SVG = `<svg viewBox="0 0 24 24" ${S} aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 11v6M9 14h6"/></svg>`;

const PENCIL_SVG = `<svg viewBox="0 0 24 24" ${S} aria-hidden="true"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m14.5 5.5 4 4"/></svg>`;

const TRASH_SVG = `<svg viewBox="0 0 24 24" ${S} aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg>`;

const HOME = '/home/guest';

function iconFor(node: VfsNode): string {
  if (node.type === 'dir') return FOLDER_SVG;
  if (node.mime.startsWith('image/')) return IMAGE_SVG;
  if (node.mime.startsWith('text/')) return FILE_TEXT_SVG;
  return FILE_SVG;
}

async function openNode(node: VfsNode, ctx: AppContext): Promise<void> {
  if (node.type === 'dir') return;
  if (node.mime.startsWith('text/') || extname(node.path) === 'md') {
    ctx.openApp('notepad', node.path);
    return;
  }
  if (node.mime.startsWith('image/')) {
    ctx.openApp('viewer', node.path);
    return;
  }
  showToast(`No app can open .${extname(node.path) || 'bin'} files yet`, 'info');
}

export const filesApp: FlashApp = {
  id: 'files',
  name: 'Files',
  iconSvg: FOLDER_SVG,
  defaultSize: { w: 740, h: 500 },
  mount(container: HTMLElement, ctx: AppContext, args?: unknown) {
    let cwd = typeof args === 'string' && args.startsWith('/') ? args : HOME;
    let selectedPath: string | null = null;

    container.innerHTML = `
      <div class="files">
        <div class="files-toolbar">
          <button class="tool-btn" data-up title="Up">${ARROW_UP_SVG}</button>
          <div class="files-sep"></div>
          <button class="tool-btn" data-newdir title="New folder">${FOLDER_PLUS_SVG}<span>New folder</span></button>
          <button class="tool-btn" data-newfile title="New text file">${FILE_PLUS_SVG}<span>New text file</span></button>
          <button class="tool-btn" data-rename disabled title="Rename">${PENCIL_SVG}<span>Rename</span></button>
          <button class="tool-btn danger" data-delete disabled title="Delete">${TRASH_SVG}<span>Delete</span></button>
        </div>
        <div class="files-crumb"></div>
        <div class="files-main">
          <div class="files-side"></div>
          <div class="files-grid-wrap"><div class="files-grid"></div></div>
        </div>
        <div class="files-status"></div>
      </div>`;

    const toolbar = container.querySelector<HTMLElement>('.files-toolbar')!;
    const crumbEl = container.querySelector<HTMLElement>('.files-crumb')!;
    const sideEl = container.querySelector<HTMLElement>('.files-side')!;
    const gridEl = container.querySelector<HTMLElement>('.files-grid')!;
    const statusEl = container.querySelector<HTMLElement>('.files-status')!;
    const upBtn = toolbar.querySelector<HTMLButtonElement>('[data-up]')!;
    const renameBtn = toolbar.querySelector<HTMLButtonElement>('[data-rename]')!;
    const deleteBtn = toolbar.querySelector<HTMLButtonElement>('[data-delete]')!;

    ctx.setTitle('Files');

    // ---------- toolbar ----------
    upBtn.addEventListener('click', () => {
      if (cwd !== '/') navigate(parentPath(cwd));
    });

    toolbar.querySelector('[data-newdir]')!.addEventListener('click', async () => {
      const name = await showDialog(container, {
        title: 'New folder',
        message: `Create a folder in ${cwd}`,
        input: { value: 'New folder', placeholder: 'Folder name' },
        confirmText: 'Create'
      });
      if (!name?.trim()) return;
      try {
        await ctx.vfs.mkdir(joinPath(cwd, name.trim()));
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not create folder', 'danger');
      }
    });

    toolbar.querySelector('[data-newfile]')!.addEventListener('click', async () => {
      const name = await showDialog(container, {
        title: 'New text file',
        message: `Create a text file in ${cwd}`,
        input: { value: 'untitled.txt', placeholder: 'File name' },
        confirmText: 'Create'
      });
      if (!name?.trim()) return;
      const target = joinPath(cwd, name.trim());
      try {
        await ctx.vfs.writeFile(target, '', 'text/plain');
        ctx.openApp('notepad', target);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not create file', 'danger');
      }
    });

    renameBtn.addEventListener('click', () => {
      if (selectedPath) startInlineRename(selectedPath);
    });

    deleteBtn.addEventListener('click', () => {
      if (selectedPath) void deleteByPath(selectedPath);
    });

    async function deleteByPath(path: string): Promise<void> {
      const node = await ctx.vfs.stat(path);
      const label = node ? `${basename(path)}${node.type === 'dir' ? ' and everything inside it' : ''}` : path;
      const ok = await showDialog(container, {
        title: 'Delete',
        message: `Delete ${label}? This cannot be undone.`,
        confirmText: 'Delete',
        danger: true
      });
      if (ok === null) return;
      try {
        await ctx.vfs.rm(path);
        if (selectedPath === path || selectedPath?.startsWith(path + '/')) selectedPath = null;
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Delete failed', 'danger');
      }
    }

    // ---------- selection ----------
    function setSelection(path: string | null): void {
      selectedPath = path;
      for (const tile of gridEl.querySelectorAll<HTMLElement>('.file-tile')) {
        tile.classList.toggle('selected', tile.dataset.path === path);
      }
      renameBtn.disabled = !path;
      deleteBtn.disabled = !path;
    }

    // ---------- breadcrumbs ----------
    function renderCrumb(): void {
      crumbEl.innerHTML = '';
      const parts = cwd.split('/').filter(Boolean);
      const mk = (label: string, path: string): HTMLElement => {
        const seg = document.createElement('button');
        seg.className = 'crumb-seg';
        seg.textContent = label;
        seg.addEventListener('click', () => navigate(path));
        seg.addEventListener('dragover', (e) => {
          e.preventDefault();
          seg.classList.add('drop');
        });
        seg.addEventListener('dragleave', () => seg.classList.remove('drop'));
        seg.addEventListener('drop', (e) => {
          e.preventDefault();
          seg.classList.remove('drop');
          void handleDrop(e, path);
        });
        return seg;
      };
      const root = mk('FlashOS', '/');
      crumbEl.append(root);
      let acc = '';
      for (const part of parts) {
        acc += '/' + part;
        crumbEl.append(mk(part, acc));
      }
      crumbEl.scrollLeft = crumbEl.scrollWidth;
    }

    // ---------- sidebar tree ----------
    async function renderSidebar(): Promise<void> {
      sideEl.innerHTML = '';
      const all = await ctx.vfs.listAll();
      const dirs = all.filter((n) => n.type === 'dir');
      const byParent = new Map<string, VfsNode[]>();
      for (const d of dirs) {
        const list = byParent.get(d.path === '/' ? '/' : parentPath(d.path)) ?? [];
        list.push(d);
        byParent.set(d.path === '/' ? '/' : parentPath(d.path), list);
      }

      const build = (parent: string, depth: number): void => {
        const children = byParent.get(parent) ?? [];
        children.sort((a, b) => a.path.localeCompare(b.path));
        for (const dir of children) {
          const row = document.createElement('button');
          row.className = 'side-dir' + (dir.path === cwd ? ' active' : '');
          row.style.paddingLeft = `${10 + depth * 16}px`;
          row.innerHTML = `${FOLDER_SVG}<span></span>`;
          row.querySelector('span')!.textContent = basename(dir.path);
          row.addEventListener('click', () => navigate(dir.path));
          row.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (canDropInto(dir.path)) row.classList.add('drop');
          });
          row.addEventListener('dragleave', () => row.classList.remove('drop'));
          row.addEventListener('drop', (e) => {
            e.preventDefault();
            row.classList.remove('drop');
            void handleDrop(e, dir.path);
          });
          sideEl.append(row);
          build(dir.path, depth + 1);
        }
      };

      const rootRow = document.createElement('button');
      rootRow.className = 'side-dir root' + (cwd === '/' ? ' active' : '');
      rootRow.innerHTML = `${FOLDER_SVG}<span>FlashOS</span>`;
      rootRow.addEventListener('click', () => navigate('/'));
      sideEl.append(rootRow);
      build('/', 1);
    }

    // ---------- grid ----------
    async function renderGrid(): Promise<void> {
      gridEl.innerHTML = '';
      let nodes: VfsNode[];
      try {
        nodes = await ctx.vfs.readdir(cwd);
      } catch {
        navigate(HOME);
        return;
      }
      statusEl.textContent = `${nodes.length} item${nodes.length === 1 ? '' : 's'}`;

      if (nodes.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'files-empty';
        empty.innerHTML = `${FOLDER_SVG}<p>This folder is empty</p><span>Right-click or use the toolbar to create something</span>`;
        gridEl.append(empty);
        return;
      }

      for (const node of nodes) {
        const tile = document.createElement('div');
        tile.className = 'file-tile' + (node.path === selectedPath ? ' selected' : '');
        tile.dataset.path = node.path;
        tile.innerHTML = `<div class="file-icon">${iconFor(node)}</div><div class="file-name"></div>`;
        tile.querySelector('.file-name')!.textContent = basename(node.path);

        tile.addEventListener('click', (e) => {
          e.stopPropagation();
          setSelection(node.path);
        });
        tile.addEventListener('dblclick', () => {
          if (node.type === 'dir') navigate(node.path);
          else void openNode(node, ctx);
        });
        tile.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          setSelection(node.path);
          itemMenu(node, e.clientX, e.clientY);
        });

        if (node.type === 'dir') {
          tile.addEventListener('dragover', (e) => {
            if (!canDropInto(node.path)) return;
            e.preventDefault();
            tile.classList.add('drop');
          });
          tile.addEventListener('dragleave', () => tile.classList.remove('drop'));
          tile.addEventListener('drop', (e) => {
            e.preventDefault();
            tile.classList.remove('drop');
            void handleDrop(e, node.path);
          });
        } else {
          tile.draggable = true;
          tile.addEventListener('dragstart', (e) => {
            e.dataTransfer?.setData('text/flashos-path', node.path);
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            tile.classList.add('dragging');
          });
          tile.addEventListener('dragend', () => tile.classList.remove('dragging'));
        }
        gridEl.append(tile);
      }
    }

    function canDropInto(dirPath: string): boolean {
      const dragged = gridEl.querySelector<HTMLElement>('.file-tile.dragging')?.dataset.path;
      if (!dragged) return false;
      return dragged !== dirPath && !dirPath.startsWith(dragged + '/');
    }

    async function handleDrop(e: DragEvent, targetDir: string): Promise<void> {
      const path = e.dataTransfer?.getData('text/flashos-path');
      if (!path) return;
      const dest = joinPath(targetDir, basename(path));
      if (dest === path) return;
      try {
        await ctx.vfs.mv(path, dest);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Move failed', 'danger');
      }
    }

    // ---------- context menu ----------
    function itemMenu(node: VfsNode, x: number, y: number): void {
      showContextMenu(x, y, [
        {
          label: 'Open',
          iconSvg: node.type === 'dir' ? FOLDER_SVG : FILE_SVG,
          action: () => {
            if (node.type === 'dir') navigate(node.path);
            else void openNode(node, ctx);
          }
        },
        { separator: true },
        { label: 'Rename', iconSvg: PENCIL_SVG, action: () => startInlineRename(node.path) },
        {
          label: 'Delete',
          iconSvg: TRASH_SVG,
          action: () => void deleteByPath(node.path)
        }
      ]);
    }

    function startInlineRename(path: string): void {
      const tile = gridEl.querySelector<HTMLElement>(`.file-tile[data-path="${CSS.escape(path)}"]`);
      if (!tile) return;
      const nameEl = tile.querySelector<HTMLElement>('.file-name')!;
      const old = nameEl.textContent ?? '';
      const input = document.createElement('input');
      input.className = 'file-rename';
      input.value = old;
      input.spellcheck = false;
      nameEl.replaceWith(input);
      input.focus();
      const dot = old.lastIndexOf('.');
      input.setSelectionRange(0, dot > 0 ? dot : old.length);

      let settled = false;
      const commit = async (): Promise<void> => {
        if (settled) return;
        settled = true;
        const next = input.value.trim();
        if (!next || next === old) {
          input.replaceWith(nameEl);
          nameEl.textContent = old;
          return;
        }
        try {
          await ctx.vfs.mv(path, joinPath(cwd, next));
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Rename failed', 'danger');
          input.replaceWith(nameEl);
          nameEl.textContent = old;
        }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void commit();
        } else if (e.key === 'Escape') {
          settled = true;
          input.replaceWith(nameEl);
          nameEl.textContent = old;
        }
        e.stopPropagation();
      });
      input.addEventListener('blur', () => void commit());
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('dblclick', (e) => e.stopPropagation());
    }

    // ---------- navigation ----------
    function navigate(path: string): void {
      cwd = path;
      setSelection(null);
      refresh();
    }

    gridEl.addEventListener('click', (e) => {
      if (e.target === gridEl || (e.target as HTMLElement).classList.contains('files-empty')) setSelection(null);
    });
    container.addEventListener('contextmenu', (e) => {
      if (e.target instanceof Element && e.target.closest('.file-tile')) return;
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, [
        { label: 'New folder', iconSvg: FOLDER_PLUS_SVG, action: () => toolbar.querySelector<HTMLButtonElement>('[data-newdir]')!.click() },
        { label: 'New text file', iconSvg: FILE_PLUS_SVG, action: () => toolbar.querySelector<HTMLButtonElement>('[data-newfile]')!.click() }
      ]);
    });

    container.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'Delete' && selectedPath) {
        void deleteByPath(selectedPath);
      } else if (e.key === 'Enter' && selectedPath) {
        void ctx.vfs.stat(selectedPath).then((node) => {
          if (!node) return;
          if (node.type === 'dir') navigate(node.path);
          else void openNode(node, ctx);
        });
      }
    });

    let refreshing = false;
    let refreshQueued = false;
    async function refresh(): Promise<void> {
      if (refreshing) {
        refreshQueued = true;
        return;
      }
      refreshing = true;
      do {
        refreshQueued = false;
        renderCrumb();
        await Promise.all([renderSidebar(), renderGrid()]);
      } while (refreshQueued);
      refreshing = false;
    }

    const offChanged = ctx.events.on('vfs:changed', () => {
      void refresh();
    });
    void refresh();

    return () => {
      offChanged();
    };
  }
};

// ---------- hidden image viewer ----------

export const viewerApp: FlashApp = {
  id: 'viewer',
  name: 'Viewer',
  iconSvg: IMAGE_SVG,
  defaultSize: { w: 660, h: 480 },
  hidden: true,
  mount(container: HTMLElement, ctx: AppContext, args?: unknown) {
    const path = typeof args === 'string' ? args : (args as { path?: string } | undefined)?.path;
    container.innerHTML = `<div class="imgview"><div class="imgview-stage"></div></div>`;
    const stage = container.querySelector<HTMLElement>('.imgview-stage')!;

    if (!path) {
      stage.innerHTML = '<div class="imgview-missing">No image was passed to the viewer</div>';
      return;
    }

    let url: string | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const content = await ctx.vfs.readFile(path);
        if (cancelled) return;
        if (!(content instanceof Blob)) {
          stage.innerHTML = '<div class="imgview-missing">Not a valid image file</div>';
          return;
        }
        url = URL.createObjectURL(content);
        const img = document.createElement('img');
        img.src = url;
        img.alt = basename(path);
        stage.append(img);
        ctx.setTitle(`${basename(path)} — Viewer`);
      } catch {
        if (!cancelled) stage.innerHTML = '<div class="imgview-missing">Could not load this image</div>';
      }
    })();

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }
};
