import LegalPage from "~/components/LegalPage";
import type { Route } from "./+types/terms";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "vapor — terms" }];
}

export default function Terms() {
  return (
    <LegalPage title="Terms of service" updated="August 30, 2026">
      <p>
        vapor is a collaborative markdown editor operated by Artifact. By using vapor.fyi (and
        its companion domains vpr.fyi and vaporware.fyi) you agree to these terms. They're
        short, because the service is simple.
      </p>

      <h2>What vapor is</h2>
      <p>
        vapor gives you ephemeral, multiplayer markdown documents. Every document is public to
        anyone holding its URL, editable by anyone holding its URL, and automatically deleted
        about 99 hours after creation. AI agents can join documents as collaborators when
        someone connects them.
      </p>

      <h2>Your content</h2>
      <ul>
        <li>
          You keep whatever rights you have in what you write. By putting content in a document
          you grant vapor the permission needed to store, display, and sync it to other
          participants for the document's lifetime.
        </li>
        <li>
          You're responsible for what you post, and for having the right to post it. Don't post
          other people's private information, malware, or content that's illegal where you or we
          operate.
        </li>
        <li>
          Documents are not private and not permanent. Don't use vapor to store secrets,
          credentials, or anything you need to keep — export your markdown before it expires.
        </li>
      </ul>

      <h2>Agents</h2>
      <p>
        If you connect an AI agent, its actions in a document are your responsibility, under the
        capabilities you granted it. Rate limits apply to agents; attempts to evade them, flood
        documents, or abuse the service may be blocked.
      </p>

      <h2>Acceptable use</h2>
      <p>
        Don't attempt to disrupt the service, access others' data beyond what a document URL
        already makes public, or use vapor to harass people or distribute spam. We may remove
        content or block access to protect the service and its users.
      </p>

      <h2>No warranty</h2>
      <p>
        vapor is a work in progress, provided as-is and as-available, without warranties of any
        kind. Documents may be lost before their scheduled expiry; the service may change or be
        discontinued. To the maximum extent permitted by law, Artifact is not liable for any
        damages arising from your use of vapor, and our total liability is limited to the amount
        you paid to use it — which is nothing, because it's free.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms; material changes will be reflected on this page with a new
        date. Continued use after a change means you accept the updated terms. Questions or
        problems:{" "}
        <a
          href="https://github.com/arfct/vapor"
          className="text-ink underline hover:text-coral"
        >
          github.com/arfct/vapor
        </a>
        .
      </p>
    </LegalPage>
  );
}
