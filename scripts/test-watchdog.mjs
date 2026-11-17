// AI Song Maker — playback watchdog test (node, no DOM, no real audio).
// Simulates the Android WebView bug where an AudioContext reports state
// 'running' yet its currentTime never advances, and asserts the v1.2.1
// watchdog throws that frozen context away, builds a fresh one and retries
// the play once. Also asserts a healthy context is NOT retried, and a
// context stuck suspended is reported, not spun on.
// Run: node scripts/test-watchdog.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../www/app.js', import.meta.url), 'utf8');
const pureStart = src.indexOf('/* __PURE_START__ */');
const pureEnd = src.indexOf('/* __PURE_END__ */');
const audioStart = src.indexOf('/* ================= AUDIO ENGINE');
const stateStart = src.indexOf('/* ================= APP STATE');
const playerStart = src.indexOf('/* ================= PLAYER');
const voiceStart = src.indexOf('/* ================= MY VOICE');
for (const [name, v] of [['pureStart', pureStart], ['pureEnd', pureEnd], ['audioStart', audioStart], ['stateStart', stateStart], ['playerStart', playerStart], ['voiceStart', voiceStart]])
  assert.ok(v >= 0, name + ' marker present');
const code = src.slice(pureStart, pureEnd) + '\n' + src.slice(audioStart, stateStart) + '\n' + src.slice(playerStart, voiceStart);

/* ---- DOM / app stubs ---- */
function makeEl(){
  return {
    textContent: '', value: 0,
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    addEventListener(){}, querySelectorAll(){ return []; }, style: {},
  };
}
const els = {};
const toasts = [];
globalThis.document = {
  getElementById: (id) => (els[id] ||= makeEl()),
  querySelectorAll: () => [],
  querySelector: () => null,
};
globalThis.$ = (id) => globalThis.document.getElementById(id);
globalThis.localStorage = { getItem: () => null, setItem(){}, removeItem(){} };
globalThis.toast = (m) => { toasts.push(String(m)); };
globalThis.saveSongs = () => {};

/* ---- Mock AudioContext ---- */
class Param { constructor(){ this.value = 0; } setValueAtTime(){ } exponentialRampToValueAtTime(){ } linearRampToValueAtTime(){ } }
class Node {
  constructor(ctx){ this.ctx = ctx; }
  connect(){ return this; } disconnect(){ } start(){ } stop(){ }
}
class Osc extends Node { constructor(ctx){ super(ctx); this.frequency = new Param(); this.detune = new Param(); this.type = 'sine'; } }
class Gain extends Node { constructor(ctx){ super(ctx); this.gain = new Param(); } }
class Filter extends Node { constructor(ctx){ super(ctx); this.frequency = new Param(); this.Q = new Param(); this.gain = new Param(); this.type = 'lowpass'; } }
class BufSrc extends Node { constructor(ctx){ super(ctx); this.buffer = null; this.loop = false; } }
class MockCtx {
  static created = 0;
  static freezeNext = false;   // next instance is born frozen (clock stuck at 0)
  static stuckSuspended = false; // instances start suspended and resume() never works
  constructor(){
    MockCtx.created++;
    this.sampleRate = 44100;
    this.destination = {};
    this._born = Date.now();
    this._frozen = MockCtx.freezeNext; MockCtx.freezeNext = false;
    this.state = MockCtx.stuckSuspended ? 'suspended' : 'running';
    this.calls = { osc: 0 };
  }
  get currentTime(){ return this._frozen ? 0 : (Date.now() - this._born) / 1000; }
  async resume(){ if (!MockCtx.stuckSuspended) this.state = 'running'; }
  suspend(){ this.state = 'suspended'; }
  async close(){ this.state = 'closed'; }
  createBuffer(ch, len, sr){ return { numberOfChannels: ch, length: len, sampleRate: sr, getChannelData: () => new Float32Array(len) }; }
  createOscillator(){ this.calls.osc++; return new Osc(this); }
  createGain(){ return new Gain(this); }
  createBiquadFilter(){ return new Filter(this); }
  createBufferSource(){ return new BufSrc(this); }
}
globalThis.window = { AudioContext: MockCtx };

const loadApp = () => new Function(code + `
;return { buildSong, generateLyrics, playSong, stopPlayback, audioDiagText };`)();
let M = loadApp();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function makeSong(){
  const lyrics = M.generateLyrics('Sunday morning with my girl, no stress', 'Romantic', 'R&B', 42);
  return M.buildSong({ title: 'Watchdog', genre: 'Pop', mood: 'Happy', tempo: 100, key: 'A minor',
    durationTarget: 45, energy: 2, vocalStyle: 'Smooth', instruments: ['Piano', 'Drums'], seed: 7 }, lyrics, { baseHz: 110 });
}
function reset(){
  /* Stop the previous instance's timers first (its player interval and
     any pending watchdog), or they would fire during the next case and
     pollute the context count. Then a fresh app instance: the player
     keeps its AudioContext in module state, and a live context is
     (correctly) reused, so a new evaluation is the only clean way to
     start a case from "no engine". */
  try { M.stopPlayback(); } catch (e){}
  M = loadApp();
  MockCtx.created = 0; MockCtx.freezeNext = false; MockCtx.stuckSuspended = false;
  toasts.length = 0;
}

/* Case A: first context frozen (state 'running', clock stuck at 0).
   Watchdog must recreate the engine and retry the play once. */
reset();
MockCtx.freezeNext = true;
await M.playSong(makeSong());
await sleep(1700);
assert.equal(MockCtx.created, 2, 'frozen context is thrown away and a fresh one is created');
assert.ok(toasts.some(t => t.includes('Audio engine was stuck — retrying')), 'retry toast shown, got: ' + JSON.stringify(toasts));
assert.ok(/Audio: running/.test(M.audioDiagText()), 'fresh engine is running: ' + M.audioDiagText());
assert.ok(/into song/.test(M.audioDiagText()), 'fresh engine is playing: ' + M.audioDiagText());
console.log('case A (frozen -> recreate + retry) OK:', M.audioDiagText());
reset();

/* Case B: healthy context whose clock advances. No retry, no toast. */
reset();
await M.playSong(makeSong());
await sleep(1400);
assert.equal(MockCtx.created, 1, 'healthy context is left alone');
assert.ok(!toasts.some(t => /stuck|retrying/.test(t)), 'no stuck/retry toast for a healthy engine: ' + JSON.stringify(toasts));
assert.ok(/Audio: running/.test(M.audioDiagText()), 'healthy engine running: ' + M.audioDiagText());
console.log('case B (healthy -> no retry) OK:', M.audioDiagText());
reset();

/* Case C: context stuck suspended (resume never works). Play must report
   it plainly and not schedule anything. */
reset();
MockCtx.stuckSuspended = true;
const songC = makeSong();
await M.playSong(songC);
await sleep(150);
assert.ok(toasts.some(t => t.includes('Audio is blocked — tap Play again')), 'blocked toast shown: ' + JSON.stringify(toasts));
assert.ok(!/into song/.test(M.audioDiagText()), 'nothing scheduled while suspended: ' + M.audioDiagText());
console.log('case C (suspended -> reported, not spun) OK:', M.audioDiagText());
reset();

console.log('WATCHDOG TEST PASSED');
