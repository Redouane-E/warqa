// A PDF chosen on one screen and used on the next (the welcome page's drop zone → the guide → the learner's
// setup). A File cannot travel in the address, so it waits here for the next screen to take it.
let pending: File | null = null;

export function passPdf(file: File | null): void {
  pending = file;
}

/** The PDF handed over, once (the next call returns null). */
export function takePdf(): File | null {
  const f = pending;
  pending = null;
  return f;
}
