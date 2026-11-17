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
  clamp, hashStr, mulberry32, fmtTime, extractVersion, KEYS, PROGRESSIONS, GENRES, INSTRUMENTS,
  BAND_LINEUPS, smartPick, SECTION_GAIN,
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

// 6. Merlin Smart Pick: every genre gets a full band, tempo in range, a reason
for (const g of M.GENRES){
  const p = M.smartPick(g, 'Happy', 'Sunday morning with my girl', 2);
  assert.ok(p.tempo >= 60 && p.tempo <= 180, g + ' pick tempo in range');
  assert.ok(p.instruments.includes('Drums'), g + ' band has drums');
  assert.ok(p.instruments.includes('Bass') || p.instruments.includes('808s'), g + ' band has bass/808s');
  assert.ok(p.reason && p.reason.length > 10, g + ' pick has a reason');
  assert.ok(p.vocalStyle, g + ' pick has a vocal style');
  assert.deepEqual(p.instruments, M.BAND_LINEUPS[g], g + ' pick uses the genre lineup');
}
assert.ok(M.smartPick('Hip-hop', 'Hype', '', 3).tempo > M.smartPick('Hip-hop', 'Sad', '', 1).tempo, 'Hype is faster than Sad');
assert.ok(M.smartPick('Pop', 'Happy', '', 2).instruments.includes('Guitar'), 'Pop band has guitar');
assert.ok(M.smartPick('Rock', 'Hype', '', 3).guitarStyle === 'electric', 'Rock guitar is electric');
console.log('smartPick OK:', M.GENRES.map(g => `${g} ${M.smartPick(g, 'Happy', '', 2).tempo} BPM`).join(', '));

// 7. buildSong carries the band + pick through
const bandSong = M.buildSong({ title: 'Band', genre: 'Rock', mood: 'Hype', tempo: 128, key: 'A minor',
  durationTarget: 80, energy: 3, vocalStyle: 'Powerful', instruments: ['Drums', 'Bass', 'Guitar', 'Piano'],
  guitarStyle: 'electric', seed: 7 }, lyrics, voice);
assert.ok(bandSong.band.includes('Guitar'), 'song keeps its band');
assert.equal(bandSong.guitarStyle, 'electric', 'song keeps guitar style');
assert.ok(bandSong.smartPick && bandSong.smartPick.reason, 'song keeps Merlin pick');
console.log('band carry-through OK:', bandSong.band.join(' + '));

// 8. v1.2.0 quality: per-bar sections, final-chorus lift, vocal stays in range
const qSong = M.buildSong({ title: 'Q', genre: 'Pop', mood: 'Happy', tempo: 104, key: 'C major',
  durationTarget: 120, energy: 2, vocalStyle: 'Smooth', seed: 7 }, lyrics, { baseHz: 110, lowHz: 90, highHz: 180 });
assert.equal(qSong.barSections.length, qSong.bars, 'one section per bar');
assert.ok(qSong.barSections.every(s => s in M.SECTION_GAIN), 'every bar section has a mix gain');
assert.ok(qSong.melody.some(n => n.lift === 2), 'final chorus lifts +2');
assert.ok(qSong.melody.every(n => n.lift === 0 || n.lift === 2), 'lift is only 0 or +2');
const lo = Math.round(M.freqToMidi(180)), hi = Math.round(M.freqToMidi(360));
assert.ok(qSong.melody.every(n => n.midi >= lo && n.midi <= hi), `melody stays in your range ${lo}-${hi}`);
assert.ok(qSong.voiceRange && qSong.voiceRange.low === lo && qSong.voiceRange.high === hi, 'song stores your voice range');
console.log('quality OK: barSections', qSong.barSections.length, 'bars, lift notes', qSong.melody.filter(n => n.lift === 2).length, ', range', lo + '-' + hi);

// 9. auto-update: the version comes from the release title, never the tag
assert.equal(M.extractVersion('AI Song Maker v1.1.2'), '1.1.2');
assert.equal(M.extractVersion('v2.0.0'), '2.0.0');
assert.equal(M.extractVersion('latest'), '', 'a bare "latest" tag is not a version');
assert.equal(M.extractVersion('AI Song Maker (newest build)'), '', 'old title has no version');
console.log('extractVersion OK');

// 9. instrumental flag + title + fmtTime
assert.equal(M.fmtTime(125), '2:05');
assert.equal(M.titleFromPrompt('sunday morning with my girl'), 'Sunday Morning With My Girl');
assert.equal(M.midiToName(69), 'A4');
assert.ok(Math.abs(M.midiToFreq(69) - 440) < 0.01);
assert.equal(M.syllablesOf('morning'), 2);
console.log('helpers OK');
console.log('ALL ENGINE TESTS PASSED');
