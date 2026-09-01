# FlashOS

**A complete operating system that runs in your browser.**

FlashOS is a real, coherent desktop environment — a window manager, a persistent
virtual file system, and a suite of nine applications that all read from and write
to that same file system. Create a file in Notepad and watch it appear in Files.
Delete it from the Terminal and it's gone everywhere. Refresh the page and your
files are still there.

> Every line of code in this operating system was written by **GLM-5.3 Flash**,
> an AI model. No frameworks, no backend, no external assets — just TypeScript,
> the DOM, IndexedDB and the Web Audio API.

Built for the **Cerebral Valley GLM-5.3 Flash Lightning Hackathon**.

---

## Run it

```bash
npm install
npm run dev        # development server
npm run build      # type-checks and produces dist/
npm run preview    # serves the production build locally
```

Open the printed URL (defaults to `http://localhost:5173`). Add `?fastboot` to skip
the boot animation.

## Deploy (Vercel)

Zero-config:

```bash
npm i -g vercel
vercel            # deploy preview
vercel --prod     # production
```

Vercel auto-detects Vite: build command `npm run build`, output directory `dist`.
GitHub Pages works too — the build uses relative asset paths (`base: './'`), so
serve `dist/` from any static host.

## The apps

| App | What it does |
| --- | --- |
| **Files** | Two-pane file manager: directory tree, breadcrumbs, new/rename/delete, drag-to-move, PNG preview in the built-in Viewer. Live-updates on every VFS change. |
| **Notepad** | Text editor with open/save/save-as over the VFS, `Ctrl/Cmd+S`, dirty-state tracking, unsaved-changes guard. |
| **Terminal** | Real shell (`fsh`) over the VFS: `help, ls, cd, pwd, cat, mkdir, touch, rm, mv, echo >, tree, open, theme, clear, date, whoami, history, about, neofetch` — with tab completion and persistent history. |
| **Paint** | Canvas drawing: brush, eraser, line, rectangle, ellipse, flood fill, 12 swatches + color picker, undo/redo, PNG export into `/home/guest/pictures`. |
| **BeatLab** | 16-step sequencer, fully synthesized (kick/snare/hat/clap + bass/lead synths), BPM, swing, mutes, three presets, pattern save/load as JSON. |
| **Snake** | Fixed-timestep canvas game, speeds up as you eat, persistent best score. |
| **Minesweeper** | Classic rules — beginner/intermediate, flags, safe first click, timer. |
| **About** | The story, live system stats, build stats, theme switcher. |
| *Viewer* | Minimal image viewer (opens PNGs from Files/Terminal). |

## Architecture

```
src/
├── main.ts              boot sequence, kernel init, shell assembly
├── boot/boot.ts         animated boot screen (?fastboot skips it)
├── kernel/
│   ├── events.ts        typed pub/sub bus (vfs:changed, theme:changed, window:…, app:…)
│   ├── vfs.ts           POSIX-ish virtual file system on IndexedDB (via idb)
│   ├── wm.ts            window manager: z-order, focus, cascade, Alt+Tab
│   ├── apps.ts          app registry + process launcher
│   └── theme.ts         theme engine (token swapping + localStorage)
├── ui/
│   ├── desktop.ts       canvas wallpaper (drifting mesh gradient) + icon grid
│   ├── window.ts        window chrome: drag/resize/min/max/close animations
│   ├── taskbar.ts       launcher button, running apps, live clock
│   ├── launcher.ts      searchable app launcher overlay
│   ├── contextmenu.ts   recursive, viewport-clamped context menus
│   ├── dialog.ts        modal prompt/confirm/picker dialogs
│   └── toast.ts         toast notifications
├── apps/                one isolated module per app, shared FlashApp interface
└── styles/
    ├── tokens.css       design tokens ×3 themes (flash / light / synthwave)
    └── base.css         all component styles
```

Key properties:

- **Strict TypeScript**, no `any`. Every app implements `FlashApp` and receives an
  `AppContext` (VFS, event bus, theme, launcher helpers). Apps are mounted into
  windows by the kernel and return cleanup functions.
- **One source of truth.** All file mutations go through `kernel/vfs.ts`, which
  persists to IndexedDB and broadcasts `vfs:changed` — Files, Notepad, the Terminal
  and About all stay in sync from that single event.
- **Theming is pure token swapping.** `kernel/theme.ts` flips `data-theme` on the
  root; every component reads CSS variables, so all three themes apply everywhere
  with zero per-app theming code.
- **Static by construction.** The wallpaper is a canvas-painted mesh gradient,
  icons are hand-drawn inline SVG, sounds are synthesized oscillators, the favicon
  is a data URI. Zero network requests at runtime.
- **Fast.** Boot-to-desktop under 2s, transform-based 60fps window dragging, and
  the entire production bundle is ~26 KB gzipped.

## Data & persistence

- Files live in IndexedDB (`flashos-vfs`), seeded on first boot with
  `/home/guest` containing a welcome note and `docs/`, `pictures/`, `music/`.
- Theme choice persists in localStorage, as do Terminal history and Snake's best
  score. Window layout intentionally resets each boot — a fresh desk every time.
