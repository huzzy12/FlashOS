/** Boot animation — bolt stroke-draw, progress bar, kernel log. `?fastboot` skips it. */

export interface BootScreen {
  step(label: string): void;
  finish(): Promise<void>;
}

const BOLT_PATH = 'M13 2 L3 14 H12 L11 22 L21 10 H12 L13 2 Z';

const MIN_VISIBLE_MS = 1250;
const FADE_MS = 380;

export function createBoot(fast: boolean): BootScreen {
  if (fast) {
    return {
      step: () => {},
      finish: async () => {}
    };
  }

  const start = performance.now();

  const screen = document.createElement('div');
  screen.className = 'boot';
  screen.innerHTML = `
    <svg class="boot-bolt" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"
         stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
      <path class="bolt-path" pathLength="1" d="${BOLT_PATH}" />
    </svg>
    <div class="boot-title">FLASHOS</div>
    <div class="boot-bar"><div class="boot-fill"></div></div>
    <div class="boot-log"></div>`;
  document.body.append(screen);

  const fill = screen.querySelector<HTMLElement>('.boot-fill')!;
  const log = screen.querySelector<HTMLElement>('.boot-log')!;
  const steps = ['Loading kernel', 'Starting window manager', 'Mounting desktop', 'Ready'];
  let stepIdx = 0;

  return {
    step(label) {
      const line = document.createElement('div');
      line.className = 'boot-log-line';
      line.innerHTML = '';
      const text = document.createElement('span');
      text.textContent = `${label}… `;
      const ok = document.createElement('span');
      ok.className = 'ok';
      ok.textContent = 'ok';
      line.append(text, ok);
      log.append(line);
      stepIdx = Math.min(stepIdx + 1, steps.length + 2);
      fill.style.width = `${Math.min(100, (stepIdx / (steps.length + 1)) * 100)}%`;
    },
    finish() {
      return new Promise<void>((resolve) => {
        fill.style.width = '100%';
        const elapsed = performance.now() - start;
        const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
        window.setTimeout(() => {
          screen.classList.add('done');
          window.setTimeout(() => {
            screen.remove();
            resolve();
          }, FADE_MS);
        }, wait);
      });
    }
  };
}
