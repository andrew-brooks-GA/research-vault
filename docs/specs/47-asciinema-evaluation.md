# Spec 47: asciinema recordings for lessons, labs and vault evidence, the written finding (#65)

Round 1 (2026-11-11), at 352347a with a clean tree. This is the first acceptance criterion of issue 65 (2026-11-11-research-vault-issue-65-evaluate-asciinema): "A short written finding: the format version, the recorder and player versions, licences, sizes for a typical probe and a long lab run, and the redaction approach, with a recommendation to adopt, adopt in part, or not." The prototype and the secret-scanning check, the issue's other two criteria, are later work; this finding decides where the player bundle may live and what the check is. The issue says its own details "should be confirmed during the evaluation", so every figure here comes from a page captured on 2026-11-11 or a run recorded that day, each cited by its vault id. Every recording used asciinema 3.1.0 from Homebrew on macOS 27.0.1 (Darwin, arm64); each size comes from one recording, and where a second run of the same command differed, both raw sizes are given. Where this spec decides or recommends something, it says judgment.

## What exists, in one paragraph

The repo has no redaction or secret-scanning code: a case-insensitive grep for `redact` or `secret` over `bin/commands/capture.mjs`, `bin/lib/` and `skills/research-teach/SKILL.md` matches nothing, a wider one over `bin`, `hooks`, `scripts`, `skills` and `.githooks` matches nothing either, and the only git hook, `.githooks/pre-commit`, runs `gate staged --check` and nothing else (2026-11-11-research-vault-352347a-has-no-redaction). AGENTS.md line 17 reads "ESM only, no dependencies, no classes"; `package.json` declares `"type": "module"` and `"license": "MIT"`; for a URL list, `capture --batch` picks `fetchSource` only when `allowNetwork` is set (capture.mjs line 170), which line 251 sets from `process.env.RESEARCH_VAULT_ALLOW_NETWORK === '1'`, and, with neither `allowNetwork` nor an injected `fetch`, returns the error `network access is off` (lines 149 and 171); and teach.mjs line 326 declares `STATIC_DIRS = ['lessons', 'reference', 'assets']`, all at 352347a (2026-11-11-repo-lines-behind-spec-47-asciinema).

## Findings from research

### F1. Format: asciicast v3

asciicast v3 is newline-delimited JSON: a header object on the first line, then one event per line as `[interval, code, data]`, where the interval is the time in seconds since the previous event and the code is one of `o` (output), `i` (input), `m` (marker), `r` (resize) or `x` (exit status); lines starting with `#` are comments; the official CLI writes intervals to millisecond precision; and v3 "is not backward compatible with asciicast v1/v2" because of header changes and relative time (2026-11-11-asciicast-v3-file-format-specification). The same page says v3 support was added in asciinema CLI 3.0 and player 3.10.0, and that the header's `idle_time_limit` "should be used by an asciicast player to reduce all terminal inactivity" (same entry). The local CLI 3.1.0 writes v3 by default and can also write v2 and txt; its help also lists raw (2026-11-11-asciinema-3-1-0-local-recorder). In the probe recording, the v3 cast's header held `version`, `term` (cols, rows, type), `timestamp`, `command` and `env` with `SHELL` only, its intervals had three decimals, and the v2 cast of the same script had six (2026-11-11-asciinema-3-1-0-recording-short).

### F2. The recorder: asciinema CLI

- **Versions.** The local binary is 3.1.0 (2026-11-11-asciinema-3-1-0-local-recorder). On 2026-11-11 the latest release is v3.2.1, published 2026-06-16, which its notes call "a small release, mostly improving error handling and formatting" (2026-11-11-asciinema-cli-release-v3-2-1). No run used 3.2.1.
- **Licence.** The repository's licence is GPL-3.0 (2026-11-11-asciinema-cli-release-v3-2-1).
- **Platforms.** The v3.2.1 release assets are binaries for aarch64 and x86_64 macOS and for aarch64 and x86_64 Linux (gnu, plus an x86_64 musl build), 6845888 to 8130064 bytes each, and none for Windows (2026-11-11-asciinema-cli-release-v3-2-1). The installation page names package managers on Linux, macOS and FreeBSD, the release binaries, a container image and a source build, and names no Windows install (2026-11-11-asciinema-cli-installation). Recording on Windows, under WSL or otherwise, was not established.
- **What it records.** The `rec` help says keyboard input is recorded only with `-I, --capture-input`; that `--capture-env` captures only `SHELL` when not given; that `--headless` records with no terminal, for scripted use; and that ctrl+\ pauses and resumes capture (2026-11-11-asciinema-3-1-0-local-recorder). The v3 spec says the same of input and of `SHELL` (2026-11-11-asciicast-v3-file-format-specification). No option in the `rec` or `convert` help filters or redacts recorded output (2026-11-11-asciinema-3-1-0-local-recorder).
- **Searchable text.** `asciinema convert -f txt` writes "Plain text without colors or control sequences" (2026-11-11-asciinema-3-1-0-local-recorder). In one run it joined a token split across two output events and dropped a colour sequence inside another, and its output was lines of text with no timestamps (2026-11-11-asciinema-3-1-0-cast-made). In a second run it dropped a token that the same line overwrote after a carriage return, though the cast still holds that token's bytes (2026-11-11-secret-scan-asciinema-casts-event-stream).

### F3. The player: asciinema-player

- **Version and licence.** On 2026-11-11 the latest release is v3.18.0, published 2026-11-05, licence Apache-2.0, and its only two assets are `asciinema-player.css` and `asciinema-player.min.js`, with no licence file (2026-11-11-asciinema-player-release-v3-18-0). npm has the same version under Apache-2.0, depending on `solid-js` (2026-11-11-asciinema-player-3-18-0-npm).
- **The standalone bundle.** The quick start says the standalone player needs only `asciinema-player.min.js` and `asciinema-player.css`, copied into the site's assets and started with `AsciinemaPlayer.create(src, element, opts)` in the page, where `src` can be a relative path to a cast (2026-11-11-asciinema-player-quick-start).
- **Bundle size and hashes, measured.** `asciinema-player.min.js` is 226742 bytes (85055 gzipped), sha256 `752c9b528b664f5b16f27c68ba22fc7973d1d6063a1c3e4795a4c8015943acf6`; `asciinema-player.css` is 19322 bytes (3926 gzipped), sha256 `981fe7bc6042048b2a373b6da297f747e324e90a8b6264e833e3a92cec22dfb9`; together 246064 bytes, 88981 gzipped. The npm tarball (504453 bytes, 17 files) holds the same two files with the same hashes, and a `package/LICENSE` of 11347 bytes, the Apache License 2.0. The min.js opens with an `@license` comment naming Apache-2.0 (2026-11-11-asciinema-player-3-18-0-standalone).
- **Offline.** The only http(s) URLs in the min.js text are `http://localhost/` and `http://www.w3.org/2000/svg`; it calls `WebAssembly.instantiate` and `instantiateStreaming` and holds one base64-alphabet string literal of 115906 characters (2026-11-11-asciinema-player-3-18-0-standalone). This spec reads that as consistent with a bundle that needs no network, but no browser loaded it: whether it plays a cast offline, under `teach serve` or from a static export, is not established (open question 2026-11-11-does-asciinema-player-3-18-0).
- **Idle time and theme.** The player's `idleTimeLimit` option defaults to the cast header's `idle_time_limit`, else to no limit; `theme` defaults to `"auto/asciinema"` since player 3.8, which uses the theme the CLI embedded in the recording when there is one; the options page points to a themes page for custom themes, which this spec did not capture (2026-11-11-asciinema-player-options). How a custom theme follows the page's light and dark mode (issue 64) is not established.
- **Accessibility.** No captured page addresses screen readers; not established. The options page names keyboard use in two places: the keystroke overlay "can also be toggled at any time during playback with the <kbd>k</kbd> keyboard shortcut", and with `pauseOnMarkers` playback paused at a marker "can be resumed by either pressing the space bar key or clicking on the play button"; it links a shortcuts page that was not captured (2026-11-11-asciinema-player-options).

### F4. Sizes

Every size below is `wc -c` in bytes, gzipped with `gzip -9`.

| Recording | Cast (v3) | Gzipped | txt conversion | Source |
|---|---|---|---|---|
| Typical probe: three research-vault commands (lint, search, teach lint) on copies of the test fixtures | 3745 | 1138 | 3083 (959 gzipped) | 2026-11-11-asciinema-3-1-0-recording-short |
| The same probe as asciicast v2 | 3785 | 1218 | | 2026-11-11-asciinema-3-1-0-recording-short |
| Synthetic lab build, 2400 lines of about 80 bytes (a 20-minute run at an assumed 2 lines a second) | 242952 | 27271 | 190223 (25493 gzipped) | 2026-11-11-asciinema-3-1-0-synthetic-lab |
| Synthetic lab build, 12000 lines (a 20-minute run at an assumed 10 lines a second) | 1222965 | 133660 | 959995 (125646 gzipped) | 2026-11-11-asciinema-3-1-0-synthetic-lab |

How the long run was built: no real lab build was recorded. A script printed the lines one write at a time with a 5 ms sleep, so the 2400-line run took 14.86 s of wall time and the 12000-line run 73.59 s, and each line became one output event; both rates are assumptions (2026-11-11-asciinema-3-1-0-synthetic-lab). The program printed 192383 and 970795 bytes, so the cast added (242952 - 192383) / 2400 = 21.1 and (1222965 - 970795) / 12000 = 21.0 bytes per event, and gzip brought each cast to about 11% of its raw size (27271 / 242952 and 133660 / 1222965); these are this spec's arithmetic on that entry's figures. Repeat runs moved the figures slightly: the probe cast was 3711 bytes in an earlier run (2026-11-11-asciinema-3-1-0-recording-short) and the long casts 242952 and 1222948 bytes (27059 and 132961 gzipped) (2026-11-11-asciinema-3-1-0-synthetic-lab).

Scaling to a real 20 minutes, an estimate: a cast's size is its event count times its bytes per event, and wall time enters only through the interval field. In the compressed runs every interval but the first printed as five characters, 0.000 to 0.015 (the tabulation in 2026-11-11-asciinema-3-1-0-synthetic-lab), and the CLI writes intervals to three decimals (2026-11-11-asciicast-v3-file-format-specification), so an interval of 0.5 s ("0.500") has the same length and an interval of 10 s or more adds one character. So, as an estimate, a real 20-minute run with the same lines and the same event split gives the same size within a few bytes. The real risk to the estimate is the output itself: a real build's rate, its line length, and progress bars that redraw a line many times could each change the event count, and none was measured (open question 2026-11-11-what-output-rate-cast-size-does).

### F5. Idle time

Recording with `-i 1` added the header field `"idle_time_limit":1.0` (263 bytes against 241 without it) and left the recorded intervals as they were, about 3 s and 2 s for a 3 s and a 2 s sleep (2026-11-11-asciinema-3-1-0-idle-time), as the `rec` help says: the option "doesn't alter the original (captured) timing information" and is "interpreted by session players at playback time" (2026-11-11-asciinema-3-1-0-local-recorder). So with asciinema the cap is a playback setting stored in the file, and capping at record time does not shrink a cast: its size follows the event count (F4). Playback with the cap was not run.

### F6. Secrets in a cast

A cast records what the command prints, unfiltered (F2). In one run with a made-up test token, `rvtest_FAKE0123456789abcdef`, printed whole, split across two writes 0.3 s apart, and with a colour sequence inside it, a grep for the token over the raw cast found 1 of the 3, because the split one lands in two events and the coloured one is stored as `rvtest_\u001b[31mFAKE0123456789abcdef`; a grep over the txt conversion found all 3 (2026-11-11-asciinema-3-1-0-cast-made). In a second run, a token printed and then overwritten after a carriage return was in the cast's output event but not in the txt conversion, and a base64-encoded copy was found by no scan; a short Node prototype that joins every output and input event, removes CSI and OSC escape sequences and counts a literal found all 3 in the first cast and the overwritten token in the second (2026-11-11-secret-scan-asciinema-casts-event-stream).

## Decisions

### D1. Where a player bundle may live (judgment)

The repo takes "no dependencies" (AGENTS.md line 17, 2026-11-11-repo-lines-behind-spec-47-asciinema), and the issue asks for "loading it from the workspace (not a CDN) so `teach serve` and the export work offline" (2026-11-11-research-vault-issue-65-evaluate-asciinema). The bundle is two files, 246064 bytes (F3). The options and what each costs, as this spec judges them:

| Option | What it costs |
|---|---|
| A. Vendored under a skill's assets, with the npm tarball's `LICENSE` and a pinned sha256 in the repo | 246064 bytes of third-party minified code, plus the 11347-byte licence, tracked in the plugin and installed with it; every player release is a hand update of three files and two hashes; and it is code the repo did not write, which sits uneasily with "no dependencies" even though nothing is installed. It needs no fetch step. |
| B. Fetched into the workspace by the author, at a version and two sha256 values pinned in the repo | No third-party file in the repo, only a version and two hashes. It needs network once per workspace, behind an opt-in like the `RESEARCH_VAULT_ALLOW_NETWORK=1` gate `capture --batch` already has; the release has no licence asset (F3), so the licence comes from the npm tarball; a fetched file whose hash differs is refused. The files land in the workspace's `assets/`, one of the directories `STATIC_DIRS` names (2026-11-11-repo-lines-behind-spec-47-asciinema). |
| C. Not shipped | No replay in lessons; a cast stays vault evidence and the lesson shows its transcript. No cost, and it loses what the issue wants a learner to see. |

A CDN is excluded by the issue. Recommendation, judgment: B. It keeps third-party code out of the repo, the pinned hash gives the same integrity as vendoring, and the issue's own shape already has a replay block that "degrades to that transcript where the player cannot load" (2026-11-11-research-vault-issue-65-evaluate-asciinema), which is what a workspace without the fetched files would show. A is the fallback if the prototype finds the fetch step a burden for authors; C is the answer if the prototype finds the player does not play offline (F3's open question).

### D2. What the secret-scanning check is (judgment)

**What it scans.** Every event of a cast whose code is `o` or `i`, joined in order, with CSI and OSC escape sequences removed, plus the header's string values (`title`, `command`, the `env` values). It scans the event stream, not the `convert -f txt` output, because the txt rendering drops a token that was printed and then overwritten while the bytes stay in the file (F6). It runs in Node with no dependency, as the prototype did (F6), so lint does not need the asciinema binary.

**What it looks for.** Two kinds of needle: literal values the caller passes for the run (the secret values a probe runner was given, which it knows), and a short list of token shapes kept in one module. The issue's test (a cast containing a known test token), extended here to the three forms of F6: a cast built in the test, holding a made-up token whole, split across two events and with a colour sequence inside it, fails the check. Which token shapes to list is left to the prototype wave; this spec captured no source on token formats.

**When it runs.** Before a cast is kept anywhere: in the recording helper right after the recorder exits; in `capture` when the content is a cast, refusing the capture on a match, so the vault never holds a cast that failed; and in `teach lint`, as a finding for a replay block whose cast fails, which covers a cast copied into a workspace by hand. The pre-commit hook, which today runs only `gate staged --check` (2026-11-11-research-vault-352347a-has-no-redaction), is left as it is; adding the scan to it is a later choice.

**Redaction.** Judgment: redact at the source, never in the cast. A probe that handles a secret prints it masked (the runner replaces the values it knows in the output it prints) and records with no `-I` and no `--capture-env`, the CLI's defaults (F2). A cast that fails the scan is recorded again, not edited, so a cast stays what the probe runner recorded, which is the issue's fidelity question.

**What it cannot catch.** A secret the check was not given and that matches no listed shape; a secret printed in a transformed form, such as the base64 copy F6 measured; a secret whose halves are separated by other output, such as text printed between them at another screen position (not tested); and anything in an `m` marker label or an event code it does not read.

## Answers to the issue's questions

- **Format and tooling.** asciicast v3, the CLI's default and supported by the player since 3.10.0 (F1). Searchable text: the txt conversion, which has no timestamps (F2); keeping timestamps needs code that walks the events, as the scan prototype does (F6). Judgment: store the txt conversion as the transcript and searchable body, and keep the cast for timing.
- **Size.** About 3.7 KB for a typical probe and, at the assumed rates, 0.24 MB to 1.2 MB raw (27 KB to 134 KB gzipped) for a 20-minute run (F4). Every interval in those casts but the first is 0.015 s or less; a real run's varied intervals may compress less well, so the gzipped figures may underestimate a real run. Idle time: with asciinema it is capped only on playback, since the recorder keeps the true intervals (F5). Judgment: record with `-i 2` so the header carries a cap for the player, and keep the true intervals as the evidence of how long each step took.
- **Secrets.** D2.
- **Fidelity.** A cast is plain text (F1); recording again instead of editing (D2) keeps it the runner's record. Whether a hand edit could be detected after the fact is not established.
- **Player embedding.** Pin v3.18.0 and its two hashes (F3, D1); load it from the workspace's `assets/` (D1); theming and accessibility not established (F3); a transcript beside every player, as the issue says.
- **Platform reach.** Recording: release binaries and documented installs for macOS and Linux, and FreeBSD packages, none for Windows (F2). Playback is a script in a web page (2026-11-11-asciinema-player-quick-start), but no browser on any platform was tested.

## Recommendation (judgment)

Adopt in part. Adopt the recorder for probe and lab runs as evidence: the format is plain text and small for a probe (F1, F4); the recorder captures no input and only `SHELL` by default (F2); and the cast keeps the timing a flat log drops, with the idle cap stored rather than applied (F5). Adopt the player only through the prototype, fetched into the workspace (D1), because offline playback, theming and accessibility are unmeasured (F3). Let no cast reach the vault or a workspace without the scan in D2, since the recorder filters nothing (F2, F6). Under this plan the repo ships neither: the recorder (GPL-3.0, F2) is a binary the author installs and runs, and the player (Apache-2.0, F3) is fetched by the author (D1).

## Risks

- **A secret the scan does not know.** D2 lists what it cannot catch; the residual is a leak into a kept cast. Mitigation: masking at the source and recording headless with the defaults.
- **Large casts as vault entries.** A cast at the higher assumed rate is 1.2 MB (F4); how lint, search and the claims reviewer handle an entry body that size was not measured, which is one reason for the judgment to store the txt as the body.
- **Version drift.** The local CLI is 3.1.0 and the latest 3.2.1 (F2); the player is pinned by hash, so a new release changes nothing until the pin moves.
- **Licence handling under B.** The fetched files need their licence beside them, and the release assets do not include it (F3).

## Not established

The recorder on Windows; real lab-build output rates (2026-11-11-what-output-rate-cast-size-does); the player playing offline under `teach serve` or an export (2026-11-11-does-asciinema-player-3-18-0); custom themes for light and dark mode; player accessibility; playback with an idle cap; how well a real run's varied intervals and real log text compress, against the synthetic 11%; any run with CLI 3.2.1.

## Open questions

1. D1: does the prototype find the author's fetch step acceptable, or should the bundle be vendored (option A)?
2. D2: which token shapes go in the list, and from which source?
3. Should a cast be captured as a source body, or kept as an attachment beside an experiment whose body is the txt transcript (the issue's possible shape names "A `cast` evidence kind, or an optional cast attachment on `experiment` entries")?
