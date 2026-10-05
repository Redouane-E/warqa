// The first visit: the welcome page and the start guide in English and Arabic (right to left), the provider
// step's key guide and privacy note, and no sideways scrolling on a phone.
import { expect, test } from '@playwright/test';

test('the first visit is in English, and in Arabic from right to left', async ({ page }) => {
  await page.goto('./');
  // no books yet: the welcome page
  await expect(page).toHaveURL(/\/warqa\/welcome$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Turn a PDF into a lesson that');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('حوّل ملف PDF إلى درس');

  // the guide's first question, its cards starting on the right
  await page.getByRole('button', { name: 'أنشئ كتابي الأول' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'كيف ستستعمل ورقة؟' })).toBeVisible();
  const card = await page.locator('.welcome-card').boundingBox();
  const title = await page.getByRole('heading', { level: 1 }).boundingBox();
  expect(card && title && card.x + card.width - (title.x + title.width)).toBeLessThan(60);
  await expect(page.getByRole('button', { name: 'متابعة' })).toBeDisabled();
  await page.getByRole('radio', { name: 'أُدرّس' }).check();
  await page.getByRole('button', { name: 'متابعة' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'اربط نموذج ذكاء اصطناعي' })).toBeVisible();
  await page.getByRole('radio', { name: /Google Gemini/ }).check();
  await expect(page.getByRole('link', { name: /aistudio\.google\.com/ })).toHaveAttribute(
    'href',
    'https://aistudio.google.com/apikey',
  );
  await expect(page.getByText('مفتاحك يبقى في هذا المتصفح')).toBeVisible();
  // a key must be checked before going on
  await expect(page.getByRole('button', { name: 'التالي' })).toBeDisabled();
});

test.describe('in a browser set to Arabic', () => {
  test.use({ locale: 'ar-MA' });
  test('the guide opens in Arabic', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('button', { name: 'تخطَّ الدليل' })).toBeVisible();
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const lang of ['ar', 'en']) {
    test(`nothing scrolls sideways (${lang})`, async ({ page }) => {
      await page.addInitScript((l) => localStorage.setItem('warqa-studio:lang', l), lang);
      await page.goto('./');
      await expect(page.locator('.welcome-hero')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.getByRole('button', { name: lang === 'ar' ? 'تخطَّ الدليل' : 'Skip the guide' }).click();
      await expect(page.locator('.web-status')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
  }
});
