import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import Fathom from "~/components/Fathom";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&display=swap",
  },
];

const themeScript = `(function(){var t=localStorage.getItem('vapor-theme')||'auto';document.documentElement.setAttribute('data-theme',t)})()`;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="auto">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <Meta />
        <Links />
      </head>
      <body>
        <Fathom />
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let status = 500;
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    status = error.status;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    stack = error.stack;
  }

  if (status === 404) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center">
        <p className="mb-1 text-6xl font-light tracking-tight text-ink">404</p>
        <p className="mb-6 text-muted">vapor not found</p>
        <Link to="/" className="font-bold text-ink underline">
          vapor home
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <p className="mb-1 text-6xl font-light tracking-tight text-ink">{status}</p>
      <p className="mb-6 text-muted">Something went wrong</p>
      <Link to="/" className="font-bold text-ink underline">
        vapor home
      </Link>
      {stack && (
        <pre className="mt-8 max-w-2xl overflow-x-auto p-4 text-sm text-muted">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
