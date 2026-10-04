# warqa-pack-clock

An analogue clock for [Warqa](../../../README.md) lessons: telling the time, with hands that turn when the narration says so.

```bash
warqa pack add examples/packs/clock        # or: warqa pack add warqa-pack-clock (from npm)
```

```json
{ "id": "c", "type": "clock", "hour": 3, "minute": 0, "digital": true }
```

Cue `{"at": "half", "do": "set", "target": "c", "args": {"hour": 4, "minute": 30}}` turns the hands forward. Parts `c#hour` and `c#minute` can be highlighted or picked in a question.

This folder is also the template for writing your own pack: see [docs/en/component-packs.md](../../../docs/en/component-packs.md).
