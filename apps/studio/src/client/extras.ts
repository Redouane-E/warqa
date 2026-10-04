// Places where a host can add its own controls to the studio screens. The local studio adds none; the web app adds
// its backup, import and example-book actions, and a banner.
import { createContext, type ReactNode, useContext } from 'react';

export interface StudioExtras {
  /** Under the top bar, on every screen. */
  banner?: ReactNode;
  /** Next to "New book" on the home screen. */
  homeActions?: ReactNode;
  /** In a project's header, next to Settings. */
  projectActions?: (id: string) => ReactNode;
}

export const ExtrasContext = createContext<StudioExtras>({});
export const useExtras = () => useContext(ExtrasContext);
