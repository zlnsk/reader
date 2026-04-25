// Public privacy policy — linked from the Play Store listing and the in-app
// settings page. Inline styles so it renders cleanly regardless of the
// surrounding theme state.
export const metadata = { title: "Privacy — Reader" };

const Section = ({ h, children }: { h: string; children: React.ReactNode }) => (
  <section style={{ marginTop: 28 }}>
    <h2 style={{ fontSize: 20, margin: "0 0 8px", fontFamily: "'Source Serif 4', Georgia, serif", fontWeight: 500 }}>{h}</h2>
    <div style={{ fontSize: 15, lineHeight: 1.6, color: "#3a3530" }}>{children}</div>
  </section>
);

export default function PrivacyPage() {
  return (
    <main style={{
      maxWidth: 720,
      margin: "0 auto",
      padding: "56px 24px 96px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', sans-serif",
      color: "#1a1714",
      background: "#FBF7F1",
      minHeight: "100dvh",
    }}>
      <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "#5C534B", margin: 0 }}>
        Reader · Privacy Policy
      </p>
      <h1 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontWeight: 400, fontSize: 40, lineHeight: 1.05, letterSpacing: "-0.02em", margin: "12px 0 4px" }}>
        What Reader knows about you.
      </h1>
      <p style={{ color: "#5C534B", fontSize: 15, margin: 0 }}>Last updated 18 April 2026.</p>

      <Section h="Who runs this service">
        <p>Reader is a personal reading app and accompanying server run by Lukasz (you@example.com). There is no company, no analytics provider, and no third-party ad network. Every backend service the app talks to is hosted by the same operator on <code>example.com</code>.</p>
      </Section>

      <Section h="What we store">
        <ul>
          <li><strong>Account</strong> — your email address and a scrypt-hashed copy of the app password you set. The plaintext password never leaves your device.</li>
          <li><strong>Library</strong> — books you upload or import (via OPDS / LibGen), their chapter text, and auto-generated covers.</li>
          <li><strong>Reading progress</strong> — the chapter and paragraph you last read, a finished-prompt flag, and the timestamp of the last update, so your position syncs across devices.</li>
          <li><strong>Preferences</strong> — typeface, size, theme, line spacing, and reading mode.</li>
          <li><strong>TTS cache</strong> — generated audio clips for paragraphs you've heard are cached on your device and on the server, keyed by a hash of the text + voice, so replaying doesn't re-bill the TTS API.</li>
        </ul>
      </Section>

      <Section h="What we do NOT store">
        <ul>
          <li>No analytics, telemetry, crash reports, advertising identifiers, or device fingerprints.</li>
          <li>No location data, contacts, calendar, photos, or any on-device sensor.</li>
          <li>No tracking cookies on the web client — a single session cookie carries your login.</li>
        </ul>
      </Section>

      <Section h="Third parties">
        <p>The server forwards specific text to these providers only at your explicit request:</p>
        <ul>
          <li><strong>Google (Gemini API)</strong> — when you tap "Listen" on a paragraph, the text is sent to Gemini TTS to synthesise speech. Google's privacy policy governs that transfer.</li>
          <li><strong>OpenRouter</strong> — when you use "Explain" on selected text, the selection and surrounding paragraph are sent to an OpenRouter-hosted model for a dictionary-style gloss.</li>
        </ul>
        <p>Neither provider receives your email address or any other account information. Neither is given a long-lived identifier tying requests back to you.</p>
      </Section>

      <Section h="Where it lives">
        <p>All data is stored in a Postgres database on a single server located in the EU (Poland). Backups are encrypted at rest. There is no CDN, replication, or cross-border transfer apart from the third-party API calls described above.</p>
      </Section>

      <Section h="Your rights">
        <p>You can:</p>
        <ul>
          <li>Sign out at any time — the app forgets the bearer token immediately.</li>
          <li>Revoke app passwords individually from the web settings page.</li>
          <li>Archive or delete books; deletion removes chapter text, covers, and progress rows.</li>
          <li>Request a full export or deletion of your account by emailing you@example.com — processed within seven days.</li>
        </ul>
      </Section>

      <Section h="Children">
        <p>Reader is not directed at children under 13. We do not knowingly collect data from anyone we believe to be under 13.</p>
      </Section>

      <Section h="Changes">
        <p>If this policy changes materially, the "Last updated" date above will move and the app will surface a banner on next launch. Substantive changes are also emailed to registered addresses.</p>
      </Section>

      <Section h="Contact">
        <p>Email <a href="mailto:you@example.com" style={{ color: "#C44818" }}>you@example.com</a> for any privacy question, export request, or deletion request.</p>
      </Section>
    </main>
  );
}
