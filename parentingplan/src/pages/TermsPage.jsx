import { Link } from 'react-router-dom'
import { useSeo } from '../hooks/useSeo'

function Section({ n, title, children }) {
  return (
    <section>
      <h2 className="text-lg font-bold text-gray-900 mb-3">{n}. {title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

export default function TermsPage() {
  useSeo({
    title: 'Terms of Use | parentingplan.help',
    description: 'Terms of use for parentingplan.help.',
    path: '/terms',
  })
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
        <h1 className="text-4xl font-bold text-gray-900 mb-2">Terms of Use</h1>
        <p className="text-gray-400 text-sm mb-10">Last updated: 30 June 2026 &middot; Applies to parentingplan.help only</p>

        <div className="space-y-10 text-gray-700 text-sm leading-relaxed">

          <Section n={1} title="Acceptance">
            <p>By using parentingplan.help (&ldquo;the Service&rdquo;), you agree to be bound by these Terms of Use (&ldquo;Terms&rdquo;). If you do not agree, do not use the Service.</p>
            <p>These Terms form a legally binding agreement between you and <strong>Chrysalis Works Ltd</strong> (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;), a company registered in England and Wales. Registered office: Suite A, 82 James Carter Road, Mildenhall, IP28 7DE. Chrysalis Works Ltd also operates the Canopy app, but parentingplan.help can be used entirely independently of Canopy and does not require a Canopy subscription.</p>
          </Section>

          <Section n={2} title="The Service">
            <p>parentingplan.help is a free tool that helps two parents draft, share, and refine a parenting plan together, with optional AI-generated feedback. It is not a legal service, mediation service, or court-approved system, and using it does not create a lawyer-client or mediator relationship.</p>
            <p>The plan you produce is an advisory document reflecting what you and the other parent have entered. It is not legally binding on its own. If you want a legally binding arrangement, you should have it reviewed and, where appropriate, formalised by a family solicitor, mediator, or the court in your jurisdiction.</p>
          </Section>

          <Section n={3} title="Eligibility and use without an account">
            <ul className="list-disc pl-5 space-y-2">
              <li>You must be 18 years of age or older to use the Service.</li>
              <li>You can draft a plan without creating an account. Your in-progress answers are then stored only in your browser and are not visible to us.</li>
              <li>To save a plan, share it with a co-parent, or use the AI review, you must sign in with a one-time emailed link. There is no password to create or remember.</li>
              <li>You are responsible for the accuracy of the information you enter, including information about your children.</li>
            </ul>
          </Section>

          <Section n={4} title="Inviting a co-parent">
            <p>You may invite another parent to review and amend the plan. By doing so, you are choosing to share your plan content, including any information about your children, with that person. Make sure you send the invitation to the correct email address &mdash; we are not responsible for invitations sent to the wrong recipient.</p>
            <p>Either party may submit a new draft at any time. We do not mediate, approve, or adjudicate disagreements between drafts &mdash; that is for you, and where needed, your own legal or mediation advisers.</p>
          </Section>

          <Section n={5} title="AI plan review">
            <p>The Service offers an optional AI-generated review of your plan, produced using a third-party AI model (Anthropic&rsquo;s Claude). The review is a suggestion only &mdash; it is not legal advice, is not guaranteed to be accurate or complete, and should not be relied on as a substitute for professional advice.</p>
            <p>Where a paid unlock is required for additional reviews, pricing is shown in the Service at the time of purchase. Payments, where enabled, are processed by Stripe in accordance with their terms.</p>
          </Section>

          <Section n={6} title="Acceptable use">
            <p>You agree not to:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Use the Service to harass, intimidate, or abuse any other person, including a co-parent</li>
              <li>Enter content that is unlawful, defamatory, or that violates a third party&rsquo;s rights</li>
              <li>Attempt to access a plan you have not been invited to</li>
              <li>Reverse-engineer, decompile, or attempt to extract the source code of the Service</li>
              <li>Use the Service in any way that could damage, disable, overburden, or impair it</li>
            </ul>
            <p>We reserve the right to suspend or terminate access for anyone we reasonably believe is using the Service in breach of these Terms.</p>
          </Section>

          <Section n={7} title="Your content">
            <p>You retain ownership of the plan content you and your co-parent create. You grant us a limited, non-exclusive licence to store and process that content solely to provide the Service, including running the AI review where you request it. We do not use your content for any other purpose. See our <Link to="/privacy" className="text-[#2d6a4f] hover:underline">Privacy Policy</Link> for full detail on how your data is processed and shared.</p>
          </Section>

          <Section n={8} title="No legal advice">
            <p>Nothing in the Service constitutes legal advice. The questions, prompts, jurisdiction information, and AI feedback are general in nature and are not tailored to your individual circumstances. We strongly recommend you seek independent legal advice before relying on any plan produced using the Service, particularly where children&rsquo;s welfare, relocation, or financial arrangements are involved.</p>
          </Section>

          <Section n={9} title="Intellectual property">
            <p>The parentingplan.help name, design, and all content we produce are the property of Chrysalis Works Ltd and are protected by copyright, trade mark, and other intellectual property rights. You may not reproduce, distribute, or create derivative works from our intellectual property without our written permission.</p>
          </Section>

          <Section n={10} title="Third-party services">
            <p>The Service integrates with third-party providers to deliver certain features (see our Privacy Policy for the full list). We are not responsible for the availability, accuracy, or conduct of any third-party service.</p>
          </Section>

          <Section n={11} title="Availability and changes">
            <p>We aim to provide a reliable service but do not guarantee uninterrupted availability. We reserve the right to modify, suspend, or discontinue the Service, or any feature of it, at any time. Where reasonably practicable, we will give advance notice of material changes affecting saved plans.</p>
          </Section>

          <Section n={12} title="Disclaimer of warranties">
            <p>To the maximum extent permitted by law, the Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind, express or implied. We do not warrant that the Service, or the AI review, will be error-free, accurate, or fit for any particular purpose.</p>
            <p>Nothing in these Terms limits our liability for death or personal injury caused by our negligence, or for fraud or fraudulent misrepresentation.</p>
          </Section>

          <Section n={13} title="Limitation of liability">
            <p>To the maximum extent permitted by law, our total aggregate liability to you for any claim arising under or in connection with these Terms or the Service shall not exceed the total amount, if any, you paid us in the 12 months preceding the event giving rise to the claim.</p>
            <p>We shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the Service, including reliance on the plan content or AI review in any legal or family proceedings.</p>
            <p>If you are a consumer in the UK, you may have statutory rights that these Terms do not affect.</p>
          </Section>

          <Section n={14} title="Changes to these Terms">
            <p>We may update these Terms from time to time. The current version is always available at this URL. Continued use of the Service after changes take effect constitutes acceptance of the revised Terms.</p>
          </Section>

          <Section n={15} title="Governing law">
            <p>These Terms are governed by the laws of England and Wales. Any dispute arising from these Terms or your use of the Service shall be subject to the exclusive jurisdiction of the courts of England and Wales, except where you have statutory rights to use courts in your country of residence.</p>
          </Section>

          <Section n={16} title="Contact">
            <p>If you have questions about these Terms, contact us at:</p>
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
        <Link to="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
        <span className="mx-3">&middot;</span>
        <span>&copy; 2026 Chrysalis Works Ltd</span>
      </footer>

    </div>
  )
}
