/** Desktop — canvas wallpaper (drifting mesh gradient + accent particles) and app icon grid. */

import type { Bus, ThemeName } from '../kernel/events';
import type { ThemeEngine } from '../kernel/theme';
import type { FlashApp } from '../kernel/apps';

export interface DesktopHandles {
  layer: HTMLElement;
  destroy(): void;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return [10, 14, 26];
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

interface Blob {
  bx: number; // base position (fraction)
  by: number;
  r: number; // radius fraction of min(vw,vh)
  speed: number;
  phase: number;
  rgb: [number, number, number];
  alpha: number;
}

interface Particle {
  x: number; // fraction
  y: number;
  size: number;
  speed: number;
  twinkle: number;
}

function createWallpaper(events: Bus): { el: HTMLCanvasElement; destroy(): void } {
  const canvas = document.createElement('canvas');
  canvas.className = 'wallpaper';
  const g = canvas.getContext('2d');
  if (!g) return { el: canvas, destroy: () => canvas.remove() };

  let W = 0;
  let H = 0;
  const resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();

  const readColors = (): { a: [number, number, number]; b: [number, number, number]; accent: [number, number, number] } => {
    const s = getComputedStyle(document.documentElement);
    return {
      a: hexToRgb(s.getPropertyValue('--bg-desktop-a')),
      b: hexToRgb(s.getPropertyValue('--bg-desktop-b')),
      accent: hexToRgb(s.getPropertyValue('--accent'))
    };
  };
  let colors = readColors();

  const mkBlobs = (): Blob[] => [
    { bx: 0.18, by: 0.22, r: 0.75, speed: 0.05, phase: 0.0, rgb: colors.b, alpha: 0.9 },
    { bx: 0.85, by: 0.15, r: 0.6, speed: 0.04, phase: 1.7, rgb: colors.accent, alpha: 0.1 },
    { bx: 0.7, by: 0.85, r: 0.8, speed: 0.035, phase: 3.1, rgb: colors.b, alpha: 0.8 },
    { bx: 0.1, by: 0.9, r: 0.55, speed: 0.045, phase: 4.4, rgb: colors.accent, alpha: 0.07 },
    { bx: 0.5, by: 0.5, r: 0.9, speed: 0.03, phase: 5.6, rgb: colors.b, alpha: 0.6 }
  ];
  let blobs = mkBlobs();

  const particles: Particle[] = Array.from({ length: 42 }, () => ({
    x: Math.random(),
    y: Math.random(),
    size: 1 + Math.random() * 1.8,
    speed: 0.004 + Math.random() * 0.01,
    twinkle: Math.random() * Math.PI * 2
  }));

  const draw = (t: number): void => {
    const { a, b, accent } = colors;
    const base = g.createLinearGradient(0, 0, W, H);
    const [ar, ag, ab] = a;
    const [br, bg, bb] = b;
    base.addColorStop(0, `rgb(${ar},${ag},${ab})`);
    base.addColorStop(1, `rgb(${br},${bg},${bb})`);
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);

    const minDim = Math.min(W, H);
    for (const blob of blobs) {
      const cx = (blob.bx + Math.sin(t * 0.0001 * blob.speed * 6 + blob.phase) * 0.09) * W;
      const cy = (blob.by + Math.cos(t * 0.00013 * blob.speed * 6 + blob.phase) * 0.07) * H;
      const r = blob.r * minDim;
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      const [cr, cg, cb] = blob.rgb;
      grad.addColorStop(0, `rgba(${cr},${cg},${cb},${blob.alpha})`);
      grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
    }

    for (const p of particles) {
      p.y -= p.speed * 0.016;
      if (p.y < -0.02) {
        p.y = 1.02;
        p.x = Math.random();
      }
      const tw = 0.5 + 0.5 * Math.sin(t * 0.001 + p.twinkle);
      const px = p.x * W;
      const py = p.y * H;
      const rad = g.createRadialGradient(px, py, 0, px, py, p.size * 3.2);
      rad.addColorStop(0, `rgba(${accent[0]},${accent[1]},${accent[2]},${0.16 * tw})`);
      rad.addColorStop(1, `rgba(${accent[0]},${accent[1]},${accent[2]},0)`);
      g.fillStyle = rad;
      g.beginPath();
      g.arc(px, py, p.size * 3.2, 0, Math.PI * 2);
      g.fill();
    }
  };

  let raf = 0;
  let last = 0;
  let running = !document.hidden;
  const frame = (t: number): void => {
    if (!running) return;
    if (t - last >= 1000 / 30) {
      last = t;
      draw(t);
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  const onVis = (): void => {
    running = !document.hidden;
    if (running) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    } else {
      cancelAnimationFrame(raf);
    }
  };
  const onResize = (): void => resize();
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('resize', onResize);

  const offTheme = events.on('theme:changed', (name: ThemeName) => {
    void name;
    colors = readColors();
    blobs = mkBlobs();
    draw(performance.now());
  });

  return {
    el: canvas,
    destroy() {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', onResize);
      offTheme();
      canvas.remove();
    }
  };
}

export interface DesktopDeps {
  events: Bus;
  theme: ThemeEngine;
  apps(): FlashApp[];
  onOpenApp(id: string): void;
  onBackgroundClick(): void;
}

export function createDesktop(root: HTMLElement, deps: DesktopDeps): DesktopHandles {
  const wallpaper = createWallpaper(deps.events);
  root.append(wallpaper.el);
  wallpaper.el.addEventListener('click', () => deps.onBackgroundClick());

  const layer = document.createElement('div');
  layer.className = 'desktop-icons';
  root.append(layer);

  const buildIcons = (): void => {
    layer.innerHTML = '';
    for (const app of deps.apps()) {
      const tile = document.createElement('div');
      tile.className = 'desk-icon';
      tile.dataset.appId = app.id;
      const icon = document.createElement('div');
      icon.className = 'desk-icon-tile';
      icon.innerHTML = app.iconSvg;
      const label = document.createElement('div');
      label.className = 'desk-icon-label';
      label.textContent = app.name;
      tile.append(icon, label);
      tile.addEventListener('click', (e) => {
        e.stopPropagation();
        for (const s of layer.querySelectorAll('.desk-icon.selected')) s.classList.remove('selected');
        tile.classList.add('selected');
      });
      tile.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        deps.onOpenApp(app.id);
      });
      layer.append(tile);
    }
  };
  buildIcons();

  layer.addEventListener('click', (e) => {
    if (e.target === layer) {
      for (const s of layer.querySelectorAll('.desk-icon.selected')) s.classList.remove('selected');
    }
  });

  return {
    layer,
    destroy() {
      wallpaper.destroy();
      layer.remove();
    }
  };
}
