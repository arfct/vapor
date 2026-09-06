import { createContext, useContext, type ReactNode } from "react";
import { UPSTREAM_SOURCE_URL, type SiteConfig } from "~/shared/site";

/**
 * The instance's identity (origin, operator, source repo) as the server
 * resolved it for this request — see app/shared/site.ts. Provided by the
 * root route from its loader; the default is for renders with no router
 * (component tests), where the browser's own origin is the best guess.
 */
const SiteContext = createContext<SiteConfig | null>(null);

function browserDefault(): SiteConfig {
  return {
    origin: typeof window !== "undefined" ? window.location.origin : "",
    operatorName: null,
    sourceUrl: UPSTREAM_SOURCE_URL,
  };
}

export function SiteProvider({ site, children }: { site: SiteConfig; children: ReactNode }) {
  return <SiteContext.Provider value={site}>{children}</SiteContext.Provider>;
}

export function useSite(): SiteConfig {
  return useContext(SiteContext) ?? browserDefault();
}
