import { createContext, useContext } from "react";
import type { SitePage } from "./api.ts";
import type { Viewport } from "./Toolbar.tsx";

/** What widgets need to know about the editor around them. */
export interface EditorEnvironment {
  /** The site's pages, offered when a link is chosen. */
  pages: SitePage[];
  /** The preview size in use; per-breakpoint settings follow it. */
  viewport: Viewport;
}

const EditorContext = createContext<EditorEnvironment>({ pages: [], viewport: "desktop" });

export const EditorProvider = EditorContext.Provider;

export function useEditor(): EditorEnvironment {
  return useContext(EditorContext);
}
