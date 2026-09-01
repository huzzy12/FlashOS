/** Modal dialogs scoped to an app window — prompt, confirm, list picker. */

export interface DialogItem {
  label: string;
  hint?: string;
  value: string;
}

export interface DialogOptions {
  title: string;
  message?: string;
  /** text input mode */
  input?: { value?: string; placeholder?: string };
  /** list picker mode */
  items?: DialogItem[];
  confirmText?: string;
  danger?: boolean;
}

export function showDialog(container: HTMLElement, opts: DialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dlg-overlay';

    const box = document.createElement('div');
    box.className = 'dlg-box';

    const title = document.createElement('div');
    title.className = 'dlg-title';
    title.textContent = opts.title;
    box.append(title);

    if (opts.message) {
      const msg = document.createElement('div');
      msg.className = 'dlg-message';
      msg.textContent = opts.message;
      box.append(msg);
    }

    let inputEl: HTMLInputElement | null = null;
    if (opts.input) {
      inputEl = document.createElement('input');
      inputEl.className = 'dlg-input';
      inputEl.type = 'text';
      inputEl.spellcheck = false;
      inputEl.value = opts.input.value ?? '';
      inputEl.placeholder = opts.input.placeholder ?? '';
      box.append(inputEl);
    }

    let listEl: HTMLElement | null = null;
    if (opts.items) {
      listEl = document.createElement('div');
      listEl.className = 'dlg-list';
      if (opts.items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'dlg-empty';
        empty.textContent = 'Nothing here yet';
        listEl.append(empty);
      }
      for (const item of opts.items) {
        const row = document.createElement('button');
        row.className = 'dlg-item';
        row.type = 'button';
        const label = document.createElement('span');
        label.textContent = item.label;
        row.append(label);
        if (item.hint) {
          const hint = document.createElement('span');
          hint.className = 'dlg-hint';
          hint.textContent = item.hint;
          row.append(hint);
        }
        row.addEventListener('click', () => finish(item.value));
        listEl.append(row);
      }
      box.append(listEl);
    }

    const buttons = document.createElement('div');
    buttons.className = 'dlg-buttons';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'dlg-btn';
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => finish(null));
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'dlg-btn primary' + (opts.danger ? ' danger' : '');
    confirmBtn.type = 'button';
    confirmBtn.textContent = opts.confirmText ?? 'OK';
    confirmBtn.addEventListener('click', () => finishConfirm());
    buttons.append(cancelBtn, confirmBtn);
    box.append(buttons);
    overlay.append(box);
    container.append(overlay);

    let done = false;
    function finish(value: string | null): void {
      if (done) return;
      done = true;
      overlay.classList.add('closing');
      window.setTimeout(() => overlay.remove(), 130);
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    }

    function finishConfirm(): void {
      if (opts.items) {
        const selected = listEl?.querySelector<HTMLElement>('.dlg-item.picked');
        const idx = selected ? [...(listEl?.children ?? [])].indexOf(selected) : -1;
        if (idx >= 0 && opts.items && opts.items[idx]) {
          finish(opts.items[idx]!.value);
          return;
        }
        finish(null);
        return;
      }
      finish(inputEl ? inputEl.value : 'ok');
    }

    function onKey(e: KeyboardEvent): void {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        finishConfirm();
      }
    }
    document.addEventListener('keydown', onKey, true);

    if (listEl && opts.items && opts.items.length > 0) {
      const first = listEl.querySelector<HTMLElement>('.dlg-item');
      first?.classList.add('picked');
      first?.scrollIntoView({ block: 'nearest' });
    } else if (inputEl) {
      inputEl.focus();
      inputEl.select();
    } else {
      confirmBtn.focus();
    }
  });
}
