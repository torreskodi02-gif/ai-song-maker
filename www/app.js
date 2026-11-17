/* ============================================================================
   AI SONG MAKER — app.js
   Merlin builds original songs in the browser: lyrics, melody, beat,
   synthesized vocal tuned to your voice. No Suno, no external API, no keys.
   ----------------------------------------------------------------------------
   Pure music/lyrics logic lives between __PURE_START__ / __PURE_END__ so it
   can be unit-tested in node without a DOM (see scripts/test-engine.mjs).
   ========================================================================== */
'use strict';
/* __PURE_START__ */
const CURRENT_VERSION = '1.2.3';
const REPO = 'torreskodi02-gif/ai-song-maker';
const LATEST_API = 'https://api.github.com/repos/' + REPO + '/releases/latest';
/* Fallback for the update check: the release title is often unversioned
   ("AI Song Maker (newest build)") because the workflow file was never
   re-pasted, so www/version.json on main is the reliable version source. */
const VERSION_JSON_URL = 'https://raw.githubusercontent.com/' + REPO + '/main/www/version.json';
const APK_URL = 'https://github.com/' + REPO + '/releases/download/latest/ai-song-maker.apk';

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function midiToFreq(m){ return 440 * Math.pow(2, (m - 69) / 12); }
function midiToName(m){ return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }
function freqToMidi(f){ return 69 + 12 * Math.log2(f / 440); }
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function hashStr(s){ let h = 0; for (let i = 0; i < s.length; i++){ h = (h * 31 + s.charCodeAt(i)) >>> 0; } return h; }
function mulberry32(seed){ let a = seed >>> 0; return function(){ a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function pick(rng, arr){ return arr[Math.floor(rng() * arr.length)]; }
function fmtTime(sec){ sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
/* Pull a "1.2.3" version out of a release name/tag like "AI Song Maker v1.2.3"
   or "v1.2.3". Returns '' when there is no version in the text — a bare
   tag like "latest" is NOT a version. */
function extractVersion(str){
  const m = String(str || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? m[0] : '';
}

/* --- music theory: keys, scales, per-genre chord progressions --- */
const KEYS = {
  'C major':  { tonic: 60, minor: false }, 'G major':  { tonic: 55, minor: false },
  'D major':  { tonic: 62, minor: false }, 'A major':  { tonic: 57, minor: false },
  'F major':  { tonic: 53, minor: false }, 'Bb major': { tonic: 58, minor: false },
  'A minor':  { tonic: 57, minor: true  }, 'E minor':  { tonic: 52, minor: true  },
  'D minor':  { tonic: 50, minor: true  }, 'B minor':  { tonic: 59, minor: true  },
};
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const MAJOR_TRIAD = ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'];
const MINOR_TRIAD = ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj'];
const TRIAD_TONES = { maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6] };
/* progressions are scale degrees, one chord per bar, 4-bar loop */
const PROGRESSIONS = {
  'Hip-hop':   { minor: true,  prog: [0, 5, 2, 6], tempo: 92,  drum: 'boom' },
  'R&B':       { minor: false, prog: [1, 4, 0, 5], tempo: 86,  drum: 'rnb'  },
  'Pop':       { minor: false, prog: [0, 4, 5, 3], tempo: 104, drum: 'pop'  },
  'Rock':      { minor: false, prog: [0, 4, 5, 3], tempo: 128, drum: 'rock' },
  'Country':   { minor: false, prog: [0, 3, 5, 4], tempo: 100, drum: 'pop'  },
  'Afrobeats': { minor: true,  prog: [0, 5, 0, 3], tempo: 106, drum: 'afro' },
  'EDM':       { minor: true,  prog: [5, 3, 0, 4], tempo: 126, drum: 'edm'  },
  'Lo-fi':     { minor: false, prog: [1, 4, 0, 5], tempo: 74,  drum: 'lofi' },
  'Gospel':    { minor: false, prog: [0, 5, 3, 4], tempo: 90,  drum: 'rnb'  },
};
/* Mix dynamics: verses sit back, choruses hit hardest, outro fades out. */
const SECTION_GAIN = { intro: 0.65, verse: 0.85, chorus: 1.0, bridge: 0.8, outro: 0.55 };
const GENRES = Object.keys(PROGRESSIONS);
/* Full band: every song gets a real lineup, not just a pad + beat. */
const INSTRUMENTS = ['Drums', 'Bass', 'Guitar', 'Piano', 'Keys', 'Strings', 'Synth', '808s'];
const BAND_LINEUPS = {
  'Hip-hop':   ['Drums', '808s', 'Piano', 'Synth'],
  'R&B':       ['Drums', 'Bass', 'Guitar', 'Piano', 'Strings'],
  'Pop':       ['Drums', 'Bass', 'Guitar', 'Piano', 'Synth'],
  'Rock':      ['Drums', 'Bass', 'Guitar', 'Piano'],
  'Country':   ['Drums', 'Bass', 'Guitar', 'Piano'],
  'Afrobeats': ['Drums', 'Bass', 'Guitar', 'Keys', 'Synth'],
  'EDM':       ['Drums', 'Bass', 'Synth', 'Keys'],
  'Lo-fi':     ['Drums', 'Bass', 'Guitar', 'Piano'],
  'Gospel':    ['Drums', 'Bass', 'Piano', 'Strings', 'Guitar'],
};
const GUITAR_STYLE = {
  'Hip-hop': 'electric clean', 'R&B': 'electric clean', 'Pop': 'electric clean',
  'Rock': 'electric', 'Country': 'acoustic', 'Afrobeats': 'electric clean',
  'EDM': 'electric clean', 'Lo-fi': 'acoustic', 'Gospel': 'acoustic',
};
const GENRE_KEYS = {
  'Hip-hop': 'A minor', 'R&B': 'E minor', 'Pop': 'C major', 'Rock': 'A minor',
  'Country': 'G major', 'Afrobeats': 'D minor', 'EDM': 'A minor',
  'Lo-fi': 'D minor', 'Gospel': 'F major',
};
const RELATIVE_MINOR = { 'C major': 'A minor', 'G major': 'E minor', 'F major': 'D minor', 'D major': 'B minor', 'A major': 'F# minor', 'Bb major': 'G minor' };
const MOOD_TEMPO_ADJ = { Happy: 4, Chill: -8, Romantic: -4, Sad: -10, Hype: 8, Motivational: 4, Confident: 2, Peaceful: -12 };
const MOOD_VOCAL = { Happy: 'Smooth', Chill: 'Soft / airy', Romantic: 'Smooth', Sad: 'Soft / airy', Hype: 'Powerful', Motivational: 'Powerful', Confident: 'Powerful', Peaceful: 'Soft / airy' };
/* Merlin Smart Pick: given genre + mood + lyrics, pick the best tempo, key,
   vocal style and full-band lineup — with a plain reason, so the user can
   trust it or override any single piece. */
function smartPick(genre, mood, lyricsText, energy){
  const g = PROGRESSIONS[genre] || PROGRESSIONS.Pop;
  const e = energy || 2;
  let tempo = clamp(g.tempo + (MOOD_TEMPO_ADJ[mood] || 0) + (e === 3 ? 4 : e === 1 ? -4 : 0), 60, 180);
  let key = GENRE_KEYS[genre] || 'A minor';
  const text = (lyricsText || '').toLowerCase();
  if (/love|heart|girl|baby|darling/.test(text) && !/night|city|street/.test(text)) key = 'C major';
  if (/night|city|street|rain|goodbye|alone/.test(text)) key = GENRE_KEYS[genre] && KEYS[GENRE_KEYS[genre]] && KEYS[GENRE_KEYS[genre]].minor ? GENRE_KEYS[genre] : (RELATIVE_MINOR[key] || 'A minor');
  if ((mood === 'Sad' || mood === 'Chill') && !KEYS[key].minor) key = RELATIVE_MINOR[key] || 'A minor';
  if (mood === 'Happy' && KEYS[key].minor && !/night|rain|goodbye/.test(text)) key = 'C major';
  const instruments = (BAND_LINEUPS[genre] || BAND_LINEUPS.Pop).slice();
  const vocalStyle = MOOD_VOCAL[mood] || 'Smooth';
  const reason = `${genre} + ${mood.toLowerCase()} mood → ${tempo} BPM in ${key}, with ${instruments.join(', ')}`;
  return { genre, mood, tempo, key, instruments, vocalStyle, guitarStyle: GUITAR_STYLE[genre] || 'electric clean', energy: e, reason };
}
const STYLE_TAGS = ['ethereal', 'dreamy', 'punchy', 'smooth', 'raw', 'anthemic', 'chill', 'euphoric'];
const MOOD_WORDS = {
  Happy: ['sunshine', 'good times', 'smiling'], Chill: ['slow nights', 'easy air', 'no rush'],
  Romantic: ['your hand in mine', 'close to you', 'your eyes'], Sad: ['empty rooms', 'goodbye', 'rain'],
  Hype: ['turn it up', 'all night', 'no brakes'], Motivational: ['keep going', 'rise up', 'one more step'],
  Confident: ['I know my worth', 'standing tall', 'watch me'], Peaceful: ['quiet mornings', 'still water', 'soft light'],
};
const STOPWORDS = new Set(('a an the and or but of to in on for with my your his her our their is are was were be been it this that i you he she we they me him us them at as by from up down out over just so no not do does did don t ll re ve s').split(' '));
function keywordsFromPrompt(prompt){
  const words = (prompt || '').toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
  const out = []; for (const w of words){ if (!out.includes(w)) out.push(w); if (out.length >= 3) break; }
  return out.length ? out : ['tonight'];
}
function titleFromPrompt(prompt, fallback){
  const clean = (prompt || '').replace(/[^a-zA-Z0-9\s']/g, ' ').trim().split(/\s+/).slice(0, 5).join(' ');
  if (clean) return clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return fallback || 'Untitled';
}

/* --- Merlin lyrics: original line banks, keyword slots, seeded variety --- */
function verseLine(rng, kw, mood){
  const k = kw[0], k2 = kw[1] || kw[0];
  return pick(rng, [
    `Woke up thinking 'bout ${k}, couldn't shake it off my mind`,
    `Every road I take keeps leading back to ${k2}`,
    `I was lost in the noise till I found a little ${k}`,
    `We were talking late, talking 'bout ${k} and where we've been`,
    `There's a light in the dark and it sounds a lot like ${k}`,
    `I keep your name in my pocket everywhere I go`,
    `Some days feel heavy, but ${k} makes the weight feel light`,
    `I remember ${k} like it happened yesterday`,
    `No map, no plan, just ${k} and the open road`,
    `If I could rewind, I'd land right back on ${k}`,
  ]);
}
function chorusLine(rng, kw, mood){
  const k = kw[0], mw = pick(rng, MOOD_WORDS[mood] || MOOD_WORDS.Happy);
  return pick(rng, [
    `And it's all about ${k}, yeah, ${k} all night`,
    `${mw} — that's all I need, that's all I need`,
    `Sing it louder, ${k}, don't let the feeling fade`,
    `Hold on to ${k}, hold on, don't let go`,
    `This is my ${k}, my ${k}, my everything`,
    `We keep rising, rising, nothing holding us down`,
    `${k} in my heart and the whole world knows`,
    `One more time for ${k}, one more time for us`,
  ]);
}
function bridgeLine(rng, kw, mood){
  const k = kw[0];
  return pick(rng, [
    `If the world goes quiet, I'll still hear ${k}`,
    `Strip it all back, it's only you and me`,
    `Take a breath, take your time, we'll get there slow`,
    `Everything I needed was ${k} all along`,
  ]);
}
function generateLyrics(prompt, mood, genre, seed){
  const rng = mulberry32(seed || (Date.now() % 2147483647));
  const kw = keywordsFromPrompt(prompt);
  const take = (fn, n) => { const lines = []; let guard = 0; while (lines.length < n && guard++ < 40){ const l = fn(rng, kw, mood); if (!lines.includes(l)) lines.push(l); } return lines; };
  const v1 = take(verseLine, 4), c = take(chorusLine, 4), v2 = take(verseLine, 4), b = take(bridgeLine, 3);
  const sec = (name, lines) => '[' + name + ']\n' + lines.join('\n');
  return [sec('Verse 1', v1), sec('Chorus', c), sec('Verse 2', v2), sec('Chorus', c), sec('Bridge', b), sec('Chorus', c)].join('\n\n');
}
function parseLyrics(text){
  const sections = []; let cur = { name: 'Verse', lines: [] };
  for (const raw of (text || '').split('\n')){
    const line = raw.trim(); if (!line) continue;
    const m = line.match(/^\[(.+)\]$/);
    if (m){ if (cur.lines.length) sections.push(cur); cur = { name: m[1].trim(), lines: [] }; }
    else cur.lines.push(line);
  }
  if (cur.lines.length) sections.push(cur);
  if (!sections.length) return { sections: [], allLines: [] };
  const allLines = [];
  for (const s of sections) for (const l of s.lines) allLines.push({ text: l, section: s.name });
  return { sections, allLines };
}
function syllablesOf(word){
  const m = (word || '').toLowerCase().replace(/[^a-z]/g, '').match(/[aeiouy]+/g);
  return Math.max(1, m ? m.length : 1);
}

/* --- arrangement: lyrics -> melody + chords, tuned to the voice profile --- */
function buildSong(settings, lyricsText, voiceProfile){
  const rng = mulberry32(settings.seed || hashStr((settings.title || '') + (settings.genre || '') + Date.now()));
  const key = KEYS[settings.key] || KEYS['A minor'];
  const prog = PROGRESSIONS[settings.genre] || PROGRESSIONS.Pop;
  const scale = key.minor ? MINOR_SCALE : MAJOR_SCALE;
  const triads = key.minor ? MINOR_TRIAD : MAJOR_TRIAD;
  const parsed = parseLyrics(lyricsText);
  const beat = 60 / settings.tempo;
  /* structure by target length: each lyric line gets 2 bars (8 beats) */
  const target = settings.durationTarget || 80;
  const plan = target <= 50 ? ['intro', 'verse', 'chorus', 'outro']
    : target <= 90 ? ['intro', 'verse', 'chorus', 'verse', 'chorus', 'outro']
    : target <= 130 ? ['intro', 'verse', 'chorus', 'verse', 'chorus', 'bridge', 'chorus', 'outro']
    : ['intro', 'verse', 'chorus', 'verse', 'chorus', 'bridge', 'verse', 'chorus', 'chorus', 'outro'];
  const sectionLines = { verse: [], chorus: [], bridge: [] };
  for (const l of parsed.allLines){
    const s = /chorus/i.test(l.section) ? 'chorus' : /bridge/i.test(l.section) ? 'bridge' : 'verse';
    sectionLines[s].push(l.text);
  }
  if (!sectionLines.verse.length) sectionLines.verse = ['La la la, singing through the night'];
  if (!sectionLines.chorus.length) sectionLines.chorus = sectionLines.verse.slice(0, 4);
  if (!sectionLines.bridge.length) sectionLines.bridge = sectionLines.verse.slice(0, 2);
  const barsFor = { intro: 2, verse: 8, chorus: 8, bridge: 4, outro: 2 };
  const lineBeats = 8;
  let totalBars = 0; for (const s of plan) totalBars += barsFor[s];
  const durationSec = totalBars * 4 * beat;
  /* one section name per bar — the mixer uses it for dynamics + fills */
  const barSections = [];
  for (const s of plan) for (let b = 0; b < barsFor[s]; b++) barSections.push(s);
  /* final chorus lift: the last chorus sings a whole step higher */
  let lastChorusIdx = -1; plan.forEach((s, i) => { if (s === 'chorus') lastChorusIdx = i; });
  /* voice tuning: shift melody so its middle sits near the singer's range,
     then keep every note inside the recorded range (octave-shifted) so the
     vocal stays close to YOUR voice, not a generic singer's. */
  let shift = 0, vLow = 0, vHigh = 0;
  if (voiceProfile && voiceProfile.baseHz){
    const singMidi = freqToMidi(voiceProfile.baseHz * 2);
    shift = clamp(Math.round(singMidi - (key.tonic + 5)), -7, 7);
    vLow = voiceProfile.lowHz ? Math.round(freqToMidi(voiceProfile.lowHz * 2)) : Math.round(singMidi) - 12;
    vHigh = voiceProfile.highHz ? Math.round(freqToMidi(voiceProfile.highHz * 2)) : Math.round(singMidi) + 12;
  }
  /* chords, one per bar, cycling the genre progression */
  const chords = [];
  for (let bar = 0; bar < totalBars; bar++){
    const deg = prog.prog[bar % prog.prog.length];
    const rootMidi = key.tonic + scale[deg];
    const quality = triads[deg];
    chords.push({ bar, rootMidi, quality, tones: TRIAD_TONES[quality].map(t => rootMidi + t) });
  }
  /* melody: walk the scale, one note per syllable, chorus sits higher */
  const melody = []; const lineEvents = [];
  let beatCursor = 0; let verseIdx = 0, chorusIdx = 0, bridgeIdx = 0;
  for (let secOrdinal = 0; secOrdinal < plan.length; secOrdinal++){
    const secName = plan[secOrdinal];
    const bars = barsFor[secName];
    const lift = (secName === 'chorus' && secOrdinal === lastChorusIdx) ? 2 : 0;
    if (secName === 'intro' || secName === 'outro'){ beatCursor += bars * 4; continue; }
    const pool = sectionLines[secName];
    const idxRef = secName === 'chorus' ? 'chorusIdx' : secName === 'bridge' ? 'bridgeIdx' : 'verseIdx';
    let idx = secName === 'chorus' ? chorusIdx : secName === 'bridge' ? bridgeIdx : verseIdx;
    const baseDeg = secName === 'chorus' ? 4 : secName === 'bridge' ? 2 : 2;
    let degPos = baseDeg;
    for (let li = 0; li < bars / 2; li++){
      const lineText = pool[idx % pool.length]; idx++;
      const lineStart = beatCursor + li * lineBeats;
      lineEvents.push({ text: lineText, section: secName, startBeat: lineStart, endBeat: lineStart + lineBeats });
      const words = lineText.split(/\s+/).filter(Boolean);
      let totalSyl = 0; for (const w of words) totalSyl += syllablesOf(w);
      let noteCursor = lineStart;
      words.forEach((word, wi) => {
        const syl = syllablesOf(word);
        for (let s = 0; s < syl; s++){
          const isLast = wi === words.length - 1 && s === syl - 1;
          if (isLast) degPos = pick(rng, [0, 0, 2]); /* last syllable resolves to tonic/third */
          else { const step = pick(rng, [-2, -1, -1, 0, 1, 1, 2]); degPos = clamp(degPos + step, 0, 9); }
          let midi = key.tonic + scale[((degPos % 7) + 7) % 7] + 12 * Math.floor(degPos / 7) + shift + lift;
          if (vLow && vHigh){ while (midi > vHigh) midi -= 12; while (midi < vLow) midi += 12; }
          const dur = clamp(lineBeats / Math.max(1, totalSyl), 0.5, 2);
          melody.push({ midi, lift, startBeat: noteCursor, dur, word, line: lineEvents.length - 1 });
          noteCursor += dur;
        }
      });
    }
    if (secName === 'chorus') chorusIdx = idx; else if (secName === 'bridge') bridgeIdx = idx; else verseIdx = idx;
    beatCursor += bars * 4;
  }
  const songPick = settings.smartPick || smartPick(settings.genre, settings.mood, lyricsText, settings.energy);
  return {
    id: 's' + Date.now().toString(36) + Math.floor(rng() * 1e6).toString(36),
    title: settings.title || 'Untitled', genre: settings.genre, mood: settings.mood,
    tempo: settings.tempo, key: settings.key, durationSec: Math.round(durationSec),
    energy: settings.energy, vocalStyle: settings.vocalStyle,
    instruments: (settings.instruments && settings.instruments.length ? settings.instruments : songPick.instruments) || [],
    guitarStyle: settings.guitarStyle || songPick.guitarStyle,
    band: songPick.instruments, smartPick: songPick,
    styleDesc: settings.styleDesc || '',
    variety: settings.variety || 3, instrumental: !!settings.instrumental,
    lyrics: lyricsText, seed: settings.seed || 0, hue: hashStr(settings.title || 'song') % 360,
    bars: totalBars, beat, chords, melody, lineEvents, barSections,
    voiceRange: (vLow && vHigh) ? { low: vLow, high: vHigh } : null,
    plays: 0, favorite: false, createdAt: Date.now(),
    audioRefName: settings.audioRefName || '', voiceHz: voiceProfile ? voiceProfile.baseHz : 0,
  };
}
function describeStyle(genre, mood){
  const g = (PROGRESSIONS[genre] || PROGRESSIONS.Pop);
  return `${mood.toLowerCase()} ${genre.toLowerCase()}, ${g.tempo} BPM, ${g.minor ? 'minor-key' : 'major-key'} progression`;
}
/* __PURE_END__ */

/* ================= AUDIO ENGINE (Web Audio, no external API) ================= */
let _noiseBuf = null;
function noiseBuffer(ctx){
  if (_noiseBuf && _noiseBuf.sampleRate === ctx.sampleRate) return _noiseBuf;
  const len = ctx.sampleRate; const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  _noiseBuf = buf; return buf;
}
const DRUMS = {
  boom: { kick: [1,0,0,0, 0,0,0,1, 0,0,1,0, 0,0,0,0], snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0], hat: [1,0,1,0, 1,0,1,1, 1,0,1,0, 1,0,1,1] },
  rnb:  { kick: [1,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,0,0], snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1], hat: [1,0,1,1, 1,0,1,0, 1,0,1,1, 1,0,1,0] },
  pop:  { kick: [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0], snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0], hat: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0] },
  rock: { kick: [1,0,0,0, 0,0,1,0, 0,1,0,0, 0,0,0,0], snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0], hat: [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1] },
  afro: { kick: [1,0,0,1, 0,0,1,0, 0,1,0,0, 1,0,0,0], snare: [0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,0,0], hat: [1,0,1,0, 1,1,0,1, 1,0,1,0, 1,1,0,1] },
  edm:  { kick: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0], snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1], hat: [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,1] },
  lofi: { kick: [1,0,0,0, 0,0,0,1, 0,0,1,0, 0,0,0,0], snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0], hat: [1,0,0,1, 0,1,0,0, 1,0,0,1, 0,1,0,0] },
};
function drumHit(ctx, dest, t, kind, vol){
  if (kind === 'kick'){
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.12);
    g.gain.setValueAtTime(0.42 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.3);
  } else if (kind === 'snare'){
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.9;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.24 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    src.connect(f); f.connect(g); g.connect(dest); src.start(t); src.stop(t + 0.2);
  } else {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.08 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(f); f.connect(g); g.connect(dest); src.start(t); src.stop(t + 0.08);
  }
}
function crashHit(ctx, dest, t, vol){
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.14 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
  src.connect(f); f.connect(g); g.connect(dest); src.start(t); src.stop(t + 1.0);
}
/* Plucked-string guitar, Karplus-Strong: a burst of noise fed through a
   delay loop tuned to the note. Acoustic = slower decay, electric = faster
   decay with a touch of drive. Works in live and OfflineAudioContext. */
/* Karplus-Strong pluck cache: a pluck buffer is fully determined by
   (midi, dur, style, sampleRate) — the noise seed comes from midi alone —
   so the same pluck is bit-identical every time it is played. Rebuilding it
   sample-by-sample for every guitar note was ~95% of the scheduling cost
   (hundreds of buffers per song, tens of thousands of samples each), which
   froze the main thread for ~half a second on an older phone on every Play.
   Cache it (capped, FIFO) and a song schedules in a few ms after the first bar. */
const _guitarCache = new Map();
function guitarPluckBuffer(ctx, midi, dur, style){
  const sr = ctx.sampleRate;
  const key = sr + '|' + midi + '|' + dur.toFixed(3) + '|' + style;
  const hit = _guitarCache.get(key);
  if (hit) return hit;
  const freq = midiToFreq(midi);
  const len = Math.max(1, Math.floor(dur * sr));
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const N = Math.max(2, Math.round(sr / freq));
  const rng = mulberry32((midi * 2654435761) >>> 0);
  for (let i = 0; i < N && i < len; i++) d[i] = rng() * 2 - 1;
  const decay = style === 'acoustic' ? 0.996 : 0.9935;
  for (let i = N; i < len; i++) d[i] = decay * 0.5 * (d[i - N] + d[i - N + 1 < len ? i - N + 1 : i - N]);
  const fade = Math.floor(sr * 0.08);
  for (let i = 0; i < fade && len - 1 - i >= 0; i++) d[len - 1 - i] *= i / fade;
  if (_guitarCache.size >= 64){ const first = _guitarCache.keys().next().value; _guitarCache.delete(first); }
  _guitarCache.set(key, buf);
  return buf;
}
function guitarNote(ctx, dest, t, midi, dur, style, vol){
  const src = ctx.createBufferSource(); src.buffer = guitarPluckBuffer(ctx, midi, dur, style);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.30 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = style === 'acoustic' ? 4200 : 3400;
  src.connect(f); f.connect(g); g.connect(dest); src.start(t); src.stop(t + dur);
}
function subBassNote(ctx, dest, t, midi, dur, vol){
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(midiToFreq(midi), t); o.frequency.exponentialRampToValueAtTime(midiToFreq(midi) * 0.82, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.30 * vol, t + 0.03);
  g.gain.setValueAtTime(0.30 * vol, t + Math.max(0.05, dur - 0.1)); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
}
function bassNote(ctx, dest, t, midi, dur, vol){
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'triangle'; o.frequency.value = midiToFreq(midi);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22 * vol, t + 0.02);
  g.gain.setValueAtTime(0.22 * vol, t + Math.max(0.05, dur - 0.08)); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
}
function chordPad(ctx, dest, t, midis, dur, kind, vol){
  for (const m of midis){
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'triangle'; o2.type = 'triangle'; /* triangle pads: warm, not buzzy — the sawtooth pad was a big part of the harshness */
    o.frequency.value = midiToFreq(m); o2.frequency.value = midiToFreq(m); o2.detune.value = 5; o.detune.value = -5;
    f.type = 'lowpass'; f.frequency.value = kind === 'pluck' ? 2600 : 1100;
    const a = kind === 'pluck' ? 0.01 : 0.4, rel = kind === 'pluck' ? 0.35 : dur;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06 * vol, t + a);
    g.gain.setValueAtTime(0.06 * vol, t + Math.max(a, dur - 0.15)); g.gain.exponentialRampToValueAtTime(0.001, t + dur + rel * 0.2);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(dest);
    o.start(t); o2.start(t); o.stop(t + dur + 0.3); o2.stop(t + dur + 0.3);
  }
}
/* Lead vocal, built to sound like a real singer in YOUR range, not a beep:
   a doubled voice (main + a slightly detuned double, like a studio double
   track), a formant peak shaped by your base pitch, a short glide into each
   note (portamento — real singers slide, they don't teleport), vibrato on
   longer notes, and a breath of air at the start of soft notes. */
function vocalNote(ctx, dest, t, midi, dur, style, vol, prevMidi, warmHz, send){
  const freq = midiToFreq(midi);
  const prevFreq = prevMidi != null ? midiToFreq(prevMidi) : freq;
  const type = style === 'Soft / airy' ? 'sine' : style === 'Autotune' ? 'square' : 'sawtooth';
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = style === 'Raspy' ? 3600 : clamp((warmHz || 200) * 18, 2400, 4800); f.Q.value = 1.2;
  const formant = ctx.createBiquadFilter();
  formant.type = 'peaking'; formant.frequency.value = clamp((warmHz || 200) * 5, 700, 1500); formant.Q.value = 1.0; formant.gain.value = 2;
  const peak = (style === 'Powerful' ? 0.62 : style === 'Soft / airy' ? 0.42 : 0.55) * vol; /* vocal is the lead: louder than any band element */
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.07);
  g.gain.setValueAtTime(peak, t + Math.max(0.09, dur - 0.14)); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  const sing = (detune, gainMul) => {
    const o = ctx.createOscillator();
    o.type = type;
    if (prevMidi != null && style !== 'Autotune'){ o.frequency.setValueAtTime(prevFreq, t); o.frequency.linearRampToValueAtTime(freq, t + 0.07); }
    else o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    const og = ctx.createGain(); og.gain.value = gainMul;
    if (style !== 'Autotune' && dur > 0.4){
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 5.5; lg.gain.value = 7; lfo.connect(lg); lg.connect(o.detune); lfo.start(t); lfo.stop(t + dur + 0.05);
    }
    o.connect(og); og.connect(formant); o.start(t); o.stop(t + dur + 0.05);
  };
  sing(0, 1); sing(8, 0.35); /* the double track */
  formant.connect(f); f.connect(g); g.connect(dest); if (send) g.connect(send); /* vocal space send */
  if (style === 'Soft / airy' || style === 'Smooth'){
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx); src.loop = true;
    const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 3200; bf.Q.value = 0.6;
    const bg = ctx.createGain(); bg.gain.setValueAtTime(0.0001, t); bg.gain.linearRampToValueAtTime((style === 'Soft / airy' ? 0.035 : 0.02) * vol, t + 0.05); bg.gain.exponentialRampToValueAtTime(0.001, t + Math.min(dur, 0.3));
    src.connect(bf); bf.connect(bg); bg.connect(dest); src.start(t); src.stop(t + Math.min(dur, 0.3) + 0.05);
  }
  if (style === 'Raspy'){
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx); src.loop = true;
    const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 1400; bf.Q.value = 0.7;
    const bg = ctx.createGain(); bg.gain.setValueAtTime(0.0001, t); bg.gain.linearRampToValueAtTime(0.05 * vol, t + 0.06); bg.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bf); bf.connect(bg); bg.connect(dest); src.start(t); src.stop(t + dur + 0.05);
  }
}
/* Vocal space: a short feedback delay send for the lead vocal only, so the
   voice sits in a small room instead of sounding dry and beepy. Created ONCE
   per play/render (a few native nodes) — each vocal note just connects its
   gain to the send as well as to the master, so it adds no per-note nodes
   and cannot reintroduce the v1.2.2 freeze. Returns the send GainNode, or
   null when the context has no DelayNode. */
function createVocalSpace(ctx, master){
  if (!ctx || typeof ctx.createDelay !== 'function' || !master) return null;
  try {
    const send = ctx.createGain(); send.gain.value = 1;
    const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.17;
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    const wet = ctx.createGain(); wet.gain.value = 0.12;
    send.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(master);
    return send;
  } catch (e){ return null; }
}
/* Schedule a whole song into any BaseAudioContext (live or offline).
   Returns { durationSec, lineEvents: [{t, text, line}] } with absolute times.
   Pass opts.barStart / opts.barEnd to schedule only those bars (the live
   lookahead scheduler drives it bar by bar so the Play tap never blocks).
   opts.prevMidi carries the vocal glide across chunks; the returned lastMidi
   is the last melody note scheduled, to pass to the next chunk. When no bar
   range is given the whole song is scheduled in one call (WAV export). */
function scheduleSong(ctx, dest, song, opts){
  const o = opts || {}; const t0 = o.t0 || 0; const fromBeat = o.fromBeat || 0;
  const barStart = (o.barStart != null) ? o.barStart : 0;
  const barEnd = (o.barEnd != null) ? o.barEnd : song.bars;
  const vocalSend = o.vocalSend || null;
  const beat = song.beat; const barSec = 4 * beat;
  const prog = PROGRESSIONS[song.genre] || PROGRESSIONS.Pop;
  const drums = DRUMS[prog.drum] || DRUMS.pop;
  const energyVol = 0.7 + 0.15 * (song.energy || 2);
  /* Full band: only the instruments in the song's lineup play. An empty
     lineup means "Merlin's full band" — never a silent track. */
  const instList = (song.instruments && song.instruments.length ? song.instruments : (song.band || BAND_LINEUPS[song.genre] || BAND_LINEUPS.Pop));
  const inst = new Set(instList);
  const has = name => inst.has(name);
  const hasKeys = has('Piano') || has('Keys') || has('Strings') || has('Synth');
  const sections = song.barSections || [];
  const secOf = bar => sections[bar] || 'verse';
  const totalBeats = song.bars * 4;
  for (let bar = barStart; bar < Math.min(barEnd, song.bars); bar++){
    /* Humanize per bar, seeded by song + bar: a bar-by-bar (lookahead)
       schedule then sounds identical to a full schedule, and the jitter
       never repeats identically every bar. */
    const hrng = mulberry32((hashStr(song.id || 'song') + bar) >>> 0);
    const barStartBeat = bar * 4; const barT = t0 + (barStartBeat - fromBeat) * beat;
    if (barT + barSec < t0) continue;
    const barVol = energyVol * (SECTION_GAIN[secOf(bar)] || 1);
    const isSectionStart = bar === 0 || secOf(bar) !== secOf(bar - 1);
    const isLastBarOfSection = bar + 1 < song.bars && secOf(bar + 1) !== secOf(bar);
    const chord = song.chords[bar];
    if (chord){
      if (hasKeys){
        const padKind = has('Piano') && !has('Strings') && !has('Synth') ? 'pluck' : 'pad';
        chordPad(ctx, dest, Math.max(t0, barT), chord.tones, barSec, padKind, barVol);
      }
      if (has('Bass')){
        bassNote(ctx, dest, Math.max(t0, barT), chord.rootMidi - 24, barSec * 0.9, barVol);
        bassNote(ctx, dest, Math.max(t0, barT + barSec / 2), chord.rootMidi - 12 + 7, barSec * 0.4, barVol * 0.7); /* walk up to the fifth */
      }
      if (has('808s')){
        subBassNote(ctx, dest, Math.max(t0, barT), chord.rootMidi - 24, barSec * 0.9, barVol);
      }
      if (has('Guitar')){
        const gStyle = song.guitarStyle || 'electric clean';
        const strums = song.genre === 'Rock' ? [0, 2, 4, 6, 8, 10, 12, 14] : song.genre === 'Country' || song.genre === 'Lo-fi' ? [0, 4, 8, 12] : [0, 4, 8, 12];
        strums.forEach((s, si) => {
          const gt = Math.max(t0, barT + s * (barSec / 16));
          const tone = chord.tones[(si + (s % 3)) % chord.tones.length];
          guitarNote(ctx, dest, gt, tone + 12, barSec / strums.length * 1.8, gStyle, barVol * 0.9);
        });
      }
      if (isSectionStart && has('Drums')) crashHit(ctx, dest, Math.max(t0, barT), barVol);
    }
    if (has('Drums')){
      for (let step = 0; step < 16; step++){
        const st = barT + step * (barSec / 16) + (hrng() - 0.5) * 0.016; if (st < t0) continue;
        const v = barVol * (0.85 + hrng() * 0.15); /* no robot drummer: every hit lands a little differently */
        if (drums.kick[step]) drumHit(ctx, dest, st, 'kick', v);
        if (drums.snare[step]) drumHit(ctx, dest, st, 'snare', v);
        if (drums.hat[step]) drumHit(ctx, dest, st, 'hat', v * 0.9);
      }
      if (isLastBarOfSection){
        const ft = barT + 12 * (barSec / 16);
        drumHit(ctx, dest, Math.max(t0, ft), 'snare', barVol);
        drumHit(ctx, dest, Math.max(t0, ft + barSec / 16), 'snare', barVol);
        drumHit(ctx, dest, Math.max(t0, ft + 2 * (barSec / 16)), 'kick', barVol);
        drumHit(ctx, dest, Math.max(t0, ft + 3 * (barSec / 16)), 'snare', barVol * 1.1);
      }
    }
  }
  const lineEvents = [];
  let prevMidi = (o.prevMidi != null) ? o.prevMidi : null; /* glide across chunks */
  if (!song.instrumental){
    for (const n of song.melody){
      if (n.startBeat < barStart * 4 || n.startBeat >= barEnd * 4) continue; /* this chunk only */
      const nt = t0 + (n.startBeat - fromBeat) * beat; if (nt + n.dur * beat < t0) continue;
      const line = song.lineEvents[n.line];
      const secVol = energyVol * (SECTION_GAIN[line ? line.section : 'verse'] || 1);
      vocalNote(ctx, dest, Math.max(t0, nt), n.midi, n.dur * beat, song.vocalStyle, secVol, prevMidi, song.voiceHz || 0, vocalSend);
      if (line && /chorus/i.test(line.section)){
        vocalNote(ctx, dest, Math.max(t0, nt), n.midi + 4, n.dur * beat, song.vocalStyle, secVol * 0.28, null, song.voiceHz || 0, vocalSend);
        if (n.lift) vocalNote(ctx, dest, Math.max(t0, nt), n.midi + 7, n.dur * beat, song.vocalStyle, secVol * 0.16, null, song.voiceHz || 0, vocalSend);
      }
      prevMidi = n.midi;
    }
  }
  for (const le of song.lineEvents){
    if (le.startBeat < barStart * 4 || le.startBeat >= barEnd * 4) continue; /* this chunk only */
    lineEvents.push({ t: t0 + (le.startBeat - fromBeat) * beat, end: t0 + (le.endBeat - fromBeat) * beat, text: le.text, section: le.section });
  }
  return { durationSec: totalBeats * beat, lineEvents, lastMidi: prevMidi };
}
/* --- WAV export: render offline, encode 16-bit PCM --- */
function encodeWAV(buffer){
  const nCh = buffer.numberOfChannels, sr = buffer.sampleRate, len = buffer.length * nCh * 2 + 44;
  const out = new ArrayBuffer(len), v = new DataView(out);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, 'RIFF'); v.setUint32(4, len - 8, true); wstr(8, 'WAVE'); wstr(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * nCh * 2, true); v.setUint16(32, nCh * 2, true);
  v.setUint16(34, 16, true); wstr(36, 'data'); v.setUint32(40, len - 44, true);
  const chans = []; for (let c = 0; c < nCh; c++) chans.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < buffer.length; i++) for (let c = 0; c < nCh; c++){
    const s = clamp(chans[c][i], -1, 1); v.setInt16(off, s < 0 ? s * 32768 : s * 32767, true); off += 2;
  }
  return new Blob([out], { type: 'audio/wav' });
}
async function renderSongWav(song){
  const dur = song.bars * 4 * song.beat + 0.5;
  const off = new OfflineAudioContext(2, Math.ceil(dur * 44100), 44100);
  const master = off.createGain(); master.gain.value = 0.47; master.connect(off.destination);
  const vocalSend = createVocalSpace(off, master);
  scheduleSong(off, master, song, { t0: 0.05, vocalSend });
  const buf = await off.startRendering();
  return encodeWAV(buf);
}

/* ================= APP STATE + STORAGE ================= */
const $ = id => document.getElementById(id);
const store = {
  get(k, fb){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e){ return fb; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch (e){} },
};
let songs = store.get('asm_songs_v1', []);
let voiceProfile = store.get('asm_voice_v1', null);
let audioRef = store.get('asm_audioref_v1', null);
let currentSong = null, currentFilter = 'All', libraryQuery = '';
let settings = { genre: 'Pop', mood: 'Happy', tempo: 100, key: 'A minor', durationTarget: 80, energy: 2, vocalStyle: 'Smooth', instruments: ['Drums', 'Bass', 'Guitar', 'Piano', 'Synth'], guitarStyle: 'electric clean', variety: 3, instrumental: false, mode: 'advanced' };
let toastTimer = null;
function toast(msg){ const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2600); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function saveSongs(){ store.set('asm_songs_v1', songs); }
function coverStyle(song){ const h = song.hue || 200; return `background:linear-gradient(135deg,hsl(${h},72%,52%),hsl(${(h + 45) % 360},70%,34%))`; }
function songSub(song){ return [song.genre, song.mood, (song.styleDesc || '').split(',')[0]].filter(Boolean).join(' · '); }

/* ================= NAV ================= */
function showView(name){
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = $('view-' + name); if (el) el.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.nav === name));
  if (name === 'library') renderLibrary();
  if (name === 'home') renderHome();
  if (name === 'search'){ renderSearch(); setTimeout(() => $('searchInput').focus(), 60); }
  window.scrollTo(0, 0);
}
function wireNav(){ document.querySelectorAll('.nav-item').forEach(b => b.addEventListener('click', () => showView(b.dataset.nav))); }

/* ================= CREATE SCREEN ================= */
function buildChips(){
  const gc = $('genreChips'); gc.innerHTML = '';
  GENRES.forEach(g => {
    const b = document.createElement('button'); b.className = 'chip' + (g === settings.genre ? ' active' : ''); b.textContent = g;
    b.addEventListener('click', () => {
      settings.genre = g; settings.tempo = PROGRESSIONS[g].tempo;
      $('tempo').value = settings.tempo; $('tempoOut').textContent = settings.tempo + ' BPM';
      $('styleTag').textContent = pickStyleTag(g);
      buildChips();
      applyPickIfAuto();
    });
    gc.appendChild(b);
  });
  const ic = $('instChips'); ic.innerHTML = '';
  INSTRUMENTS.forEach(ins => {
    const b = document.createElement('button'); b.className = 'chip' + (settings.instruments.includes(ins) ? ' active' : ''); b.textContent = ins;
    b.addEventListener('click', () => {
      const i = settings.instruments.indexOf(ins);
      if (i >= 0) settings.instruments.splice(i, 1); else settings.instruments.push(ins);
      buildChips();
    });
    ic.appendChild(b);
  });
  /* Band tab mirrors the same lineup — same settings, same toggles. */
  const bc = $('bandChips');
  if (bc){
    bc.innerHTML = '';
    INSTRUMENTS.forEach(ins => {
      const b = document.createElement('button'); b.className = 'chip' + (settings.instruments.includes(ins) ? ' active' : ''); b.textContent = ins;
      b.addEventListener('click', () => {
        const i = settings.instruments.indexOf(ins);
        if (i >= 0) settings.instruments.splice(i, 1); else settings.instruments.push(ins);
        buildChips();
      });
      bc.appendChild(b);
    });
  }
}
/* ---- Merlin Smart Pick UI: show the pick, apply it, or let the user override ---- */
function currentPick(){
  return smartPick(settings.genre, settings.mood, ($('lyricsBox') ? $('lyricsBox').value : ''), settings.energy);
}
function refreshPick(){
  const p = currentPick();
  if ($('pickText')) $('pickText').textContent = p.reason + '.';
  if ($('guitarStyleOut')) $('guitarStyleOut').textContent = 'Guitar: ' + p.guitarStyle;
  return p;
}
function applyPick(announce){
  const p = refreshPick();
  settings.tempo = p.tempo; settings.key = p.key;
  settings.instruments = p.instruments.slice();
  settings.vocalStyle = p.vocalStyle; settings.guitarStyle = p.guitarStyle;
  $('tempo').value = p.tempo; $('tempoOut').textContent = p.tempo + ' BPM';
  $('keySel').value = p.key; $('vocalStyle').value = p.vocalStyle;
  buildChips();
  if (announce) toast('Merlin picked: ' + p.tempo + ' BPM, ' + p.key + ' ✦');
  return p;
}
function applyPickIfAuto(){
  if ($('pickAuto') && $('pickAuto').checked) applyPick(false);
  else refreshPick();
}
function showCreateTab(name){
  document.querySelectorAll('.ctab').forEach(b => b.classList.toggle('active', b.dataset.ctab === name));
  document.querySelectorAll('.ctab-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'ctab-' + name));
  if (name === 'band') refreshPick();
  if (name === 'voice') renderVoiceTab();
}
function renderVoiceTab(){
  const el = $('voiceTabStatus'); if (!el) return;
  el.textContent = voiceProfile
    ? `Voice ready ✓ — base pitch ${Math.round(voiceProfile.baseHz)} Hz, songs tune to your range.`
    : 'No voice profile yet — songs use a neutral pitch until you record.';
}
function pickStyleTag(genre){
  return { 'Hip-hop': 'punchy', 'R&B': 'smooth', 'Pop': 'anthemic', 'Rock': 'raw', 'Country': 'smooth', 'Afrobeats': 'euphoric', 'EDM': 'euphoric', 'Lo-fi': 'dreamy', 'Gospel': 'anthemic' }[genre] || 'ethereal';
}
function wireCreate(){
  document.querySelectorAll('[data-collapse]').forEach(btn => btn.addEventListener('click', () => {
    $(btn.dataset.collapse).classList.toggle('closed');
  }));
  $('modeBtn').addEventListener('click', e => { e.stopPropagation(); $('modeMenu').classList.toggle('hidden'); });
  document.addEventListener('click', () => $('modeMenu').classList.add('hidden'));
  document.querySelectorAll('#modeMenu button').forEach(b => b.addEventListener('click', () => {
    settings.mode = b.dataset.mode;
    $('modeBtn').firstChild.textContent = settings.mode === 'simple' ? 'Simple Song ' : 'Advanced Song ';
    $('moreCard').classList.toggle('closed', settings.mode === 'simple');
    $('moreCard').style.display = settings.mode === 'simple' ? 'none' : '';
    toast(settings.mode === 'simple' ? 'Simple Song — just lyrics + style' : 'Advanced Song — all options');
  }));
  document.querySelectorAll('.ctab').forEach(b => b.addEventListener('click', () => showCreateTab(b.dataset.ctab)));
  $('btnUsePick').addEventListener('click', () => { applyPick(true); showCreateTab('band'); });
  $('btnPickManual').addEventListener('click', () => {
    if ($('pickAuto')) $('pickAuto').checked = false;
    refreshPick(); toast('Your call — set tempo, key and band yourself');
  });
  $('pickAuto').addEventListener('change', e => { if (e.target.checked) applyPick(true); else refreshPick(); });
  $('btnVoiceTabRecord').addEventListener('click', () => showView('profile'));
  $('btnVoiceTabProfile').addEventListener('click', () => showView('profile'));
  $('modelPill').addEventListener('click', () => toast('Merlin v1 — Merlin builds your songs in the app'));
  $('btnAudio').addEventListener('click', () => $('audioFile').click());
  $('audioFile').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    $('audioRefName').textContent = f.name.length > 22 ? f.name.slice(0, 20) + '…' : f.name;
    $('btnAudio').classList.add('on');
    try {
      const buf = await f.arrayBuffer();
      const actx = new (window.AudioContext || window.webkitAudioContext)();
      const decoded = await actx.decodeAudioData(buf);
      const hz = analysePitch(decoded);
      audioRef = { name: f.name, baseHz: hz, seconds: Math.round(decoded.duration) };
      store.set('asm_audioref_v1', audioRef);
      toast(hz ? `Reference saved — tuned near ${Math.round(hz)} Hz` : 'Reference saved');
      actx.close();
    } catch (err){ audioRef = { name: f.name, baseHz: 0, seconds: 0 }; store.set('asm_audioref_v1', audioRef); toast('Reference saved (pitch not readable)'); }
  });
  $('btnVoice').addEventListener('click', () => {
    showView('profile');
    toast(voiceProfile ? `Your voice is on — songs tune to ${Math.round(voiceProfile.baseHz)} Hz` : 'Record your voice — 15 to 60 seconds');
  });
  $('btnLyricsWand').addEventListener('click', () => {
    const txt = $('lyricsBox').value.trim();
    const lines = txt.split('\n').filter(l => l.trim());
    if (lines.length >= 4){ toast('Keeping your lyrics exactly as written'); showLyricsPreview(txt); return; }
    const prompt = txt || $('stylesBox').value.trim() || 'a song about tonight';
    const lyrics = generateLyrics(prompt, $('mood').value, settings.genre, hashStr(prompt + settings.genre));
    $('lyricsBox').value = lyrics; showLyricsPreview(lyrics); toast('Merlin wrote your lyrics ✦');
  });
  $('btnLyricsLibrary').addEventListener('click', () => {
    const starters = ['Sunday morning, no rush, just us', 'City lights and a heart that won\'t slow down', 'I left it all behind for a better day', 'Dancing in the kitchen like nobody\'s watching'];
    const s = starters[Math.floor(Math.random() * starters.length)];
    $('lyricsBox').value = ($('lyricsBox').value ? $('lyricsBox').value + '\n' : '') + s;
    toast('Lyric idea added');
  });
  $('btnInstrumental').addEventListener('click', () => {
    settings.instrumental = !settings.instrumental;
    $('btnInstrumental').classList.toggle('off', !settings.instrumental);
    $('btnInstrumental').setAttribute('aria-pressed', String(settings.instrumental));
    toast(settings.instrumental ? 'Instrumental — no vocal track' : 'Vocals on');
  });
  const expand = (ta) => { ta.style.minHeight = ta.style.minHeight === '220px' ? '' : '220px'; };
  $('btnLyricsExpand').addEventListener('click', () => expand($('lyricsBox')));
  $('btnStylesExpand').addEventListener('click', () => expand($('stylesBox')));
  $('btnStylesWand').addEventListener('click', () => {
    const d = describeStyle(settings.genre, $('mood').value) + ', ' + $('styleTag').textContent + ' feel';
    $('stylesBox').value = d; toast('Merlin suggested a style ✦');
  });
  $('btnStylesRefresh').addEventListener('click', () => {
    settings.genre = GENRES[Math.floor(Math.random() * GENRES.length)];
    $('mood').selectedIndex = Math.floor(Math.random() * $('mood').options.length);
    $('styleTag').textContent = STYLE_TAGS[Math.floor(Math.random() * STYLE_TAGS.length)];
    buildChips(); $('btnStylesWand').click();
  });
  $('btnStylesLibrary').addEventListener('click', () => {
    $('stylesBox').value = describeStyle(settings.genre, $('mood').value);
    toast('Style preset loaded');
  });
  $('styleTag').addEventListener('click', () => {
    const i = STYLE_TAGS.indexOf($('styleTag').textContent);
    const next = STYLE_TAGS[(i + 1) % STYLE_TAGS.length];
    $('styleTag').textContent = next;
    if ($('stylesBox').value && !$('stylesBox').value.includes(next)) $('stylesBox').value += ', ' + next;
  });
  $('tempo').addEventListener('input', e => { settings.tempo = +e.target.value; $('tempoOut').textContent = settings.tempo + ' BPM'; });
  $('energy').addEventListener('input', e => { settings.energy = +e.target.value; $('energyOut').textContent = ['Low', 'Medium', 'High'][settings.energy - 1]; });
  $('varietyRange').addEventListener('input', e => { settings.variety = +e.target.value; $('varietyLabel').textContent = ['Very low', 'Low', 'Normal', 'High', 'Wild'][settings.variety - 1]; });
  $('mood').addEventListener('change', e => { settings.mood = e.target.value; applyPickIfAuto(); });
  $('keySel').addEventListener('change', e => { settings.key = e.target.value; });
  $('duration').addEventListener('change', e => { settings.durationTarget = +e.target.value; });
  $('vocalStyle').addEventListener('change', e => { settings.vocalStyle = e.target.value; });
  $('btnCreate').addEventListener('click', createSong);
}
function showLyricsPreview(text){
  const parsed = parseLyrics(text);
  $('lyricsPreviewWrap').classList.remove('hidden');
  $('lyricsPreview').innerHTML = parsed.sections.map(s =>
    `<div class="sec">[${esc(s.name.toUpperCase())}]</div>` + s.lines.map(esc).join('\n')).join('\n\n');
}
function setProgress(pct, label){
  $('progress').classList.remove('hidden');
  $('progressBar').style.width = pct + '%';
  $('progressLabel').textContent = label;
  const p = $('progressPct'); if (p) p.textContent = Math.round(pct) + '%';
}
/* Reveal the lyrics section by section so the user watches the song being
   written instead of staring at a frozen block. Yields between sections so
   the UI actually repaints and the progress bar moves. */
async function revealLyricsProgressive(text){
  const parsed = parseLyrics(text);
  $('lyricsPreviewWrap').classList.remove('hidden');
  $('lyricsPreview').innerHTML = '';
  const total = Math.max(1, parsed.sections.length);
  for (let i = 0; i < parsed.sections.length; i++){
    const s = parsed.sections[i];
    $('lyricsPreview').innerHTML += `<div class="sec">[${esc(s.name.toUpperCase())}]</div>` + s.lines.map(esc).join('\n') + '\n\n';
    setProgress(5 + Math.round(25 * (i + 1) / total), 'Writing lyrics… ' + s.name);
    await sleep(160); /* yield so the lines actually appear + the bar moves */
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* Song creation, in visible steps with a progress % and a status line —
   never one frozen block. Each stage names what is being written right now
   and yields (await) so the UI repaints and the bar actually moves.
   THREADING NOTE: no Web Worker here. After the guitar-buffer cache and the
   incremental lookahead scheduler, the remaining per-step main-thread work
   is a few milliseconds (buildSong ~1-2ms, one bar ~1-3ms), so there is
   nothing heavy left to offload — and a Blob-URL worker is unreliable in
   this Capacitor WebView. The work is chunked with yields instead, which is
   what keeps the UI responsive on this phone. */
async function createSong(){
  const btn = $('btnCreate'); if (btn.disabled) return;
  /* Warm up audio NOW, inside the tap — Android blocks audio started
     after the ~2s of lyric/melody work that follows. */
  warmAudio();
  let lyrics = $('lyricsBox').value.trim();
  const prompt = lyrics || $('stylesBox').value.trim() || $('songTitle').value.trim();
  if (!prompt){ toast('Write lyrics or a prompt first'); $('lyricsBox').focus(); return; }
  btn.disabled = true;
  try {
    /* 1 — lyrics (5-30%): the lines appear section by section. */
    setProgress(5, 'Writing lyrics…'); await sleep(120);
    if (!lyrics || lyrics.split('\n').filter(l => l.trim()).length < 4){
      lyrics = generateLyrics(prompt, $('mood').value, settings.genre, hashStr(prompt + settings.genre + settings.variety + Date.now()));
      $('lyricsBox').value = lyrics;
    }
    await revealLyricsProgressive(lyrics);
    setProgress(30, 'Lyrics done — ' + lyrics.split('\n').filter(l => l.trim()).length + ' lines'); await sleep(140);
    /* 2 — melody + chords (35-55%): buildSong is the real composition work. */
    setProgress(35, 'Composing melody…'); await sleep(140);
    const seed = hashStr(prompt + settings.genre + settings.variety) + Math.floor(Math.random() * 1e6);
    const song = buildSong({
      title: $('songTitle').value.trim() || titleFromPrompt(prompt),
      genre: settings.genre, mood: $('mood').value, tempo: settings.tempo, key: settings.key,
      durationTarget: settings.durationTarget, energy: settings.energy, vocalStyle: settings.vocalStyle,
      instruments: settings.instruments, smartPick: currentPick(), guitarStyle: settings.guitarStyle || currentPick().guitarStyle,
      styleDesc: $('stylesBox').value.trim() || describeStyle(settings.genre, $('mood').value),
      variety: settings.variety, instrumental: settings.instrumental, seed,
      audioRefName: audioRef ? audioRef.name : '',
    }, lyrics, voiceProfile);
    setProgress(55, 'Melody done — ' + song.melody.length + ' notes in ' + song.key + ' · ' + song.tempo + ' BPM'); await sleep(140);
    /* 3 — drums + band (60-75%). */
    setProgress(62, 'Building drums…'); await sleep(140);
    const drumName = (PROGRESSIONS[song.genre] || PROGRESSIONS.Pop).drum;
    setProgress(72, 'Drums ready — ' + drumName + ' beat · ' + song.instruments.join(', ')); await sleep(140);
    /* 4 — vocals (80-92%). */
    setProgress(80, 'Shaping vocals…'); await sleep(140);
    const vRange = song.voiceRange ? midiToName(song.voiceRange.low) + '–' + midiToName(song.voiceRange.high) : song.vocalStyle;
    setProgress(90, 'Vocals tuned — ' + song.vocalStyle + ' · range ' + vRange); await sleep(140);
    /* 5 — save + show (100%). */
    songs.unshift(song); saveSongs();
    setProgress(100, 'Done — tap Play to hear it'); await sleep(220);
    $('progress').classList.add('hidden');
    renderLibrary(); renderHome();
    /* Do NOT auto-play here: this runs ~2s after the Create tap, outside
       the user gesture, so Android's WebView will not let the audio start
       and Play looks broken. Show the song and let Kodi tap Play himself —
       that tap IS a gesture, and the watchdog below verifies the engine. */
    openSong(song.id);
    toast('Your song is ready 🎵 — tap Play to hear it');
  } catch (err){ console.error(err); toast('Something went wrong — try again'); $('progress').classList.add('hidden'); }
  btn.disabled = false;
}

/* ================= LIBRARY / HOME / SEARCH ================= */
function songRowHTML(song){
  return `<button class="song-row" data-song="${song.id}">
    <span class="cover" style="${coverStyle(song)}">${esc(song.title.charAt(0).toUpperCase() || '♪')}<span class="dur">${fmtTime(song.durationSec)}</span></span>
    <span class="info"><span class="title">${esc(song.title)} <span class="ver">M1</span></span>
    <span class="sub">${esc(songSub(song))}</span></span>
    <span class="dots" data-menu="${song.id}" aria-label="Song options">⋮</span>
  </button>`;
}
function filteredSongs(){
  let list = songs.slice();
  if (currentFilter === 'Liked') list = list.filter(s => s.favorite);
  if (currentFilter === 'Newest') list.sort((a, b) => b.createdAt - a.createdAt);
  if (libraryQuery){
    const q = libraryQuery.toLowerCase();
    list = list.filter(s => (s.title + ' ' + s.genre + ' ' + s.mood + ' ' + s.styleDesc + ' ' + s.lyrics).toLowerCase().includes(q));
  }
  return list;
}
function renderLibrary(){
  const list = filteredSongs();
  $('libraryList').innerHTML = list.map(songRowHTML).join('');
  $('libraryEmpty').classList.toggle('hidden', list.length > 0);
  $('likedCount').textContent = songs.filter(s => s.favorite).length + (songs.filter(s => s.favorite).length === 1 ? ' song' : ' songs');
  $('plCount').textContent = songs.length + (songs.length === 1 ? ' song' : ' songs');
  $('albCount').textContent = new Set(songs.map(s => s.genre)).size + (new Set(songs.map(s => s.genre)).size === 1 ? ' style' : ' styles');
  $('filterLabel').textContent = currentFilter === 'All' ? 'Filter' : currentFilter;
  wireSongRows($('libraryList'));
}
function renderHome(){
  const gg = $('genreGrid'); gg.innerHTML = '';
  const hues = { 'Hip-hop': [280, 340], 'R&B': [260, 200], 'Pop': [330, 20], 'Rock': [0, 40], 'Country': [35, 15], 'Afrobeats': [150, 40], 'EDM': [190, 280], 'Lo-fi': [220, 160], 'Gospel': [45, 280] };
  GENRES.forEach(g => {
    const h = hues[g] || [250, 300];
    const b = document.createElement('button'); b.className = 'genre-tile';
    b.style.background = `linear-gradient(135deg,hsl(${h[0]},70%,50%),hsl(${h[1]},70%,42%))`;
    b.innerHTML = `${esc(g)}<small>${PROGRESSIONS[g].tempo} BPM · ${PROGRESSIONS[g].minor ? 'minor' : 'major'}</small>`;
    b.addEventListener('click', () => { settings.genre = g; settings.tempo = PROGRESSIONS[g].tempo; $('tempo').value = settings.tempo; $('tempoOut').textContent = settings.tempo + ' BPM'; buildChips(); showView('create'); toast(g + ' loaded — hit Create'); });
    gg.appendChild(b);
  });
  const starters = [
    { idea: 'Sunday morning with my girl, no stress, just us', genre: 'R&B' },
    { idea: 'Chasing a dream that won\'t let me sleep', genre: 'Hip-hop' },
    { idea: 'Dancing in the kitchen like nobody\'s watching', genre: 'Pop' },
  ];
  $('starterGrid').innerHTML = starters.map((s, i) =>
    `<button class="song-row" data-starter="${i}"><span class="cover" style="background:linear-gradient(135deg,#3b2a6b,#7c2d5e)">✦</span>
    <span class="info"><span class="title">${esc(s.idea)}</span><span class="sub">${esc(s.genre)} · tap to start this song</span></span></button>`).join('');
  $('starterGrid').querySelectorAll('[data-starter]').forEach(b => b.addEventListener('click', () => {
    const s = starters[+b.dataset.starter];
    $('lyricsBox').value = s.idea; settings.genre = s.genre; buildChips(); showView('create'); toast('Starter loaded — tap the wand or Create');
  }));
  const recent = songs.slice(0, 3);
  $('recentList').innerHTML = recent.length ? recent.map(songRowHTML).join('') : '<p class="muted">Nothing yet — your first song will show up here.</p>';
  wireSongRows($('recentList'));
}
function renderSearch(){
  const q = ($('searchInput').value || '').trim();
  libraryQuery = q;
  const list = q ? filteredSongs() : [];
  $('searchResults').innerHTML = !q ? '<p class="muted" style="margin-top:14px">Type to search your songs by title, genre, mood or lyrics.</p>'
    : list.length ? list.map(songRowHTML).join('') : '<p class="muted" style="margin-top:14px">No songs match “' + esc(q) + '”.</p>';
  wireSongRows($('searchResults'));
}
function wireSongRows(root){
  if (!root) return;
  root.querySelectorAll('.song-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('[data-menu]')){ openRowMenu(e.target.closest('[data-menu]')); return; }
      openSong(row.dataset.song);
    });
  });
}
function closeMenu(){ const m = document.querySelector('.menu-pop'); if (m) m.remove(); }
function openRowMenu(btn){
  closeMenu();
  const id = btn.dataset.menu; const song = songs.find(s => s.id === id); if (!song) return;
  const r = btn.getBoundingClientRect();
  const m = document.createElement('div'); m.className = 'menu-pop';
  m.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  m.style.top = Math.min(window.innerHeight - 260, r.bottom + 6) + 'px';
  m.innerHTML = `<button data-a="play">▶ Play</button><button data-a="fav">${song.favorite ? '♥ Liked — remove' : '♡ Add to Liked'}</button>
    <button data-a="remix">✦ Remix</button><button data-a="extend">＋ Extend</button>
    <button data-a="wav">↓ Download WAV</button><button data-a="del" class="danger">🗑 Delete</button>`;
  document.body.appendChild(m);
  m.addEventListener('click', async e => {
    const a = e.target.closest('button'); if (!a) return; closeMenu();
    if (a.dataset.a === 'play'){ openSong(id); playSong(song); }
    if (a.dataset.a === 'fav'){ song.favorite = !song.favorite; saveSongs(); renderLibrary(); renderHome(); toast(song.favorite ? 'Added to Liked ♥' : 'Removed from Liked'); }
    if (a.dataset.a === 'remix') remixSong(song);
    if (a.dataset.a === 'extend') extendSong(song);
    if (a.dataset.a === 'wav') downloadWav(song);
    if (a.dataset.a === 'del'){ songs = songs.filter(s => s.id !== id); saveSongs(); renderLibrary(); renderHome(); closeSheet(); toast('Song deleted'); }
  });
  setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 10);
}
function remixSong(song){
  settings.genre = song.genre; settings.tempo = song.tempo; settings.key = song.key;
  settings.durationTarget = song.durationSec <= 50 ? 45 : song.durationSec <= 90 ? 80 : song.durationSec <= 130 ? 120 : 150;
  settings.energy = song.energy; settings.vocalStyle = song.vocalStyle; settings.instruments = song.instruments.slice();
  $('lyricsBox').value = song.lyrics; $('songTitle').value = song.title + ' (Remix)';
  $('tempo').value = song.tempo; $('tempoOut').textContent = song.tempo + ' BPM';
  $('keySel').value = song.key; $('duration').value = String(settings.durationTarget);
  $('energy').value = song.energy; $('energyOut').textContent = ['Low', 'Medium', 'High'][song.energy - 1];
  $('vocalStyle').value = song.vocalStyle; $('mood').value = song.mood;
  buildChips(); showLyricsPreview(song.lyrics); showView('create');
  toast('Remix loaded — hit Create for a fresh take');
}
function extendSong(song){
  const next = song.durationSec <= 50 ? 80 : song.durationSec <= 90 ? 120 : 150;
  const ext = buildSong({ title: song.title + ' (Extended)', genre: song.genre, mood: song.mood, tempo: song.tempo, key: song.key, durationTarget: next, energy: song.energy, vocalStyle: song.vocalStyle, instruments: song.instruments, styleDesc: song.styleDesc, variety: song.variety + 1, instrumental: song.instrumental, seed: song.seed + 7, audioRefName: song.audioRefName }, song.lyrics, voiceProfile);
  ext.favorite = song.favorite; songs.unshift(ext); saveSongs(); renderLibrary(); renderHome();
  openSong(ext.id); toast('Extended to ~' + fmtTime(ext.durationSec));
}
async function downloadWav(song){
  toast('Rendering WAV…');
  try {
    const blob = await renderSongWav(song);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = song.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.wav';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('WAV downloaded');
  } catch (err){ console.error(err); toast('WAV render failed — try playing it first'); }
}

/* ================= SONG DETAIL SHEET ================= */
function openSong(id){
  const song = songs.find(s => s.id === id); if (!song) return;
  currentSong = song;
  $('sheetBody').innerHTML = `
    <div class="detail-cover" style="${coverStyle(song)}">${esc(song.title.charAt(0).toUpperCase())}</div>
    <h2 style="font-size:22px">${esc(song.title)} <span style="color:var(--ver);font-size:13px">M1</span></h2>
    <p class="muted">${esc(songSub(song))} · ${song.tempo} BPM · ${fmtTime(song.durationSec)} · ${song.plays} plays</p>
    <div class="sheet-actions">
      <button class="btn" data-sheet="play">▶ Play</button>
      <button class="btn ghost" data-sheet="wav">↓ WAV</button>
      <button class="btn ghost" data-sheet="fav">${song.favorite ? '♥ Liked' : '♡ Like'}</button>
      <button class="btn ghost" data-sheet="remix">✦ Remix</button>
      <button class="btn ghost" data-sheet="extend">＋ Extend</button>
    </div>
    <p class="muted small" id="audioDiag" style="margin-top:10px">Audio: —</p>
    <h3 style="margin-top:18px">Lyrics</h3>
    <div class="detail-lyrics" id="detailLyrics">${(() => {
      let out = '', lastSec = '';
      song.lineEvents.forEach((le, i) => {
        if (le.section !== lastSec){ out += `<span style="color:var(--gold-1);font-weight:700;font-size:12px">[${esc(le.section.toUpperCase())}]</span>\n`; lastSec = le.section; }
        out += `<span data-line="${i}">${esc(le.text)}</span>\n`;
      });
      return out;
    })()}</div>`;
  $('songSheet').classList.remove('hidden');
  renderAudioDiag();
  $('sheetBody').querySelectorAll('[data-sheet]').forEach(b => b.addEventListener('click', async () => {
    const a = b.dataset.sheet;
    if (a === 'play') playSong(song);
    if (a === 'wav') downloadWav(song);
    if (a === 'fav'){ song.favorite = !song.favorite; saveSongs(); renderLibrary(); renderHome(); openSong(id); }
    if (a === 'remix'){ closeSheet(); remixSong(song); }
    if (a === 'extend'){ closeSheet(); extendSong(song); }
  }));
}
function closeSheet(){ $('songSheet').classList.add('hidden'); }

/* ================= PLAYER ================= */
let audioCtx = null, songGain = null, playState = null, playTimer = null, playWatchdogTimer = null, schedTimer = null;
/* Lookahead scheduler: schedule one bar at a time, ~1s ahead of playback,
   on a 150ms tick. The Play tap then only schedules the first bar (a few ms)
   and returns immediately, instead of blocking the main thread while the
   whole song (~8-11k nodes) is scheduled at once. */
const SCHED_TICK_MS = 150;
const LOOKAHEAD_SEC = 1.0;
/* One long-lived AudioContext for the whole app. Android's WebView blocks
   audio that starts without a tap, so the context is created + resumed
   synchronously inside tap handlers (warmAudio) — never after an async
   wait, and never closed and recreated between songs. */
/* How long after scheduling we check that the clock is really moving.
   On some Android WebViews a context reports state 'running' yet its
   currentTime never advances — the notes are scheduled but nothing ever
   sounds, so Play looks stuck. The watchdog below catches exactly that. */
const PLAY_WATCHDOG_MS = 1000;
function ensureCtx(){
  if (!audioCtx){
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e){ toast('This phone blocked audio — try closing and reopening the app'); return null; }
  }
  return audioCtx;
}
function warmAudio(){
  const ctx = ensureCtx();
  if (ctx && ctx.state === 'suspended'){ try { ctx.resume(); } catch (e){} }
  return ctx;
}
/* One-line audio diagnostic for the song sheet: engine state + clock
   time, so Kodi can report exactly what the engine is doing when Play
   fails. Updated on open, on every player tick, and by the watchdog. */
function audioDiagText(){
  if (!audioCtx) return 'Audio: no engine yet — tap Play';
  const st = audioCtx.state;
  let t = NaN;
  try { t = audioCtx.currentTime; } catch (e){}
  const tTxt = isFinite(t) ? t.toFixed(2) + 's' : 'n/a';
  if (playState){
    const el = t - playState.t0;
    return 'Audio: ' + st + ' · time ' + tTxt + ' · ' + (el >= 0 ? fmtTime(el) + ' into song' : 'starting…');
  }
  return 'Audio: ' + st + ' · time ' + tTxt;
}
function renderAudioDiag(){
  const el = $('audioDiag');
  if (el) el.textContent = audioDiagText();
}
function clearPlayWatchdog(){ if (playWatchdogTimer){ clearTimeout(playWatchdogTimer); playWatchdogTimer = null; } }
function clearSchedTimer(){ if (schedTimer){ clearInterval(schedTimer); schedTimer = null; } }
function stopPlayback(){
  if (playTimer){ clearInterval(playTimer); playTimer = null; }
  clearPlayWatchdog();
  clearSchedTimer();
  /* Disconnect the song's gain — the old notes finish silently into nothing.
     Never close the context: a fresh context made outside a tap starts
     suspended on Android and the next play does nothing. */
  if (songGain){ try { songGain.disconnect(); } catch (e){} songGain = null; }
  playState = null;
  $('btnPlayPause').textContent = '▶';
  document.querySelectorAll('.song-row.playing').forEach(r => r.classList.remove('playing'));
}
async function playSong(song, fromBeat, isRetry){
  if (!song) return;
  stopPlayback();
  const ctx = warmAudio();
  if (!ctx) return;
  try { await ctx.resume(); } catch (e){}
  if (ctx.state === 'suspended'){ toast('Audio is blocked — tap Play again'); renderAudioDiag(); return; }
  songGain = ctx.createGain(); songGain.gain.value = 0.47; songGain.connect(ctx.destination);
  const vocalSend = createVocalSpace(ctx, songGain);
  const t0 = ctx.currentTime + 0.12;
  const startT = ctx.currentTime;
  const fb = fromBeat || 0;
  const beat = song.beat;
  const durationSec = song.bars * 4 * beat;
  /* Lookahead scheduler: schedule bars only as playback approaches them.
     The first call below schedules just the opening bar(s), so this tap
     returns in a few ms; a 150ms tick then keeps ~1s of audio scheduled
     ahead. One bar earlier than the seek point catches a melody note that
     started just before it but is still sounding. */
  const allLineEvents = [];
  let scheduledBar = Math.max(0, Math.floor(fb / 4) - (fb > 0 ? 1 : 0));
  let lastMidi = null;
  let schedErr = null;
  const scheduleAhead = () => {
    try {
      const horizon = ctx.currentTime + LOOKAHEAD_SEC;
      while (scheduledBar < song.bars){
        const barT = t0 + (scheduledBar * 4 - fb) * beat;
        if (barT > horizon) break;
        const r = scheduleSong(ctx, songGain, song, { t0, fromBeat: fb, barStart: scheduledBar, barEnd: scheduledBar + 1, prevMidi: lastMidi, vocalSend });
        if (r.lastMidi != null) lastMidi = r.lastMidi;
        for (const le of r.lineEvents) allLineEvents.push(le);
        scheduledBar++;
      }
      if (scheduledBar >= song.bars) clearSchedTimer();
    } catch (err){ schedErr = err; console.error(err); clearSchedTimer(); }
  };
  scheduleAhead();
  if (schedErr){ toast('Could not start playback — try again'); renderAudioDiag(); return; }
  song.plays = (song.plays || 0) + 1; saveSongs();
  playState = { song, t0, fromBeat: fb, durationSec, lineEvents: allLineEvents, paused: false };
  $('playerBar').classList.remove('hidden');
  $('pTitle').textContent = song.title;
  $('btnPlayPause').textContent = '⏸';
  document.querySelectorAll(`[data-song="${song.id}"]`).forEach(r => r.classList.add('playing'));
  playTimer = setInterval(updatePlayer, 120);
  schedTimer = setInterval(scheduleAhead, SCHED_TICK_MS);
  updatePlayer();
  renderAudioDiag();
  /* Watchdog: ~1s after scheduling, check the clock actually moved. A
     context can claim state 'running' while its currentTime is frozen —
     on that phone nothing will ever sound. If it is stuck, throw the
     broken context away, build a fresh one and retry the play once. If
     the fresh one is frozen too, say so plainly instead of spinning. */
  playWatchdogTimer = setTimeout(async () => {
    playWatchdogTimer = null;
    if (!playState || playState.song !== song || playState.t0 !== t0) return;
    const cur = audioCtx;
    let now = NaN;
    try { now = cur ? cur.currentTime : NaN; } catch (e){}
    const advancing = cur && isFinite(now) && (now - startT) > 0.02;
    const stuck = !cur || cur.state === 'suspended' || !advancing;
    if (!stuck){ renderAudioDiag(); return; }
    const stateTxt = cur ? cur.state : 'no-context';
    const timeTxt = isFinite(now) ? now.toFixed(2) + 's' : 'n/a';
    console.warn('[play-watchdog] frozen AudioContext', stateTxt, timeTxt);
    if (!isRetry){
      const old = cur;
      stopPlayback();
      if (old){ try { const p = old.close(); if (p && p.catch) p.catch(() => {}); } catch (e){} }
      audioCtx = null; songGain = null;
      toast('Audio engine was stuck — retrying with a fresh one…');
      renderAudioDiag();
      await playSong(song, fromBeat || 0, true);
      return;
    }
    stopPlayback();
    audioCtx = null; songGain = null;
    toast('Audio engine stuck (state: ' + stateTxt + ', time frozen at ' + timeTxt + ') — try closing and reopening the app');
    renderAudioDiag();
  }, PLAY_WATCHDOG_MS);
}
function updatePlayer(){
  if (!playState || !audioCtx) return;
  const elapsed = audioCtx.currentTime - playState.t0;
  const total = playState.durationSec - playState.fromBeat * playState.song.beat;
  if (elapsed >= total){ const totalDur = playState.song.durationSec; stopPlayback(); $('pLine').textContent = ''; $('pTime').textContent = '0:00 / ' + fmtTime(totalDur); renderAudioDiag(); return; }
  $('seek').value = Math.round(1000 * clamp(elapsed / total, 0, 1));
  $('pTime').textContent = fmtTime(elapsed) + ' / ' + fmtTime(total);
  const ev = playState.lineEvents.find(e => elapsed >= (e.t - playState.t0) && elapsed < (e.end - playState.t0));
  const curText = ev ? ev.text : '';
  if ($('pLine').textContent !== curText) $('pLine').textContent = curText;
  document.querySelectorAll('#detailLyrics [data-line]').forEach(el => el.classList.remove('cur'));
  if (ev){
    const idx = playState.lineEvents.indexOf(ev);
    const span = document.querySelector(`#detailLyrics [data-line="${idx}"]`);
    if (span) span.classList.add('cur');
  }
  renderAudioDiag();
}
function wirePlayer(){
  $('btnPlayPause').addEventListener('click', async () => {
    if (!playState){ if (currentSong) playSong(currentSong); return; }
    if (!audioCtx){ playSong(playState.song, playState.fromBeat); return; }
    if (audioCtx.state === 'suspended'){ try { await audioCtx.resume(); } catch (e){} $('btnPlayPause').textContent = '⏸'; }
    else { audioCtx.suspend(); $('btnPlayPause').textContent = '▶'; }
  });
  $('seek').addEventListener('change', e => {
    if (!playState) return;
    const totalBeats = playState.durationSec / playState.song.beat;
    const beat = playState.fromBeat + (e.target.value / 1000) * (totalBeats - playState.fromBeat);
    playSong(playState.song, Math.floor(beat));
  });
  $('sheetClose').addEventListener('click', closeSheet);
  $('songSheet').addEventListener('click', e => { if (e.target === $('songSheet')) closeSheet(); });
}

/* ================= MY VOICE ================= */
function analysePitch(audioBuffer){
  const data = audioBuffer.getChannelData(0), sr = audioBuffer.sampleRate;
  const win = Math.floor(sr * 0.12), hop = Math.floor(sr * 0.06);
  const hzList = [];
  const autocorr = (buf) => {
    let best = 0, bestLag = 0;
    const minLag = Math.floor(sr / 500), maxLag = Math.floor(sr / 70);
    for (let lag = minLag; lag <= maxLag; lag++){
      let sum = 0; for (let i = 0; i < buf.length - lag; i += 2) sum += buf[i] * buf[i + lag];
      if (sum > best){ best = sum; bestLag = lag; }
    }
    return best > 0.01 ? sr / bestLag : 0;
  };
  for (let start = 0; start + win < data.length; start += hop){
    let energy = 0; for (let i = start; i < start + win; i += 4) energy += data[i] * data[i];
    if (energy < 0.02) continue;
    const hz = autocorr(data.slice(start, start + win));
    if (hz >= 70 && hz <= 500) hzList.push(hz);
  }
  if (!hzList.length) return 0;
  hzList.sort((a, b) => a - b);
  return hzList[Math.floor(hzList.length / 2)];
}
let mediaRecorder = null, recChunks = [], recBlob = null, recStream = null, recTimer = null;
function renderVoice(){
  if (!voiceProfile){ $('voiceStatus').innerHTML = '<b>No voice profile yet</b><p class="muted">Songs will use a neutral pitch until you record.</p>'; $('voiceStats').classList.add('hidden'); $('btnPlayRec').classList.add('hidden'); $('voiceRefName').textContent = 'Use your voice'; return; }
  $('pitchBig').textContent = Math.round(voiceProfile.baseHz) + ' Hz';
  $('pitchNote').textContent = 'Your base pitch · ' + midiToName(Math.round(freqToMidi(voiceProfile.baseHz))) + ' — songs sing near ' + midiToName(Math.round(freqToMidi(voiceProfile.baseHz * 2)));
  $('pitchRange').textContent = `Range ${Math.round(voiceProfile.lowHz)}–${Math.round(voiceProfile.highHz)} Hz · recorded ${new Date(voiceProfile.recordedAt).toLocaleDateString()} · ${voiceProfile.seconds}s`;
  $('voiceStatus').innerHTML = '<b>Voice ready ✓</b><p class="muted">Every song\'s vocal is tuned to your pitch.</p>';
  $('voiceStats').classList.remove('hidden');
  $('voiceRefName').textContent = 'Voice ready · ' + Math.round(voiceProfile.baseHz) + ' Hz';
  renderVoiceTab();
}
function wireVoice(){
  $('btnRecord').addEventListener('click', async () => {
    try {
      recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recChunks = []; mediaRecorder = new MediaRecorder(recStream);
      mediaRecorder.ondataavailable = e => { if (e.data.size) recChunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        recStream.getTracks().forEach(t => t.stop());
        $('voiceRing').classList.remove('rec'); $('btnRecord').classList.remove('hidden'); $('btnStopRec').classList.add('hidden');
        recBlob = new Blob(recChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        if (recBlob.size < 5000){ toast('Too short — sing or talk for at least 15 seconds'); return; }
        toast('Analysing your pitch…');
        try {
          const buf = await recBlob.arrayBuffer();
          const actx = new (window.AudioContext || window.webkitAudioContext)();
          const decoded = await actx.decodeAudioData(buf);
          const hz = analysePitch(decoded);
          if (!hz){ toast('Couldn\'t hear a clear pitch — try again in a quiet room'); actx.close(); return; }
          const sorted = [];
          voiceProfile = { baseHz: hz, lowHz: hz * 0.8, highHz: hz * 1.6, seconds: Math.round(decoded.duration), recordedAt: Date.now() };
          store.set('asm_voice_v1', voiceProfile); renderVoice(); actx.close();
          $('btnPlayRec').classList.remove('hidden');
          toast('Voice saved — songs now tune to you ✓');
        } catch (err){ console.error(err); toast('Couldn\'t analyse that recording — try again'); }
      };
      mediaRecorder.start();
      $('voiceRing').classList.add('rec'); $('btnRecord').classList.add('hidden'); $('btnStopRec').classList.remove('hidden');
      $('voiceStatus').innerHTML = '<b>● Recording…</b><p class="muted">Sing or talk for 15–60 seconds, then tap Stop.</p>';
      clearTimeout(recTimer); recTimer = setTimeout(() => { if (mediaRecorder && mediaRecorder.state === 'recording') $('btnStopRec').click(); }, 60000);
    } catch (err){ toast('Microphone blocked — allow mic access in Android settings'); }
  });
  $('btnStopRec').addEventListener('click', () => { clearTimeout(recTimer); if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); });
  $('btnPlayRec').addEventListener('click', () => { if (recBlob){ const a = new Audio(URL.createObjectURL(recBlob)); a.play(); } else toast('Record your voice first'); });
}

/* ================= LIBRARY CONTROLS / SEARCH ================= */
function wireLibrary(){
  $('btnLibSearch').addEventListener('click', () => showView('search'));
  $('btnGoCreate').addEventListener('click', () => showView('create'));
  $('filterBtn').addEventListener('click', () => {
    currentFilter = currentFilter === 'All' ? 'Liked' : currentFilter === 'Liked' ? 'Newest' : 'All';
    renderLibrary(); toast(currentFilter === 'All' ? 'Showing all songs' : 'Showing: ' + currentFilter);
  });
  $('catLiked').addEventListener('click', () => { currentFilter = 'Liked'; renderLibrary(); toast('Liked songs ♥'); });
  $('catPlaylists').addEventListener('click', () => { currentFilter = 'All'; renderLibrary(); toast('Playlists — all your songs'); });
  $('catAlbums').addEventListener('click', () => { currentFilter = 'All'; renderLibrary(); toast('Albums — grouped by style'); });
  $('searchInput').addEventListener('input', renderSearch);
}

/* ================= AUTO-UPDATE (GitHub, QS pattern) ================= */
function cmpVer(a, b){
  const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).replace(/^v/, '').split('.').map(Number);
  if (pa.some(isNaN) || pb.some(isNaN)) return 0; /* unparseable version: never claim an update */
  for (let i = 0; i < 3; i++){ const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
async function installedVersion(){
  try {
    const P = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App;
    if (P){ const info = await P.getInfo(); if (info && info.version) return String(info.version); }
  } catch (e){}
  return CURRENT_VERSION;
}
async function checkUpdate(announce){
  try {
    const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' }, signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    /* The release tag is literally "latest" and the title is often
       unversioned ("AI Song Maker (newest build)") because the workflow
       file was never re-pasted — so read the version from the title
       first, then the tag, then fall back to www/version.json on main,
       which every push updates. That way a new version is detected even
       when the release title carries no version at all. */
    let latest = extractVersion(d.name) || extractVersion(d.tag_name) || '';
    if (!latest){
      try {
        const vr = await fetch(VERSION_JSON_URL + '?t=' + Date.now(), { signal: ctrl.signal });
        if (vr.ok){ const vj = await vr.json(); latest = extractVersion(vj.version) || ''; }
      } catch (e){}
    }
    if (!latest) return;
    const inst = await installedVersion();
    if (cmpVer(latest, inst) > 0){
      $('updVer').textContent = 'v' + latest;
      $('updateBanner').classList.remove('hidden');
      $('updStatus').textContent = 'New app version v' + latest + ' is ready — tap Update app above.';
    } else {
      $('updateBanner').classList.add('hidden');
      $('updStatus').textContent = 'You\'re up to date · v' + inst;
      if (announce) toast('You\'re up to date · v' + inst);
    }
  } catch (err){
    $('updStatus').textContent = 'Couldn\'t reach GitHub — will retry automatically.';
  }
}
async function openApk(){
  const url = APK_URL;
  try {
    const B = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Browser;
    if (B){ await B.open({ url }); return; }
  } catch (e){}
  window.open(url, '_blank');
}
function wireUpdate(){
  $('btnUpdate').addEventListener('click', openApk);
  $('btnUpdLater').addEventListener('click', () => $('updateBanner').classList.add('hidden'));
  $('btnCheckUpd').addEventListener('click', () => checkUpdate(true));
  setInterval(() => checkUpdate(false), 15 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(false); });
  window.addEventListener('pageshow', () => checkUpdate(false));
}

/* ================= INIT ================= */
function init(){
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  document.querySelector('#view-home h1').textContent = greet + ', Kodi';
  $('profileVer').textContent = 'v' + CURRENT_VERSION;
  $('libVer').textContent = 'v' + CURRENT_VERSION;
  $('homeVer').textContent = 'AI Song Maker v' + CURRENT_VERSION + ' · Merlin builds your songs — no extra app or key needed.';
  if (audioRef){ $('audioRefName').textContent = audioRef.name; $('btnAudio').classList.add('on'); }
  buildChips(); refreshPick(); wireNav(); wireCreate(); wireLibrary(); wirePlayer(); wireVoice(); wireUpdate();
  /* Any tap anywhere warms the audio up — the Play button never has to
     fight Android's tap-only audio rule on its own. */
  document.addEventListener('pointerdown', () => warmAudio());
  renderVoice(); renderLibrary(); renderHome(); renderSearch();
  checkUpdate(false);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
