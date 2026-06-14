import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Home,
  Wand2,
  Image as ImageIcon,
  Video,
  Briefcase,
  Wallet,
  Clock3,
  User,
  Settings,
  LogOut,
  ChevronDown,
  LogIn,
} from "lucide-react";
import { Logo } from "./Logo";
import { cn } from "../lib/utils";
import { useCurrency } from "../lib/currency";
import { logout } from "../lib/firebase";
import { User as FirebaseUser } from "firebase/auth";
import { toast } from "sonner";
import { UserTier, UserProfile } from "../types";
import { getTierLabel, isSubscriberTier } from "../lib/tier";

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  tier: UserTier;
  user: FirebaseUser | null;
  profile: UserProfile | null;
}

export function Layout({ children, activeTab, setActiveTab, tier, user }: LayoutProps) {
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const isSubscribed = isSubscriberTier(tier);
  const tierLabel = getTierLabel(tier);
  const { currency, setCurrency } = useCurrency();

  const handleLogout = async () => {
    try {
      await logout();
      toast.success("Signed out successfully");
      setActiveTab("home");
      setIsProfileOpen(false);
    } catch {
      toast.error("Logout failed");
    }
  };

  const tabs = [
    { id: "home", icon: Home, label: "Home" },
    { id: "fix", icon: Wand2, label: "Polish" },
    { id: "photo", icon: ImageIcon, label: "Photo" },
    { id: "video", icon: Video, label: "Video" },
    { id: "business", icon: Briefcase, label: "Level Up" },
    { id: "history", icon: Clock3, label: "History" },
    { id: "wallet", icon: Wallet, label: "Wallet" },
  ];

  return (
    <div className="app-shell flex flex-col bg-black text-white overflow-hidden">
      <div className="noise-overlay" />

      <header className="safe-area-top flex items-center justify-between px-3 py-[var(--chrome-header-y)] bg-black/80 backdrop-blur-md border-b border-white/10 z-50">
        <div className="flex items-center gap-2">
          <Logo className="w-7 h-7" />
          <h1 className="title-text text-lg font-bold tracking-tighter">CHROMANCY</h1>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-full bg-white/5 border border-white/10 p-0.5 text-[10px] font-bold leading-none">
            <button onClick={() => setCurrency("ZAR")} className={cn("px-2 py-1 rounded-full transition-colors", currency === "ZAR" ? "bg-white text-black" : "text-white/55")}>ZAR</button>
            <button onClick={() => setCurrency("USD")} className={cn("px-2 py-1 rounded-full transition-colors", currency === "USD" ? "bg-white text-black" : "text-white/55")}>USD</button>
          </div>
          <div className="relative">
          <button
            onClick={() => (user ? setIsProfileOpen(!isProfileOpen) : setActiveTab("auth"))}
            className="flex items-center gap-1 p-1 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center overflow-hidden">
              {user?.photoURL ? <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <User className="w-4 h-4 text-white/70" />}
            </div>
            {user ? <ChevronDown className={cn("w-4 h-4 text-white/50 transition-transform", isProfileOpen && "rotate-180")} /> : <LogIn className="w-4 h-4 text-white/50 ml-1" />}
          </button>

          <AnimatePresence>
            {isProfileOpen && user && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute right-0 mt-2 w-64 bg-secondary border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden"
              >
                <div className="p-4 border-b border-white/10">
                  <p className="text-sm font-medium truncate">{user.displayName || "User"}</p>
                  <p className="text-xs text-white/50 truncate">{user.email}</p>
                  <div className={cn("mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-widest", isSubscribed ? "bg-white text-black" : "bg-white/10 text-white")}>
                    {tierLabel}
                  </div>
                </div>
                <div className="p-2">
                  {!isSubscribed && (
                    <button
                      onClick={() => {
                        setIsProfileOpen(false);
                        setActiveTab("subscribe");
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-xl hover:bg-white/5 transition-colors"
                    >
                      <Wallet className="w-4 h-4" />
                      <span>Open Wallet</span>
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setIsProfileOpen(false);
                      setActiveTab("settings");
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-xl hover:bg-white/5 transition-colors"
                  >
                    <User className="w-4 h-4" />
                    <span>Settings</span>
                  </button>
                  <button
                    onClick={() => {
                      setIsProfileOpen(false);
                      handleLogout();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-xl hover:bg-white/5 text-red-400 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto relative">
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.2 }} className="h-full">
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="safe-area-bottom bg-black/80 backdrop-blur-md border-t border-white/10 px-2 py-[var(--chrome-nav-y)] z-50">
        <div className="flex items-center justify-around max-w-2xl mx-auto">
          {tabs.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={cn("flex flex-col items-center gap-0.5 p-1 rounded-xl transition-all", activeTab === tab.id ? "text-white" : "text-white/40 hover:text-white/60")}>
              <div className={cn("p-1 rounded-lg transition-all", activeTab === tab.id && "bg-white/10 shadow-[0_0_15px_rgba(255,255,255,0.1)]")}>
                <tab.icon className={cn("w-5 h-5", activeTab === tab.id && "animate-pulse")} />
              </div>
              <span className="text-[8px] font-medium tracking-tighter">{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
