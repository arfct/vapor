import { Link } from "react-router";
import type { ReactNode } from "react";

/**
 * Shared shell for the /privacy and /terms pages: the vapor wordmark, a
 * readable single column, and consistent heading treatment.
 */
export default function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="flex h-[60px] items-stretch border-b border-border">
        <Link
          to="/"
          className="flex items-center px-4 font-medium tracking-wider text-ink transition-colors hover:bg-border"
        >
          vapor
        </Link>
        <div className="flex grow items-center px-4 font-mono text-sm uppercase tracking-wider text-muted">
          {title}
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-6 py-10 leading-relaxed [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-medium [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:mt-1">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-muted">Last updated {updated}</p>
        {children}
      </main>
      <footer className="mx-auto max-w-2xl px-6 pb-10 text-sm text-muted">
        <Link to="/privacy" className="text-ink hover:text-coral">
          Privacy
        </Link>
        {" · "}
        <Link to="/terms" className="text-ink hover:text-coral">
          Terms
        </Link>
        {" · "}
        <a
          href="https://github.com/arfct/vapor"
          target="_blank"
          rel="noopener noreferrer"
          className="text-ink hover:text-coral"
        >
          GitHub
        </a>
      </footer>
    </div>
  );
}
