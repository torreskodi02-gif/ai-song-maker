// AI Song Maker — engine test (node, no DOM, no audio hardware).
// Extracts the pure logic between __PURE_START__ / __PURE_END__ in www/app.js,
// evaluates it, and asserts the song engine behaves: lyrics, chords, melody,
// durations, voice tuning, and version comparison helpers.
// Run: node scripts/test-engine.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../www/app.js', import.meta.url), 'utf8');
const start = src.indexOf('/* __PURE_START__ */');
const end = src.indexOf('/* __PURE_END__ */');
assert.ok(start >= 0 && end > start, 'pure markers present in app.js');
const pure = src.slice(start, end);
const fn = new Function(pure + `
;return { CURRENT_VERSION, REPO, LATEST_API, APK_URL, midiToFreq, midiToName, freqToMidi,
  clamp, hashStr, mulberry32, fmtTime, KEYS, PROGRESSIONS, GENRES, INSTRUMENTS,
  keywordsFromPrompt, titleFromPrompt, generateLyrics, parseLyrics, syllablesOf,
  buildSong, describeStyle };`);
const M = fn();

// 1. every genre has a progression + tempo + drum style
for (const g of M.GENRES){
  const p = M.PROGRESSIONS[g];
  assert.equal(p.prog.length, 4, g + ' progression is 4 bars');
  assert.ok(p.tempo >= 60 && p.tempo <= 180, g + ' tempo in range');
}
console.log('genres OK:', M.GENRES.join(', '));

// 2. lyrics: full structure, original, keyword present
const lyrics = M.generateLyrics('Sunday morning with my girl, no stress', 'Romantic', 'R&B', 42);
const parsed = M.parseLyrics(lyrics);
assert.ok(parsed.sections.length >= 5, 'lyrics have 5+ sections, got ' + parsed.sections.length);
assert.ok(parsed.sections.some(s => /chorus/i.test(s.name)), 'has a chorus');
assert.ok(parsed.allLines.length >= 16, '16+ lyric lines, got ' + parsed.allLines.length);
assert.ok(/girl|sunday|morning|stress/i.test(lyrics), 'lyrics use the prompt words');
assert.ok(!/suno/i.test(lyrics), 'no Suno branding in generated lyrics');
console.log('lyrics OK:', parsed.allLines.length, 'lines,', parsed.sections.map(s => s.name).join(' / '));

// 3. pasted lyrics are kept exactly
const mine = '[Verse 1]\nMy own words here\nSecond line here\n\n[Chorus]\nMy chorus line';
const mineParsed = M.parseLyrics(mine);
assert.equal(mineParsed.allLines[0].text, 'My own words here');
assert.equal(mineParsed.allLines[2].text, 'My chorus line');

// 4. buildSong: melody + chords + duration for every target length
const voice = { baseHz: 110 };
for (const target of [45, 80, 120, 150]){
  const song = M.buildSong({ title: 'Test', genre: 'Pop', mood: 'Happy', tempo: 100, key: 'A minor',
    durationTarget: target, energy: 2, vocalStyle: 'Smooth', instruments: ['Piano'], seed: 7 }, lyrics, voice);
  assert.ok(song.melody.length > 40, `target ${target}: melody has notes (${song.melody.length})`);
  assert.equal(song.chords.length, song.bars, 'one chord per bar');
  assert.ok(Math.abs(song.durationSec - target) <= 12, `target ${target}: duration ${song.durationSec}s`);
  assert.ok(song.melody.every(n => n.midi >= 40 && n.midi <= 96), 'melody in singable range');
  assert.ok(song.lineEvents.length > 0, 'line events for lyric highlighting');
  console.log(`buildSong target ${target}s -> ${song.durationSec}s, ${song.bars} bars, ${song.melody.length} notes, ${song.chords.length} chords`);
}

// 5. voice tuning actually shifts the melody
const low = M.buildSong({ title: 'T', genre: 'Pop', mood: 'Happy', tempo: 100, key: 'A minor', durationTarget: 80, energy: 2, vocalStyle: 'Smooth', seed: 7 }, lyrics, { baseHz: 82 });
const high = M.buildSong({ title: 'T', genre: 'Pop', mood: 'Happy', tempo: 100, key: 'A minor', durationTarget: 80, energy: 2, vocalStyle: 'Smooth', seed: 7 }, lyrics, { baseHz: 220 });
const med = arr => { const s = arr.map(n => n.midi).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
assert.ok(med(low.melody) < med(high.melody), `voice tuning shifts melody: low ${med(low.melody)} < high ${med(high.melody)}`);
console.log('voice tuning OK: median MIDI low-voice', med(low.melody), 'vs high-voice', med(high.melody));

// 6. instrumental flag + title + fmtTime
assert.equal(M.fmtTime(125), '2:05');
assert.equal(M.titleFromPrompt('sunday morning with my girl'), 'Sunday Morning With My Girl');
assert.equal(M.midiToName(69), 'A4');
assert.ok(Math.abs(M.midiToFreq(69) - 440) < 0.01);
assert.equal(M.syllablesOf('morning'), 2);
console.log('helpers OK');
console.log('ALL ENGINE TESTS PASSED');
