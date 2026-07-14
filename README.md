# Entrainment

[![Test](https://github.com/ufo-files/entrainment/actions/workflows/test.yml/badge.svg)](https://github.com/ufo-files/entrainment/actions/workflows/test.yml)
[![Deploy to GitHub Pages](https://github.com/ufo-files/entrainment/actions/workflows/pages.yml/badge.svg)](https://github.com/ufo-files/entrainment/actions/workflows/pages.yml)

An inspectable stereo audio synthesizer inspired by Robert A. Monroe's expired
US patent [US5213562A](https://patents.google.com/patent/US5213562A/en).

Live app: https://ufo-files.github.io/entrainment/

![Entrainment reference signal running in the browser](screenshots/entrainment-desktop.png)

![Entrainment spatial soundfield running in the browser](screenshots/entrainment-spatial-desktop.png)

The app implements the portions of the patent that can be reproduced as a
browser audio instrument:

- independent carrier signals delivered to the left and right channels;
- the patent's 100 Hz / 104 Hz reference example, producing a 4 Hz difference;
- multi-pair differential frequency sets identified in Figures 3B, 3D, 3F,
  and 3H;
- amplitude contouring; and
- a deterministic pink-noise layer with cyclic panning and filtering, kept at
  least 10 dB below the carrier reference;
- an app-defined spatial alternative that routes the base carriers through a
  fixed browser HRTF soundfield with continuous crossfading; and
- post-volume, post-compressor left and right PCM analyser taps that drive the
  live waveforms, normalized mid-side vectorscope, spatial PCM field, dBFS
  levels, and correlation readout.

The instrument does **not** capture, infer, or reproduce EEG recordings. Carrier
placement for the multi-pair figure programs is app-defined because the patent
names differential frequencies without providing reproducible source EEG data.

## Use

Stereo headphones are required to preserve either the separate binaural
carriers or the HRTF spatial cues. Start at low volume. Stop if you feel
discomfort, and do not use the app while driving or operating machinery.

This is an experimental audio tool, not a medical device. Effects described in
the patent are historical patent claims and are not presented by UFO Files as
established medical or scientific outcomes.

## Development

```sh
npm ci
npm test
npm run test:browser
npm run serve
```

Open <http://127.0.0.1:4173>.

Capture the desktop and mobile reference views with:

```sh
npm run screenshots
```

## Signal Model

In Binaural mode, the browser creates one sine oscillator routed only to the
left channel and another routed only to the right for each pair. Their
frequency difference is the displayed beat frequency. Multi-pair programs sum
three independently routed pairs at gain scaled by the square root of the pair
count. This is the patent-inspired signal path and remains the default.

Spatial mode is an app-defined alternate presentation, not a behavior specified
by the patent. Each configured base carrier is amplitude-contoured at its
corresponding difference frequency. The carriers are summed to mono, then a Web
Audio `PannerNode` bank with `panningModel = "HRTF"` places the carrier field at
12 fixed points on a constant-radius horizontal orbit. Equal-power control
curves crossfade adjacent positions to create continuous motion without asking
the browser to recalculate an audible HRTF filter in place. HRTF rendering is
platform-dependent, so the final PCM telemetry is the authoritative view of
what the browser produced. Spatial mode uses a dedicated radial soundfield: its
12 perimeter points are the real fixed HRTF positions, the moving marker is the
current crossfade position, and the two concentric wave rings encode the live
mid and side PCM channels. The listener, orientation, orbit trail, and
configured cycle are control-state displays rather than inferred sound-source
measurements.

The pink layer uses seeded, deterministic pink-noise samples. A low-frequency
cycle modulates stereo panning and filter frequency. The UI constrains the layer
to -10 dB or lower relative gain, following the patent's stated design boundary.

Audio starts only after a user gesture, as required by modern browsers.

Before audio starts, the canvas is a mathematical preview of the configured
carrier pair. During binaural playback, the left and right traces are drawn
from the actual PCM stream sent to each output channel. The center field is a
normalized stereo vectorscope. Its horizontal axis plots `(L + R) / 2` and its
vertical axis plots `(L - R) / 2`, using a short fading history over a fixed
circle and crosshair. Spatial playback replaces that composition with the
radial HRTF field described above. Both views expose signal behavior without
presenting a scalar measurement as arbitrary shape deformation.
Absolute left, right, and difference levels remain available as dBFS readouts,
with correlation reported separately.

## Project Links

- [UFO Files](https://ufo-files.app/)
- [Source](https://github.com/ufo-files/entrainment)
- [US5213562A](https://patents.google.com/patent/US5213562A/en)
- [Anonymous tips](https://tips.hushline.app/to/ufo-files)
