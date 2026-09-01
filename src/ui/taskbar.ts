/** Taskbar — launcher button, running windows, live clock. */

import type { Bus } from '../kernel/events';
import type { WM } from '../kernel/wm';
import type { WindowChrome } from './window';

export const BOLT_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 L3 14 H12 L11 22 L21 10 H12 Z"/></svg>';

export interface TaskbarDeps {
  events: Bus;
  wm(): WM;
  onLauncher(): void;
}

export function createTaskbar(root: HTMLElement, deps: TaskbarDeps): { bar: HTMLElement } {
  const bar = document.createElement('div');
  bar.className = 'taskbar';

  const launcherBtn = document.createElement('button');
  launcherBtn.className = 'tb-launcher';
  launcherBtn.title = 'Open launcher';
  launcherBtn.setAttribute('aria-label', 'Open launcher');
  launcherBtn.innerHTML = BOLT_SVG;
  launcherBtn.addEventListener('click', deps.onLauncher);

  const apps = document.createElement('div');
  apps.className = 'tb-apps';

  const clock = document.createElement('div');
  clock.className = 'tb-clock';
  const timeEl = document.createElement('div');
  timeEl.className = 'tb-clock-time';
  const dateEl = document.createElement('div');
  dateEl.className = 'tb-clock-date';
  clock.append(timeEl, dateEl);

  bar.append(launcherBtn, apps, clock);
  root.append(bar);

  const buttons = new Map<string, HTMLButtonElement>();

  const syncActive = (): void => {
    const focused = deps.wm().focused();
    for (const [id, btn] of buttons) {
      btn.classList.toggle('active', focused !== null && focused.id === id);
    }
  };

  const makeButton = (win: WindowChrome): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.className = 'tb-app';
    btn.title = labelFor(win);
    const icon = document.createElement('span');
    const iconSrc = win.el.querySelector<HTMLElement>('.win-title-icon');
    icon.innerHTML = iconSrc?.innerHTML ?? '';
    const label = document.createElement('span');
    label.textContent = labelFor(win);
    btn.append(icon, label);
    btn.addEventListener('click', () => {
      const cur = deps.wm().focused();
      if (cur === win && !win.minimized) {
        win.minimize();
      } else {
        deps.wm().focus(win);
      }
    });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      win.close();
    });
    return btn;
  };

  function labelFor(win: WindowChrome): string {
    const t = win.el.querySelector<HTMLElement>('.win-title-text');
    return t?.textContent ?? win.appId;
  }

  deps.events.on('window:opened', (id) => {
    const win = deps
      .wm()
      .windows()
      .find((w) => w.id === id);
    if (!win || buttons.has(id)) return;
    const btn = makeButton(win);
    buttons.set(id, btn);
    apps.append(btn);
  });

  deps.events.on('window:closed', (id) => {
    const btn = buttons.get(id);
    if (btn) {
      btn.remove();
      buttons.delete(id);
    }
    syncActive();
  });

  deps.events.on('window:focused', () => {
    for (const [id, btn] of buttons) {
      const win = deps
        .wm()
        .windows()
        .find((w) => w.id === id);
      if (win) {
        const label = btn.querySelector('span:last-child');
        if (label) label.textContent = labelFor(win);
      }
    }
    syncActive();
  });

  deps.events.on('window:minimized', () => syncActive());
  deps.events.on('window:restored', () => syncActive());

  const tick = (): void => {
    const now = new Date();
    timeEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    dateEl.textContent = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  };
  tick();
  window.setInterval(tick, 1000);

  return { bar };
}
