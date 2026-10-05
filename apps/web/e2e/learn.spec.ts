// Learning on your own, in the browser with the test-only scripted model (?warqa-fake=1, nothing spent): the
// first visit's question, the PDF, the language (the PDF's own is detected), the level, the summary with its
// time and cost, "Teach me", the one go, chapter 1 in the player with the learner's finish card (the level moves,
// chapter 2 is made from it), and What I'm learning with the next chapter.
import { expect, test } from '@playwright/test';
import { fixture } from './helpers';

test('a PDF becomes a course, chapter by chapter (test model)', async ({ page }) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => localStorage.setItem('warqa-studio:lang', 'en'));
  await page.goto('./?warqa-fake=1');
  await page.getByRole('button', { name: 'Make my first book' }).click();
  await page.getByRole('radio', { name: 'I’m learning for myself' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/warqa\/learn\/new$/);

  // the PDF, with the copyright note
  await expect(page.getByRole('heading', { level: 1, name: 'Which PDF do you want to understand?' })).toBeVisible();
  await expect(page.getByRole('note')).toContainText('for your own use');
  await page.getByTestId('drop-input').setInputFiles(fixture('textbook-en.pdf'));
  await expect(page.getByText('textbook-en.pdf')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();

  // the language: the PDF's own is detected and named
  await expect(page.getByRole('heading', { level: 1, name: 'Which language should Warqa teach you in?' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('Your PDF is in English.')).toBeVisible();
  await page.getByRole('radio', { name: /^English/ }).click();

  // the level (a card moves on by itself)
  await expect(page.getByRole('heading', { level: 1, name: 'How much do you already know about this?' })).toBeVisible();
  await page.getByRole('radio', { name: /^Beginner/ }).click();

  // the summary: time and cost before anything is spent
  await expect(page.getByRole('heading', { level: 1, name: 'Ready to teach you' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.learn-estimate')).toContainText('your limit $1.00');
  await expect(page.getByRole('link', { name: 'I’d rather review the plan first' })).toHaveAttribute(
    'href',
    /\/warqa\/project\/textbook-en\?step=plan$/,
  );
  await page.getByRole('button', { name: 'Teach me' }).click();

  // the one go, then chapter 1 opens by itself in the player
  await expect(page).toHaveURL(/\/warqa\/learn\/textbook-en/);
  await expect(page).toHaveURL(/\/warqa\/learn\/textbook-en\/ch01\?play=1$/, { timeout: 90_000 });
  await expect(page.locator('.learn-player-host .wq-player')).toBeVisible();
  await expect(page.locator('.learn-player .kicker')).toContainText('Chapter 1 of 3');

  // the end of the chapter: the learner's finish card
  await page.locator('.learn-player-host .wq-seg').last().click();
  const card = page.locator('.wq-finish');
  await expect(card.getByRole('group', { name: 'How was this chapter?' })).toBeVisible({ timeout: 20_000 });
  await card.getByRole('button', { name: 'Too easy' }).click();
  await expect(card).toContainText('Your level now: I know some');
  // the next chapter is made only when asked, from the card
  await card.getByRole('button', { name: /^Make chapter 2/ }).click();
  await expect(card).toContainText('Chapter 2 is ready', { timeout: 90_000 });
  await card.getByRole('button', { name: 'Open' }).click();
  await expect(page).toHaveURL(/\/warqa\/learn\/textbook-en\/ch02\?play=1$/);

  // What I'm learning: the course, its chapters, its new level, and the next chapter made on demand
  await page.locator('.strips').getByRole('link', { name: 'What I’m learning' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'What I’m learning' })).toBeVisible();
  const course = page.locator('.course-card');
  await expect(course).toContainText('Chapters made: 2 of 3');
  await expect(course).toContainText('English · I know some');
  await course.getByRole('button', { name: /^Make chapter 3/ }).click();
  await expect(page).toHaveURL(/\/warqa\/learn\/textbook-en\/ch03\?play=1$/, { timeout: 90_000 });

  // an address with a job the server no longer knows (after a reload) opens the course where it is
  await page.goto('learn/textbook-en?job=gone');
  await expect(page).toHaveURL(/\/warqa\/learn\/textbook-en\/ch03$/);

  // the course is an ordinary book for a teacher too
  await page.getByRole('link', { name: 'Open as a teacher' }).click();
  await expect(page).toHaveURL(/\/warqa\/project\/textbook-en$/);
  await expect(page.locator('.stepper')).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('the setup reads right to left in Arabic, without sideways scrolling', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('warqa-studio:lang', 'ar');
      localStorage.setItem('warqa-studio:onboarded', '1');
    });
    await page.goto('./learn/new?warqa-fake=1');
    await expect(page.getByRole('heading', { level: 1, name: 'أيّ ملف PDF تريد أن تفهم؟' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByTestId('drop-input').setInputFiles(fixture('textbook-en.pdf'));
    await page.getByRole('button', { name: 'التالي' }).click();
    await expect(page.getByRole('radio', { name: /^العربية/ })).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
