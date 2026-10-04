// The web app's own strings, in the studio's interface language (same language store and number formatting).
import { useCallback } from 'react';
import { type Params, useI18n } from '../../../studio/src/client/i18n';
import { WEB_CATALOGS, type WebKey } from './messages';

export type W = (key: WebKey, params?: Params) => string;

export function useW(): W {
  const { lang, num } = useI18n();
  return useCallback(
    (key, params = {}) => {
      const s = WEB_CATALOGS[lang]?.[key] ?? WEB_CATALOGS.en![key];
      return s.replace(/\{(\w+)\}/g, (_, k: string) => {
        const v = params[k];
        if (v === undefined) return `{${k}}`;
        return typeof v === 'number' ? num(v) : v;
      });
    },
    [lang, num],
  );
}
