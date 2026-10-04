// Experimental custom widget: model-written HTML in a sandboxed iframe (scripts only — no same-origin,
// no network via CSP, no storage), driven by the lesson clock through postMessage.
import { h } from '../dom.js';
import type { ViewFactory } from './types.js';

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:";

export const widget: ViewFactory = (ctx) => {
  const p = ctx.node.props as { html: string; title: string; height: number };
  const doc = `<!doctype html><html lang="${ctx.lang}" dir="${ctx.dir}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>html,body{margin:0;height:100%;background:transparent;color:#ece8dc;font-family:system-ui,sans-serif;overflow:hidden}</style></head><body>${p.html}</body></html>`;
  const frame = h('iframe', {
    class: 'wq-widget',
    title: p.title,
    sandbox: 'allow-scripts',
    srcdoc: doc,
    loading: 'eager',
    referrerpolicy: 'no-referrer',
  });
  ctx.div.append(frame);
  let last = -1;
  let ready = false;
  const post = (t: number) =>
    frame.contentWindow?.postMessage({ type: 'warqa:time', t, lang: ctx.lang, dir: ctx.dir }, '*');
  // the frame loads after the first frames were drawn: send it the current time once it is ready
  frame.addEventListener('load', () => {
    ready = true;
    if (last >= 0) post(last);
  });
  return {
    size: (maxW) => ({ w: maxW, h: p.height }),
    place(b) {
      Object.assign(frame.style, { width: `${b.w}px`, height: `${b.h}px`, border: '0', display: 'block' });
    },
    update(_get, t) {
      if (Math.abs(t - last) < 1 / 60) return;
      last = t;
      if (ready) post(t);
    },
  };
};
