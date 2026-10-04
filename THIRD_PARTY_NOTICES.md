# Third-party notices

## Papermorph — MIT License

Warqa's lesson ideas (beats paired with narration marks, in-picture questions, first-try scoring,
the delivery checks) and parts of its timeline, grading and teaching guidelines are derived from
Papermorph: https://github.com/DozenTwelve/Papermorph. Files containing ported code carry the header
"Portions derived from Papermorph (MIT)". The example lesson in `examples/integers.warqa` is a
re-implementation of Papermorph's *Elementary Algebra*, chapter 5, in Warqa's lesson format, with
its English narration audio reused.

```
MIT License

Copyright (c) 2026 TedKaczynski

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Fonts — SIL Open Font License 1.1

Readex Pro, Noto Naskh Arabic and STIX Two Text are bundled from the `@fontsource/*` packages.

## MathJax — Apache License 2.0

Display math (the `math` component) is typeset at export with MathJax 4 (`@mathjax/src`), the New Computer
Modern font data (`@mathjax/mathjax-newcm-font`) and the mhchem glyph extension
(`@mathjax/mathjax-mhchem-font-extension`), © The MathJax Consortium, Apache License 2.0. The SVG paths in
exported books come from that font data (based on New Computer Modern, SIL Open Font License 1.1).

## Map data

- **Natural Earth** (public domain), through the `world-atlas` package (ISC licence, © Michael Bostock), and
  `topojson-client` (ISC licence, © Michael Bostock): country and land outlines in `geo-world.js` and
  `geo-world-50m.js`.
- **Region layers** that `warqa geo add` downloads come from [geoBoundaries](https://www.geoboundaries.org)
  (CC BY 4.0 for the project). Each layer keeps its own source licence; many come from OpenStreetMap
  (© OpenStreetMap contributors, Open Database License 1.0). Maps credit them on screen. The example
  `examples/morocco.warqa/assets/geo/MAR-ADM1.*` is such a layer: it is ODbL data, not Apache-2.0.

## Python packages (optional worker)

See `workers/py/README.md`. Some local voice models (Piper voices, Habibi-TTS weights) carry research-only or
non-commercial terms; they are not bundled, and the worker prints their licence when it loads them.
