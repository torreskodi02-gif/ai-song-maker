# AI Song Maker

**Merlin builds your songs.** Give it your voice, a prompt or your own lyrics,
pick a style — and Merlin writes the lyrics, melody, beat and vocals in the
background. No external music service, no API key, nothing leaves your phone
except the update check.

- **App:** `app.aisongmaker`, v1.0.0 — Capacitor web app in `www/`, packaged as
  an Android APK by GitHub Actions (same pattern as Quantum Signal).
- **Engine:** pure Web Audio in `www/app.js` — per-genre chord progressions,
  drum patterns, bass, melody from your lyrics' syllables, synthesized lead
  vocal tuned to your saved voice pitch. Play in-app, download WAV.
- **UI:** black studio, bottom nav (Home / Search / Create / Library /
  Profile), Library rows with gradient category cards, Advanced Song create
  screen with +Audio / +Voice, Lyrics + Styles cards, More Options Variety
  slider, Song Title field, orange-to-pink gradient Create button.
  Layout follows the reference screenshots; branding is ours only —
  model pill is **Merlin v1**, song version tags are **M1** in accent orange.

## What Merlin does in the app

1. **Create** — type a prompt or paste lyrics (your words are kept exactly),
   tap the wand and Merlin writes full verse/chorus/bridge lyrics. Pick genre
   (Hip-hop, R&B, Pop, Rock, Country, Afrobeats, EDM, Lo-fi, Gospel), mood,
   tempo, key, length, energy, vocal style, instruments. Hit **Create** and
   Merlin shows progress: writing lyrics → composing melody → building beat
   → mixing vocals.
2. **+ Voice** — opens My Voice: record 15–60s, Merlin measures your pitch
   (autocorrelation) and tunes every song's vocal to your range. Honest label
   in the app: the vocal is a *synthesized vocal tuned to your range, not a
   studio voice clone*.
3. **+ Audio** — upload a reference track; its pitch is analysed and used as
   a tuning hint for the song.
4. **Library** — Liked / Playlists / Albums cards, My Songs rows (64px cover,
   duration badge, M1 tag, 3-dot menu: Play, Like, Remix, Extend, Download
   WAV, Delete). Songs + voice profile persist in localStorage.
5. **Player** — mini-player above the bottom nav with seek and live lyric
   highlighting; tap a song for full lyrics + actions.

## Auto-update (in the app, via GitHub)

On boot, every 15 minutes, and whenever the app returns to the foreground,
the app fetches `https://api.github.com/repos/torreskodi02-gif/ai-song-maker/releases/latest`,
compares the tag to the installed version (via `@capacitor/app getInfo()`),
and shows **"New app version vX is ready"** with an **Update app** button
that opens `https://github.com/torreskodi02-gif/ai-song-maker/releases/download/latest/ai-song-maker.apk`
in the system browser. Tap the download, then Install. Android never allows
silent install. Works offline gracefully (check just retries later).

APK download once published:
`https://github.com/torreskodi02-gif/ai-song-maker/releases/download/latest/ai-song-maker.apk`

## Push steps (repo already exists — do NOT create another one)

The repo `torreskodi02-gif/ai-song-maker` already exists on GitHub (created
2026-11-17, `main` branch, only a `# ai-song-maker` README so far). Push this
project into it:

```bash
cd ~/workspace/ai-song-maker
git init
git add .
git commit -m "AI Song Maker v1.0.0 — Merlin song engine, black studio UI, auto-update"
git branch -M main
git remote add origin https://github.com/torreskodi02-gif/ai-song-maker.git
git push -u origin main
```

That push triggers the **Build APK** workflow. When it finishes, the APK is
at the `latest` release link above, and the app's in-app updater will find it.

> **Workflow file caveat:** the GitHub App cannot push `.github/workflows`
> files (403, same as Quantum Signal). If the workflow does not run after the
> push, check the repo's Actions tab — if `build-apk.yml` is missing, paste
> the file `build-apk.yml` (project root — identical copy of
> `.github/workflows/build-apk.yml`) via GitHub's web editor at
> `.github/workflows/build-apk.yml`, then re-run the workflow.

## Local build

```bash
bash setup-android.sh        # npm install + fresh Capacitor android scaffold + permissions + sync
cd android && ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

## Files

| File | What it is |
|---|---|
| `package.json` | name `ai-song-maker`, version `1.0.0`, Capacitor 6 deps |
| `capacitor.config.json` | appId `app.aisongmaker`, webDir `www` |
| `www/index.html` | whole UI — Home/Search/Create/Library/Profile, bottom nav |
| `www/style.css` | all colours/spacing in `:root` tokens at the top — restyle there |
| `www/app.js` | lyrics generator, song engine, Web Audio, player, voice, updater |
| `www/version.json` | bundled version note |
| `android/` | minimal scaffold: `app/build.gradle`, `AndroidManifest.xml` (RECORD_AUDIO etc.), `MainActivity.java` — the workflow regenerates the full scaffold with `cap add android` and restores these |
| `.github/workflows/build-apk.yml` | CI: build APK, publish to `latest` release |
| `build-apk.yml` | identical copy at project root, for pasting via the web editor if CI can't push it |
| `setup-android.sh` | local Android setup |
| `scripts/test-engine.mjs` | `node scripts/test-engine.mjs` — lyrics/chords/melody/voice-tuning tests |

## UI tokens (for later restyles)

Everything visual lives in the `:root` block at the top of `www/style.css`
(`--bg`, `--card`, `--create-1/--create-2` gradient, `--ver` accent orange,
`--radius`, etc.). Change values there; do not rename classes or element ids
— `www/app.js` depends on them.

## Honest limits

- The vocal is a synthesized lead tuned to your pitch range, not a studio
  clone of your voice. A true clone would need a paid voice service later.
- Songs are generated on-device with Web Audio; quality is demo/studio-sketch
  level, not a commercial mastering chain.
- Closed-app delivery of anything is not involved here — songs are made and
  stored on the phone.
