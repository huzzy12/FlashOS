/** Paint — canvas drawing with brush/eraser/shapes/fill, undo-redo, PNG export to the VFS. */

import type { FlashApp } from '../kernel/apps';
import { showDialog } from '../ui/dialog';
import { showToast } from '../ui/toast';

const S = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

type Tool = 'brush' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'fill';

const SWATCHES = [
  '#e8ecf6', '#0a0e1a', '#ff6b2c', '#ffd23e', '#3ddc84', '#37b6ff',
  '#8a63ff', '#ff4d5e', '#ff8fd0', '#8b5a2b', '#94a3b8', '#10162a'
] as const;

const TOOLS: { id: Tool; label: string; svg: string }[] = [
  {
    id: 'brush',
    label: 'Brush',
    svg: `<svg viewBox="0 0 24 24" ${S} aria-hidden="true"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`
  },
  {
    id: 'eraser',
    label: 'Eraser',
    svg: `<svg viewBox="0 0 24 24" ${S} aria-hidden="true"><path d="m7 21-4-4a2 2 0 0 1 0-2.8L13.5 3.7a2 2 0 0 1 2.8 0l4 4a2 2 0 0 1 0 2.8L11 20"/><path d="M22 21H7"/><path d="m5 11 8 8"/></svg>`
  },
  {
    id: 'line',
    label: 'Line',
    svg: `<svg viewBox="0 0 24 24" ${S} aria-hidden="true"><path d="M5 19 19 5"/></svg>`
  },
  {
    id: 'rect',
    label: 'Rectangle',
    svg: `<svg viewBox="0 0 24 24" ${S} aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="1"/></svg>`
  },
  {
    id: 'ellipse',
    label: 'Ellipse',
    svg: `<svg viewBox="0 0 24 24" ${S} aria-hidden="true"><ellipse cx="12" cy="12" rx="8" ry="6"/></svg>`
  },
  {
    id: 'fill',
    label: 'Flood fill',
    svg: `<svg viewBox="0 0 24 24" ${S} aria-hidden="true"><path d="m9 11 -5.5 5.5a2.1 2.1 0 0 0 3 3L15 11"/><path d="m7 9 6-6 8 8-6 6"/><path d="M20 19a2 2 0 1 1-4 0c0-1.3 2-3.5 2-3.5s2 2.2 2 3.5"/></svg>`
  }
];

interface UndoState {
  data: ImageData;
}

export const paintApp: FlashApp = {
  id: 'paint',
  name: 'Paint',
  iconSvg: `<svg viewBox="0 0 24 24" ${S} aria-hidden="true"><path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><circle cx="9" cy="9" r="0.5"/><circle cx="15" cy="9" r="0.5"/></svg>`,
  defaultSize: { w: 760, h: 540 },
  mount(container: HTMLElement, ctx) {
    container.innerHTML = `
      <div class="paint">
        <div class="paint-toolbar">
          <div class="paint-tools"></div>
          <div class="files-sep"></div>
          <label class="paint-size">
            <span>Size</span>
            <input type="range" min="1" max="40" value="6" data-size />
            <span data-size-val>6</span>
          </label>
          <div class="files-sep"></div>
          <div class="paint-swatches"></div>
          <input type="color" data-color value="#ff6b2c" title="Custom color" />
          <div class="paint-spring"></div>
          <button class="tool-btn" data-undo title="Undo (Ctrl+Z)">↶</button>
          <button class="tool-btn" data-redo title="Redo (Ctrl+Shift+Z)">↷</button>
          <button class="tool-btn danger" data-clear title="Clear canvas">Clear</button>
          <button class="tool-btn primary" data-save title="Save PNG to /home/guest/pictures">Save</button>
        </div>
        <div class="paint-stage">
          <canvas class="paint-canvas"></canvas>
        </div>
      </div>`;

    const stage = container.querySelector<HTMLElement>('.paint-stage')!;
    const canvas = container.querySelector<HTMLCanvasElement>('.paint-canvas')!;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) return;

    const toolsEl = container.querySelector<HTMLElement>('.paint-tools')!;
    const swatchesEl = container.querySelector<HTMLElement>('.paint-swatches')!;
    const sizeInput = container.querySelector<HTMLInputElement>('[data-size]')!;
    const sizeVal = container.querySelector<HTMLElement>('[data-size-val]')!;
    const colorInput = container.querySelector<HTMLInputElement>('[data-color]')!;

    // offscreen buffer keeps the drawing across window resizes
    const buffer = document.createElement('canvas');
    const bg = buffer.getContext('2d', { willReadFrequently: true });
    if (!bg) return;

    let tool: Tool = 'brush';
    let color = '#ff6b2c';
    let size = 6;
    let drawing = false;
    let startX = 0;
    let startY = 0;
    let snapshot: ImageData | null = null;

    const undoStack: UndoState[] = [];
    const redoStack: UndoState[] = [];
    const MAX_UNDO = 40;

    const pushUndo = (): void => {
      undoStack.push({ data: bg.getImageData(0, 0, buffer.width, buffer.height) });
      if (undoStack.length > MAX_UNDO) undoStack.shift();
      redoStack.length = 0;
    };

    const repaint = (): void => {
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.drawImage(buffer, 0, 0);
    };

    const resizeCanvas = (): void => {
      const rect = stage.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return;
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      if (canvas.width === w && canvas.height === h) return;

      // preserve current drawing in the buffer
      if (buffer.width === 0) {
        buffer.width = w;
        buffer.height = h;
        bg.fillStyle = '#10162a';
        bg.fillRect(0, 0, w, h);
      } else {
        const keep = document.createElement('canvas');
        keep.width = buffer.width;
        keep.height = buffer.height;
        keep.getContext('2d')?.drawImage(buffer, 0, 0);
        buffer.width = w;
        buffer.height = h;
        bg.fillStyle = '#10162a';
        bg.fillRect(0, 0, w, h);
        bg.drawImage(keep, 0, 0);
      }
      canvas.width = w;
      canvas.height = h;
      repaint();
    };

    const ro = new ResizeObserver(() => resizeCanvas());
    ro.observe(stage);
    resizeCanvas();

    const pos = (e: PointerEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const strokeSetup = (): void => {
      bg.lineCap = 'round';
      bg.lineJoin = 'round';
      bg.lineWidth = size;
      bg.strokeStyle = tool === 'eraser' ? '#10162a' : color;
      bg.fillStyle = tool === 'eraser' ? '#10162a' : color;
    };

    // ---------- flood fill ----------
    const floodFill = (sx: number, sy: number, hex: string): void => {
      const img = bg.getImageData(0, 0, buffer.width, buffer.height);
      const d = img.data;
      const w = buffer.width;
      const idx = (x: number, y: number): number => (y * w + x) * 4;
      sx = Math.round(sx);
      sy = Math.round(sy);
      const start = idx(sx, sy);
      const target = [d[start]!, d[start + 1]!, d[start + 2]!, d[start + 3]!];
      const m = /^#(..)(..)(..)$/.exec(hex);
      if (!m) return;
      const fill = [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16), 255];
      if (target.every((v, i) => v === fill[i]!)) return;
      const match = (i: number): boolean =>
        d[i] === target[0] && d[i + 1] === target[1] && d[i + 2] === target[2] && d[i + 3] === target[3];
      const stack: number[] = [sx, sy];
      while (stack.length > 0) {
        const y = stack.pop()!;
        const x = stack.pop()!;
        if (x < 0 || y < 0 || x >= w || y >= buffer.height) continue;
        const i = idx(x, y);
        if (!match(i)) continue;
        d[i] = fill[0]!;
        d[i + 1] = fill[1]!;
        d[i + 2] = fill[2]!;
        d[i + 3] = 255;
        stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
      }
      bg.putImageData(img, 0, 0);
    };

    // ---------- pointer handling ----------
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      const p = pos(e);
      if (tool === 'fill') {
        pushUndo();
        floodFill(p.x, p.y, color);
        repaint();
        return;
      }
      pushUndo();
      drawing = true;
      startX = p.x;
      startY = p.y;
      strokeSetup();
      if (tool === 'brush' || tool === 'eraser') {
        bg.beginPath();
        bg.moveTo(p.x, p.y);
        bg.lineTo(p.x + 0.01, p.y + 0.01);
        bg.stroke();
        repaint();
      } else {
        snapshot = bg.getImageData(0, 0, buffer.width, buffer.height);
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = pos(e);
      if (tool === 'brush' || tool === 'eraser') {
        bg.lineTo(p.x, p.y);
        bg.stroke();
        repaint();
        return;
      }
      // shape preview: restore snapshot, draw live shape
      if (snapshot) bg.putImageData(snapshot, 0, 0);
      strokeSetup();
      g.setLineDash([]);
      bg.strokeStyle = color;
      if (tool === 'line') {
        bg.beginPath();
        bg.moveTo(startX, startY);
        bg.lineTo(p.x, p.y);
        bg.stroke();
      } else if (tool === 'rect') {
        bg.beginPath();
        bg.rect(Math.min(startX, p.x), Math.min(startY, p.y), Math.abs(p.x - startX), Math.abs(p.y - startY));
        bg.stroke();
      } else if (tool === 'ellipse') {
        bg.beginPath();
        bg.ellipse(
          (startX + p.x) / 2,
          (startY + p.y) / 2,
          Math.abs(p.x - startX) / 2,
          Math.abs(p.y - startY) / 2,
          0,
          0,
          Math.PI * 2
        );
        bg.stroke();
      }
      repaint();
    });

    const finishStroke = (): void => {
      if (!drawing) return;
      drawing = false;
      snapshot = null;
      repaint();
    };
    canvas.addEventListener('pointerup', finishStroke);
    canvas.addEventListener('pointercancel', finishStroke);

    // ---------- toolbar ----------
    for (const t of TOOLS) {
      const btn = document.createElement('button');
      btn.className = 'paint-tool' + (t.id === 'brush' ? ' active' : '');
      btn.title = t.label;
      btn.innerHTML = t.svg;
      btn.addEventListener('click', () => {
        tool = t.id;
        for (const b of toolsEl.querySelectorAll('.paint-tool')) b.classList.remove('active');
        btn.classList.add('active');
      });
      toolsEl.append(btn);
    }

    for (const sw of SWATCHES) {
      const b = document.createElement('button');
      b.className = 'paint-swatch' + (sw === color ? ' active' : '');
      b.style.background = sw;
      b.title = sw;
      b.addEventListener('click', () => {
        color = sw;
        colorInput.value = sw.length === 7 ? sw : '#ff6b2c';
        for (const s of swatchesEl.querySelectorAll('.paint-swatch')) s.classList.remove('active');
        b.classList.add('active');
      });
      swatchesEl.append(b);
    }

    sizeInput.addEventListener('input', () => {
      size = Number(sizeInput.value);
      sizeVal.textContent = String(size);
    });
    colorInput.addEventListener('input', () => {
      color = colorInput.value;
      for (const s of swatchesEl.querySelectorAll('.paint-swatch')) s.classList.remove('active');
    });

    const undo = (): void => {
      const prev = undoStack.pop();
      if (!prev) return;
      redoStack.push({ data: bg.getImageData(0, 0, buffer.width, buffer.height) });
      bg.putImageData(prev.data, 0, 0);
      repaint();
    };
    const redo = (): void => {
      const next = redoStack.pop();
      if (!next) return;
      undoStack.push({ data: bg.getImageData(0, 0, buffer.width, buffer.height) });
      bg.putImageData(next.data, 0, 0);
      repaint();
    };

    container.querySelector('[data-undo]')!.addEventListener('click', undo);
    container.querySelector('[data-redo]')!.addEventListener('click', redo);
    container.querySelector('[data-clear]')!.addEventListener('click', () => {
      void showDialog(container, {
        title: 'Clear canvas',
        message: 'Clear the entire canvas? You can still undo afterwards.',
        confirmText: 'Clear',
        danger: true
      }).then((ok) => {
        if (ok === null) return;
        pushUndo();
        bg.fillStyle = '#10162a';
        bg.fillRect(0, 0, buffer.width, buffer.height);
        repaint();
      });
    });

    container.querySelector('[data-save]')!.addEventListener('click', () => {
      void (async () => {
        try {
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
          if (!blob) throw new Error('export failed');
          const name = `drawing-${Date.now()}.png`;
          await ctx.vfs.writeFile(`/home/guest/pictures/${name}`, blob, 'image/png');
          showToast(`Saved pictures/${name}`, 'success');
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Save failed', 'danger');
        }
      })();
    });

    container.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) redo();
        else undo();
      }
    });

    return () => {
      ro.disconnect();
    };
  }
};
