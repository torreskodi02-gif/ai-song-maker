// AI Song Maker — mix test (node, real OfflineAudioContext).
// Renders full songs and asserts the v1.2.3 mix targets:
//   (a) full-mix peak < 0.9 (no clipping — v1.2.2 peaked at 1.7-2.0),
//   (b) the vocal is clearly audible AND the loudest element in the chorus
//       (vocal-only RMS > 0.05, and chorus vocal RMS > chorus band RMS),
//   (c) no silent 1-second sections.
// Also asserts the bar-by-bar (live scheduler) render matches a full render,
// so the live path cannot drop the vocal.
// Needs node-web-audio-api: `npm i -D node-web-audio-api` (it is installed
// under ~/workspace/ai-sim on the dev machine; the test falls back to it).
// Run: node scripts/test-mix.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

let OfflineAudioContext;
try {
  ({ OfflineAudioContext } = await import('node-web-audio-api'));
} catch {
  const req = createRequire('/home/hatch/workspace/ai-sim/package.json');
  ({ OfflineAudioContext } = req('node-web-audio-api'));
}

const src = readFileSync(new URL('../www/app.js', import.meta.url), 'utf8');
const pureStart = src.indexOf('/* __PURE_START__ */');
const pureEnd = src.indexOf('/* __PURE_END__ */');
const audioStart = src.indexOf('/* ================= AUDIO ENGINE');
const stateStart = src.indexOf('/* ================= APP STATE');
assert.ok(pureStart >= 0 && audioStart > pureEnd && stateStart > audioStart, 'pure+audio sections present');
const code = src.slice(pureStart, pureEnd) + '\n' + src.slice(audioStart, stateStart);
globalThis.OfflineAudioContext = OfflineAudioContext;
const fn = new Function(code + `\n;return { buildSong, scheduleSong, generateLyrics, smartPick, createVocalSpace };`);
const M = fn();
const SR = 44100;
const clone = (s, patch) => Object.assign({}, s, patch);

function makeSong(genre){
  const lyrics = M.generateLyrics('Sunday morning with my girl, no stress, just us', 'Happy', genre, 42);
  const pick = M.smartPick(genre, 'Happy', 'Sunday morning with my girl', 2);
  return M.buildSong({ title: 'Mix ' + genre, genre, mood: 'Happy', tempo: pick.tempo,
    key: pick.key, durationTarget: 45, energy: 2, vocalStyle: 'Smooth',
    instruments: pick.instruments, smartPick: pick, guitarStyle: pick.guitarStyle, seed: 7 },
    lyrics, { baseHz: 110, lowHz: 88, highHz: 176 });
}

async function render(song, { barByBar = false } = {}){
  const dur = song.bars * 4 * song.beat + 0.5;
  const off = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
  const master = off.createGain(); master.gain.value = 0.47; master.connect(off.destination);
  const vocalSend = M.createVocalSpace(off, master);
  if (barByBar){
    let lastMidi = null;
    for (let b = 0; b < song.bars; b++){
      const r = M.scheduleSong(off, master, song, { t0: 0.05, barStart: b, barEnd: b + 1, prevMidi: lastMidi, vocalSend });
      if (r.lastMidi != null) lastMidi = r.lastMidi;
    }
  } else {
    M.scheduleSong(off, master, song, { t0: 0.05, vocalSend });
  }
  const buf = await off.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = (L[i] + R[i]) / 2;
  return out;
}
function stats(x){
  let peak = 0, sum = 0, clip = 0;
  for (let i = 0; i < x.length; i++){ const a = Math.abs(x[i]); if (a > peak) peak = a; sum += x[i]*x[i]; if (a >= 0.999) clip++; }
  return { peak, rms: Math.sqrt(sum / x.length), clipFrac: clip / x.length };
}
function windowRms(x, t0s, lenS){
  const a = Math.floor(t0s * SR), b = Math.min(x.length, a + Math.floor(lenS * SR));
  let sum = 0; for (let i = a; i < b; i++) sum += x[i]*x[i];
  return Math.sqrt(sum / Math.max(1, b - a));
}

for (const genre of ['Pop', 'Rock', 'Hip-hop']){
  const song = makeSong(genre);
  const full = await render(song);
  const vocal = await render(clone(song, { instruments: ['None'] }));
  const band = await render(clone(song, { instrumental: true }));
  const f = stats(full), v = stats(vocal), b = stats(band);
  // (a) full-mix peak < 0.9 — no clipping.
  assert.ok(f.peak < 0.9, `${genre}: full-mix peak < 0.9, got ${f.peak.toFixed(3)}`);
  assert.ok(f.clipFrac < 0.001, `${genre}: clip fraction < 0.1%, got ${(f.clipFrac*100).toFixed(2)}%`);
  // (b) vocal clearly audible, and the loudest element in the chorus.
  assert.ok(v.rms > 0.05, `${genre}: vocal-only RMS clearly audible (>0.05), got ${v.rms.toFixed(4)}`);
  assert.ok(v.peak < 0.95, `${genre}: vocal-only peak < 0.95 (no self-clip), got ${v.peak.toFixed(3)}`);
  const chorusBeat = song.lineEvents.find(le => /chorus/i.test(le.section))?.startBeat ?? 16;
  const ct = 0.05 + chorusBeat * song.beat;
  const vCh = windowRms(vocal, ct, 2), bCh = windowRms(band, ct, 2);
  assert.ok(vCh > bCh, `${genre}: chorus vocal RMS (${vCh.toFixed(4)}) > band RMS (${bCh.toFixed(4)}) — vocal is the loudest element`);
  // (c) no silent 1-second sections in the full mix.
  let silentSecs = 0;
  for (let s = 0; s < Math.floor(full.length / SR); s++){
    if (windowRms(full, s, 1) < 0.01) silentSecs++;
  }
  assert.equal(silentSecs, 0, `${genre}: no silent seconds, got ${silentSecs}`);
  // Live (bar-by-bar) render matches the full render — scheduler drops nothing.
  const chunked = await render(song, { barByBar: true });
  let maxDiff = 0;
  for (let i = 0; i < full.length; i++){ const d = Math.abs(full[i] - chunked[i]); if (d > maxDiff) maxDiff = d; }
  assert.ok(maxDiff < 0.02, `${genre}: bar-by-bar == full render (maxDiff ${maxDiff.toFixed(4)})`);
  console.log(`mix ${genre}: peak=${f.peak.toFixed(3)} rms=${f.rms.toFixed(4)} clip=${(f.clipFrac*100).toFixed(2)}% | vocal rms=${v.rms.toFixed(4)} peak=${v.peak.toFixed(3)} | chorus vocal=${vCh.toFixed(4)} band=${bCh.toFixed(4)} (${(vCh/bCh).toFixed(2)}x) | silentSecs=${silentSecs}`);
}
console.log('MIX TEST PASSED');
