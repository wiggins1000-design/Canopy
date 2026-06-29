import { Link } from 'react-router-dom'

function Section({ n, title, children }) {
  return (
    <section>
      <h2 className="text-lg font-bold text-gray-900 mb-3">{n}. {title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" }}>

      {/* Nav */}
      <nav className="bg-[#1b4332] sticky top-0 z-50 shadow-sm">
        <div className="max-w-3xl mx-auto px-5 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <img src="/CanopyGreenLogo.gif" alt="Canopy" style={{ height: 28 }} />
            <span className="text-white font-bold text-xl tracking-tight">parentingplan.help</span>
          </Link>
          <Link to="/" className="text-[#d8f3dc] hover:text-white text-sm transition-colors">&larr; Back to home</Link>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-5 py-16">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-gray-400 text-sm mb-10">Last updated: 30 June 2026 &middot; Applies to parentingplan.help only</p>

        <div className="space-y-10 text-gray-700 text-sm leading-relaxed">

          <Section n={1} title="Who we are">
            <p>parentingplan.help (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) is operated by <strong>Chrysalis Works Ltd</strong>, a company registered in England and Wales, which also operates the Canopy family app. parentingplan.help is a separate, free-standing tool with its own data practices, set out in this policy. It is not part of a Canopy subscription and does not require a Canopy account.</p>
            <p><strong>Registered office:</strong> Suite A, 82 James Carter Road, Mildenhall, IP28 7DE, United Kingdom</p>
            <p><strong>Contact:</strong> <a href="mailto:hello@canopy-app.app" className="text-[#2d6a4f] hover:underline">hello@canopy-app.app</a></p>
            <p>We are registered with the Information Commissioner&rsquo;s Office (ICO) as required under the UK GDPR and the Data Protection Act 2018, and act as data controller for personal data processed through parentingplan.help.</p>
          </Section>

          <Section n={2} title="What data we collect">
            <div>
              <p className="font-semibold text-gray-800">Plan content</p>
              <p>The names of both parents and any children, children&rsquo;s dates of birth, and the free-text and selected answers you give across the plan-builder sections &mdash; schedule, handovers, holidays, travel, digital life, communication, childcare, education, health, decisions, and money. This may include incidental health information about a child (for example, a note about an allergy or appointment routine) where you choose to include it.</p>
            </div>
            <div>
              <p className="font-semibold text-gray-800">Account data</p>
              <p>If you save a plan, your email address. We use passwordless &ldquo;magic link&rdquo; sign-in &mdash; we never collect or store a password.</p>
            </div>
            <div>
              <p className="font-semibold text-gray-800">Collaboration data</p>
              <p>If you invite a second parent to review and amend the plan, their email address, and a record of each version (&ldquo;draft&rdquo;) submitted by either party with a timestamp.</p>
            </div>
            <div>
              <p className="font-semibold text-gray-800">Technical data</p>
              <p>Authentication session tokens. Before you save a plan, your in-progress answers are held only in your browser&rsquo;s local storage &mdash; we have no copy of them.</p>
            </div>
          </Section>

          <Section n={3} title="Lawful basis for processing">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left p-3 border border-gray-200 font-semibold text-gray-800">Processing activity</th>
                    <th className="text-left p-3 border border-gray-200 font-semibold text-gray-800">Lawful basis</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td className="p-3 border border-gray-200">Building, saving, and sharing your plan</td><td className="p-3 border border-gray-200">Performance of contract</td></tr>
                  <tr className="bg-gray-50"><td className="p-3 border border-gray-200">Magic-link sign-in and invite emails</td><td className="p-3 border border-gray-200">Performance of contract</td></tr>
                  <tr><td className="p-3 border border-gray-200">AI plan review</td><td className="p-3 border border-gray-200">Performance of contract (a feature you actively choose to run)</td></tr>
                  <tr className="bg-gray-50"><td className="p-3 border border-gray-200">Payment for AI review (where enabled)</td><td className="p-3 border border-gray-200">Performance of contract</td></tr>
                  <tr><td className="p-3 border border-gray-200">Compliance with legal obligations</td><td className="p-3 border border-gray-200">Legal obligation</td></tr>
                </tbody>
              </table>
            </div>
          </Section>

          <Section n={4} title="How we use your data">
            <ul className="list-disc pl-5 space-y-2">
              <li>To generate and display your parenting plan</li>
              <li>To save your plan and let you return to it later</li>
              <li>To send invite and draft-update emails between the two parents using the tool</li>
              <li>To run the AI review feature, where you request it</li>
              <li>To produce the printable / PDF version of your plan</li>
              <li>To investigate and resolve technical issues</li>
            </ul>
            <p className="font-medium">We do not sell your data. We do not use your data for advertising. We do not use it for marketing profiling.</p>
          </Section>

          <Section n={5} title="Who we share data with">
            <p>We share data only with the following service providers, only as necessary to operate the tool, and only as data processors under appropriate agreements.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left p-3 border border-gray-200 font-semibold text-gray-800">Provider</th>
                    <th className="text-left p-3 border border-gray-200 font-semibold text-gray-800">Purpose</th>
                    <th className="text-left p-3 border border-gray-200 font-semibold text-gray-800">Location</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td className="p-3 border border-gray-200 font-medium">Supabase</td><td className="p-3 border border-gray-200">Database, authentication, and edge functions</td><td className="p-3 border border-gray-200">USA</td></tr>
                  <tr className="bg-gray-50"><td className="p-3 border border-gray-200 font-medium">Anthropic</td><td className="p-3 border border-gray-200">AI review of plan content (when you request it)</td><td className="p-3 border border-gray-200">USA</td></tr>
                  <tr><td className="p-3 border border-gray-200 font-medium">Resend</td><td className="p-3 border border-gray-200">Transactional email (sign-in links, invites, draft updates)</td><td className="p-3 border border-gray-200">USA</td></tr>
                  <tr className="bg-gray-50"><td className="p-3 border border-gray-200 font-medium">Railway</td><td className="p-3 border border-gray-200">Application hosting</td><td className="p-3 border border-gray-200">USA</td></tr>
                  <tr><td className="p-3 border border-gray-200 font-medium">Stripe</td><td className="p-3 border border-gray-200">Payment processing for the paid AI review (not yet live)</td><td className="p-3 border border-gray-200">USA / Global</td></tr>
                </tbody>
              </table>
            </div>
          </Section>

          <Section n={6} title="International data transfers">
            <p>Several of our service providers are based in the United States. Where personal data is transferred outside the UK, we rely on Standard Contractual Clauses (SCCs) and/or the UK International Data Transfer Addendum (IDTA), or an equivalent legal basis such as the EU-US Data Privacy Framework, under Data Processing Agreements with each processor.</p>
            <p>Plan content sent to Anthropic for the AI review is used solely to generate that review and is not retained beyond the processing window or used to train AI models.</p>
          </Section>

          <Section n={7} title="AI plan review">
            <p>If you choose to run the AI review, the content of your plan (parent and child first names, and your answers across each section) is sent to Anthropic&rsquo;s Claude AI, which returns a completeness score, suggested gaps, strengths, and &mdash; where two drafts have been submitted &mdash; a comparison highlighting where the drafts differ and suggested compromise wording.</p>
            <p>This is an optional feature you actively start by clicking &ldquo;Run AI review&rdquo;. It is not run automatically. The AI&rsquo;s output is a suggestion only, not legal advice, and is not retained by Anthropic to train models.</p>
          </Section>

          <Section n={8} title="Two-parent collaboration">
            <p>parentingplan.help is designed for two parents to work on the same plan. If you invite a second parent, they will see the answers you have entered so far, and you will see theirs once they submit a draft. Each of you is a recipient of the other&rsquo;s personal data for the purpose of reaching a shared plan &mdash; only invite someone you intend to share this information with.</p>
            <p>The second parent does not need a Canopy account, only an email address to receive the magic-link invite.</p>
          </Section>

          <Section n={9} title="Children's data">
            <p>parentingplan.help is for use by adults (18+) to draft arrangements about their children. Children do not create accounts or access the tool directly. All information about children is entered by a parent and is visible only to the parents collaborating on that plan (and, where you run it, to the AI review feature described above).</p>
          </Section>

          <Section n={10} title="Data retention">
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Before you save:</strong> your answers exist only in your browser&rsquo;s local storage. We have no record of them until you choose to sign in and save.</li>
              <li><strong>After you save:</strong> your plan and its draft history are retained for as long as you or your co-parent continue to use the tool for that plan.</li>
              <li><strong>Deletion on request:</strong> we do not currently offer in-app account deletion for parentingplan.help. Email <a href="mailto:hello@canopy-app.app" className="text-[#2d6a4f] hover:underline">hello@canopy-app.app</a> and we will delete your plan and account data, usually within a few days.</li>
              <li><strong>Backups:</strong> deleted data may persist in encrypted backups for up to 30 days before being permanently purged.</li>
            </ul>
          </Section>

          <Section n={11} title="Your rights">
            <p>Under UK GDPR you have the right to access, correct, delete, or export the personal data we hold about you, and to object to or restrict processing in certain circumstances. To exercise any of these rights, email <a href="mailto:hello@canopy-app.app" className="text-[#2d6a4f] hover:underline">hello@canopy-app.app</a>. We aim to respond within 14 days and will always respond within the statutory 30-day period.</p>
            <p>If you believe we have not handled your data correctly, you may complain to the Information Commissioner&rsquo;s Office (ICO) at <a href="https://ico.org.uk" className="text-[#2d6a4f] hover:underline">ico.org.uk</a> or by calling 0303 123 1113.</p>
          </Section>

          <Section n={12} title="Security">
            <p>We use row-level security so that only the parents collaborating on a plan can access it, passwordless magic-link sign-in (so there is no password to compromise), and HTTPS for all data in transit. No system is completely secure; if you become aware of a security issue, contact us immediately at <a href="mailto:hello@canopy-app.app" className="text-[#2d6a4f] hover:underline">hello@canopy-app.app</a>.</p>
          </Section>

          <Section n={13} title="Cookies and local storage">
            <p>We do not use advertising cookies, tracking pixels, or third-party analytics. We use your browser&rsquo;s local storage to hold your in-progress plan before you sign in, and an essential session cookie/token to keep you signed in once you have saved a plan.</p>
          </Section>

          <Section n={14} title="Changes to this policy">
            <p>We may update this policy from time to time. The current version is always available at this URL. Material changes affecting saved plans will be notified by email to account holders at least 14 days before they take effect.</p>
          </Section>

          <Section n={15} title="Contact us">
            <p>For any questions about this policy or to exercise your rights:</p>
            <p className="mt-2"><strong>Chrysalis Works Ltd (operating parentingplan.help)</strong></p>
            <p className="mt-1">Suite A, 82 James Carter Road, Mildenhall, IP28 7DE</p>
            <p className="mt-1"><strong>Email:</strong> <a href="mailto:hello@canopy-app.app" className="text-[#2d6a4f] hover:underline">hello@canopy-app.app</a></p>
          </Section>

        </div>
      </main>

      {/* Footer */}
      <footer style={{ background: '#111827', color: '#9ca3af' }} className="py-8 px-5 text-center text-sm">
        <Link to="/" className="text-white font-bold">parentingplan.help</Link>
        <span className="mx-3">&middot;</span>
        <Link to="/terms" className="hover:text-white transition-colors">Terms of Use</Link>
        <span className="mx-3">&middot;</span>
        <span>&copy; 2026 Chrysalis Works Ltd</span>
      </footer>

    </div>
  )
}
