// The editor's catalog (components, actions and question kinds as JSON Schemas), fetched once per book.
import { useEffect, useState } from 'react';
import type { EditorCatalog } from '../../../shared/types';
import { api } from '../../api';

const cache = new Map<string, Promise<EditorCatalog>>();

export function useCatalog(bookId: string): EditorCatalog | null {
  const [catalog, setCatalog] = useState<EditorCatalog | null>(null);
  useEffect(() => {
    let live = true;
    let p = cache.get(bookId);
    if (!p) {
      p = api.components(bookId);
      cache.set(bookId, p);
      // a failed fetch is tried again next time
      p.catch(() => cache.delete(bookId));
    }
    p.then((c) => live && setCatalog(c)).catch(() => {});
    return () => {
      live = false;
    };
  }, [bookId]);
  return catalog;
}
