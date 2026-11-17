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
class Filter extends Node { constructor(ctx){ super(ctx); this.frequency = new Param(); this.Q = new Param(); this.gain = new Param(); this.type = 'lowpass'; } }
class BufSrc extends Node { constructor(ctx){ super(ctx); this.buffer = null; this.loop = false; } }
class Delay extends Node { constructor(ctx){ super(ctx); this.delayTime = new Param(); } }
class MockCtx {
  constructor(){ this.sampleRate = 44100; this.currentTime = 0; this.destination = {}; this.calls = { osc: 0, gain: 0, filter: 0, bufSrc: 0, buffer: 0 }; }
  createBuffer(ch, len, sr){ this.calls.buffer++; return { numberOfChannels: ch, length: len, sampleRate: sr, getChannelData: () => new Float32Array(len) }; }
  createOscillator(){ this.calls.osc++; return new Osc(this); }
  createGain(){ this.calls.gain++; return new Gain(this); }
  createBiquadFilter(){ this.calls.filter++; return new Filter(this); }
  createBufferSource(){ this.calls.bufSrc++; return new BufSrc(this); }
  createDelay(){ return new Delay(this); }
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
/* ---- v1.2.2 caps: guitar-buffer cache + incremental (bar-by-bar) scheduling ----
   Rock 48 bars, guitar-heavy: uncached, ~288 Karplus buffer generations.
   With the cache the same song collapses to ~12 unique buffers, and the
   lookahead scheduler only builds one bar per tick, so the Play tap never
   creates ~8-10k nodes in one frozen block. */
{
  const M2 = fn(); // fresh module instance: empty guitar + noise caches
  const lyrics2 = M2.generateLyrics('Sunday morning with my girl, no stress', 'Romantic', 'R&B', 42);
  const pick2 = M2.smartPick('Rock', 'Happy', 'test song about tonight', 2);
  const song2 = M2.buildSong({ title: 'Caps Rock', genre: 'Rock', mood: 'Happy', tempo: pick2.tempo,
    key: pick2.key, durationTarget: 120, energy: 2, vocalStyle: 'Smooth',
    instruments: pick2.instruments, smartPick: pick2, guitarStyle: pick2.guitarStyle, seed: 7 }, lyrics2, { baseHz: 110 });
  assert.equal(song2.bars, 48, 'caps song is 48 bars');
  // Incremental schedule FIRST (cold cache), bar by bar — exactly what the
  // lookahead scheduler does on a Play tap.
  const ctxInc = new MockCtx();
  const destInc = new Gain(ctxInc);
  let lastMidi = null;
  const incLineEvents = [];
  for (let bar = 0; bar < song2.bars; bar++){
    const before = { osc: ctxInc.calls.osc, gain: ctxInc.calls.gain, filter: ctxInc.calls.filter, bufSrc: ctxInc.calls.bufSrc };
    const r = M2.scheduleSong(ctxInc, destInc, song2, { t0: 0.05, barStart: bar, barEnd: bar + 1, prevMidi: lastMidi });
    if (r.lastMidi != null) lastMidi = r.lastMidi;
    for (const le of r.lineEvents) incLineEvents.push(le);
    if (bar === 0){
      const barNodes = (ctxInc.calls.osc - before.osc) + (ctxInc.calls.gain - before.gain) + (ctxInc.calls.filter - before.filter) + (ctxInc.calls.bufSrc - before.bufSrc);
      // CAP: the first tick (one bar) must be a small fraction of the whole song.
      assert.ok(barNodes <= 400, 'first tick (one bar) creates <=400 nodes, got ' + barNodes);
      console.log(`caps first-bar nodes=${barNodes}`);
    }
  }
  const incNodes = ctxInc.calls.osc + ctxInc.calls.gain + ctxInc.calls.filter + ctxInc.calls.bufSrc;
  const incBuffers = ctxInc.calls.buffer;
  // CAP: Karplus buffers collapse on a cold cache (Rock ~288 generations -> ~12 unique + 1 noise buffer).
  assert.ok(incBuffers <= 20, 'incremental schedule creates <=20 buffers (cache), got ' + incBuffers);
  // Full schedule (one call) — the reference. Must match the incremental one.
  const ctxFull = new MockCtx();
  const outFull = M2.scheduleSong(ctxFull, new Gain(ctxFull), song2, { t0: 0.05 });
  const fullNodes = ctxFull.calls.osc + ctxFull.calls.gain + ctxFull.calls.filter + ctxFull.calls.bufSrc;
  const fullBuffers = ctxFull.calls.buffer;
  console.log(`caps full-schedule nodes=${fullNodes}, buffers=${fullBuffers} (warm cache)`);
  // Incremental == full: same nodes, same lyric lines, same duration.
  assert.equal(incNodes, fullNodes, 'bar-by-bar nodes == full-schedule nodes');
  assert.equal(incLineEvents.length, outFull.lineEvents.length, 'bar-by-bar lineEvents == full lineEvents');
  for (let i = 0; i < incLineEvents.length; i++){
    assert.equal(incLineEvents[i].t, outFull.lineEvents[i].t, 'lineEvent t matches');
    assert.equal(incLineEvents[i].text, outFull.lineEvents[i].text, 'lineEvent text matches');
  }
  assert.equal(outFull.durationSec, song2.bars * 4 * song2.beat, 'durationSec is the full song');
  console.log(`caps Rock 48 bars: buffers=${incBuffers} (was ~288 uncached), nodes=${incNodes}, lineEvents=${incLineEvents.length}`);
  // Second full schedule of the same song: every guitar buffer is a cache hit.
  const ctx2 = new MockCtx();
  const beforeBuf = ctx2.calls.buffer;
  M2.scheduleSong(ctx2, new Gain(ctx2), song2, { t0: 0.05 });
  const secondBuffers = ctx2.calls.buffer - beforeBuf;
  assert.ok(secondBuffers <= 1, 'second schedule of same song creates ~0 new buffers (cache), got ' + secondBuffers);
  console.log(`caps second schedule buffers=${secondBuffers} (cache hit)`);
}
console.log('MOCK AUDIO TEST PASSED');
