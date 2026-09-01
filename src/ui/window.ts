/** Window chrome component — drag, resize, min/max/close, animations. Pure UI; state registry lives in wm.ts. */

export interface WindowOptions {
  appId: string;
  title: string;
  iconSvg: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  content: HTMLElement;
  /** optional veto for the close button — return false to cancel */
  onRequestClose?: () => boolean | Promise<boolean>;
  onClose?: () => void;
}

export interface WindowHooks {
  getZ(): number;
  onFocus(): void;
  onMinimize(): void;
  onRestore(): void;
  onClosed(): void;
}

export interface WindowChrome {
  id: string;
  appId: string;
  el: HTMLDivElement;
  body: HTMLDivElement;
  minimized: boolean;
  maximized: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  setTitle(title: string): void;
  focus(): void;
  minimize(): void;
  restore(): void;
  toggleMaximize(): void;
  close(): void;
  bounds(): { x: number; y: number; w: number; h: number };
}

const MIN_W = 320;
const MIN_H = 240;
const EDGE_MARGIN = 120;

const ICONS = {
  minimize:
    '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 5h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  maximize:
    '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.7" y="1.7" width="6.6" height="6.6" rx="1.6" stroke="currentColor" fill="none" stroke-width="1.3"/></svg>',
  close:
    '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.8 1.8l6.4 6.4M8.2 1.8L1.8 8.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  html?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max);

export function createWindowChrome(id: string, opts: WindowOptions, hooks: WindowHooks): WindowChrome {
  const layer = opts.content.parentElement ?? document.body;
  const vw = layer.clientWidth;
  const vh = layer.clientHeight;

  const w = Math.min(opts.width, Math.max(vw - 24, MIN_W));
  const h = Math.min(opts.height, Math.max(vh - 24, MIN_H));
  const x = clamp(opts.x ?? 0, EDGE_MARGIN - w, Math.max(vw - EDGE_MARGIN, 0));
  const y = clamp(opts.y ?? 0, 0, Math.max(vh - 60, 0));

  const root = el('div', 'win');
  root.style.width = `${w}px`;
  root.style.height = `${h}px`;
  root.style.zIndex = String(hooks.getZ());
  let restoreBounds: { x: number; y: number; w: number; h: number } | null = null;
  let closing = false;
  let closeRequestPending = false;

  const titlebar = el('div', 'win-titlebar');
  const titleIcon = el('div', 'win-title-icon', opts.iconSvg);
  const titleText = el('div', 'win-title-text');
  titleText.textContent = opts.title;
  const controls = el('div', 'win-controls');
  const btnMin = el('button', 'win-btn', ICONS.minimize);
  btnMin.title = 'Minimize';
  const btnMax = el('button', 'win-btn', ICONS.maximize);
  btnMax.title = 'Maximize';
  const btnClose = el('button', 'win-btn close', ICONS.close);
  btnClose.title = 'Close';
  controls.append(btnMin, btnMax, btnClose);
  titlebar.append(titleIcon, titleText, controls);

  const body = el('div', 'win-body');
  body.append(opts.content);

  const rzR = el('div', 'win-rz win-rz-r');
  const rzB = el('div', 'win-rz win-rz-b');
  const rzBR = el('div', 'win-rz win-rz-br');
  root.append(titlebar, body, rzR, rzB, rzBR);

  const win: WindowChrome = {
    id,
    appId: opts.appId,
    el: root,
    body,
    minimized: false,
    maximized: false,
    x,
    y,
    w,
    h,
    setTitle(title) {
      titleText.textContent = title;
    },
    focus() {
      hooks.onFocus();
    },
    bounds() {
      return { x: win.x, y: win.y, w: win.w, h: win.h };
    },
    minimize() {
      if (win.minimized) return;
      win.minimized = true;
      const tx = (window.innerWidth - win.w) / 2;
      const ty = window.innerHeight - 24 - win.h / 2;
      root.classList.add('animating');
      requestAnimationFrame(() => {
        root.style.transform = `translate(${tx}px, ${ty}px) scale(0.45)`;
        root.style.opacity = '0';
      });
      window.setTimeout(() => {
        root.classList.remove('animating');
        root.classList.add('minimized');
        root.style.transition = 'none';
        root.style.transform = '';
        root.style.opacity = '';
        void root.offsetHeight;
        root.style.transition = '';
      }, 210);
      hooks.onMinimize();
    },
    restore() {
      if (!win.minimized) return;
      win.minimized = false;
      root.classList.remove('minimized');
      const tx = (window.innerWidth - win.w) / 2;
      const ty = window.innerHeight - 24 - win.h / 2;
      root.style.transition = 'none';
      root.style.transform = `translate(${tx}px, ${ty}px) scale(0.45)`;
      root.style.opacity = '0';
      void root.offsetHeight;
      root.classList.add('animating');
      requestAnimationFrame(() => {
        root.style.transform = `translate(${win.x}px, ${win.y}px)`;
        root.style.opacity = '';
      });
      window.setTimeout(() => {
        root.classList.remove('animating');
      }, 210);
      hooks.onRestore();
      hooks.onFocus();
    },
    toggleMaximize() {
      if (!win.maximized) {
        restoreBounds = { x: win.x, y: win.y, w: win.w, h: win.h };
      }
      const target = win.maximized ? restoreBounds : null;
      win.maximized = !win.maximized;
      root.classList.add('animating');
      requestAnimationFrame(() => {
        if (win.maximized) {
          root.classList.add('maximized');
          root.style.width = `${layer.clientWidth}px`;
          root.style.height = `${layer.clientHeight}px`;
          root.style.transform = 'translate(0px, 0px)';
          win.x = 0;
          win.y = 0;
          win.w = layer.clientWidth;
          win.h = layer.clientHeight;
        } else {
          root.classList.remove('maximized');
          if (!target) return;
          root.style.width = `${target.w}px`;
          root.style.height = `${target.h}px`;
          root.style.transform = `translate(${target.x}px, ${target.y}px)`;
          win.x = target.x;
          win.y = target.y;
          win.w = target.w;
          win.h = target.h;
          restoreBounds = null;
        }
      });
      window.setTimeout(() => root.classList.remove('animating'), 210);
    },
    close() {
      if (closing) return;
      closing = true;
      opts.onClose?.();
      hooks.onClosed();
      root.classList.add('animating');
      requestAnimationFrame(() => {
        root.style.transform = `translate(${win.x}px, ${win.y}px) scale(0.96)`;
        root.style.opacity = '0';
      });
      window.setTimeout(() => {
        root.remove();
      }, 150);
    }
  };

  const applyTransform = (): void => {
    root.style.transform = `translate(${win.x}px, ${win.y}px)`;
  };
  applyTransform();

  // open animation: start from 0.96 scale + fade, keyframes read --wx/--wy
  root.style.setProperty('--wx', `${win.x}px`);
  root.style.setProperty('--wy', `${win.y}px`);
  root.classList.add('opening');
  window.setTimeout(() => root.classList.remove('opening'), 160);

  // ----- dragging -----
  let dragRaf = 0;
  titlebar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.win-btn')) return;
    if (win.maximized) return;
    e.preventDefault();
    hooks.onFocus();
    root.classList.add('dragging');
    titlebar.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = win.x;
    const origY = win.y;
    let nx = origX;
    let ny = origY;

    const onMove = (ev: PointerEvent): void => {
      nx = clamp(origX + ev.clientX - startX, EDGE_MARGIN - win.w, Math.max(layer.clientWidth - EDGE_MARGIN, 0));
      ny = clamp(origY + ev.clientY - startY, 0, Math.max(layer.clientHeight - 44, 0));
      if (!dragRaf) {
        dragRaf = requestAnimationFrame(() => {
          dragRaf = 0;
          win.x = nx;
          win.y = ny;
          applyTransform();
        });
      }
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      root.classList.remove('dragging');
      if (dragRaf) {
        cancelAnimationFrame(dragRaf);
        dragRaf = 0;
        win.x = nx;
        win.y = ny;
        applyTransform();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });

  // ----- resizing -----
  let resizeRaf = 0;
  for (const handle of [rzR, rzB, rzBR]) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || win.maximized) return;
      e.preventDefault();
      hooks.onFocus();
      root.classList.add('resizing');
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = win.w;
      const startH = win.h;
      const dir = handle === rzR ? 'r' : handle === rzB ? 'b' : 'br';
      let nw = startW;
      let nh = startH;

      const onMove = (ev: PointerEvent): void => {
        const maxW = Math.max(layer.clientWidth - win.x, MIN_W);
        const maxH = Math.max(layer.clientHeight - win.y, MIN_H);
        if (dir !== 'b') nw = clamp(startW + ev.clientX - startX, MIN_W, maxW);
        if (dir !== 'r') nh = clamp(startH + ev.clientY - startY, MIN_H, maxH);
        if (!resizeRaf) {
          resizeRaf = requestAnimationFrame(() => {
            resizeRaf = 0;
            win.w = nw;
            win.h = nh;
            root.style.width = `${nw}px`;
            root.style.height = `${nh}px`;
          });
        }
      };
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        root.classList.remove('resizing');
        if (resizeRaf) {
          cancelAnimationFrame(resizeRaf);
          resizeRaf = 0;
          win.w = nw;
          win.h = nh;
          root.style.width = `${nw}px`;
          root.style.height = `${nh}px`;
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }

  // ----- focus + controls -----
  root.addEventListener('pointerdown', () => hooks.onFocus(), true);

  btnMin.addEventListener('click', () => win.minimize());
  btnMax.addEventListener('click', () => win.toggleMaximize());
  btnClose.addEventListener('click', () => {
    if (closeRequestPending || closing) return;
    closeRequestPending = true;
    void (async () => {
      if (opts.onRequestClose) {
        const ok = await opts.onRequestClose();
        if (!ok) {
          closeRequestPending = false;
          return;
        }
      }
      win.close();
    })();
  });

  titlebar.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).closest('.win-btn')) return;
    win.toggleMaximize();
  });

  return win;
}
