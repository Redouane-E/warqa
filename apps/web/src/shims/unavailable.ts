// Stand-in for Node-only modules in the browser build (node:http, playwright, @napi-rs/canvas): importing works,
// using them explains that the feature needs the desktop version.
import { DesktopOnlyError } from './child_process';

const fail = (what: string) => () => {
  throw new DesktopOnlyError(what);
};

export const createServer = fail('A local web server');
export const createCanvas = fail('Native canvas rendering');
export const chromium = { launch: fail('Visual checks (Playwright)') };
export const firefox = chromium;
export const webkit = chromium;
export default { createServer, createCanvas, chromium, firefox, webkit };
