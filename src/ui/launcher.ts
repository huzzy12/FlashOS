/** App launcher — full-screen overlay with search. */

import type { Bus } from '../kernel/events';
import type { FlashApp } from '../kernel/apps';

export interface LauncherDeps {
  events: Bus;
  apps(): FlashApp[];
  onLaunch(id: string): void;
}

export function createLauncher(root: HTMLElement, deps: LauncherDeps): { open(): void; close(): void; isOpen(): boolean } {
  const overlay = document.createElement('div');
  overlay.className = 'launcher';
  const inner = document.createElement('div');
  inner.className = 'launcher-inner';

  const input = document.createElement('input');
  input.className = 'launcher-search';
  input.type = 'text';
  input.placeholder = 'Search apps…';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Search apps');

  const grid = document.createElement('div');
  grid.className = 'launcher-grid';
  const empty = document.createElement('div');
  empty.className = 'launcher-empty';
  empty.textContent = 'No apps match';
  empty.style.display = 'none';

  inner.append(input, grid, empty);
  overlay.append(inner);
  root.append(overlay);

  let isOpen = false;
  let focusIdx = -1;

  const tiles: { app: FlashApp; el: HTMLButtonElement }[] = [];

  const build = (): void => {
    grid.innerHTML = '';
    tiles.length = 0;
    for (const app of deps.apps()) {
      const tile = document.createElement('button');
      tile.className = 'launcher-tile';
      tile.type = 'button';
      const icon = document.createElement('div');
      icon.className = 'desk-icon-tile';
      icon.innerHTML = app.iconSvg;
      const label = document.createElement('div');
      label.className = 'desk-icon-label';
      label.textContent = app.name;
      tile.append(icon, label);
      tile.addEventListener('click', () => {
        close();
        deps.onLaunch(app.id);
      });
      grid.append(tile);
      tiles.push({ app, el: tile });
    }
  };

  const visibleTiles = (): { app: FlashApp; el: HTMLButtonElement }[] => tiles.filter((t) => t.el.style.display !== 'none');

  const applyFilter = (): void => {
    const q = input.value.trim().toLowerCase();
    let any = false;
    for (const t of tiles) {
      const match = q === '' || t.app.name.toLowerCase().includes(q) || t.app.id.includes(q);
      t.el.style.display = match ? '' : 'none';
      if (match) any = true;
    }
    empty.style.display = any ? 'none' : '';
    focusIdx = -1;
  };

  const setKbdFocus = (idx: number): void => {
    const vis = visibleTiles();
    if (vis.length === 0) return;
    focusIdx = ((idx % vis.length) + vis.length) % vis.length;
    for (const [i, t] of vis.entries()) t.el.classList.toggle('kbd-focus', i === focusIdx);
    vis[focusIdx]?.el.scrollIntoView({ block: 'nearest' });
  };

  input.addEventListener('input', applyFilter);
  input.addEventListener('keydown', (e) => {
    const vis = visibleTiles();
    if (e.key === 'Enter') {
      e.preventDefault();
      const target = focusIdx >= 0 ? vis[focusIdx] : vis[0];
      if (target) {
        close();
        deps.onLaunch(target.app.id);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setKbdFocus(focusIdx < 0 ? 0 : focusIdx + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setKbdFocus(focusIdx < 0 ? vis.length - 1 : focusIdx - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setKbdFocus(focusIdx < 0 ? 0 : focusIdx + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setKbdFocus(focusIdx < 0 ? vis.length - 1 : focusIdx - 1);
    }
  });

  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) close();
  });

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });

  function open(): void {
    if (isOpen) return;
    isOpen = true;
    build();
    input.value = '';
    applyFilter();
    overlay.classList.add('open');
    requestAnimationFrame(() => input.focus());
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    overlay.classList.remove('open');
    input.blur();
  }

  return { open, close, isOpen: () => isOpen };
}
