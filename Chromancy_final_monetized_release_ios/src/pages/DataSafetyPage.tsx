import { ChevronLeft, ShieldCheck } from "lucide-react";

interface DataSafetyPageProps {
  onBack: () => void;
}

const sections = [
  {
    title: "Data Collected",
    body: [
      "Personal information such as name, email address, profile photo, and account details when provided by the user.",
      "User IDs and device or session identifiers used for login verification, billing enforcement, and fraud prevention.",
      "Billing data such as subscription status, wallet balance, AI credits, purchase events, refunds, and transaction history.",
      "User-generated content such as prompts, notes, form inputs, help messages, and content submitted for processing.",
      "Crash logs and diagnostic information used to identify and fix technical errors.",
      "Photos, videos, PDFs, and other files that users upload for processing.",
      "Camera and microphone capture only when users choose recording or preview features such as Beam Mode.",
    ],
  },
  {
    title: "Data Usage",
    body: [
      "Data is used strictly for:",
      "App functionality.",
      "AI processing when requested by the user.",
      "Camera preview, microphone capture, and video recording when requested by the user.",
      "Account management.",
      "Billing, purchase restoration, refunds, and subscription management.",
      "Fraud prevention, security, and compliance.",
      "Crash diagnosis, app reliability, and bug fixing.",
      "Customer support and account deletion requests.",
    ],
  },
  {
    title: "Data Sharing",
    body: [
      "Data is NOT sold.",
      "Data is disclosed only as needed to service providers acting on our behalf, such as Firebase, RevenueCat, platform billing providers such as the Apple App Store and Google Play, AI processing providers such as Google Gemini, and support email providers.",
      "Data may also be disclosed when legally required.",
    ],
  },
  {
    title: "Data Handling",
    body: [
      "Uploaded AI media is processed temporarily for the requested job and is not intended to be stored permanently by us after processing.",
      "Camera and microphone data is used only for the selected feature.",
      "Crash logs are used only for diagnostics, reliability, and security.",
      "Data is not sold or used for advertising.",
      "Encryption in transit and secure authentication are used to protect data.",
    ],
  },
  {
    title: "Security Practices",
    body: [
      "Encryption in transit.",
      "Secure login and authentication.",
      "Access restriction controls.",
      "Server-side billing and entitlement enforcement.",
    ],
  },
  {
    title: "Data Retention",
    body: [
      "Account data is retained while the account is active.",
      "Billing and transaction records may be retained for accounting, fraud prevention, dispute handling, and legal obligations.",
      "Support requests may be retained as long as needed to resolve them.",
      "Uploaded AI media is not intended to be retained permanently by us after processing unless the user explicitly saves content or retention is required for security or legal reasons.",
    ],
  },
  {
    title: "User Control",
    body: [
      "Users can:",
      "Delete their account.",
      "Request deletion of associated account data.",
      "Control what content they upload.",
      "Stop using the app at any time.",
      "Use the deletion link at https://chromancy.online/#settings",
    ],
  },
] as const;

export function DataSafetyPage({ onBack }: DataSafetyPageProps) {
  return (
    <div className="flex flex-col h-full bg-black">
      <div className="p-4 flex items-center gap-4 border-b border-white/5">
        <button onClick={onBack} className="p-2 rounded-full bg-white/5 border border-white/10">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold tracking-tight">Data Safety</h2>
      </div>

      <div className="visible-scrollbar flex-1 overflow-y-auto p-6 space-y-4 pr-4">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="p-5 rounded-3xl border border-white/10 bg-white/5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/10 mb-4">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span className="text-[10px] font-bold uppercase tracking-widest">CHROMANCY</span>
            </div>
            <p className="text-sm text-white/70 leading-7">Data Safety</p>
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

