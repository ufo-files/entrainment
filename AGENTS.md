# Agent Instructions

This repository publishes Entrainment, a static Web Audio experiment inspired by
US5213562A. Treat every change as production work: the audio graph, visualizer,
responsive controls, screenshots, and Pages deployment must remain reproducible.

## Scientific Boundaries

- Describe effects attributed to the patent as claims, not established outcomes.
- Do not add medical, therapeutic, diagnostic, or performance claims.
- Keep the audio signal inspectable. Frequencies, gains, and routing must not be
  hidden behind unexplained state labels.
- The app does not capture or reproduce EEG data. Do not imply otherwise unless a
  future implementation adds measured input, provenance, and validation.
- Preserve the low-volume warning and explicit headphone requirement.

## Pre-Push Gate

Run the complete local gate before pushing:

```sh
npm ci
npm test
npm run test:browser
npm run screenshots
```

Inspect desktop and mobile screenshots for clipped controls, overlapping text,
blank canvas output, and visual regressions. Exercise audio startup in a real
browser; automated screenshots cannot validate audible output.

## Git Identity

Use the UFO Files bot identity:

```sh
git config user.name "ufo-files"
git config user.email "297273897+ufo-files@users.noreply.github.com"
```

Never commit with a personal name or personal email address.

## Change Discipline

- Keep the app static and dependency-light.
- Maintain Safari/iOS compatibility for Web Audio and responsive layout changes.
- Preserve deterministic pink-noise generation and deterministic screenshots.
- Add unit coverage for changes to signal math, preset data, or sanitization.
- Do not commit local caches, browser reports, recordings, or generated scratch
  files.
