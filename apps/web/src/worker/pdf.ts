// pdf.js in the Web Worker: its own worker code runs on this thread (no nested worker), pages render on
// OffscreenCanvas, and its data files (CMaps, standard fonts, wasm decoders) come from the app's pdfjs/ folder.
import { setPdfPlatform } from '@warqa/pipeline';

/** pdf.js's canvas factory interface, on OffscreenCanvas (the default one needs a DOM document). */
class OffscreenCanvasFactory {
  create(width: number, height: number) {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) };
  }
  reset(cc: { canvas: OffscreenCanvas }, width: number, height: number) {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    cc.canvas.width = width;
    cc.canvas.height = height;
  }
  destroy(cc: { canvas: OffscreenCanvas | null; context: unknown }) {
    if (cc.canvas) cc.canvas.width = cc.canvas.height = 0;
    cc.canvas = null;
    cc.context = null;
  }
}

/** No SVG filters (they need a DOM): transfer maps and high-contrast modes are skipped, as in Node. */
class NoFilters {
  addFilter() {
    return 'none';
  }
  addHCMFilter() {
    return 'none';
  }
  addAlphaFilter() {
    return 'none';
  }
  addLuminosityFilter() {
    return 'none';
  }
  addKnockoutFilter() {
    return 'none';
  }
  addHighlightHCMFilter() {
    return 'none';
  }
  addSelectionHCMFilter() {
    return 'none';
  }
  addSelectionFilter() {
    return 'none';
  }
  createSelectionStyle() {
    return null;
  }
  destroy() {}
}

export function setupPdf(base: string): void {
  setPdfPlatform({
    // @ts-expect-error the worker module has no type declarations
    loadWorker: () => import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    assets: new URL(`${base}pdfjs/`, self.location.origin).href,
    documentParams: {
      CanvasFactory: OffscreenCanvasFactory,
      FilterFactory: NoFilters,
      // pdf.js's own code fetches CMaps and fonts (its page-side fetch looks at document.baseURI)
      useWorkerFetch: true,
    },
    createCanvas(width, height) {
      const canvas = new OffscreenCanvas(width, height);
      return {
        canvas,
        png: async () => new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()),
      };
    },
  });
}
