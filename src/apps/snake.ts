/** Snake — fixed-timestep canvas game with speed ramp, pause, best score. */

import type { FlashApp } from '../kernel/apps';

const COLS = 24;
const ROWS = 18;
const CELL = 26;
const BASE_STEP_MS = 130;
const MIN_STEP_MS = 62;
const BEST_KEY = 'flashos.snake.best';

type Dir = 'up' | 'down' | 'left' | 'right';

const DIRS: Record<Dir, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};

export const snakeApp: FlashApp = {
  id: 'snake',
  name: 'Snake',
  iconSvg:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h9a4 4 0 0 1 0 8H8a3 3 0 0 0 0 6h8"/><circle cx="19" cy="6" r="1.4"/></svg>',
  defaultSize: { w: 700, h: 560 },
  mount(container: HTMLElement, ctx) {
    container.innerHTML = `
      <div class="snake">
        <div class="snake-hud">
          <span>Score <strong data-score>0</strong></span>
          <span>Best <strong data-best>0</strong></span>
          <span data-speed>Speed 1×</span>
          <span class="snake-hint">Arrows/WASD move · P pause</span>
        </div>
        <div class="snake-stage">
          <canvas tabindex="0" width="${COLS * CELL}" height="${ROWS * CELL}"></canvas>
          <div class="snake-overlay">
            <div class="snake-overlay-title">Snake</div>
            <div class="snake-overlay-text">Press any arrow key to start</div>
          </div>
        </div>
      </div>`;

    const canvas = container.querySelector<HTMLCanvasElement>('canvas')!;
    const g = canvas.getContext('2d');
    if (!g) return;
    const gc: CanvasRenderingContext2D = g;
    const overlay = container.querySelector<HTMLElement>('.snake-overlay')!;
    const overlayTitle = container.querySelector<HTMLElement>('.snake-overlay-title')!;
    const overlayText = container.querySelector<HTMLElement>('.snake-overlay-text')!;
    const scoreEl = container.querySelector<HTMLElement>('[data-score]')!;
    const bestEl = container.querySelector<HTMLElement>('[data-best]')!;
    const speedEl = container.querySelector<HTMLElement>('[data-speed]')!;

    interface Segment { x: number; y: number; }

    let snake: Segment[] = [];
    let dir: Dir = 'right';
    let queuedDir: Dir | null = null;
    let apple: Segment = { x: 12, y: 9 };
    let score = 0;
    let applesEaten = 0;
    let best = Number(localStorage.getItem(BEST_KEY) ?? '0');
    let state: 'idle' | 'running' | 'paused' | 'over' = 'idle';
    let acc = 0;
    let lastTime = 0;
    let raf = 0;

    const stepMs = (): number => Math.max(MIN_STEP_MS, BASE_STEP_MS - applesEaten * 6);

    const speedLevel = (): number => Math.round((BASE_STEP_MS / stepMs()) * 10) / 10;

    function placeApple(): void {
      let p: Segment;
      do {
        p = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
      } while (snake.some((s) => s.x === p.x && s.y === p.y));
      apple = p;
    }

    function reset(): void {
      snake = [
        { x: 8, y: 9 },
        { x: 7, y: 9 },
        { x: 6, y: 9 }
      ];
      dir = 'right';
      queuedDir = null;
      score = 0;
      applesEaten = 0;
      acc = 0;
      placeApple();
      scoreEl.textContent = '0';
      speedEl.textContent = 'Speed 1×';
      overlay.style.display = 'none';
    }

    function showOverlay(title: string, text: string): void {
      overlayTitle.textContent = title;
      overlayText.textContent = text;
      overlay.style.display = 'grid';
    }

    function startGame(): void {
      if (state === 'over' || state === 'idle') reset();
      state = 'running';
      lastTime = performance.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    }

    function gameOver(): void {
      state = 'over';
      if (score > best) {
        best = score;
        localStorage.setItem(BEST_KEY, String(best));
        bestEl.textContent = String(best);
      }
      showOverlay('Game over', `Score ${score} — press Enter to play again`);
    }

    function step(): void {
      if (queuedDir) {
        const q = DIRS[queuedDir];
        const cur = DIRS[dir];
        if (q.x !== -cur.x || q.y !== -cur.y) dir = queuedDir;
        queuedDir = null;
      }
      const head = { x: snake[0]!.x + DIRS[dir]!.x, y: snake[0]!.y + DIRS[dir]!.y };
      if (
        head.x < 0 ||
        head.y < 0 ||
        head.x >= COLS ||
        head.y >= ROWS ||
        snake.some((s) => s.x === head.x && s.y === head.y)
      ) {
        gameOver();
        return;
      }
      snake.unshift(head);
      if (head.x === apple.x && head.y === apple.y) {
        score += 10;
        applesEaten += 1;
        scoreEl.textContent = String(score);
        speedEl.textContent = `Speed ${speedLevel()}×`;
        placeApple();
      } else {
        snake.pop();
      }
    }

    function draw(t: number): void {
      const w = canvas.width;
      const h = canvas.height;
      gc.clearRect(0, 0, w, h);

      // background + subtle grid
      gc.fillStyle = 'rgba(2, 4, 10, 0.5)';
      gc.fillRect(0, 0, w, h);
      gc.strokeStyle = 'rgba(139, 148, 173, 0.07)';
      gc.lineWidth = 1;
      for (let x = 1; x < COLS; x++) {
        gc.beginPath();
        gc.moveTo(x * CELL + 0.5, 0);
        gc.lineTo(x * CELL + 0.5, h);
        gc.stroke();
      }
      for (let y = 1; y < ROWS; y++) {
        gc.beginPath();
        gc.moveTo(0, y * CELL + 0.5);
        gc.lineTo(w, y * CELL + 0.5);
        gc.stroke();
      }

      // apple (pulses)
      const pulse = 1 + Math.sin(t * 0.006) * 0.12;
      const ar = (CELL / 2 - 4) * pulse;
      const grad = gc.createRadialGradient(
        apple.x * CELL + CELL / 2,
        apple.y * CELL + CELL / 2,
        1,
        apple.x * CELL + CELL / 2,
        apple.y * CELL + CELL / 2,
        ar
      );
      grad.addColorStop(0, '#ffd23e');
      grad.addColorStop(1, '#ff6b2c');
      gc.fillStyle = grad;
      gc.beginPath();
      gc.arc(apple.x * CELL + CELL / 2, apple.y * CELL + CELL / 2, ar, 0, Math.PI * 2);
      gc.fill();

      // snake (accent gradient head → tail)
      for (const [i, s] of snake.entries()) {
        const f = 1 - i / Math.max(snake.length, 1);
        const r = Math.round(255);
        const gg = Math.round(107 - f * 20);
        const b = Math.round(44 + f * 10);
        gc.fillStyle = i === 0 ? '#ffd23e' : `rgb(${r},${gg},${b})`;
        const pad = i === 0 ? 2 : 3 + f * 1.5;
        const radius = 6;
        const x = s.x * CELL + pad;
        const y = s.y * CELL + pad;
        const size = CELL - pad * 2;
        gc.beginPath();
        gc.roundRect(x, y, size, size, radius);
        gc.fill();
      }
    }

    function loop(t: number): void {
      if (state !== 'running') return;
      raf = requestAnimationFrame(loop);
      const dt = Math.min(t - lastTime, 250);
      lastTime = t;
      acc += dt;
      while (acc >= stepMs()) {
        acc -= stepMs();
        step();
        if (state !== 'running') break;
      }
      draw(t);
    }

    const KEY_DIR: Record<string, Dir> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      w: 'up',
      s: 'down',
      a: 'left',
      d: 'right',
      W: 'up',
      S: 'down',
      A: 'left',
      D: 'right'
    };

    container.addEventListener('keydown', (e) => {
      const dirKey = KEY_DIR[e.key];
      if (dirKey) {
        e.preventDefault();
        if (state === 'idle' || state === 'over') startGame();
        queuedDir = dirKey;
        if (state === 'paused') state = 'running';
        return;
      }
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        if (state === 'running') {
          state = 'paused';
          showOverlay('Paused', 'Press P or any arrow to resume');
        } else if (state === 'paused') {
          state = 'running';
          overlay.style.display = 'none';
          lastTime = performance.now();
        }
        return;
      }
      if (e.key === 'Enter' && state === 'over') {
        e.preventDefault();
        startGame();
      }
    });

    container.addEventListener('pointerdown', () => canvas.focus());
    canvas.focus();

    bestEl.textContent = String(best);
    reset();
    showOverlay('Snake', 'Press any arrow key to start');
    draw(0);

    void ctx;
    return () => {
      cancelAnimationFrame(raf);
    };
  }
};
