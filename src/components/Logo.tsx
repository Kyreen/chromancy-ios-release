import { motion } from "motion/react";

export function Logo({ className = "w-12 h-12" }: { className?: string }) {
  return (
    <div className={className}>
      <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Prism */}
        <path d="M50 20L80 75H20L50 20Z" stroke="white" strokeWidth="2" fill="rgba(255,255,255,0.1)" />
        
        {/* White Light Beam */}
        <motion.line
          x1="0" y1="47.5" x2="50" y2="47.5"
          stroke="white"
          strokeWidth="1.5"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.5, repeat: Infinity, repeatType: "loop" }}
        />

        {/* Rainbow Refraction */}
        <motion.g
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 1, repeat: Infinity, repeatType: "reverse" }}
        >
          <path d="M50 47.5L90 30" stroke="#ff0000" strokeWidth="1" />
          <path d="M50 47.5L90 37" stroke="#ff8000" strokeWidth="1" />
          <path d="M50 47.5L90 44" stroke="#ffff00" strokeWidth="1" />
          <path d="M50 47.5L90 51" stroke="#00ff00" strokeWidth="1" />
          <path d="M50 47.5L90 58" stroke="#0000ff" strokeWidth="1" />
          <path d="M50 47.5L90 65" stroke="#4b0082" strokeWidth="1" />
          <path d="M50 47.5L90 72" stroke="#9400d3" strokeWidth="1" />
        </motion.g>
      </svg>
    </div>
  );
}

export function AppIcon({ className = "w-16 h-16" }: { className?: string }) {
  return (
    <div className={`relative flex items-center justify-center rounded-2xl bg-black border border-white/10 ${className}`}>
      <span className="text-4xl font-bold rainbow-text">C</span>
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
    </div>
  );
}
