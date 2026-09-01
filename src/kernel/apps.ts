/** App registry + process launcher. */

import type { Bus } from './events';
import type { ThemeEngine } from './theme';
import type { WM } from './wm';
import type { VFS } from './vfs';

export interface FlashApp {
  id: string;
  name: string;
  iconSvg: string;
  defaultSize: { w: number; h: number };
  /** hidden apps don't appear on the desktop or launcher (e.g. image viewer) */
  hidden?: boolean;
  mount(container: HTMLElement, ctx: AppContext, args?: unknown): void | (() => void);
}

export interface AppContext {
  events: Bus;
  theme: ThemeEngine;
  vfs: VFS;
  bootTime: number;
  openApp(id: string, args?: unknown): void;
  /** sets this window's titlebar text */
  setTitle(title: string): void;
  /** registers a close guard — return false (or Promise<false>) to veto closing */
  onCloseRequest(guard: () => boolean | Promise<boolean>): void;
  /** number of registered apps (for the About panel) */
  appCount(): number;
}

export interface AppSystem {
  register(app: FlashApp): void;
  get(id: string): FlashApp | undefined;
  list(): FlashApp[];
  visibleApps(): FlashApp[];
  launch(id: string, args?: unknown): void;
}

interface AppSystemDeps {
  events: Bus;
  theme: ThemeEngine;
  vfs: VFS;
  bootTime: number;
  wm(): WM;
}

export function createApps(deps: AppSystemDeps): AppSystem {
  const registry = new Map<string, FlashApp>();

  const sys: AppSystem = {
    register(app) {
      if (registry.has(app.id)) {
        console.warn(`[apps] duplicate id "${app.id}" ignored`);
        return;
      }
      registry.set(app.id, app);
    },
    get: (id) => registry.get(id),
    list: () => [...registry.values()],
    visibleApps: () => [...registry.values()].filter((a) => !a.hidden),

    launch(id, args) {
      const app = registry.get(id);
      if (!app) {
        console.warn(`[apps] unknown app "${id}"`);
        return;
      }
      const content = document.createElement('div');
      content.className = 'app-root';
      let cleanup: (() => void) | void;
      let closeGuard: (() => boolean | Promise<boolean>) | null = null;

      const win = deps.wm().openWindow({
        appId: app.id,
        title: app.name,
        iconSvg: app.iconSvg,
        width: app.defaultSize.w,
        height: app.defaultSize.h,
        content,
        onRequestClose: () => (closeGuard ? closeGuard() : true),
        onClose: () => {
          try {
            cleanup?.();
          } catch (err) {
            console.error(`[apps] cleanup for "${app.id}" threw`, err);
          }
          deps.events.emit('app:closed', app.id);
        }
      });

      const ctx: AppContext = {
        events: deps.events,
        theme: deps.theme,
        vfs: deps.vfs,
        bootTime: deps.bootTime,
        openApp: (appId, appArgs) => {
          sys.launch(appId, appArgs);
        },
        setTitle: (title) => win.setTitle(title),
        onCloseRequest: (guard) => {
          closeGuard = guard;
        },
        appCount: () => registry.size
      };

      cleanup = app.mount(content, ctx, args);
      deps.events.emit('app:launched', app.id);
    }
  };

  return sys;
}
