/** Window manager — owns window registry, z-order, focus, cascade placement, Alt+Tab. */

import type { Bus } from './events';
import { createWindowChrome } from '../ui/window';
import type { WindowChrome, WindowOptions } from '../ui/window';

export interface WM {
  openWindow(opts: WindowOptions): WindowChrome;
  windows(): readonly WindowChrome[];
  focused(): WindowChrome | null;
  focus(win: WindowChrome): void;
  blur(): void;
  focusById(id: string): void;
}

interface WMOptions {
  layer: HTMLElement;
  events: Bus;
}

export function createWM(opts: WMOptions): WM {
  const { layer, events } = opts;
  const open: WindowChrome[] = [];
  const focusOrder: WindowChrome[] = []; // most recently focused first
  let zCounter = 1;
  let seq = 0;
  let cascade = 0;
  let focusedWin: WindowChrome | null = null;

  // ----- Alt+Tab overlay -----
  const altTabEl = document.createElement('div');
  altTabEl.className = 'alttab';
  document.body.append(altTabEl);
  let altTabActive = false;
  let altTabIndex = 0;

  const renderAltTab = (): void => {
    altTabEl.innerHTML = '';
    for (const [i, win] of open.entries()) {
      const row = document.createElement('div');
      row.className = i === altTabIndex ? 'alttab-row hl' : 'alttab-row';
      const icon = document.createElement('span');
      icon.innerHTML = winTitleIcon(win);
      row.append(icon, document.createTextNode(winTitle(win)));
      altTabEl.append(row);
    }
    altTabEl.classList.add('visible');
  };

  function winTitle(win: WindowChrome): string {
    const t = win.el.querySelector<HTMLElement>('.win-title-text');
    return t?.textContent ?? win.appId;
  }

  function winTitleIcon(win: WindowChrome): string {
    const t = win.el.querySelector<HTMLElement>('.win-title-icon');
    return t?.innerHTML ?? '';
  }

  const commitAltTab = (): void => {
    if (!altTabActive) return;
    altTabActive = false;
    altTabEl.classList.remove('visible');
    const win = open[altTabIndex];
    if (win) wm.focus(win);
    altTabIndex = 0;
  };

  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      if (open.length === 0) return;
      if (open.length === 1) {
        wm.focus(open[0] as WindowChrome);
        return;
      }
      if (!altTabActive) {
        altTabActive = true;
        altTabIndex = 1;
      } else {
        altTabIndex = (altTabIndex + 1) % open.length;
      }
      renderAltTab();
    }
  }, true);
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') commitAltTab();
  });
  window.addEventListener('blur', commitAltTab);

  const wm: WM = {
    openWindow(wopts) {
      const vw = layer.clientWidth;
      const vh = layer.clientHeight;
      const w = Math.min(wopts.width, Math.max(vw - 24, 320));
      const h = Math.min(wopts.height, Math.max(vh - 24, 240));

      let x = wopts.x;
      let y = wopts.y;
      if (x === undefined || y === undefined) {
        const off = cascade % 9;
        x = Math.min(72 + off * 28, Math.max(vw - w - 24, 24));
        y = Math.min(48 + off * 28, Math.max(vh - h - 24, 24));
        cascade += 1;
      }

      const id = `${wopts.appId}-${seq++}`;
      const win = createWindowChrome(id, { ...wopts, width: w, height: h, x, y }, {
        getZ: () => zCounter++,
        onFocus: () => wm.focus(win),
        onMinimize: () => {
          if (focusedWin === win) {
            focusedWin = null;
            const next = focusOrder.find((w) => w !== win && !w.minimized);
            if (next) wm.focus(next);
            else events.emit('window:focused', '');
          }
          events.emit('window:minimized', id);
        },
        onRestore: () => {
          events.emit('window:restored', id);
        },
        onClosed: () => {
          const cleanupIdx = open.indexOf(win);
          if (cleanupIdx !== -1) open.splice(cleanupIdx, 1);
          const orderIdx = focusOrder.indexOf(win);
          if (orderIdx !== -1) focusOrder.splice(orderIdx, 1);
          if (focusedWin === win) {
            focusedWin = null;
            const next = focusOrder[0];
            if (next) wm.focus(next);
          }
          events.emit('window:closed', id);
        }
      });
      layer.append(win.el);
      open.push(win);
      focusOrder.unshift(win);
      events.emit('window:opened', id);
      wm.focus(win);
      return win;
    },

    windows: () => [...open],

    focused: () => focusedWin,

    focus(win) {
      if (win.minimized) {
        win.restore();
      }
      if (focusedWin === win && win.el.style.zIndex === String(zCounter - 1)) {
        return;
      }
      focusedWin = win;
      win.el.style.zIndex = String(zCounter++);
      for (const w of open) w.el.classList.toggle('focused', w === win);
      focusOrder.splice(focusOrder.indexOf(win), 1);
      focusOrder.unshift(win);
      events.emit('window:focused', win.id);
    },

    blur() {
      if (!focusedWin) return;
      focusedWin = null;
      for (const w of open) w.el.classList.remove('focused');
      events.emit('window:focused', '');
    },

    focusById(id) {
      const win = open.find((w) => w.id === id);
      if (win) wm.focus(win);
    }
  };

  return wm;
}
