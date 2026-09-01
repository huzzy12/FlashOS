/** FlashOS main — boot sequence, kernel init, shell assembly. */

import './styles/tokens.css';
import './styles/base.css';

import { createBus } from './kernel/events';
import { createTheme } from './kernel/theme';
import { createWM } from './kernel/wm';
import { createApps, type AppSystem } from './kernel/apps';
import { createVfs, seedVfs, basename } from './kernel/vfs';
import { createBoot } from './boot/boot';
import { createDesktop } from './ui/desktop';
import { createTaskbar } from './ui/taskbar';
import { createLauncher } from './ui/launcher';
import { showContextMenu, type MenuItem } from './ui/contextmenu';
import { filesApp, viewerApp } from './apps/files';
import { notepadApp } from './apps/notepad';
import { terminalApp } from './apps/terminal';
import { paintApp } from './apps/paint';
import { beatlabApp } from './apps/beatlab';
import { snakeApp } from './apps/snake';
import { minesweeperApp } from './apps/minesweeper';
import { aboutApp } from './apps/about';

function registerApps(apps: AppSystem): void {
  apps.register(filesApp);
  apps.register(notepadApp);
  apps.register(terminalApp);
  apps.register(paintApp);
  apps.register(beatlabApp);
  apps.register(snakeApp);
  apps.register(minesweeperApp);
  apps.register(aboutApp);
  apps.register(viewerApp);
}

async function main(): Promise<void> {
  const fast = new URLSearchParams(location.search).has('fastboot');
  const boot = createBoot(fast);
  const root = document.getElementById('os');
  if (!root) throw new Error('FlashOS: #os root missing');

  const events = createBus();

  boot.step('Loading kernel');
  const theme = createTheme(events);
  const bootTime = Date.now();

  boot.step('Mounting VFS');
  const vfs = createVfs({ events });
  await seedVfs(vfs);

  boot.step('Starting window manager');
  const layer = document.createElement('div');
  layer.className = 'windows-layer';
  root.append(layer);
  const wm = createWM({ layer, events });

  const apps = createApps({ events, theme, vfs, bootTime, wm: () => wm });
  registerApps(apps);

  boot.step('Mounting desktop');
  createDesktop(root, {
    events,
    theme,
    apps: () => apps.visibleApps(),
    onOpenApp: (id) => apps.launch(id),
    onBackgroundClick: () => wm.blur()
  });

  const launcher = createLauncher(root, {
    events,
    apps: () => apps.visibleApps(),
    onLaunch: (id) => apps.launch(id)
  });

  createTaskbar(root, {
    events,
    wm: () => wm,
    onLauncher: () => launcher.open()
  });

  // desktop right-click menu (About app joins in M4)
  const themeMenu = (): MenuItem[] =>
    theme.all().map((name) => ({
      label: theme.label(name),
      checked: theme.get() === name,
      action: () => theme.set(name)
    }));

  const newDesktopTextFile = async (): Promise<void> => {
    const existing = new Set((await vfs.readdir('/home/guest')).map((n) => basename(n.path)));
    let n = 1;
    let name = 'untitled-1.txt';
    while (existing.has(name)) {
      n += 1;
      name = `untitled-${n}.txt`;
    }
    const path = `/home/guest/${name}`;
    await vfs.writeFile(path, '', 'text/plain');
    apps.launch('notepad', path);
  };

  root.addEventListener('contextmenu', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    if (target.closest('.win') || target.closest('.taskbar')) return;
    if (target.closest('.desk-icon')) return;
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      { label: 'New text file', action: () => void newDesktopTextFile() },
      { label: 'About FlashOS', action: () => apps.launch('about') },
      { separator: true },
      { label: 'Change theme', children: themeMenu() }
    ]);
  });

  boot.step('Ready');
  await boot.finish();
}

main().catch((err) => {
  console.error('[flashos] boot failed', err);
});
