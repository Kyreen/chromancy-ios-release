import { ChevronLeft, ShieldCheck } from "lucide-react";

interface PrivacyPolicyProps {
  onBack: () => void;
}

const sections = [
  {
    title: "1. Information We Collect",
    body: [
      "Account information such as your name, email address, profile photo, and account ID when you create or sign in to an account.",
      "Billing and entitlement information such as subscription plan, subscription status, wallet balance, AI credits, purchase events, refunds, and transaction history.",
      "Device and session identifiers used for login verification, free-trial enforcement, fraud prevention, and secure billing checks.",
      "Crash logs and diagnostic details such as error messages, app route, device platform, and browser/app user agent when the app encounters an error.",
      "Content you provide, including photos, videos, PDFs or other files, prompts, notes, form inputs, and support messages that you submit through the app.",
      "Camera and microphone access only when you choose features that require preview, capture, or recording, such as Beam Mode.",
    ],
  },
  {
    title: "2. How We Use Your Data",
    body: [
      "We use your data strictly to:",
      "Authenticate and manage user accounts.",
      "Enable app features and tools.",
      "Process AI-based enhancements and requested media outputs.",
      "Enable camera preview, microphone capture, and video recording when you choose features that require them.",
      "Manage subscriptions, wallet top-ups, purchase restoration, refunds, and transaction history.",
      "Prevent fraud, abuse, unauthorized access, and repeated free-trial misuse.",
      "Detect, diagnose, and fix crashes or technical errors.",
      "Respond to support requests and account deletion requests.",
      "We do NOT use your data for:",
      "Advertising.",
      "Selling data.",
      "Building advertising profiles.",
      "Facial recognition.",
      "Identity tracking.",
    ],
  },
  {
    title: "3. AI & Media Processing",
    body: [
      "CHROMANCY uses AI technologies, including third-party services such as Google Gemini, to process content that you choose to send for a requested feature.",
      "Our AI commitments:",
      "Your content is processed only to deliver the requested feature.",
      "We do not sell your uploaded content or use it for advertising or unrelated profiling.",
      "We do not use your uploaded content to build our own training datasets.",
      "We do not reuse your uploaded content for any purpose outside your request except where required to operate, secure, or comply with law.",
      "Likeness and identity protection:",
      "We do NOT use your face, likeness, or identity for facial recognition, identity tracking, or advertising profiles.",
      "Camera and microphone data is used only for the selected feature and is not used for advertising, profiling, facial recognition, or identity tracking.",
    ],
  },
  {
    title: "4. Data Processing & Storage",
    body: [
      "Account, billing, and support data may be stored securely in systems we operate or through service providers acting on our behalf.",
      "Uploaded media sent for AI processing is processed temporarily for the requested job.",
      "Crash logs are kept only as long as needed to troubleshoot, secure, and improve app reliability.",
      "We do not intentionally store uploaded AI media permanently after processing unless you explicitly save content or retention is required for security, fraud prevention, or legal compliance.",
      "Some temporary local history may remain on your device for a short period as part of app functionality.",
    ],
  },
  {
    title: "5. Third-Party Services",
    body: [
      "We may use trusted third-party services to operate the app, including:",
      "Firebase Authentication and Firestore (account and database services).",
      "RevenueCat and platform billing providers such as the Apple App Store and Google Play (subscription and purchase processing).",
      "Google Gemini or other AI processing providers that act on our behalf to fulfill requested AI features.",
      "Email or SMTP providers used to deliver support messages.",
      "These providers process data only as needed to operate the service on our behalf or to complete the transaction or request you initiated.",
    ],
  },
  {
    title: "6. Data Sharing",
    body: [
      "We do NOT sell your data.",
      "We may share data only when necessary:",
      "With service providers acting on our behalf, such as authentication, billing, AI processing, and support delivery providers.",
      "When legally required, such as in response to a court order, law enforcement request, or regulatory obligation.",
    ],
  },
  {
    title: "7. Data Retention",
    body: [
      "Account data is retained while your account is active.",
      "Billing, subscription, refund, and transaction records may be retained while your account is active and for as long as needed for accounting, fraud prevention, dispute handling, and legal compliance.",
      "Support messages may be retained as long as needed to resolve your request.",
      "Uploaded media sent for AI processing is not intended to be retained permanently by us after processing unless you explicitly save content or retention is required for security or legal reasons.",
    ],
  },
  {
    title: "8. Your Rights (POPIA)",
    body: [
      "Under applicable law, including Protection of Personal Information Act, you have the right to:",
      "Access your data.",
      "Request correction of your data.",
      "Delete your account and associated data.",
      "Withdraw consent by stopping use of the app.",
    ],
  },
  {
    title: "9. Account Deletion",
    body: [
      "When you delete your account:",
      "Personal data is removed from active systems where feasible.",
      "Associated account data is deleted or anonymised, subject to technical and legal limits.",
      "Some minimal records may remain where legally required or necessary for fraud prevention, financial records, or dispute resolution.",
      "You can request account deletion from within the app and from outside the app at https://chromancy.online/#settings",
    ],
  },
  {
    title: "10. Security",
    body: [
      "We use industry-standard safeguards:",
      "Encryption in transit.",
      "Secure authentication.",
      "Access controls.",
      "However, no system is completely secure.",
    ],
  },
  {
    title: "11. Children's Privacy",
    body: [
      "CHROMANCY is not intended for users under 13.",
      "We do not knowingly collect data from children.",
    ],
  },
  {
    title: "12. Changes to This Policy",
    body: [
      "We may update this policy from time to time.",
      "Continued use of the app constitutes acceptance of updates.",
    ],
  },
  {
    title: "13. Contact",
    body: [
      "Support and privacy contact: info@chromancy.online",
      "Account deletion request link: https://chromancy.online/#settings",
    ],
  },
] as const;

export function PrivacyPolicy({ onBack }: PrivacyPolicyProps) {
  return (
    <div className="flex flex-col h-full bg-black">
      <div className="p-4 flex items-center gap-4 border-b border-white/5">
        <button onClick={onBack} className="p-2 rounded-full bg-white/5 border border-white/10">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold tracking-tight">Privacy Policy</h2>
      </div>

      <div className="visible-scrollbar flex-1 overflow-y-auto p-6 pb-24 pr-4">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="p-5 rounded-3xl border border-white/10 bg-white/5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/10 mb-4">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span className="text-[10px] font-bold uppercase tracking-widest">CHROMANCY</span>
            </div>
            <p className="text-sm text-white/70 leading-7">
              PRIVACY POLICY
              <br />
              Effective Date: 20/04/2026
              <br />
              This Privacy Policy explains how CHROMANCY collects, uses, and protects your information.
            </p>
          </div>

          {sections.map((section) => (
            <section key={section.title} className="p-5 rounded-3xl border border-white/10 bg-white/5">
              <h3 className="text-sm font-bold uppercase tracking-widest text-white mb-3">{section.title}</h3>
              <div className="space-y-2 text-sm text-white/70 leading-7">
                {section.body.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

