import { ChevronLeft, FileCheck, ShieldCheck, Sparkles } from "lucide-react";
import { formatZarAmount, formatZarUsd, getWalletTopUpLabel, premiumMonthlyPricing, subscriptionPlanPricing } from "../lib/pricing";

interface TermsOfUseProps {
  onAccept: () => void;
  onBack?: () => void;
}

const premiumPlan = subscriptionPlanPricing.find((plan) => plan.planId === "premium");

const sections = [
  {
    title: "1. Using the app",
    body: "CHROMANCY lets you fix designs, photos, videos, and business assets. Some tools are manual and some use AI. AI results depend on the media, prompt, and source content you provide, so results can vary.",
  },
  {
    title: "2. Your content",
    body: "You are responsible for the photos, videos, PDFs, prompts, files, and other content you upload or process. You must have permission to use that content.",
  },
  {
    title: "3. Permissions",
    body: "CHROMANCY may ask for access to photos, videos, files, and notifications so the app can import, edit, export, and send updates. You can allow or deny notifications in Settings.",
  },
  {
    title: "4. Payments and wallet",
    body: `Pro Monthly is ${formatZarUsd(premiumMonthlyPricing.zar)} per month including VAT and includes 40 AI Credits Monthly, Unlimited Beam Mode, No Beam Mode Watermark, and HD Exports. Premium Monthly is R${formatZarAmount(premiumPlan?.monthlyZar || 249.99)} per month including VAT and includes ${premiumPlan?.monthlyAiCredits || 60} AI Credits, Monthly Unlimited Beam Mode, No Beam Mode Watermark, HD Exports, and Priority Processing. AI wallet pricing uses per-tool tiers of R12, R20, and R39 depending on the tool selected. CREATE currently costs R39 from wallet funds or 3 AI Credits from an active subscription. EDIT WITH PROMPT currently costs R39 from wallet funds or 1 AI Credit from an active subscription. Retry pricing is 50% of the original tool price. Wallet top-ups are ${getWalletTopUpLabel()}. Before any paid AI feature starts, CHROMANCY shows the exact wallet-fund or AI-credit cost. Failed AI generations are refunded or released. Beam Mode remains free and never uses wallet or AI credits.`,
  },
  {
    title: "5. Exports",
    body: "Non-AI tools are free and export normally. AI tools require an available free trial, an active Premium AI credit, or enough wallet balance before generation.",
  },
  {
    title: "6. AI results",
    body: "AI outputs, enhancements, generated assets, and recommendations are provided as-is. We do not guarantee that every result will be perfect, uninterrupted, or suitable for every purpose.",
  },
  {
    title: "7. Account and security",
    body: "You are responsible for keeping your account secure. You are also responsible for activity that happens through your account unless the law says otherwise.",
  },
  {
    title: "8. Contact",
    body: "For support requests sent through the Help Center form, contact emails may be sent to info@chromancy.online.",
  },
];

export function TermsOfUse({ onAccept, onBack }: TermsOfUseProps) {
  return (
    <div className="flex flex-col h-full bg-black text-white">
      <div className="safe-area-top border-b border-white/10 bg-black/80 backdrop-blur-md px-4 py-4 flex items-center gap-4">
        {onBack ? (
          <button onClick={onBack} className="p-2 rounded-full bg-white/5 border border-white/10">
            <ChevronLeft className="w-5 h-5" />
          </button>
        ) : (
          <div className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
            <FileCheck className="w-4 h-4" />
          </div>
        )}
        <div>
          <h1 className="text-xl font-bold tracking-tight">Terms of Use</h1>
          <p className="text-xs text-white/45 mt-1">Creative Intelligence Platform</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 flex flex-col gap-4">
            <div className="inline-flex items-center gap-2 self-start rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">
              <ShieldCheck className="w-3 h-3" /> CHROMANCY terms
            </div>
            <h2 className="text-2xl font-bold tracking-tight">Please review before using the app</h2>
            <p className="text-sm text-white/60 leading-7">By continuing, you agree to the terms below and understand that AI features read the media you submit in order to generate or improve results.</p>
          </div>

          {sections.map((section) => (
            <section key={section.title} className="rounded-[2rem] border border-white/10 bg-white/5 p-6 space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">
                <Sparkles className="w-3 h-3" /> {section.title}
              </div>
              <p className="text-sm text-white/70 leading-7">{section.body}</p>
            </section>
          ))}
        </div>
      </div>

      <div className="safe-area-bottom border-t border-white/10 bg-black/90 backdrop-blur-md p-4">
        <div className="max-w-3xl mx-auto flex flex-col gap-3">
          <p className="text-xs text-white/45 leading-6">By tapping <span className="text-white font-semibold">Agree &amp; Continue</span>, you confirm that you have read and accepted the CHROMANCY Terms of Use.</p>
          <button onClick={onAccept} className="w-full rounded-3xl bg-white text-black px-4 py-4 text-sm font-bold uppercase tracking-widest hover:bg-white/90 transition-colors">
            Agree &amp; Continue
          </button>
        </div>
      </div>
    </div>
  );
}
