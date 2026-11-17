// AI Song Maker — mock-audio test (node, no DOM, no real audio hardware).
// Builds a full-band song and schedules it into a fake AudioContext,
// proving scheduleSong + the Karplus-Strong guitar never throw and
// actually schedule notes. Run: node scripts/test-audio-mock.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../www/app.js', import.meta.url), 'utf8');
const start = src.indexOf('/* __PURE_START__ */');
const end = src.indexOf('/* ================= APP STATE');
assert.ok(start >= 0 && end > start, 'pure+audio sections present in app.js');
const code = src.slice(start, end);

class Param { constructor(){ this.value = 0; } setValueAtTime(){ } exponentialRampToValueAtTime(){ } linearRampToValueAtTime(){ } }
class Node {
  constructor(ctx){ this.ctx = ctx; }
  connect(){ return this; } disconnect(){ } start(){ } stop(){ }
}
class Osc extends Node { constructor(ctx){ super(ctx); this.frequency = new Param(); this.detune = new Param(); this.type = 'sine'; } }
class Gain extends Node { constructor(ctx){ super(ctx); this.gain = new Param(); } }
class Filter extends Node { constructor(ctx){ super(ctx); this.frequency = new Param(); this.Q = new Param(); this.type = 'lowpass'; } }
class BufSrc extends Node { constructor(ctx){ super(ctx); this.buffer = null; this.loop = false; } }
class MockCtx {
  constructor(){ this.sampleRate = 44100; this.currentTime = 0; this.destination = {}; this.calls = { osc: 0, gain: 0, filter: 0, bufSrc: 0, buffer: 0 }; }
  createBuffer(ch, len, sr){ this.calls.buffer++; return { numberOfChannels: ch, length: len, sampleRate: sr, getChannelData: () => new Float32Array(len) }; }
  createOscillator(){ this.calls.osc++; return new Osc(this); }
  createGain(){ this.calls.gain++; return new Gain(this); }
  createBiquadFilter(){ this.calls.filter++; return new Filter(this); }
  createBufferSource(){ this.calls.bufSrc++; return new BufSrc(this); }
  async resume(){ } suspend(){ }
}

const fn = new Function(code + `
;return { buildSong, scheduleSong, generateLyrics, smartPick };`);
const M = fn();
const lyrics = M.generateLyrics('Sunday morning with my girl, no stress', 'Romantic', 'R&B', 42);

for (const genre of ['Hip-hop', 'Rock', 'Country', 'Lo-fi', 'Pop']){
  const pick = M.smartPick(genre, 'Happy', 'test song about tonight', 2);
  const song = M.buildSong({ title: 'Mock ' + genre, genre, mood: 'Happy', tempo: pick.tempo,
    key: pick.key, durationTarget: 45, energy: 2, vocalStyle: 'Smooth',
    instruments: pick.instruments, smartPick: pick, guitarStyle: pick.guitarStyle, seed: 7 }, lyrics, { baseHz: 110 });
  const ctx = new MockCtx();
  const dest = new Gain(ctx);
  const out = M.scheduleSong(ctx, dest, song, { t0: 0.05 });
  assert.ok(out.durationSec > 30, genre + ' schedules a real duration');
  assert.ok(out.lineEvents.length > 0, genre + ' schedules lyric lines');
  assert.ok(ctx.calls.osc > 20, genre + ' schedules oscillators (' + ctx.calls.osc + ')');
  if (pick.instruments.includes('Guitar')) assert.ok(ctx.calls.bufSrc > 0, genre + ' schedules guitar plucks');
  console.log(`mock-audio ${genre}: ${out.durationSec.toFixed(1)}s, osc=${ctx.calls.osc} bufSrc=${ctx.calls.bufSrc} buffers=${ctx.calls.buffer}`);
}
console.log('MOCK AUDIO TEST PASSED');
