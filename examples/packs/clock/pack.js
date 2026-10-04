// Warqa component pack: an analogue clock for learning to tell the time.
// One plain script, run by Warqa in Node (schema, validation, the writer's catalog) and in the player (drawing).
// Licence: Apache-2.0.
(globalThis.WARQA_PACKS = globalThis.WARQA_PACKS || []).push(function (W) {
  var z = W.z;
  var total = function (p) {
    return ((p.hour % 12) * 60 + p.minute) % 720;
  };

  W.registerComponent({
    type: 'clock',
    pack: 'kids',
    doc:
      'An analogue clock face for telling the time. hour (0–23) and minute (0–59) set the hands; digital: also show the time in digits. Action "set" {hour, minute} turns the hands forward to a new time (the minute hand sweeps). Parts: hour, minute (the hands), face. Both hands can be picked in a "pick" question.',
    props: z.object({
      hour: z.number().int().min(0).max(23).default(3),
      minute: z.number().int().min(0).max(59).default(0),
      digital: z.boolean().default(false),
      label: W.Text.optional(),
    }),
    defaultSlot: 'main',
    text: ['label'],
    subs: function () {
      return ['face', 'hour', 'minute'];
    },
    init: function (p) {
      return { tm: total(p) };
    },
    pickable: function () {
      return ['hour', 'minute'];
    },
    minWidth: function () {
      return 300;
    },
    natHeight: function (p) {
      return p.digital || p.label ? 460 : 400;
    },
    actions: {
      set: {
        doc: 'Turn the hands forward to {hour, minute}.',
        args: z.object({ hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59).default(0) }),
        dur: 2,
        apply: function (ctx, a) {
          var cur = Number(ctx.get('', 'tm') || 0);
          var to = total({ hour: a.hour, minute: a.minute || 0 });
          var base = cur - (cur % 720);
          var target = base + to;
          if (target < cur) target += 720; // clocks only go forward
          ctx.tween('', 'tm', target, ctx.t0, ctx.dur, 'io');
        },
      },
    },
    examples: [
      {
        title: 'From three o’clock to half past four',
        props: { hour: 3, minute: 0, digital: true },
        cues: [{ at: 1, do: 'set', target: 'x', args: { hour: 4, minute: 30 } }],
      },
    ],
  });

  if (!W.registerView) return; // in Node: the definition is enough

  var k = W.kit;
  W.registerView('clock', function (ctx) {
    var p = ctx.node.props;
    var g = k.svg('g', {}, ctx.g);
    var box = { x: 0, y: 0, w: 0, h: 0 };
    var cx = 0;
    var cy = 0;
    var r = 100;
    var faceG, hourHand, minuteHand, digital;
    var extra = p.digital || p.label ? 60 : 0;
    function hand(len, width, colour) {
      return k.svg('line', { x1: 0, y1: 0, x2: 0, y2: -len, stroke: colour, 'stroke-width': width, 'stroke-linecap': 'round' }, g);
    }
    function draw() {
      g.replaceChildren();
      faceG = k.svg('g', {}, g);
      k.svg('circle', { cx: cx, cy: cy, r: r, fill: k.mix(k.COLORS.board, k.COLORS.chalk, 0.08), stroke: k.COLORS.chalk, 'stroke-width': 6 }, faceG);
      for (var i = 0; i < 60; i++) {
        var a = (i / 60) * 2 * Math.PI;
        var long = i % 5 === 0;
        var r1 = r * (long ? 0.86 : 0.92);
        k.svg('line', {
          x1: cx + Math.sin(a) * r1,
          y1: cy - Math.cos(a) * r1,
          x2: cx + Math.sin(a) * r * 0.97,
          y2: cy - Math.cos(a) * r * 0.97,
          stroke: k.COLORS.chalk,
          'stroke-width': long ? 5 : 2,
          opacity: long ? 1 : 0.6,
        }, faceG);
      }
      for (var n = 1; n <= 12; n++) {
        var b = (n / 12) * 2 * Math.PI;
        k.svgLabel(faceG, ctx.fmt(n), { x: cx + Math.sin(b) * r * 0.7, y: cy - Math.cos(b) * r * 0.7 + r * 0.07, size: r * 0.19, fill: k.COLORS.chalk, weight: 600, dir: 'ltr' });
      }
      hourHand = hand(r * 0.5, r * 0.07, k.color('coral'));
      minuteHand = hand(r * 0.78, r * 0.045, k.color('sky'));
      k.svg('circle', { cx: cx, cy: cy, r: r * 0.06, fill: k.COLORS.chalk }, g);
      digital = null;
      if (p.digital || p.label)
        digital = k.svgLabel(g, '', { x: cx, y: cy + r + 46, size: 34, fill: k.COLORS.chalk, weight: 600, dir: ctx.dir });
    }
    return {
      size: function (maxW, maxH) {
        var s = Math.min(maxW, maxH - extra, 420);
        return { w: s, h: s + extra };
      },
      place: function (b) {
        box = b;
        r = Math.min(b.w, b.h - extra) / 2 - 6;
        cx = b.x + b.w / 2;
        cy = b.y + r + 6;
        draw();
      },
      update: function (get) {
        var tm = k.num(get('', 'tm'), 0);
        var minutes = ((tm % 60) + 60) % 60;
        var hours = (tm / 60) % 12;
        hourHand.setAttribute('transform', 'translate(' + cx + ' ' + cy + ') rotate(' + hours * 30 + ')');
        minuteHand.setAttribute('transform', 'translate(' + cx + ' ' + cy + ') rotate(' + minutes * 6 + ')');
        hourHand.setAttribute('stroke', get('hour', 'c') ? k.color(get('hour', 'c')) : k.color(k.num(get('hour', 'hl'), 0) > 0.01 ? 'task' : 'coral'));
        minuteHand.setAttribute('stroke', get('minute', 'c') ? k.color(get('minute', 'c')) : k.color(k.num(get('minute', 'hl'), 0) > 0.01 ? 'task' : 'sky'));
        hourHand.setAttribute('opacity', String(k.num(get('hour', 'o'), 1)));
        minuteHand.setAttribute('opacity', String(k.num(get('minute', 'o'), 1)));
        faceG.setAttribute('opacity', String(k.num(get('face', 'o'), 1)));
        if (digital) {
          var hh = Math.floor(tm / 60) % 12 || 12;
          var mm = Math.floor(minutes);
          var text = (p.digital ? ctx.fmt(hh) + ':' + (mm < 10 ? ctx.fmt(0) : '') + ctx.fmt(mm) : '') + (p.label ? (p.digital ? ' · ' : '') + p.label : '');
          if (digital.textContent !== text) digital.textContent = text;
        }
      },
      part: function (sub) {
        if (sub === 'face') return { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r };
        if (sub === 'hour' || sub === 'minute') {
          var el = sub === 'hour' ? hourHand : minuteHand;
          var m = /rotate\(([-\d.]+)\)/.exec(el.getAttribute('transform') || '');
          var ang = ((m ? Number(m[1]) : 0) * Math.PI) / 180;
          var len = sub === 'hour' ? r * 0.35 : r * 0.55;
          return { x: cx + Math.sin(ang) * len - 28, y: cy - Math.cos(ang) * len - 28, w: 56, h: 56 };
        }
        return null;
      },
    };
  });
});
