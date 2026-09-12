import LegalPage from "~/components/LegalPage";
import type { Route } from "./+types/privacy";
import { useSite } from "~/lib/site-context";
import { displayHost } from "~/shared/site";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "vapor — privacy" }];
}

export default function Privacy() {
  const { operatorName, sourceUrl } = useSite();
  return (
    <LegalPage title="Privacy" updated="September 6, 2026">
      <p>
        vapor is a collaborative markdown editor{operatorName ? ` operated by ${operatorName}` : ""}.
        This page describes what this instance stores and why, in plain language.
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
        Sign-in is optional, through Google or Apple, whichever this instance offers. When you
        sign in we receive and store your email address and display name, plus an avatar image URL
        from Google, and we set a session cookie (<code>vp_session</code>) so you stay signed in.
        We use these only to attribute your presence, comments, and agents to you. We never see or
        store your password with either provider, and we don't post anything to your account
        there. If you use Apple's Hide My Email, the relay address is what we store, and it is the
        address other people would need to mention you by.
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

      <h2>What is stored, why, who sees it, and for how long</h2>
      <table className="mt-3 w-full text-sm [&_td]:border-t [&_td]:border-border [&_td]:py-2 [&_td]:pr-3 [&_td]:align-top [&_th]:pb-2 [&_th]:pr-3 [&_th]:text-left [&_th]:font-medium">
        <thead>
          <tr>
            <th>Data</th>
            <th>Purpose</th>
            <th>Recipients</th>
            <th>Kept</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Document text, comments, tracked changes, attachments</td>
            <td>Showing and syncing the document to everyone with its link</td>
            <td>Anyone holding the link; the infrastructure below</td>
            <td>99 hours from creation, then deleted with the document</td>
          </tr>
          <tr>
            <td>Anonymous visitor label (random name, colour, browser id)</td>
            <td>Labelling your cursor and comments</td>
            <td>Collaborators on the same document</td>
            <td>In your browser until you clear it; on a document until it expires</td>
          </tr>
          <tr>
            <td>Signed-in profile: email, display name, avatar URL, provider account id</td>
            <td>Attributing your presence, comments, and agents to you</td>
            <td>Collaborators see the name and avatar; the email and account id stay on the server</td>
            <td>Until you ask for removal</td>
          </tr>
          <tr>
            <td>Agent grants and personal access tokens (hashed)</td>
            <td>Letting your agents act as you at the capability you chose</td>
            <td>Nobody else</td>
            <td>Until revoked; OAuth refresh grants expire on their own</td>
          </tr>
          <tr>
            <td>Wake targets, Kindle address, reMarkable pairing (secrets sealed)</td>
            <td>Waking your agent; sending documents to your devices</td>
            <td>The routine or webhook you named; Amazon (via the mail sender) or reMarkable's cloud, only when you send</td>
            <td>Until you remove them</td>
          </tr>
          <tr>
            <td>Request logs</td>
            <td>Operating the service</td>
            <td>The operator, and Cloudflare as the host</td>
            <td>Cloudflare's standard retention</td>
          </tr>
        </tbody>
      </table>
      <p>
        Nothing here is sold or used for advertising, profiling, or training models. Agents you connect see only the
        documents you point them at.
      </p>

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
        <a href={sourceUrl} className="text-ink underline hover:text-coral">
          {displayHost(sourceUrl)}
          {new URL(sourceUrl).pathname.replace(/\/$/, "")}
        </a>
        {operatorName ? ` or contact ${operatorName}` : ""}, and it will be deleted.
      </p>

      <h2>Changes</h2>
      <p>
        If this policy changes materially, we'll update this page and the date above. Continued
        use after a change means you accept the updated policy.
      </p>
    </LegalPage>
  );
}
