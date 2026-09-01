/** About — the submission's story, live system stats, theme previews. */

import type { FlashApp } from '../kernel/apps';
import type { ThemeName } from '../kernel/events';

const S = 'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"';
const BOLT_PATH = 'M13 2 L3 14 H12 L11 22 L21 10 H12 L13 2 Z';

const THEME_PREVIEWS: Record<ThemeName, { bg: string; accent: string }> = {
  flash: { bg: 'linear-gradient(135deg, #0a0e1a, #131c33)', accent: '#ff6b2c' },
  light: { bg: 'linear-gradient(135deg, #e9edf5, #cdd7ea)', accent: '#ff6b2c' },
  synthwave: { bg: 'linear-gradient(135deg, #14002e, #2a0a4a)', accent: '#ff2ea6' }
};

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export const aboutApp: FlashApp = {
  id: 'about',
  name: 'About',
  iconSvg: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${BOLT_PATH}"/></svg>`,
  defaultSize: { w: 640, h: 640 },
  mount(container: HTMLElement, ctx) {
    container.innerHTML = `
      <div class="about">
        <div class="about-hero">
          <svg class="about-bolt" viewBox="0 0 24 24" ${S} aria-hidden="true">
            <path class="about-bolt-path" pathLength="1" d="${BOLT_PATH}"/>
          </svg>
          <div class="about-name">FlashOS <span class="about-version">1.0</span></div>
          <p class="about-story">
            Every line of code in this operating system was written by
            <strong>GLM-5.3 Flash</strong>, an AI model, running on a
            <strong>$1/month coding plan</strong>.
          </p>
        </div>

        <div class="about-stats">
          <div class="about-stat"><span class="about-stat-num" data-stat-apps>0</span><span class="about-stat-label">apps</span></div>
          <div class="about-stat"><span class="about-stat-num" data-stat-files>0</span><span class="about-stat-label">files in VFS</span></div>
          <div class="about-stat"><span class="about-stat-num" data-stat-uptime>0s</span><span class="about-stat-label">uptime</span></div>
        </div>

        <div class="about-section">
          <div class="about-heading">Build stats</div>
          <div class="about-buildstats">
            <div class="about-row"><span>Total prompts</span><span class="about-val" data-build-prompts>—</span></div>
            <div class="about-row"><span>Build hours</span><span class="about-val" data-build-hours>—</span></div>
            <div class="about-row"><span>Estimated cost</span><span class="about-val" data-build-cost>—</span></div>
          </div>
        </div>

        <div class="about-section">
          <div class="about-heading">Theme</div>
          <div class="about-themes"></div>
        </div>

        <div class="about-links">
          <span>Built for the Cerebral Valley GLM-5.3 Flash Lightning Hackathon</span>
          <span class="about-links-dim">100% static · no backend · no external assets</span>
        </div>
      </div>`;

    // bolt draw-in animation
    const boltPath = container.querySelector<SVGPathElement>('.about-bolt-path')!;
    boltPath.style.strokeDasharray = '1';
    boltPath.style.strokeDashoffset = '1';
    requestAnimationFrame(() => {
      boltPath.style.transition = 'stroke-dashoffset 0.9s cubic-bezier(0.5, 0, 0.3, 1)';
      boltPath.style.strokeDashoffset = '0';
    });

    // live stats
    const appsEl = container.querySelector<HTMLElement>('[data-stat-apps]')!;
    const filesEl = container.querySelector<HTMLElement>('[data-stat-files]')!;
    const uptimeEl = container.querySelector<HTMLElement>('[data-stat-uptime]')!;

    appsEl.textContent = String(ctx.appCount());

    const refreshFiles = (): void => {
      void ctx.vfs.listAll().then((all) => {
        filesEl.textContent = String(all.filter((n) => n.type === 'file').length);
      });
    };
    refreshFiles();
    const offChanged = ctx.events.on('vfs:changed', refreshFiles);

    const timer = window.setInterval(() => {
      uptimeEl.textContent = fmtUptime(Date.now() - ctx.bootTime);
    }, 1000);
    uptimeEl.textContent = fmtUptime(Date.now() - ctx.bootTime);

    // theme switcher with previews
    const themesEl = container.querySelector<HTMLElement>('.about-themes')!;
    for (const name of ctx.theme.all()) {
      const btn = document.createElement('button');
      btn.className = 'about-theme' + (ctx.theme.get() === name ? ' active' : '');
      const preview = document.createElement('span');
      preview.className = 'about-theme-preview';
      preview.style.background = THEME_PREVIEWS[name]!.bg;
      preview.innerHTML = `<span class="about-theme-dot" style="background:${THEME_PREVIEWS[name]!.accent}"></span>`;
      const label = document.createElement('span');
      label.textContent = ctx.theme.label(name);
      btn.append(preview, label);
      btn.addEventListener('click', () => {
        ctx.theme.set(name);
        for (const b of themesEl.querySelectorAll('.about-theme')) b.classList.remove('active');
        btn.classList.add('active');
      });
      themesEl.append(btn);
    }

    return () => {
      window.clearInterval(timer);
      offChanged();
    };
  }
};
