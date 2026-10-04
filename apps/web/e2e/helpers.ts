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

/** Wait for the job shown on the activity board to finish, and return its final state. */
export async function jobDone(page: Page, timeout = 90_000): Promise<string> {
  const pill = page.locator('.board .board-head .pill');
  await expect(pill).toHaveClass(/pill-(done|error|cancelled)/, { timeout });
  return (await pill.getAttribute('class')) ?? '';
}

/** Pick a step of the project page. */
export const step = (page: Page, name: RegExp) => page.locator('.stepper').getByRole('button', { name });
