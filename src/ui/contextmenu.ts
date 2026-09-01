/** Right-click context menus — singleton, recursive submenus, viewport-clamped. */

export interface MenuItem {
  label?: string;
  iconSvg?: string;
  hint?: string;
  checked?: boolean;
  disabled?: boolean;
  separator?: boolean;
  children?: MenuItem[];
  action?: () => void;
}

const ARROW_SVG =
  '<svg class="ctx-arrow" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 2.5 L8 6 L4.5 9.5"/></svg>';

const CHECK_SVG =
  '<svg class="ctx-check" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7.5 L5.5 10.5 L11.5 3.5"/></svg>';

let openMenus: HTMLElement[] = [];
let outsideHandler: ((e: PointerEvent) => void) | null = null;
let escHandler: ((e: KeyboardEvent) => void) | null = null;

function clampToViewport(menu: HTMLElement, x: number, y: number): void {
  menu.style.visibility = 'hidden';
  menu.style.left = '0px';
  menu.style.top = '0px';
  const rect = menu.getBoundingClientRect();
  let nx = x;
  let ny = y;
  if (x + rect.width > window.innerWidth - 8) nx = Math.max(8, window.innerWidth - rect.width - 8);
  if (y + rect.height > window.innerHeight - 8) ny = Math.max(8, window.innerHeight - rect.height - 8);
  menu.style.left = `${nx}px`;
  menu.style.top = `${ny}px`;
  menu.style.visibility = '';
}

function buildMenu(items: MenuItem[], isSubmenu: boolean): HTMLElement {
  const menu = document.createElement('div');
  menu.className = isSubmenu ? 'ctx-menu submenu' : 'ctx-menu';

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      menu.append(sep);
      continue;
    }
    const row = document.createElement('button');
    row.className = 'ctx-item' + (item.disabled ? ' disabled' : '');
    row.type = 'button';

    const iconSlot = document.createElement('span');
    iconSlot.className = 'ctx-icon';
    iconSlot.innerHTML = item.checked ? CHECK_SVG : item.iconSvg ?? '';
    row.append(iconSlot);

    if (item.label !== undefined) {
      const label = document.createElement('span');
      label.className = 'ctx-label';
      label.textContent = item.label;
      row.append(label);
    }

    if (item.hint) {
      const hint = document.createElement('span');
      hint.className = 'ctx-hint';
      hint.textContent = item.hint;
      row.append(hint);
    }

    if (item.children && item.children.length > 0) {
      row.insertAdjacentHTML('beforeend', ARROW_SVG);
      let sub: HTMLElement | null = null;
      let hideTimer = 0;
      row.addEventListener('pointerenter', () => {
        window.clearTimeout(hideTimer);
        for (const m of openMenus.slice(openMenus.indexOf(menu) + 1)) {
          m.remove();
          openMenus.splice(openMenus.indexOf(m), 1);
        }
        sub = buildMenu(item.children ?? [], true);
        const rect = row.getBoundingClientRect();
        openMenus.push(sub);
        document.body.append(sub);
        clampToViewport(sub, rect.right - 2, rect.top - 5);
      });
      row.addEventListener('pointerleave', (e) => {
        if (sub && e.relatedTarget instanceof Element && sub.contains(e.relatedTarget)) return;
        hideTimer = window.setTimeout(() => {
          if (sub && !sub.matches(':hover')) {
            sub.remove();
            const i = openMenus.indexOf(sub);
            if (i !== -1) openMenus.splice(i, 1);
            sub = null;
          }
        }, 180);
      });
    } else if (!item.disabled && item.action) {
      row.addEventListener('click', () => {
        closeAllMenus();
        item.action?.();
      });
    } else {
      row.addEventListener('click', (e) => e.stopPropagation());
    }

    menu.append(row);
  }

  return menu;
}

export function closeAllMenus(): void {
  for (const m of openMenus) m.remove();
  openMenus = [];
  if (outsideHandler) {
    document.removeEventListener('pointerdown', outsideHandler, true);
    outsideHandler = null;
  }
  if (escHandler) {
    document.removeEventListener('keydown', escHandler, true);
    escHandler = null;
  }
}

export function showContextMenu(x: number, y: number, items: MenuItem[]): void {
  closeAllMenus();
  if (items.length === 0) return;

  const menu = buildMenu(items, false);
  openMenus.push(menu);
  document.body.append(menu);
  clampToViewport(menu, x, y);

  outsideHandler = (e: PointerEvent) => {
    if (e.target instanceof Element && !e.target.closest('.ctx-menu')) closeAllMenus();
  };
  escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeAllMenus();
    }
  };
  document.addEventListener('pointerdown', outsideHandler, true);
  document.addEventListener('keydown', escHandler, true);
}
