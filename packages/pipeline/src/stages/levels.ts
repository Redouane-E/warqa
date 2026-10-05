// Self-learners' levels and the audience text each one gives the plan, storyboard and write stages.
import type { Book } from '@warqa/lesson';

export const LEARN_LEVELS = ['beginner', 'some', 'advanced'] as const;
export type LearnLevel = (typeof LEARN_LEVELS)[number];

export const LEARNER_AUDIENCE: Record<LearnLevel, string> = {
  beginner:
    'a person learning on their own who is new to this subject: explain every term, go slowly, use many everyday examples',
  some: 'a person learning on their own who knows the basics: short reminders, a steady pace, practice on each idea',
  advanced: 'a person learning on their own who knows the subject well: skip the basics, go deeper, harder practice',
};

const LANG_NAMES: Record<string, string> = { ar: 'Arabic', ary: 'Moroccan Darija', fr: 'French', en: 'English' };

/**
 * The audience of a learner's book at its current level (undefined for a teacher's book). When the PDF is in
 * another language, the learner keeps the words of that language they will meet in class or at work.
 */
export function learnerAudience(
  book: Pick<Book, 'learn' | 'sourceLang' | 'defaultLang' | 'langs'>,
): string | undefined {
  if (!book.learn) return undefined;
  const audience = LEARNER_AUDIENCE[book.learn.level];
  const teach = book.defaultLang ?? book.langs[0];
  const source = book.sourceLang;
  if (!source || !teach || source.split('-')[0] === teach.split('-')[0]) return audience;
  const name = LANG_NAMES[source] ?? source;
  return `${audience}. The PDF is in ${name}: keep the ${name} words they need (give the ${name} term in parentheses the first time each key term appears)`;
}
