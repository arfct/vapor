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
  { rel: "icon", type: "image/svg+xml", href: "/logo.svg" },
  { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
  { rel: "icon", type: "image/png", href: "/favicon-32.png", sizes: "32x32" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
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
  {
    // Monochrome emoji for anonymous-animal presence — glyphs inherit
    // `color`, so animals can wear the user's cursor colour.
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Noto+Emoji:wght@400;600&display=swap",
  },
  {
    // Subset to the icon names actually used — keep this list sorted and in
    // sync with <Icon name> usages or new glyphs render as raw text.
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&icon_names=account_circle,add,check,chevron_left,chevron_right,close,code,comment,computer,content_copy,dark_mode,delete,done_all,download,edit,format_bold,format_h1,format_h2,format_h3,format_italic,format_list_bulleted,format_list_numbered,format_paragraph,format_quote,format_size,horizontal_rule,ios_share,light_mode,link,logout,more_vert,note_add,rate_review,remove_done,robot_2,strikethrough_s,undo,upload_file,visibility&display=block",
  },
];

const themeScript = `(function(){var t=localStorage.getItem('vapor-theme')||'auto';document.documentElement.setAttribute('data-theme',t)})()`;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="auto">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
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
