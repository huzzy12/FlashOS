/** Toast notifications — stacked top-right above the taskbar. */

export type ToastKind = 'info' | 'success' | 'danger';

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (!container || !container.isConnected) {
    container = document.createElement('div');
    container.className = 'toast-stack';
    document.body.append(container);
  }
  return container;
}

export function showToast(message: string, kind: ToastKind = 'info'): void {
  const stack = ensureContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  toast.textContent = message;
  stack.append(toast);
  window.setTimeout(() => {
    toast.classList.add('leaving');
    window.setTimeout(() => toast.remove(), 220);
  }, 2600);
}
