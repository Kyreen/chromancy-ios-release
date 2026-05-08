import { motion } from "motion/react";
import { Logo } from "./Logo";

export function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center z-[100]">
      <div className="noise-overlay" />
      
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1, ease: "easeOut" }}
        className="relative flex flex-col items-center gap-8"
      >
        <Logo className="w-32 h-32" />
        
        <div className="space-y-3 text-center">
          <motion.h1 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="title-text text-4xl font-bold tracking-tighter"
          >
            CHROMANCY
          </motion.h1>
          
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: "100%" }}
            transition={{ delay: 1, duration: 2 }}
            className="h-px bg-gradient-to-r from-transparent via-white/50 to-transparent w-48 mx-auto"
          />
          
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.5 }}
            className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/30"
          >
            One Magic Button
          </motion.p>
        </div>
      </motion.div>

      {/* Subtle background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-white/5 blur-[120px] rounded-full pointer-events-none" />
    </div>
  );
}
