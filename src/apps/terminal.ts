/** Terminal — real shell over the VFS: history, tab completion, all core commands, neofetch. */

import type { FlashApp } from '../kernel/apps';
import type { VfsNode } from '../kernel/vfs';
import { basename, joinPath, normalizePath } from '../kernel/vfs';

const HOME = '/home/guest';
const HISTORY_KEY = 'flashos.history';
const MAX_HISTORY = 50;

const BOOT_ART = [
  '    ▄▄▄▄▄      ',
  '   ███████     ',
  '  ██████▀      ',
  ' █████▀        ',
  ' ████████▄     ',
  '  ▀████████    ',
  '     ▀█████▄   ',
  '      ██████   ',
  '     █████▀    ',
  '     ▀▀▀▀      '
] as const;

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const terminalApp: FlashApp = {
  id: 'terminal',
  name: 'Terminal',
  iconSvg:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/></svg>',
  defaultSize: { w: 720, h: 460 },
  mount(container: HTMLElement, ctx, args?: unknown) {
    container.innerHTML = `
      <div class="terminal">
        <div class="term-out"></div>
        <div class="term-line">
          <span class="term-prompt"></span>
          <input class="term-input" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" />
        </div>
      </div>`;

    const root = container.querySelector<HTMLElement>('.terminal')!;
    const out = container.querySelector<HTMLElement>('.term-out')!;
    const promptEl = container.querySelector<HTMLElement>('.term-prompt')!;
    const input = container.querySelector<HTMLInputElement>('.term-input')!;

    let cwd = HOME;

    // ---------- history ----------
    let history: string[] = [];
    try {
      history = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '') as string[];
    } catch {
      history = [];
    }
    if (!Array.isArray(history)) history = [];
    let histIdx = history.length;
    let draft = '';

    const persistHistory = (): void => {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
    };

    // ---------- printing ----------
    function print(text = '', cls = ''): void {
      const line = document.createElement('div');
      line.className = `term-row${cls ? ' ' + cls : ''}`;
      line.textContent = text;
      out.append(line);
      out.scrollTop = out.scrollHeight;
    }

    function printHTML(html: string): void {
      const line = document.createElement('div');
      line.className = 'term-row';
      line.innerHTML = html;
      out.append(line);
      out.scrollTop = out.scrollHeight;
    }

    function printBlock(rows: string[], cls = ''): void {
      for (const r of rows) print(r, cls);
    }

    function shortCwd(): string {
      return cwd === HOME ? '~' : cwd.startsWith(HOME + '/') ? '~' + cwd.slice(HOME.length) : cwd;
    }

    function syncPrompt(): void {
      promptEl.innerHTML = `<span class="term-user">guest@flashos</span>:<span class="term-cwd">${shortCwd()}</span>$`;
    }

    // ---------- path resolution ----------
    function resolve(p: string): string {
      if (p === '~') return HOME;
      if (p.startsWith('~/')) return joinPath(HOME, p.slice(2));
      if (p.startsWith('/')) return normalizePath(p);
      if (p === '-') {
        throw new Error('cd: directory jump "-" is not supported here');
      }
      return joinPath(cwd, p);
    }

    async function statOrThrow(p: string): Promise<VfsNode> {
      const node = await ctx.vfs.stat(resolve(p));
      if (!node) throw new Error(`fsh: no such file or directory: ${p}`);
      return node;
    }

    // ---------- commands ----------
    interface Command {
      desc: string;
      usage?: string;
      run(args: string[], raw: string): Promise<void> | void;
    }

    const commands: Record<string, Command> = {
      help: {
        desc: 'list available commands',
        run() {
          const names = Object.keys(commands).sort();
          const width = Math.max(...names.map((n) => n.length)) + 2;
          print('fsh — available commands', 'term-accent');
          print('');
          for (const name of names) {
            printHTML(
              `<span class="term-accent">${name.padEnd(width, ' ').replace(/ /g, '&nbsp;')}</span><span class="term-dim">${commands[name]!.desc}</span>`
            );
          }
          print('');
          print('Tab completes, ↑/↓ walks history.', 'term-dim');
        }
      },
      ls: {
        desc: 'list directory contents',
        usage: 'ls [-la] [path]',
        async run(args) {
          const flags = args.filter((a) => a.startsWith('-'));
          const rest = args.filter((a) => !a.startsWith('-'));
          const target = resolve(rest[0] ?? cwd);
          const nodes = await ctx.vfs.readdir(target);
          const showAll = flags.some((f) => f.includes('a'));
          const long = flags.some((f) => f.includes('l'));
          const list: VfsNode[] = showAll
            ? nodes
            : nodes.filter((n) => !basename(n.path).startsWith('.'));
          if (list.length === 0) {
            print('(empty)', 'term-dim');
            return;
          }
          if (!long) {
            for (const n of list) {
              printHTML(
                n.type === 'dir'
                  ? `<span class="term-dir">${basename(n.path)}/</span>`
                  : `<span>${basename(n.path)}</span>`
              );
            }
            return;
          }
          printHTML(
            `<span class="term-dim">${'type'.padEnd(6)}${'size'.padStart(9)}  ${'modified'.padEnd(18)}name</span>`
          );
          for (const n of list) {
            const size =
              n.type === 'dir' ? '—' : typeof n.content === 'string' ? `${n.content.length}B` : `${n.content.size}B`;
            const kind = n.type === 'dir' ? 'dir' : 'file';
            const nameHTML =
              n.type === 'dir'
                ? `<span class="term-dir">${basename(n.path)}/</span>`
                : `<span>${basename(n.path)}</span>`;
            printHTML(
              `<span class="term-dim">${kind.padEnd(6)}${size.padStart(9)}  ${fmtDate(n.modifiedAt).padEnd(18)}</span>${nameHTML}`
            );
          }
        }
      },
      cd: {
        desc: 'change directory',
        usage: 'cd [path]',
        async run(args) {
          const target = args[0] ? resolve(args[0]) : HOME;
          const node = await ctx.vfs.stat(target);
          if (!node) throw new Error(`cd: no such directory: ${args[0]}`);
          if (node.type !== 'dir') throw new Error(`cd: not a directory: ${args[0]}`);
          cwd = target;
          syncPrompt();
        }
      },
      pwd: {
        desc: 'print working directory',
        run() {
          print(cwd);
        }
      },
      cat: {
        desc: 'print a file',
        usage: 'cat <file>',
        async run(args) {
          if (!args[0]) throw new Error('cat: missing file operand');
          const node = await statOrThrow(args[0]);
          if (node.type === 'dir') throw new Error(`cat: ${args[0]} is a directory`);
          if (typeof node.content === 'string') {
            printBlock(node.content.split('\n'));
          } else {
            print(`(binary file, ${node.content.size} bytes)`, 'term-dim');
          }
        }
      },
      mkdir: {
        desc: 'create a directory',
        usage: 'mkdir <path>',
        async run(args) {
          if (!args[0]) throw new Error('mkdir: missing operand');
          await ctx.vfs.mkdir(resolve(args[0]));
        }
      },
      touch: {
        desc: 'create an empty file',
        usage: 'touch <path>',
        async run(args) {
          if (!args[0]) throw new Error('touch: missing operand');
          await ctx.vfs.writeFile(resolve(args[0]), '', 'text/plain');
        }
      },
      rm: {
        desc: 'remove a file or directory',
        usage: 'rm [-r] <path>',
        async run(args) {
          const recursive = args.some((a) => a.startsWith('-') && a.includes('r'));
          const rest = args.filter((a) => !a.startsWith('-'));
          if (!rest[0]) throw new Error('rm: missing operand');
          const node = await statOrThrow(rest[0]);
          if (node.type === 'dir' && !recursive) {
            throw new Error(`rm: ${rest[0]} is a directory (use rm -r)`);
          }
          await ctx.vfs.rm(node.path);
        }
      },
      mv: {
        desc: 'move or rename',
        usage: 'mv <src> <dst>',
        async run(args) {
          if (!args[0] || !args[1]) throw new Error('mv: need <src> and <dst>');
          const src = (await statOrThrow(args[0])).path;
          let dst = resolve(args[1]);
          const dstNode = await ctx.vfs.stat(dst);
          if (dstNode?.type === 'dir' && src !== dst) dst = joinPath(dst, basename(src));
          await ctx.vfs.mv(src, dst);
        }
      },
      echo: {
        desc: 'print text, or write to a file with > and >>',
        usage: 'echo "text" [> file]',
        async run(_args, raw) {
          const rest = raw.slice(raw.indexOf('echo') + 4).trim();
          const redirect = rest.match(/\s(>>?)\s*/);
          if (redirect && redirect.index !== undefined) {
            const text = rest.slice(0, redirect.index).trim();
            const op = redirect[1] ?? '';
            const file = rest.slice(redirect.index + redirect[0].length).trim();
            if (!file) throw new Error('echo: missing target file');
            const value = text.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
            const target = resolve(file);
            if (op === '>>') {
              const existing = await ctx.vfs.stat(target);
              const prev = existing && typeof existing.content === 'string' ? existing.content : '';
              await ctx.vfs.writeFile(target, prev ? prev + '\n' + value : value, 'text/plain');
            } else {
              await ctx.vfs.writeFile(target, value, 'text/plain');
            }
            return;
          }
          print(rest.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'));
        }
      },
      tree: {
        desc: 'show directory tree',
        usage: 'tree [path]',
        async run(args) {
          const root = resolve(args[0] ?? '.');
          const start = await ctx.vfs.stat(root);
          if (!start || start.type !== 'dir') throw new Error(`tree: not a directory: ${args[0] ?? '.'}`);
          print(shortOf(start.path), 'term-dir');
          const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
            if (depth > 6) {
              print(prefix + '…', 'term-dim');
              return;
            }
            const nodes = await ctx.vfs.readdir(dir);
            for (const [i, n] of nodes.entries()) {
              const last = i === nodes.length - 1;
              const branch = last ? '└── ' : '├── ';
              printHTML(
                `<span class="term-dim">${prefix}${branch}</span>` +
                  (n.type === 'dir'
                    ? `<span class="term-dir">${basename(n.path)}/</span>`
                    : `<span>${basename(n.path)}</span>`)
              );
              if (n.type === 'dir') await walk(n.path, prefix + (last ? '    ' : '│   '), depth + 1);
            }
          };
          function shortOf(p: string): string {
            return p === HOME ? '~' : p.startsWith(HOME + '/') ? '~' + p.slice(HOME.length) : p;
          }
          await walk(root, '', 0);
        }
      },
      open: {
        desc: 'launch an app or open a file',
        usage: 'open <app|file>',
        async run(args) {
          const target = args[0];
          if (!target) throw new Error('open: missing app or file');
          const appNames = ['files', 'notepad', 'terminal', 'viewer', 'paint', 'beatlab', 'snake', 'minesweeper', 'about'];
          const asApp = appNames.find((id) => id === target || id.startsWith(target));
          if (asApp && !target.includes('.')) {
            ctx.openApp(asApp);
            print(`launching ${asApp}…`, 'term-dim');
            return;
          }
          const node = await statOrThrow(target);
          if (node.type === 'dir') {
            ctx.openApp('files', node.path);
            return;
          }
          if (node.mime.startsWith('image/')) {
            ctx.openApp('viewer', node.path);
            return;
          }
          ctx.openApp('notepad', node.path);
        }
      },
      theme: {
        desc: 'switch theme',
        usage: 'theme [flash|light|synthwave]',
        run(args) {
          const all = ctx.theme.all();
          if (!args[0]) {
            print(`current theme: ${ctx.theme.get()}`, 'term-accent');
            print(`available: ${all.join(', ')}`, 'term-dim');
            return;
          }
          if (!all.includes(args[0] as never)) {
            throw new Error(`theme: unknown theme "${args[0]}" (available: ${all.join(', ')})`);
          }
          ctx.theme.set(args[0] as 'flash' | 'light' | 'synthwave');
          print(`theme set to ${args[0]}`, 'term-success');
        }
      },
      clear: {
        desc: 'clear the screen',
        run() {
          out.innerHTML = '';
        }
      },
      date: {
        desc: 'print current date and time',
        run() {
          print(new Date().toString());
        }
      },
      whoami: {
        desc: 'print current user',
        run() {
          print('guest');
        }
      },
      history: {
        desc: 'show command history',
        run() {
          if (history.length === 0) {
            print('(no history yet)', 'term-dim');
            return;
          }
          history.slice(-MAX_HISTORY).forEach((h, i) => {
            printHTML(`<span class="term-dim">${String(i + 1).padStart(3)}</span>  ${h}`);
          });
        }
      },
      about: {
        desc: 'about this system',
        run() {
          print('FlashOS 1.0 — a complete operating system that runs in your browser.', 'term-accent');
          print('Every line of code was written by GLM-5.3 Flash, an AI model.');
          print('No frameworks, no backend — just TypeScript, DOM and IndexedDB.', 'term-dim');
        }
      },
      neofetch: {
        desc: 'system info with style',
        run() {
          const uptime = fmtUptime(Date.now() - ctx.bootTime);
          const rows: [string, string][] = [
            ['OS', 'FlashOS 1.0'],
            ['Kernel', 'flash-kernel'],
            ['Shell', 'fsh'],
            ['Built by', 'GLM-5.3 Flash'],
            ['Build cost', '<$1'],
            ['Uptime', uptime],
            ['Theme', ctx.theme.get()],
            ['Resolution', `${window.innerWidth}×${window.innerHeight}`]
          ];
          print('');
          const artRows = [...BOOT_ART];
          const maxRows = Math.max(artRows.length, rows.length + 1);
          for (let i = 0; i < maxRows; i++) {
            const art = artRows[i] ?? ' '.repeat(15);
            let info = '';
            if (i === 0) {
              info = `<span class="term-accent">guest</span>@<span class="term-accent">flashos</span>`;
            } else if (i === 1) {
              info = `<span class="term-dim">${'—'.repeat(21)}</span>`;
            } else {
              const row = rows[i - 2];
              if (row) {
                info = `<span class="term-accent">${row[0]}:</span> ${row[1]}`;
              }
            }
            printHTML(
              `<span class="term-art">${art.replace(/ /g, '&nbsp;')}</span><span>${info}</span>`
            );
          }
          print('');
        }
      }
    };

    // ---------- execution ----------
    async function execute(raw: string): Promise<void> {
      const trimmed = raw.trim();
      if (!trimmed) return;
      if (history[history.length - 1] !== trimmed) {
        history.push(trimmed);
        persistHistory();
      }
      histIdx = history.length;

      printHTML(
        `<span class="term-user">guest@flashos</span>:<span class="term-cwd">${shortCwd()}</span>$ ${escapeHTML(trimmed)}`
      );

      const parts = trimmed.split(/\s+/);
      const cmd = parts[0]?.toLowerCase() ?? '';
      const args = parts.slice(1);
      const entry = commands[cmd];
      if (!entry) {
        print(`fsh: command not found: ${cmd} — try 'help'`, 'term-error');
        return;
      }
      try {
        await entry.run(args, trimmed);
      } catch (err) {
        print(err instanceof Error ? err.message : 'fsh: something went wrong', 'term-error');
      }
    }

    function escapeHTML(s: string): string {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ---------- tab completion ----------
    async function complete(): Promise<void> {
      const value = input.value;
      const tokens = value.split(/\s+/);
      const endsWithSpace = value.endsWith(' ');
      const completingIdx = endsWithSpace ? tokens.length : tokens.length - 1;
      const token = endsWithSpace ? '' : (tokens[tokens.length - 1] ?? '');

      if (completingIdx === 0) {
        const names = Object.keys(commands).filter((n) => n.startsWith(token));
        if (names.length === 1) {
          input.value = names[0]! + ' ';
        } else if (names.length > 1) {
          printHTML(`<span class="term-user">guest@flashos</span>:<span class="term-cwd">${shortCwd()}</span>$ ${escapeHTML(value)}`);
          print(names.join('  '), 'term-dim');
        }
        return;
      }

      // path completion
      const slash = token.lastIndexOf('/');
      let dirPart = slash === -1 ? '.' : token.slice(0, slash) || '/';
      const prefix = slash === -1 ? token : token.slice(slash + 1);
      let base = dirPart === '.' ? cwd : dirPart === '~' ? HOME : dirPart;
      if (!base.startsWith('/')) base = joinPath(cwd, dirPart);
      try {
        const nodes = await ctx.vfs.readdir(base);
        const matches = nodes.filter((n) => basename(n.path).startsWith(prefix));
        if (matches.length === 1) {
          const m = matches[0]!;
          const done = (slash === -1 ? '' : token.slice(0, slash + 1)) + basename(m.path) + (m.type === 'dir' ? '/' : '');
          tokens[completingIdx] = done;
          input.value = tokens.join(' ') + (m.type === 'dir' && !input.value.endsWith(' ') ? '' : '');
        } else if (matches.length > 1) {
          printHTML(`<span class="term-user">guest@flashos</span>:<span class="term-cwd">${shortCwd()}</span>$ ${escapeHTML(value)}`);
          print(
            matches.map((m) => basename(m.path) + (m.type === 'dir' ? '/' : '')).join('  '),
            'term-dim'
          );
        }
      } catch {
        // no completion possible
      }
    }

    // ---------- input events ----------
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        void complete();
        return;
      }
      if (e.key === 'Enter') {
        const value = input.value;
        input.value = '';
        histIdx = history.length;
        void execute(value).then(() => {
          out.scrollTop = out.scrollHeight;
        });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (histIdx === history.length) draft = input.value;
        if (histIdx > 0) {
          histIdx -= 1;
          input.value = history[histIdx] ?? '';
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (histIdx < history.length) {
          histIdx += 1;
          input.value = histIdx === history.length ? draft : (history[histIdx] ?? '');
        }
        return;
      }
      if (e.key === 'l' && e.ctrlKey) {
        e.preventDefault();
        out.innerHTML = '';
      }
    });

    root.addEventListener('click', () => {
      if (getSelection()?.isCollapsed !== false) input.focus();
    });

    // ---------- boot banner ----------
    print('FlashOS 1.0 — fsh shell', 'term-accent');
    print(`Type 'help' for commands, 'neofetch' for system info.`, 'term-dim');
    print('');
    syncPrompt();

    // initial command from args (e.g. run a command on open)
    if (typeof args === 'string' && args.trim()) {
      void execute(args.trim());
    }

    requestAnimationFrame(() => input.focus());
  }
};
