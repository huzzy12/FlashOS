/** BeatLab — 16-step drum machine + synth sequencer, all sound synthesized with Web Audio. */

import type { FlashApp } from '../kernel/apps';
import { basename, extname } from '../kernel/vfs';
import { showDialog } from '../ui/dialog';
import { showToast } from '../ui/toast';

const STEPS = 16;
const MUSIC_DIR = '/home/guest/music';

type DrumId = 'kick' | 'snare' | 'hat' | 'clap';
type SynthId = 'bass' | 'lead';

interface RowDef {
  id: DrumId | SynthId;
  name: string;
}

const ROWS: RowDef[] = [
  { id: 'kick', name: 'Kick' },
  { id: 'snare', name: 'Snare' },
  { id: 'hat', name: 'Hi-hat' },
  { id: 'clap', name: 'Clap' },
  { id: 'bass', name: 'Bass' },
  { id: 'lead', name: 'Lead' }
];

const SCALES: Record<SynthId, string[]> = {
  bass: ['A1', 'C2', 'D2', 'E2', 'G2', 'A2'],
  lead: ['A3', 'C4', 'D4', 'E4', 'G4', 'A4']
};

const NOTE_FREQ: Record<string, number> = {
  A1: 55, C2: 65.41, D2: 73.42, E2: 82.41, G2: 98, A2: 110,
  A3: 220, C4: 261.63, D4: 293.66, E4: 329.63, G4: 392, A4: 440
};

interface Preset {
  name: string;
  bpm: number;
  swing: boolean;
  grid: Record<DrumId | SynthId, boolean[]>;
}

const emptyRow = (): boolean[] => Array.from({ length: STEPS }, () => false);
const rows = (spec: Partial<Record<DrumId | SynthId, number[]>>): Record<DrumId | SynthId, boolean[]> => {
  const out = {} as Record<DrumId | SynthId, boolean[]>;
  for (const { id } of ROWS) {
    out[id] = emptyRow();
    for (const i of spec[id] ?? []) out[id]![i] = true;
  }
  return out;
};

const PRESETS: Preset[] = [
  {
    name: 'Boom Bap',
    bpm: 92,
    swing: false,
    grid: rows({
      kick: [0, 3, 6, 10],
      snare: [4, 12],
      hat: [0, 2, 4, 6, 8, 10, 12, 14],
      clap: [],
      bass: [0, 3, 6, 8, 11],
      lead: [2, 7, 14]
    })
  },
  {
    name: 'Techno',
    bpm: 132,
    swing: false,
    grid: rows({
      kick: [0, 4, 8, 12],
      snare: [],
      hat: [2, 6, 10, 14],
      clap: [4, 12],
      bass: [0, 2, 4, 6, 8, 10, 12, 14],
      lead: [3, 7, 11, 15]
    })
  },
  {
    name: 'Lo-fi',
    bpm: 74,
    swing: true,
    grid: rows({
      kick: [0, 7, 10],
      snare: [4, 12],
      hat: [2, 6, 10, 14],
      clap: [],
      bass: [0, 5, 10],
      lead: [4, 12, 15]
    })
  }
];

interface Pattern {
  version: 1;
  bpm: number;
  swing: boolean;
  grid: Record<DrumId | SynthId, boolean[]>;
  notes: Record<SynthId, string>;
}

export const beatlabApp: FlashApp = {
  id: 'beatlab',
  name: 'BeatLab',
  iconSvg:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h.01M11 9h.01M15 9h.01M7 13h.01M11 13h.01M15 13h.01M7 17h10"/></svg>',
  defaultSize: { w: 820, h: 540 },
  mount(container: HTMLElement, ctx) {
    const grid: Record<DrumId | SynthId, boolean[]> = rows({});
    const mutes: Record<DrumId | SynthId, boolean> = { kick: false, snare: false, hat: false, clap: false, bass: false, lead: false };
    const notes: Record<SynthId, string> = { bass: 'A1', lead: 'A4' };
    let bpm = 110;
    let swing = false;
    let playing = false;
    let currentStep = 0;
    let nextNoteTime = 0;
    let audio: AudioContext | null = null;

    container.innerHTML = `
      <div class="beatlab">
        <div class="beatlab-transport">
          <button class="bl-play" data-play title="Play/stop (Space)"><span class="bl-play-icon">▶</span></button>
          <label class="bl-bpm"><span>BPM</span><input type="range" min="60" max="180" value="110" data-bpm /><span data-bpm-val>110</span></label>
          <button class="tool-btn" data-swing>Swing</button>
          <div class="paint-spring"></div>
          <span class="bl-presets-label">Presets</span>
          <div class="bl-preset-btns"></div>
          <div class="paint-spring"></div>
          <button class="tool-btn" data-save>Save</button>
          <button class="tool-btn" data-load>Load</button>
        </div>
        <div class="beatlab-grid"></div>
        <div class="beatlab-status">Space to play — patterns save to ${MUSIC_DIR}</div>
      </div>`;

    const gridEl = container.querySelector<HTMLElement>('.beatlab-grid')!;
    const playBtn = container.querySelector<HTMLButtonElement>('[data-play]')!;
    const playIcon = container.querySelector<HTMLElement>('.bl-play-icon')!;
    const bpmInput = container.querySelector<HTMLInputElement>('[data-bpm]')!;
    const bpmVal = container.querySelector<HTMLElement>('[data-bpm-val]')!;
    const swingBtn = container.querySelector<HTMLButtonElement>('[data-swing]')!;
    const presetEl = container.querySelector<HTMLElement>('.bl-preset-btns')!;

    // ---------- build grid UI ----------
    const stepButtons = new Map<string, HTMLButtonElement>();
    const scaleSelects: Partial<Record<SynthId, HTMLSelectElement>> = {};

    for (const [rowIdx, row] of ROWS.entries()) {
      const line = document.createElement('div');
      line.className = 'bl-row';

      const label = document.createElement('div');
      label.className = 'bl-row-label';
      const name = document.createElement('span');
      name.textContent = row.name;
      const mute = document.createElement('button');
      mute.className = 'bl-mute';
      mute.title = 'Mute';
      mute.textContent = 'M';
      mute.addEventListener('click', () => {
        mutes[row.id] = !mutes[row.id];
        mute.classList.toggle('active', mutes[row.id]);
      });
      label.append(name, mute);

      if (row.id in SCALES) {
        const sel = document.createElement('select');
        sel.className = 'bl-scale';
        sel.title = 'Note';
        for (const note of SCALES[row.id as SynthId]) {
          const opt = document.createElement('option');
          opt.value = note;
          opt.textContent = note;
          sel.append(opt);
        }
        sel.value = notes[row.id as SynthId];
        scaleSelects[row.id as SynthId] = sel;
        sel.addEventListener('change', () => {
          notes[row.id as SynthId] = sel.value;
        });
        label.append(sel);
      }

      const cells = document.createElement('div');
      cells.className = 'bl-cells';
      for (let i = 0; i < STEPS; i++) {
        const cell = document.createElement('button');
        cell.className = 'bl-step' + (i % 4 === 0 ? ' beat' : '');
        cell.dataset.step = String(i);
        cell.addEventListener('click', () => {
          grid[row.id]![i] = !grid[row.id]![i];
          cell.classList.toggle('on', grid[row.id]![i]);
        });
        stepButtons.set(`${row.id}:${i}`, cell);
        cells.append(cell);
      }

      line.append(label, cells);
      if (rowIdx % 2 === 1) line.classList.add('alt');
      gridEl.append(line);
    }

    const refreshGrid = (): void => {
      for (const { id } of ROWS) {
        for (let i = 0; i < STEPS; i++) {
          stepButtons.get(`${id}:${i}`)?.classList.toggle('on', grid[id]![i]);
        }
      }
    };

    // ---------- audio engine ----------
    const ensureAudio = (): AudioContext => {
      if (!audio) audio = new AudioContext();
      if (audio.state === 'suspended') void audio.resume();
      return audio;
    };

    let noiseBuffer: AudioBuffer | null = null;
    const getNoise = (ac: AudioContext): AudioBuffer => {
      if (!noiseBuffer) {
        noiseBuffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      return noiseBuffer;
    };

    function playNoise(ac: AudioContext, time: number, dur: number, filterType: BiquadFilterType, freq: number, gain: number, taps = 1): void {
      const src = ac.createBufferSource();
      src.buffer = getNoise(ac);
      const f = ac.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      const env = ac.createGain();
      env.gain.setValueAtTime(gain, time);
      if (taps > 1) {
        for (let t = 0; t < taps; t++) {
          const tt = time + t * 0.012;
          env.gain.setValueAtTime(gain, tt);
          env.gain.exponentialRampToValueAtTime(0.001, tt + 0.02);
        }
      }
      env.gain.exponentialRampToValueAtTime(0.001, time + dur);
      src.connect(f).connect(env).connect(ac.destination);
      src.start(time);
      src.stop(time + dur + 0.05);
    }

    function playTone(ac: AudioContext, time: number, freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, lowpass?: number): void {
      const osc = ac.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, time);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, time + dur * 0.8);
      const env = ac.createGain();
      env.gain.setValueAtTime(gain, time);
      env.gain.exponentialRampToValueAtTime(0.001, time + dur);
      let node: AudioNode = env;
      if (lowpass) {
        const f = ac.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = lowpass;
        env.connect(f);
        node = f;
      }
      osc.connect(env);
      node.connect(ac.destination);
      osc.start(time);
      osc.stop(time + dur + 0.05);
    }

    const trigger = (id: DrumId | SynthId, time: number): void => {
      const ac = ensureAudio();
      switch (id) {
        case 'kick':
          playTone(ac, time, 150, 0.28, 'sine', 0.9, 42);
          break;
        case 'snare':
          playNoise(ac, time, 0.18, 'bandpass', 1800, 0.5);
          playTone(ac, time, 190, 0.1, 'triangle', 0.3);
          break;
        case 'hat':
          playNoise(ac, time, 0.05, 'highpass', 7500, 0.32);
          break;
        case 'clap':
          playNoise(ac, time, 0.22, 'bandpass', 1150, 0.45, 3);
          break;
        case 'bass':
          playTone(ac, time, NOTE_FREQ[notes.bass] ?? 55, 0.3, 'sawtooth', 0.34, undefined, 420);
          break;
        case 'lead':
          playTone(ac, time, NOTE_FREQ[notes.lead] ?? 440, 0.26, 'square', 0.13, undefined, 2400);
          break;
      }
    };

    // ---------- scheduler (lookahead) ----------
    const scheduleAhead = 0.12;
    const timerMs = 25;
    interface QueuedStep { step: number; time: number; }
    const drawQueue: QueuedStep[] = [];
    let timer = 0;

    const secondsPerStep = (): number => 60 / bpm / 4;

    const scheduleStep = (step: number, time: number): void => {
      for (const { id } of ROWS) {
        if (mutes[id]) continue;
        if (grid[id]![step]) trigger(id, time);
      }
    };

    const nextTime = (time: number, step: number): number => {
      const sp = secondsPerStep();
      return swing && step % 2 === 1 ? time + sp * 1.22 : time + sp;
    };

    const tick = (): void => {
      const ac = ensureAudio();
      while (nextNoteTime < ac.currentTime + scheduleAhead) {
        scheduleStep(currentStep, nextNoteTime);
        drawQueue.push({ step: currentStep, time: nextNoteTime });
        nextNoteTime = nextTime(nextNoteTime, currentStep);
        currentStep = (currentStep + 1) % STEPS;
      }
    };

    const setPlayhead = (step: number): void => {
      for (let i = 0; i < STEPS; i++) {
        gridEl.querySelectorAll<HTMLButtonElement>(`.bl-step[data-step="${i}"]`).forEach((el) => {
          el.classList.toggle('playhead', i === step);
        });
      }
    };

    const drawLoop = (): void => {
      if (!playing) return;
      const ac = ensureAudio();
      while (drawQueue.length > 0 && drawQueue[0]!.time <= ac.currentTime) {
        const q = drawQueue.shift()!;
        setPlayhead(q.step);
      }
      requestAnimationFrame(drawLoop);
    };

    function start(): void {
      const ac = ensureAudio();
      void ac.resume();
      playing = true;
      currentStep = 0;
      nextNoteTime = ac.currentTime + 0.06;
      timer = window.setInterval(tick, timerMs);
      requestAnimationFrame(drawLoop);
      playIcon.textContent = '■';
      playBtn.classList.add('playing');
    }

    function stop(): void {
      playing = false;
      window.clearInterval(timer);
      drawQueue.length = 0;
      setPlayhead(-1);
      playIcon.textContent = '▶';
      playBtn.classList.remove('playing');
    }

    playBtn.addEventListener('click', () => (playing ? stop() : start()));

    bpmInput.addEventListener('input', () => {
      bpm = Number(bpmInput.value);
      bpmVal.textContent = String(bpm);
    });

    swingBtn.addEventListener('click', () => {
      swing = !swing;
      swingBtn.classList.toggle('active', swing);
    });

    container.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        if (playing) stop();
        else start();
      }
    });

    // ---------- presets ----------
    for (const preset of PRESETS) {
      const btn = document.createElement('button');
      btn.className = 'tool-btn';
      btn.textContent = preset.name;
      btn.addEventListener('click', () => {
        for (const { id } of ROWS) grid[id] = [...preset.grid[id]!];
        bpm = preset.bpm;
        bpmInput.value = String(bpm);
        bpmVal.textContent = String(bpm);
        swing = preset.swing;
        swingBtn.classList.toggle('active', swing);
        refreshGrid();
      });
      presetEl.append(btn);
    }

    // ---------- save/load ----------
    const serialize = (): Pattern => ({
      version: 1,
      bpm,
      swing,
      grid: JSON.parse(JSON.stringify(grid)) as Record<DrumId | SynthId, boolean[]>,
      notes: { ...notes }
    });

    container.querySelector('[data-save]')!.addEventListener('click', () => {
      void (async () => {
        const name = await showDialog(container, {
          title: 'Save pattern',
          message: `Saved as JSON in ${MUSIC_DIR}`,
          input: { value: 'my-beat', placeholder: 'pattern name' },
          confirmText: 'Save'
        });
        if (name === null || !name.trim()) return;
        try {
          await ctx.vfs.writeFile(
            `${MUSIC_DIR}/${name.trim()}.beat.json`,
            JSON.stringify(serialize(), null, 2),
            'application/json'
          );
          showToast(`Saved ${name.trim()}.beat.json`, 'success');
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Save failed', 'danger');
        }
      })();
    });

    container.querySelector('[data-load]')!.addEventListener('click', () => {
      void (async () => {
        try {
          const files = (await ctx.vfs.readdir(MUSIC_DIR)).filter(
            (n) => n.type === 'file' && extname(n.path) === 'json'
          );
          const picked = await showDialog(container, {
            title: 'Load pattern',
            items: files.map((f) => ({ label: basename(f.path), value: f.path })),
            confirmText: 'Load'
          });
          if (picked === null) return;
          const raw = await ctx.vfs.readText(picked);
          const data = JSON.parse(raw) as Partial<Pattern>;
          if (!data.grid) throw new Error('not a BeatLab pattern');
          bpm = data.bpm ?? 110;
          bpmInput.value = String(bpm);
          bpmVal.textContent = String(bpm);
          swing = data.swing ?? false;
          swingBtn.classList.toggle('active', swing);
          for (const { id } of ROWS) {
            const row = data.grid[id];
            grid[id] = row && row.length === STEPS ? row.map(Boolean) : emptyRow();
          }
          if (data.notes) {
            for (const sid of ['bass', 'lead'] as SynthId[]) {
              const n = data.notes[sid];
              if (n && SCALES[sid].includes(n)) {
                notes[sid] = n;
                const sel = scaleSelects[sid];
                if (sel) sel.value = n;
              }
            }
          }
          refreshGrid();
          showToast('Pattern loaded', 'success');
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Load failed', 'danger');
        }
      })();
    });

    void ctx;
  }
};
