// Places where a host can add its own controls to the studio screens. The local studio adds none; the web app adds
// its status line, backup, import and example-book actions, and the start guide's test model.
import { createContext, type ReactNode, useContext } from 'react';

export interface StudioExtras {
  /** Under the top bar, on every screen. */
  banner?: ReactNode;
  /** In the top bar, before the spend chip (the web app's "Runs in this browser · Your data"). */
  topbarStatus?: ReactNode;
  /** Next to "New book" on the home screen. */
  homeActions?: ReactNode;
  /** In a project's header, next to Settings. */
  projectActions?: (id: string) => ReactNode;
  /** Where to get the desktop version (the web app links to it where something needs it). */
  desktopUrl?: string;
  /** The start guide's host parts. */
  guide?: {
    /** Test mode: the scripted model is offered as a provider, and new books use it for every role. */
    fakeModel?: string;
    /** Open the bundled example book; resolves to the screen to show. */
    example?: () => Promise<string>;
  };
}

export const ExtrasContext = createContext<StudioExtras>({});
export const useExtras = () => useContext(ExtrasContext);
