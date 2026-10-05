// Shared steps of the browser tests.
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

export const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** Open the studio with the start guide already done, in English (test mode: the scripted model). */
export async function openStudio(page: Page, opts: { fake?: boolean; lang?: string } = {}) {
  await page.addInitScript((lang) => {
    localStorage.setItem('warqa-web:onboarded', '1');
    if (!localStorage.getItem('warqa-studio:lang')) localStorage.setItem('warqa-studio:lang', lang);
  }, opts.lang ?? 'en');
  await page.goto(opts.fake ? './?warqa-fake=1' : './');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** The service worker controls the page (it serves audio, exported books and downloads from the worker). */
export async function serviceWorkerReady(page: Page) {
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, { timeout: 20_000 });
}

/** Wait for the job shown in the tray (open, or folded into its pill) to finish, and return its final state. */
export async function jobDone(page: Page, timeout = 90_000): Promise<string> {
  const pill = page.locator('.tray-head .pill, .tray-pill');
  await expect(pill).toHaveClass(/(pill|is)-(done|error|cancelled)/, { timeout });
  return ((await pill.getAttribute('class')) ?? '').replace(/\bis-/, 'pill-');
}

/** Answer the dialog that guards spending, replacing work or deleting, with its action (not the safe choice). */
export async function confirmDialog(page: Page, action: string | RegExp) {
  const dialog = page.locator('dialog.dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: action }).click();
  await expect(dialog).toBeHidden();
}

/** Pick a step of the project page. */
export const step = (page: Page, name: RegExp) => page.locator('.stepper').getByRole('button', { name });
