// node:url for the browser build.
export const fileURLToPath = (u: string | URL): string => decodeURIComponent(new URL(String(u)).pathname);
export const pathToFileURL = (p: string): URL => new URL(`file://${encodeURI(p)}`);
const _URL = globalThis.URL;
const _URLSearchParams = globalThis.URLSearchParams;

export { _URL as URL, _URLSearchParams as URLSearchParams };
export default { fileURLToPath, pathToFileURL, URL: _URL, URLSearchParams: _URLSearchParams };
