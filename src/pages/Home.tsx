import { motion } from "motion/react";
import {
  Wand2,
  Image as ImageIcon,
  Video,
  Briefcase,
} from "lucide-react";
import { cn } from "../lib/utils";
import { UserTier } from "../types";
import { getWalletTopUpLabel, setSubscriptionView } from "../lib/pricing";

interface HomeProps {
  onNavigate: (tab: string) => void;
  tier: UserTier;
}

export function Home({ onNavigate }: HomeProps) {
  const tools = [
    { id: "fix", icon: Wand2, label: "Polish", color: "from-white via-white to-slate-100", description: "Graphic design tab — upgrade your designs, logos, posters & flyers to look cleaner and more professional." },
    { id: "photo", icon: ImageIcon, label: "Photo Enhancements", color: "from-white via-zinc-50 to-stone-100", description: "Fix, enhance, and transform photos in seconds." },
    { id: "video", icon: Video, label: "Video Enhancements", color: "from-white via-slate-50 to-zinc-100", description: "Upgrade videos instantly" },
    { id: "business", icon: Briefcase, label: "Level Up", color: "from-white via-gray-50 to-slate-200", description: "Turn content into high-performing business assets." },
  ];

  return (
    <div className="p-6 space-y-8 pb-24">
      <section className="space-y-2">
        <motion.h2 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-3xl font-bold tracking-tight">
          Creative <span className="rainbow-text">Fixer</span>
        </motion.h2>
        <p className="text-white/50 text-sm max-w-xs">Fix Designs, Photos &amp; Videos in One Tap.</p>
      </section>

      <section className="grid grid-cols-2 gap-4">
        {tools.map((tool, index) => (
          <motion.button
            key={tool.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.05 }}
            onClick={() => onNavigate(tool.id)}
            className="relative flex flex-col items-start p-5 rounded-3xl border border-white/15 bg-white/[0.06] overflow-hidden text-left group transition-all hover:border-white/40 hover:bg-white/[0.1] active:scale-95 shadow-[0_18px_45px_rgba(0,0,0,0.35)]"
          >
            <div className="p-3 rounded-2xl bg-white/10 border border-white/10 mb-4 group-hover:scale-110 transition-transform">
              <tool.icon className="w-6 h-6 text-white" />
            </div>
            <h3 className="font-bold text-lg leading-tight text-white">{tool.label}</h3>
            <p className="text-xs text-white/65 mt-1">{tool.description}</p>
            <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-white/[0.06] blur-3xl rounded-full" />
          </motion.button>
        ))}
      </section>

      <section className="space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-white/30">Access</h3>
        <div className="grid gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold">Free Tier</p>
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Free</span>
            </div>
            <div className="space-y-1 text-xs text-white/55">
              <p>Unlimited Free Tools</p>
              <p>Free Trials for selected tools</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setSubscriptionView("unlock");
              onNavigate("subscribe");
            }}
            className="text-left rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3 transition-all hover:bg-white/10 active:scale-[0.99]"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold">Wallet</p>
              <span className="rounded-full bg-white text-black px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em]">Top up</span>
            </div>
            <p className="text-xs text-white/55">Top up your wallet to use AI tools once off.</p>
            <p className="text-[11px] font-bold text-white/80">↻ Basic AI tools are up to 50% off on an instant retry — re-run on the same file to save.</p>
            <p className="text-[11px] text-white/35">Available for all users. Top-ups: {getWalletTopUpLabel()}.</p>
          </button>
        </div>
      </section>
    </div>
  );
}
