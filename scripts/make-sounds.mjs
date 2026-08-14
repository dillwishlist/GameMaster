/**
 * Synthesises the sound cues in `content/assets/*.wav` from scratch.
 *
 * Sound rides the HDMI cable, so anything written here comes out of the
 * television. There are no downloaded audio files in this repo and there are
 * not going to be any: the game must work with the internet down, so every
 * asset is either drawn (see make-placeholders.mjs) or, here, generated.
 *
 * Pure Node, no dependencies: a 44-byte WAV header, 16-bit PCM samples, sine
 * tones with an envelope. Re-runnable — it overwrites the same filenames.
 *
 *   node scripts/make-sounds.mjs
 *
 * Every cue is deliberately short, soft-edged and mid-volume. This is a party
 * with a four-year-old and a toddler in the room: the buzzer is a comedic
 * "womp womp" on low sine tones with a slow attack, NOT a harsh square-wave
 * game-show buzzer. Nothing in here should make a small child cry, and nothing
 * should be so loud that the host has to lunge for the TV remote. If you add a
 * cue, keep it under two seconds and keep it gentle.
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const SAMPLE_RATE = 44100;
const assetDir = path.resolve('content/assets');
mkdirSync(assetDir, { recursive: true });

/* -------------------------------------------------------------------------- */
/* WAV encoding: 44-byte canonical header, then mono 16-bit little-endian PCM. */
/* -------------------------------------------------------------------------- */

function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const bytes = samples.length * 2;
  const buf = Buffer.alloc(44 + bytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + bytes, 4); // RIFF chunk size = everything after byte 8
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // fmt chunk size: 16 for PCM
  buf.writeUInt16LE(1, 20); // format 1 = uncompressed PCM
  buf.writeUInt16LE(1, 22); // channels: mono is plenty for a cue
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate = rate * channels * bytes/sample
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(bytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buf;
}

/* -------------------------------------------------------------------------- */
/* Synthesis                                                                  */
/* -------------------------------------------------------------------------- */

/** Equal temperament, A4 = 440. Named notes read better than magic numbers. */
const NOTE_NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function hz(note) {
  const [, letter, sharp, octave] = /^([A-G])(#?)(\d)$/.exec(note);
  const semitones = NOTE_NAMES[letter] + (sharp ? 1 : 0) + (Number(octave) - 4) * 12 - 9;
  return 440 * Math.pow(2, semitones / 12);
}

function canvas(seconds) {
  return new Float64Array(Math.round(seconds * SAMPLE_RATE));
}

/**
 * One sine note with an envelope.
 *
 * The envelope is the whole point: starting or stopping a sine wave mid-cycle
 * puts a step in the waveform, and a step is a click — audible, and much more
 * startling through a big TV speaker than the note itself. A few milliseconds
 * of fade at each edge removes it. `decay` shapes the body so notes ring off
 * like a chime instead of sitting there like a test tone.
 *
 * `bend` slides the pitch over the note's length (bend: -2 = down two
 * semitones), which is what makes the buzzer sound like a cartoon rather than
 * an alarm.
 */
function note({ freq, dur, amp = 1, attack = 0.008, release = 0.05, decay = 3, bend = 0, vibrato = 0 }) {
  const n = Math.round(dur * SAMPLE_RATE);
  const out = new Float64Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const progress = i / n;
    const f = freq * Math.pow(2, (bend * progress) / 12) * (1 + vibrato * Math.sin(2 * Math.PI * 5.5 * t));
    phase += (2 * Math.PI * f) / SAMPLE_RATE;

    const fadeIn = Math.min(1, t / attack);
    const fadeOut = Math.min(1, (dur - t) / release);
    const body = Math.exp(-decay * t);
    out[i] = Math.sin(phase) * amp * body * fadeIn * fadeOut;
  }
  return out;
}

/** Mix `samples` into `into` starting at `atSeconds`. */
function add(into, samples, atSeconds) {
  const offset = Math.round(atSeconds * SAMPLE_RATE);
  for (let i = 0; i < samples.length && offset + i < into.length; i++) into[offset + i] += samples[i];
  return into;
}

/**
 * Peak-normalise to `peak`. Each cue gets its own target so the soft ones stay
 * soft relative to the bright ones — normalising everything to the same level
 * would flatten exactly the contrast the cues exist to provide. Nothing goes
 * near 1.0: headroom, and a living room is not a stadium.
 */
function normalise(samples, peak) {
  let max = 0;
  for (const s of samples) max = Math.max(max, Math.abs(s));
  if (max === 0) return samples;
  const gain = peak / max;
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return samples;
}

/* -------------------------------------------------------------------------- */
/* The cues                                                                   */
/* -------------------------------------------------------------------------- */

const CUES = {
  /** Bright two-note rising chime: C6 up a fifth to G6. "Yes, that one." */
  'cue-correct.wav': () => {
    const buf = canvas(0.85);
    add(buf, note({ freq: hz('C6'), dur: 0.35, decay: 4.5 }), 0);
    add(buf, note({ freq: hz('G6'), dur: 0.6, decay: 3.2 }), 0.15);
    // A quiet octave above each note gives it sparkle without raising the level.
    add(buf, note({ freq: hz('C7'), dur: 0.3, amp: 0.22, decay: 6 }), 0);
    add(buf, note({ freq: hz('G7'), dur: 0.5, amp: 0.22, decay: 5 }), 0.15);
    return normalise(buf, 0.72);
  },

  /**
   * The comedic "wrong": two low sine tones sagging downwards, the second
   * bending a whole tone flat — a cartoon trombone, not a buzzer. Slow attack
   * (60ms) so it swells in rather than barking, low frequencies so it reads as
   * funny rather than urgent, and normalised well below the chime. A
   * four-year-old should laugh at this. Never replace it with a square wave.
   */
  'cue-wrong.wav': () => {
    const buf = canvas(1.1);
    add(buf, note({ freq: hz('G3'), dur: 0.3, attack: 0.06, decay: 2.2, bend: -1, vibrato: 0.004 }), 0);
    add(buf, note({ freq: hz('F3'), dur: 0.7, attack: 0.06, decay: 1.8, bend: -2, vibrato: 0.006 }), 0.28);
    return normalise(buf, 0.45);
  },

  /**
   * Final scores. A rising C-major arpeggio into a held chord — about a second
   * and a half, long enough to feel like an ending, short enough that the host
   * is not standing there waiting for it to finish.
   */
  'cue-fanfare.wav': () => {
    const buf = canvas(1.9);
    const arp = ['C5', 'E5', 'G5', 'C6'];
    arp.forEach((n, i) => add(buf, note({ freq: hz(n), dur: 0.35, decay: 5 }), i * 0.11));
    for (const n of ['C6', 'E6', 'G6']) {
      add(buf, note({ freq: hz(n), dur: 1.2, amp: 0.7, attack: 0.012, decay: 2.4 }), 0.46);
    }
    add(buf, note({ freq: hz('C5'), dur: 1.2, amp: 0.5, decay: 2.6 }), 0.46); // root underneath
    return normalise(buf, 0.75);
  },

  /**
   * "Time's up" — two soft descending bell notes with a long ring-off. It has
   * to be noticed across a noisy room without being a klaxon, because the
   * timer is theatre: the host still decides when the round is over.
   */
  'cue-times-up.wav': () => {
    const buf = canvas(1.5);
    add(buf, note({ freq: hz('A5'), dur: 0.6, attack: 0.02, decay: 3.4 }), 0);
    add(buf, note({ freq: hz('E5'), dur: 0.9, attack: 0.02, decay: 2.6 }), 0.3);
    add(buf, note({ freq: hz('A4'), dur: 0.9, amp: 0.35, attack: 0.02, decay: 2.2 }), 0.3);
    return normalise(buf, 0.55);
  },
};

/* -------------------------------------------------------------------------- */
/* Write, then verify. An unplayable cue is worse than no cue: it fails in     */
/* front of the room. Parse every file back before claiming it worked.         */
/* -------------------------------------------------------------------------- */

function verify(file, expectedSamples) {
  const buf = readFileSync(file);
  const problems = [];
  const check = (label, actual, expected) => {
    if (actual !== expected) problems.push(`${label}: expected ${expected}, got ${actual}`);
  };

  check('RIFF tag', buf.toString('ascii', 0, 4), 'RIFF');
  check('WAVE tag', buf.toString('ascii', 8, 12), 'WAVE');
  check('fmt tag', buf.toString('ascii', 12, 16), 'fmt ');
  check('fmt chunk size', buf.readUInt32LE(16), 16);
  check('audio format (1 = PCM)', buf.readUInt16LE(20), 1);
  check('channels', buf.readUInt16LE(22), 1);
  check('sample rate', buf.readUInt32LE(24), SAMPLE_RATE);
  check('byte rate', buf.readUInt32LE(28), SAMPLE_RATE * 2);
  check('block align', buf.readUInt16LE(32), 2);
  check('bits per sample', buf.readUInt16LE(34), 16);
  check('data tag', buf.toString('ascii', 36, 40), 'data');
  check('data chunk size', buf.readUInt32LE(40), expectedSamples * 2);
  check('RIFF chunk size', buf.readUInt32LE(4), 36 + expectedSamples * 2);
  check('file size', buf.length, 44 + expectedSamples * 2);

  // Decode the samples back and sanity-check the audio itself: it must not be
  // silent, must not be clipped, and must start and end near zero — a non-zero
  // first or last sample is the click the envelope exists to prevent.
  let peak = 0;
  let clipped = 0;
  for (let i = 44; i + 1 < buf.length; i += 2) {
    const v = buf.readInt16LE(i) / 32767;
    peak = Math.max(peak, Math.abs(v));
    if (Math.abs(v) > 0.999) clipped++;
  }
  const first = Math.abs(buf.readInt16LE(44) / 32767);
  const last = Math.abs(buf.readInt16LE(buf.length - 2) / 32767);
  if (peak < 0.2) problems.push(`peak amplitude ${peak.toFixed(3)} — too quiet to hear across a room`);
  if (clipped > 0) problems.push(`${clipped} clipped samples`);
  if (first > 0.02) problems.push(`starts at ${first.toFixed(3)}, not silence — that is an audible click`);
  if (last > 0.02) problems.push(`ends at ${last.toFixed(3)}, not silence — that is an audible click`);

  return { problems, peak, seconds: expectedSamples / SAMPLE_RATE };
}

/**
 * Second opinion, if the machine has one. ffprobe/soxi are not dependencies —
 * this repo assumes nothing is installed — but when they are present they read
 * the file with something other than the code that wrote it, which is the
 * whole value of the check.
 */
function externalProbe(file) {
  const probe = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels,duration', '-of', 'default=nw=1', file],
    { encoding: 'utf8' },
  );
  if (!probe.error && probe.status === 0) return `ffprobe: ${probe.stdout.trim().replace(/\s+/g, ' ')}`;
  const soxi = spawnSync('soxi', [file], { encoding: 'utf8' });
  if (!soxi.error && soxi.status === 0) return `soxi: ${soxi.stdout.trim().replace(/\s+/g, ' ')}`;
  return null;
}

let failures = 0;
let externalUsed = null;
for (const [name, render] of Object.entries(CUES)) {
  const samples = render();
  const file = path.join(assetDir, name);
  writeFileSync(file, encodeWav(samples));

  const { problems, peak, seconds } = verify(file, samples.length);
  const external = externalProbe(file);
  if (external) externalUsed = external.split(':')[0];
  if (problems.length) {
    failures++;
    console.error(`✗ ${name}\n    ${problems.join('\n    ')}`);
  } else {
    console.log(
      `✓ ${name}  ${seconds.toFixed(2)}s  ${samples.length} samples  peak ${peak.toFixed(2)}` +
        (external ? `  [${external}]` : ''),
    );
  }
}

if (failures === 0) {
  console.log(
    `Wrote ${Object.keys(CUES).length} cues to content/assets — header, sample count, level and ` +
      `silent edges verified by reading each file back` +
      (externalUsed ? `, and cross-checked with ${externalUsed}.` : ' (no ffprobe/soxi on this machine).'),
  );
} else {
  console.error(`${failures} cue(s) failed verification.`);
}
process.exit(failures === 0 ? 0 : 1);
