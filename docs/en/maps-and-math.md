# Maps and math

## Maps

The `map` component draws land and countries from Natural Earth (public domain): 1:110m for the world and
continents, and a sharper 1:50m version when the map is zoomed in (less than 60° wide).

- **Areas:** `world`, `africa`, `europe`, `mena`, `maghreb`, `morocco`, `asia`, `americas`, or a box
  `[lonMin, latMin, lonMax, latMax]`. `fit` frames whatever is highlighted.
- **Countries:** `highlight: [{country: "Morocco", color, label}]`, using English Natural Earth names.
- **Markers:** `markers: [{lon, lat, label}]`, or the cue action `pin {lon, lat, label}`.
- **Point of view:** `pov: "morocco"` (the default) draws Morocco with its Sahara provinces; `"un"` draws
  Western Sahara separately.

Parts (`m#c:0`, `m#r:2`, `m#pin:1`) can be highlighted, shown at a mark, or picked in a "pick" question
("click on the region of …"). Labels that would cover a small region or another label move beside it, with a
leader line. Maps are never mirrored in right-to-left books.

### Regions of a country

```bash
warqa geo add MAR          # Morocco's 12 regions, from geoBoundaries
warqa geo add FRA --level 2 # French departments
warqa geo add --file my-regions.geojson --name-field nom --attribution "Ministry open data (Licence Ouverte)"
warqa geo list
```

`geo add` downloads current boundaries from [geoBoundaries](https://www.geoboundaries.org) and simplifies them
(about 1 km). It stores them in the book (`assets/geo/<id>.js` and `.json`), so the book works offline and
needs no download later. A map then uses them:

```json
{ "id": "m", "type": "map", "area": "fit",
  "regions": { "layer": "MAR-ADM1", "highlight": [{ "region": "MA-09", "label": "سوس - ماسة", "color": "mint" }] } }
```

A region is named by its code (`MA-09`) or its name ("Souss-Massa"). The writer model is told which layers and
regions the book has. A layer only goes in the books that use it, and Natural Earth's data goes only in
books that have maps.

**Licences:** boundary data comes with conditions. geoBoundaries data for many countries comes from
OpenStreetMap (ODbL): the map credits it on screen automatically ("© OpenStreetMap contributors"), as the
licence asks. `geo add` prints each layer's licence, and the `.json` file keeps it. For your own files, give
the credit with `--attribution`. Natural Earth's own subdivisions are not used because they are out of date
for some countries (Morocco's regions changed in 2015).

See `examples/morocco.warqa` for a lesson with countries, regions and a pick question.

## Math

There are two components, for two jobs:

- **`equation`:** a row of tokens that **morphs** step by step. Changed tokens get a box, removed ones shrink
  away and new ones fade in. It is best for arithmetic and short algebra, where the pupil should see which
  part changed. Steps can be token arrays (with colours, notes and ids) or TeX-like strings (`x^2 + 2x + 1`,
  `\frac{3}{4}`).
- **`math`:** anything TeX can write: nested fractions, roots, matrices, sums, integrals, chemistry with
  `\ce{}`, and aligned derivations. MathJax 4 typesets it at export into SVG (New Computer Modern font), so
  books need no fonts or scripts for math and work offline.

```json
{ "id": "m", "type": "math", "steps": ["\\frac{\\part{num}{2x + 4}}{2}", "\\frac{2(x + 2)}{2}", "x + 2"] }
{ "id": "d", "type": "math", "mode": "stack", "steps": ["3x + 5 = 20", "3x = 15", "x = 5"] }
```

- **`mode: "replace"`** (the default) shows one step at a time. The cue action `step` cross-fades to the next.
- **`mode: "stack"`** is a derivation: lines appear one under the other, aligned on `=` (or on `&` where you
  put it), one per `step`.
- **Parts:** `\part{name}{…}` marks a part that cues can target: `{"do": "highlight", "target": "m#part:num"}`.

Math is always written left to right, also inside Arabic lessons (the Moroccan convention). TeX errors are
caught while the lesson is written, and the model fixes them. Links and raw styles are not allowed in TeX. In
the browser-only web app, math nodes show as plain text, because typesetting runs in the desktop version.
