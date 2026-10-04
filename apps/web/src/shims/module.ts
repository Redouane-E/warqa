// node:module for the browser build. The studio and the pipeline only use createRequire to find package folders
// (the player bundle, pdf.js data) and to read the studio's version; the worker puts those files in its virtual
// file system under /app.
const RESOLVE: Record<string, string> = {
  '@warqa/lesson/package.json': '/app/lesson/package.json',
  'pdfjs-dist/package.json': '/app/pdfjs/package.json',
};

export function createRequire(_from?: string | URL) {
  const req = (id: string): unknown => {
    if (id.endsWith('package.json')) return { name: '@warqa/studio', version: __STUDIO_VERSION__ };
    throw new Error(`require("${id}") is not available in the browser`);
  };
  req.resolve = (id: string): string => {
    const p = RESOLVE[id];
    if (!p) throw new Error(`cannot resolve "${id}" in the browser`);
    return p;
  };
  return req;
}

export const builtinModules: string[] = [];
export default { createRequire, builtinModules };
