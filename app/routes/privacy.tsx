import LegalPage from "~/components/LegalPage";
import type { Route } from "./+types/privacy";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "vapor — privacy" }];
}

export default function Privacy() {
  return (
    <LegalPage title="Privacy" updated="August 30, 2026">
      <p>
        vapor is a collaborative markdown editor operated by Artifact. This page describes what
        vapor stores and why, in plain language.
      </p>

      <h2>Documents are public and temporary</h2>
      <p>
        Every document is readable and editable by anyone who has its URL — there are no private
        documents. Document content, comments, and tracked changes are stored on our
        infrastructure only for the document's lifetime and are automatically and permanently
        deleted about 99 hours after creation. Don't put anything in a document you wouldn't
        share with everyone who might hold the link.
      </p>

      <h2>Anonymous use</h2>
      <p>
        You can use vapor without an account. Anonymous visitors get a randomly generated
        identity — an id, an animal, and a colour — stored only in your own browser's
        localStorage. It's used to label your cursor and comments (for example "Anonymous
        Otter") and is not tied to your name, email, or IP address by us. Clearing your browser
        storage discards it.
      </p>

      <h2>If you sign in</h2>
      <p>
        Sign-in is optional and uses Google. When you sign in we receive and store your email
        address, display name, and avatar image URL from Google, and we set a session cookie
        (<code>vp_session</code>) so you stay signed in. We use these only to attribute your
        presence, comments, and agents to you. We never see or store your Google password, and
        we don't post anything to your Google account.
      </p>

      <h2>AI agents</h2>
      <p>
        vapor lets you connect AI agents (via the Model Context Protocol) that read and edit
        documents. When you authorize an agent with your identity, we record the grant you chose
        and the agent's activity is attributed to you in each document's agent roster. You can
        revoke an agent from a document's Agents panel, or revoke the whole grant from your MCP
        client. Anonymous agent connections are recorded per session, tied to nothing but that
        session.
      </p>

      <h2>What we don't do</h2>
      <ul>
        <li>No advertising, and no selling or sharing of personal data.</li>
        <li>No tracking cookies. The only cookie is the optional sign-in session.</li>
        <li>
          No training of AI models on your documents. Agents you connect see only what you point
          them at, under the access you granted.
        </li>
      </ul>

      <h2>Infrastructure</h2>
      <p>
        vapor runs on Cloudflare Workers, so requests pass through Cloudflare's network and are
        subject to their standard operational logging. If analytics are enabled, we use Fathom,
        a cookieless, privacy-focused analytics service that does not track individuals.
      </p>

      <h2>Data removal</h2>
      <p>
        Documents remove themselves — everything in a document is permanently deleted when it
        expires. To remove a signed-in profile (email, name, avatar) sooner, open an issue at{" "}
        <a
          href="https://github.com/arfct/vapor"
          className="text-ink underline hover:text-coral"
        >
          github.com/arfct/vapor
        </a>{" "}
        or contact Artifact, and we'll delete it.
      </p>

      <h2>Changes</h2>
      <p>
        If this policy changes materially, we'll update this page and the date above. Continued
        use after a change means you accept the updated policy.
      </p>
    </LegalPage>
  );
}
