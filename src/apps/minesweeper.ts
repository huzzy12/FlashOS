/** Minesweeper — classic rules, themed; beginner/intermediate, flags, timer, safe first click. */

import type { FlashApp } from '../kernel/apps';

interface Difficulty {
  name: string;
  cols: number;
  rows: number;
  mines: number;
}

const DIFFICULTIES: Difficulty[] = [
  { name: 'Beginner', cols: 9, rows: 9, mines: 10 },
  { name: 'Intermediate', cols: 16, rows: 16, mines: 40 }
];

interface Cell {
  mine: boolean;
  revealed: boolean;
  flagged: boolean;
  count: number;
  el: HTMLButtonElement;
}

const NUM_COLORS = ['#37b6ff', '#3ddc84', '#ff8f5e', '#8a63ff', '#ff4d5e', '#2ef2c5', '#e8ecf6', '#8b94ad'];

export const minesweeperApp: FlashApp = {
  id: 'minesweeper',
  name: 'Minesweeper',
  iconSvg:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="7"/><path d="M12 6V3M19 13h3M2 13h3"/><path d="m17 8 2-2M7 8 5 6"/><path d="M12 10v4"/></svg>',
  defaultSize: { w: 560, h: 560 },
  mount(container: HTMLElement, ctx) {
    container.innerHTML = `
      <div class="mines">
        <div class="mines-top">
          <div class="mines-diff"></div>
          <div class="paint-spring"></div>
          <div class="mines-counter"><span data-mines>010</span></div>
          <button class="tool-btn" data-reset title="New game">Reset</button>
          <div class="mines-counter"><span data-timer>000</span></div>
        </div>
        <div class="mines-board-wrap">
          <div class="mines-board"></div>
          <div class="mines-overlay">
            <div class="mines-overlay-title"></div>
            <div class="mines-overlay-text"></div>
          </div>
        </div>
        <div class="mines-status">Left-click reveal · right-click flag</div>
      </div>`;

    const diffEl = container.querySelector<HTMLElement>('.mines-diff')!;
    const boardEl = container.querySelector<HTMLElement>('.mines-board')!;
    const overlay = container.querySelector<HTMLElement>('.mines-overlay')!;
    const overlayTitle = container.querySelector<HTMLElement>('.mines-overlay-title')!;
    const overlayText = container.querySelector<HTMLElement>('.mines-overlay-text')!;
    const minesEl = container.querySelector<HTMLElement>('[data-mines]')!;
    const timerEl = container.querySelector<HTMLElement>('[data-timer]')!;
    const resetBtn = container.querySelector<HTMLButtonElement>('[data-reset]')!;

    let diff: Difficulty = DIFFICULTIES[0]!;
    let cells: Cell[] = [];
    let started = false;
    let over = false;
    let flags = 0;
    let revealedCount = 0;
    let timer = 0;
    let timerInterval = 0;

    const pad3 = (n: number): string => String(Math.max(0, Math.min(999, n))).padStart(3, '0');

    for (const d of DIFFICULTIES) {
      const btn = document.createElement('button');
      btn.className = 'tool-btn' + (d === diff ? ' active' : '');
      btn.textContent = d.name;
      btn.addEventListener('click', () => {
        diff = d;
        for (const b of diffEl.children) b.classList.remove('active');
        btn.classList.add('active');
        newGame();
      });
      diffEl.append(btn);
    }

    function idx(x: number, y: number): number {
      return y * diff.cols + x;
    }

    function neighbors(x: number, y: number): Cell[] {
      const out: Cell[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < diff.cols && ny < diff.rows) out.push(cells[idx(nx, ny)]!);
        }
      }
      return out;
    }

    function placeMines(safeIdx: number): void {
      const safe = new Set<number>([safeIdx, ...neighbors(safeIdx % diff.cols, Math.floor(safeIdx / diff.cols)).map((c) => cells.indexOf(c))]);
      let placed = 0;
      while (placed < diff.mines) {
        const i = Math.floor(Math.random() * cells.length);
        if (safe.has(i) || cells[i]!.mine) continue;
        cells[i]!.mine = true;
        placed++;
      }
      for (const [i, cell] of cells.entries()) {
        cell.count = neighbors(i % diff.cols, Math.floor(i / diff.cols)).filter((n) => n.mine).length;
      }
    }

    function startTimer(): void {
      stopTimer();
      timerInterval = window.setInterval(() => {
        timer += 1;
        timerEl.textContent = pad3(timer);
      }, 1000);
    }

    function stopTimer(): void {
      if (timerInterval) window.clearInterval(timerInterval);
      timerInterval = 0;
    }

    function syncCounter(): void {
      minesEl.textContent = pad3(diff.mines - flags);
    }

    function renderCell(cell: Cell): void {
      const el = cell.el;
      el.className = 'mine-cell';
      el.textContent = '';
      if (cell.flagged && !cell.revealed) {
        el.classList.add('flagged');
        el.textContent = '⚑';
      } else if (cell.revealed) {
        el.classList.add('revealed');
        if (cell.mine) {
          el.classList.add('boom');
          el.textContent = '✸';
        } else if (cell.count > 0) {
          el.textContent = String(cell.count);
          el.style.color = NUM_COLORS[Math.min(cell.count - 1, NUM_COLORS.length - 1)]!;
        }
      }
    }

    function reveal(cell: Cell): void {
      if (cell.revealed || cell.flagged || over) return;
      const x = cells.indexOf(cell) % diff.cols;
      const y = Math.floor(cells.indexOf(cell) / diff.cols);
      const flood = (cx: number, cy: number): void => {
        const c = cells[idx(cx, cy)]!;
        if (c.revealed || c.flagged) return;
        c.revealed = true;
        revealedCount++;
        renderCell(c);
        if (c.count === 0 && !c.mine) {
          for (const n of neighbors(cx, cy)) {
            if (!n.revealed) flood(cells.indexOf(n) % diff.cols, Math.floor(cells.indexOf(n) / diff.cols));
          }
        }
      };
      void x;
      void y;
      flood(x, y);
    }

    function checkWin(): void {
      const total = diff.cols * diff.rows;
      if (revealedCount === total - diff.mines) {
        over = true;
        stopTimer();
        for (const c of cells) {
          if (c.mine && !c.flagged) {
            c.flagged = true;
            renderCell(c);
          }
        }
        syncCounter();
        overlayTitle.textContent = 'You win!';
        overlayText.textContent = `Cleared in ${timer}s`;
        overlay.classList.add('show');
      }
    }

    function boom(cell: Cell): void {
      over = true;
      stopTimer();
      cell.revealed = true;
      for (const c of cells) {
        if (c.mine) {
          c.revealed = true;
          renderCell(c);
        }
      }
      renderCell(cell);
      overlayTitle.textContent = 'Boom!';
      overlayText.textContent = 'You hit a mine — click Reset to retry';
      overlay.classList.add('show');
    }

    boardEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains('mine-cell') || over) return;
      const cell = cells[Number(target.dataset.i)]!;
      if (!started) {
        started = true;
        placeMines(cells.indexOf(cell));
        startTimer();
      }
      if (cell.flagged) return;
      if (cell.mine) {
        boom(cell);
        return;
      }
      reveal(cell);
      checkWin();
    });

    boardEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const target = e.target as HTMLElement;
      if (!target.classList.contains('mine-cell') || over) return;
      const cell = cells[Number(target.dataset.i)]!;
      if (cell.revealed) return;
      cell.flagged = !cell.flagged;
      flags += cell.flagged ? 1 : -1;
      syncCounter();
      renderCell(cell);
    });

    function newGame(): void {
      stopTimer();
      started = false;
      over = false;
      flags = 0;
      revealedCount = 0;
      timer = 0;
      timerEl.textContent = '000';
      syncCounter();
      overlay.classList.remove('show');
      boardEl.innerHTML = '';
      boardEl.style.setProperty('--cols', String(diff.cols));
      cells = Array.from({ length: diff.cols * diff.rows }, () => {
        const el = document.createElement('button');
        el.className = 'mine-cell';
        boardEl.append(el);
        return { mine: false, revealed: false, flagged: false, count: 0, el };
      });
      cells.forEach((c, i) => {
        c.el.dataset.i = String(i);
      });
    }

    resetBtn.addEventListener('click', newGame);

    newGame();
    void ctx;
  }
};
