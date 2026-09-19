/**
 * Generates the true-audio fixtures for `test/e2e/qa-exhaustive.spec.ts`.
 *
 * Every speech fixture is synthesized by the host OS speech engine (Windows
 * SAPI, macOS `say`, Linux `espeak-ng`), then re-written as a canonical
 * 16-bit PCM mono 44.1 kHz WAV with a 44-byte header. Chrome's
 * `--use-file-for-fake-audio-capture` rejects anything else and streams
 * silence instead, so the header is rebuilt from scratch rather than trusting
 * the synthesizer's output.
 *
 * Usage: pnpm gen:audio
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const SAMPLE_RATE = 44_100;
const CHANNELS = 1;
const BITS = 16;

export const AUDIO_DIR = resolve(import.meta.dirname, "..", "test", "fixtures", "audio");

export interface AudioFixture {
  file: string;
  /** Text spoken by the synthesizer. `null` means pure silence. */
  text: string | null;
  /** Length of a silence fixture in seconds (ignored when `text` is set). */
  silenceSeconds?: number;
}

export const FIXTURES: AudioFixture[] = [
  { file: "golden-path.wav", text: "Book the 9:40 flight." },
  { file: "ambiguity-trap.wav", text: "Click the Download button." },
  { file: "silence.wav", text: null, silenceSeconds: 5 },
  { file: "sequence.wav", text: "Fill in John Doe, then click submit, and then click confirm." },
  { file: "clarify-second.wav", text: "The second one." },
  { file: "click-search.wav", text: "Click search flights." },
  { file: "fill-from.wav", text: "Type Toronto into From." },
];

/** Lead-in so the recognizer sees onset, and a tail so it sees end of speech. */
const LEAD_IN_SECONDS = 0.4;
const TAIL_SECONDS = 0.8;

// ---------------------------------------------------------------------------
// WAV helpers
// ---------------------------------------------------------------------------

export interface Pcm {
  sampleRate: number;
  channels: number;
  samples: Int16Array; // interleaved
}

export function parseWav(buf: Buffer): Pcm {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let offset = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let data: Buffer | null = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      // Some synthesizers stream and leave the size as 0 / 0xFFFFFFFF.
      const end = size === 0 || size === 0xffffffff || body + size > buf.length ? buf.length : body + size;
      data = buf.subarray(body, end);
      break;
    }
    offset = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error("WAV is missing fmt or data chunk");
  if (fmt.format !== 1 || fmt.bits !== 16) {
    throw new Error(`expected 16-bit PCM, got format ${fmt.format} / ${fmt.bits} bit`);
  }
  const usable = data.length - (data.length % 2);
  const samples = new Int16Array(usable / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2);
  return { sampleRate: fmt.rate, channels: fmt.channels, samples };
}

function toMono(pcm: Pcm): Int16Array {
  if (pcm.channels === 1) return pcm.samples;
  const frames = Math.floor(pcm.samples.length / pcm.channels);
  const out = new Int16Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < pcm.channels; c++) sum += pcm.samples[f * pcm.channels + c];
    out[f] = Math.round(sum / pcm.channels);
  }
  return out;
}

function resample(samples: Int16Array, from: number, to: number): Int16Array {
  if (from === to) return samples;
  const outLen = Math.round((samples.length * to) / from);
  const out = new Int16Array(outLen);
  const ratio = from / to;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = pos - i0;
    out[i] = Math.round(samples[i0] * (1 - frac) + samples[i1] * frac);
  }
  return out;
}

/** Peak-normalize to ~-3 dBFS so speech recognition gets a healthy level. */
function normalize(samples: Int16Array): Int16Array {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  if (peak === 0) return samples;
  const gain = (0.7 * 32767) / peak;
  return samples.map((s) => Math.max(-32768, Math.min(32767, Math.round(s * gain))));
}

export function encodeWav(samples: Int16Array): Buffer {
  const dataBytes = samples.length * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE((SAMPLE_RATE * CHANNELS * BITS) / 8, 28); // byte rate
  header.writeUInt16LE((CHANNELS * BITS) / 8, 32); // block align
  header.writeUInt16LE(BITS, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);
  const body = Buffer.alloc(dataBytes);
  for (let i = 0; i < samples.length; i++) body.writeInt16LE(samples[i], i * 2);
  return Buffer.concat([header, body]);
}

function silence(seconds: number): Int16Array {
  return new Int16Array(Math.round(seconds * SAMPLE_RATE));
}

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

function synthesize(text: string, outPath: string): void {
  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Speech",
      "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
      "try { $s.SelectVoice('Microsoft David Desktop') } catch {}",
      "$s.Rate = -1",
      `$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(${SAMPLE_RATE}, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)`,
      `$s.SetOutputToWaveFile($env:ECHO_TTS_OUT, $fmt)`,
      "$s.Speak($env:ECHO_TTS_TEXT)",
      "$s.Dispose()",
    ].join("; ");
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, ECHO_TTS_OUT: outPath, ECHO_TTS_TEXT: text },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } else if (process.platform === "darwin") {
    execFileSync("say", ["-o", outPath, `--data-format=LEI16@${SAMPLE_RATE}`, text]);
  } else {
    execFileSync("espeak-ng", ["-w", outPath, text]);
  }
}

export function buildSpeechSamples(text: string): Int16Array {
  const dir = mkdtempSync(join(tmpdir(), "echo-tts-"));
  try {
    const raw = join(dir, "raw.wav");
    synthesize(text, raw);
    const pcm = parseWav(readFileSync(raw));
    const mono = toMono(pcm);
    const rate = resample(mono, pcm.sampleRate, SAMPLE_RATE);
    const speech = normalize(rate);
    const lead = silence(LEAD_IN_SECONDS);
    const tail = silence(TAIL_SECONDS);
    const out = new Int16Array(lead.length + speech.length + tail.length);
    out.set(lead, 0);
    out.set(speech, lead.length);
    out.set(tail, lead.length + speech.length);
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function generateAll(): void {
  mkdirSync(AUDIO_DIR, { recursive: true });
  for (const fixture of FIXTURES) {
    const samples =
      fixture.text === null
        ? silence(fixture.silenceSeconds ?? 5)
        : buildSpeechSamples(fixture.text);
    const wav = encodeWav(samples);
    writeFileSync(join(AUDIO_DIR, fixture.file), wav);
    const seconds = (samples.length / SAMPLE_RATE).toFixed(2);
    console.log(
      `[gen-audio] ${fixture.file.padEnd(20)} ${seconds}s  ${wav.length} bytes  ${
        fixture.text === null ? "(silence)" : JSON.stringify(fixture.text)
      }`
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  generateAll();
}
