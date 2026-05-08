import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 3000,
  },
  build: {
    sourcemap: false,
    target: "es2020",
    cssCodeSplit: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "motion", "framer-motion"],
          firebase: ["firebase/app", "firebase/auth", "firebase/firestore", "firebase/storage"],
          ai: ["@google/genai"],
          pdf: ["pdfjs-dist", "jspdf"],
          ffmpeg: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
        },
      },
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom", "motion/react", "firebase/app", "firebase/auth", "firebase/firestore", "firebase/storage"],
  },
});
