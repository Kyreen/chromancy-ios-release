import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Upload, 
  FileText, 
  Wand2, 
  Search, 
  CheckCircle2, 
  AlertCircle, 
  ChevronRight, 
  ChevronLeft,
  Sparkles,
  Zap,
  Layout as LayoutIcon,
  Maximize,
  Undo2,
  Redo2,
  Download,
  X,
  Target,
  Eraser,
  BarChart3,
  RotateCcw,
  History
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { cn } from "../lib/utils";
import { analyzeDesign, cancelActiveAiRequests, enhancePhoto, getAiRequestErrorMessage, isAiGenerationCancelledError, requestAiSpendConfirmation } from "../lib/gemini";
import { ensureApiKey, isLoginRequiredError } from "../lib/auth-utils";
import { auth } from "../lib/firebase";
import { DesignCriticResult, UserTier } from "../types";
import { usePhotoStack } from "../lib/usePhotoStack";
import { renderPdfFirstPage } from "../lib/media-utils";
import { blobFromDataUrl, convertDataUrlToBlob, normaliseExportTarget, sanitizeExtension, saveBlobToDevice } from "../lib/exportMedia";
import { HistoryDrawer } from "../components/HistoryDrawer";
import { getToolConfig } from "../lib/toolConfig";
import { getExportMode } from "../lib/exportRules";

const POLISH_TOOL_TO_INTERNAL_ID: Record<string, string> = {
  critic: "design_critic",
  scorer: "design_critic",
  fix: "one_tap_design_fix",
  fixer: "one_tap_design_fix",
  pro: "design_brand_image",
  pop: "make_it_pop",
  standout: "make_it_pop",
  cleanup: "clean_up",
  clean: "clean_up",
  type: "fix_type",
};

interface FixDesignProps {
  tier?: UserTier;
  onNavigate?: (tab: string) => void;
}

export function FixDesign({ tier = 'free', onNavigate }: FixDesignProps) {
  const [originalFile, setOriginalFile] = useState<string | null>(null);
  const [originalFileType, setOriginalFileType] = useState<"image" | "pdf">("image");
  const [sourceMimeType, setSourceMimeType] = useState<string>("image/jpeg");
  const [sourceExtension, setSourceExtension] = useState<string>("jpg");
  const { 
    currentImage: file, 
    historyEntries,
    pushImage: setFile, 
    undo, 
    redo, 
    reset, 
    selectHistory,
    canUndo, 
    canRedo,
    history 
  } = usePhotoStack(null);

  useEffect(() => {
    return () => {
      cancelActiveAiRequests();
    };
  }, []);
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [usedPremium, setUsedPremium] = useState(false);
  const [result, setResult] = useState<DesignCriticResult | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const mediaSessionRef = useRef(0);
  const processingRunRef = useRef(0);
  const exportKey = originalFile || file || "fix-design-export";

  const onDrop = async (acceptedFiles: File[]) => {
    const incomingFile = acceptedFiles[0];
    if (!incomingFile) return;
    setUsedPremium(false);
    mediaSessionRef.current += 1;
    processingRunRef.current += 1;
    setIsAnalyzing(false);
    setSourceMimeType(incomingFile.type || "image/jpeg");
    setSourceExtension(sanitizeExtension(incomingFile.name.split(".").pop()) || "jpg");

    if (incomingFile.type === "application/pdf") {
      setIsAnalyzing(true);
      try {
        const dataUrl = await renderPdfFirstPage(incomingFile, 1.5);
        setOriginalFile(dataUrl);
        setOriginalFileType("pdf");
        reset(dataUrl);
      } catch (error) {
        toast.error("Failed to load PDF");
        console.error(error);
      } finally {
        setIsAnalyzing(false);
      }
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        setOriginalFile(result);
        setOriginalFileType("image");
        reset(result);
      };
      reader.readAsDataURL(incomingFile);
    }
    setResult(null);
    setActiveTool(null);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png'],
      'application/pdf': ['.pdf']
    },
    multiple: false
  } as any);

  const handleProcess = async (toolId: string) => {
    if (!file) return;
    const mediaSessionId = mediaSessionRef.current;
    let runId = 0;
    const aiMeta = { toolId: POLISH_TOOL_TO_INTERNAL_ID[toolId], tier, sessionKey: String(mediaSessionId) };
    
    const isPremium = premiumTools.some(t => t.id === toolId);
    void isPremium;

    if (!auth.currentUser) {
      toast.error("Please log in before using AI tools.");
      onNavigate?.("auth");
      return;
    }

    try {
      await requestAiSpendConfirmation(aiMeta);
    } catch (error) {
      if (isAiGenerationCancelledError(error)) {
        return;
      }
      toast.error(getAiRequestErrorMessage(error, "Could not confirm AI usage. Please try again."));
      return;
    }
    
    runId = ++processingRunRef.current;
    setIsAnalyzing(true);
    setResult(null);
    setActiveTool(toolId);

    try {
      await ensureApiKey();

      if (toolId === 'critic' || toolId === 'scorer') {
        const res = await analyzeDesign(file, aiMeta);
        if (mediaSessionRef.current !== mediaSessionId || processingRunRef.current !== runId) return;
        setResult(res);
      } else {
        let prompt = "";
        switch (toolId) {
          case 'fix': 
          case 'fixer':
            prompt = "Rebuild this design into a dramatically stronger premium result. Improve the hierarchy, alignment, spacing, contrast, composition, typography, margins, grouping, rhythm, readability, and overall polish to feel roughly 7x more refined than the current version. Preserve the core message, subject matter, brand feel, and important content exactly while removing all amateur layout issues. Make it look like a professionally art-directed, high-performing design made by a senior designer. Do not add extra text blocks, slogans, app names, watermarks, logos, people, faces, images, or decorative objects that were not already present.";
            break;
          case 'pro':
            prompt = "Transform this design into a high-end professional piece with luxury-level polish. Dramatically improve typography, grid structure, alignment, spacing, visual hierarchy, composition, color balance, and finish so it feels roughly 7x more premium and commercially ready than the current version. Preserve the core content and brand intent while making the final design look expensive, deliberate, elegant, and agency-quality. Do not add extra text blocks, slogans, app names, watermarks, logos, people, faces, images, or decorative objects that were not already present.";
            break;
          case 'pop':
          case 'standout':
            prompt = "Make this design stand out much more strongly while still looking premium, not tacky. Increase focal point strength, hierarchy, contrast, visual impact, composition, and energy so it feels roughly 7x stronger than the current version. Use bold but polished design decisions, refined emphasis, better scale relationships, and cleaner art direction. Avoid chaotic effects, clutter, cheap gradients, and messy typography. Do not add extra text blocks, slogans, app names, watermarks, logos, people, faces, images, or decorative objects that were not already present.";
            break;
          case 'cleanup':
          case 'clean': prompt = "Aggressively remove clutter and weak visual noise while preserving all important content, key text, logos, and subject matter. Simplify the layout, create cleaner spacing, stronger grouping, more breathing room, better alignment, and a much more polished premium composition that feels roughly 7x cleaner and more intentional than the current design. Do not add extra text blocks, slogans, app names, watermarks, logos, people, faces, images, or decorative objects that were not already present."; break;
          case 'type': prompt = "Analyze all text and typography in the design. Detect and fix typos, grammar issues, awkward wording, weak copy, poor line breaks, and weak hierarchy. Rewrite copy where needed so it is clearer, more engaging, and more premium while preserving the original meaning. Improve typography, spacing, readability, and layout so the result feels roughly 7x more polished, editorial, and professionally designed. Do not add new text blocks, slogans, app names, watermarks, logos, people, faces, images, or decorative objects beyond the existing design content."; break;
        }
        const res = await enhancePhoto(file, prompt, undefined, { imageSize: "2K", ...aiMeta });
        if (mediaSessionRef.current !== mediaSessionId || processingRunRef.current !== runId) return;
        const toolConfig = getToolConfig(POLISH_TOOL_TO_INTERNAL_ID[toolId]);
        if (toolConfig?.isAi && toolConfig.pricingTier !== "free") {
          setUsedPremium(true);
        }
        setFile(res);
      }
      if (mediaSessionRef.current !== mediaSessionId || processingRunRef.current !== runId) return;
      toast.success("Design processed!");
    } catch (error: any) {
      console.error("Design tool processing failed", error);

      if (isAiGenerationCancelledError(error)) {
        return;
      }
      
      if (isLoginRequiredError(error)) {
        toast.error("Please log in before using AI tools.");
        onNavigate?.("auth");
        return;
      }

      toast.error(getAiRequestErrorMessage(error, "Processing failed. Please try again."));
    } finally {
      if (mediaSessionRef.current === mediaSessionId && processingRunRef.current === runId) setIsAnalyzing(false);
    }
  };

  const handleExport = async () => {
    if (!file) return;

    try {
      const exportMode = getExportMode({ tier, usedPremium, category: "design" });
      const exportQuality = exportMode === "free" ? 0.88 : 0.96;
      const target = normaliseExportTarget({ mimeType: sourceMimeType, extension: sourceExtension }, originalFileType === "pdf" ? "application/pdf" : "image/jpeg");

      if (target.mimeType === "application/pdf") {
        const imageBlob = await blobFromDataUrl(file);
        const imageUrl = URL.createObjectURL(imageBlob);
        try {
          const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error("Failed to prepare export preview."));
            element.src = imageUrl;
          });

          const { jsPDF } = await import("jspdf");
          const pdf = new jsPDF({
            orientation: img.naturalWidth > img.naturalHeight ? "l" : "p",
            unit: "px",
            format: [img.naturalWidth, img.naturalHeight],
            hotfixes: ["px_scaling"],
          });
          pdf.addImage(file, "PNG", 0, 0, img.naturalWidth, img.naturalHeight, undefined, "FAST");
          const pdfBlob = pdf.output("blob");
          await saveBlobToDevice(pdfBlob, `chromancy-design-${Date.now()}.pdf`);
        } finally {
          URL.revokeObjectURL(imageUrl);
        }
      } else {
        const exportedBlob = await convertDataUrlToBlob(file, target.mimeType, exportQuality);
        await saveBlobToDevice(exportedBlob, `chromancy-design-${Date.now()}.${target.extension}`);
      }

      toast.success("Export saved successfully.");
    } catch (error) {
      console.error("Design export failed", error);
      toast.error("Export failed. Please try again.");
    }
  };


  const freeTools: any[] = [];

  const premiumTools = [
    { id: "critic", icon: Search, label: "Design Critic", description: "What's wrong?" },
    { id: "fixer", icon: Wand2, label: "1-Tap Design Fix", description: "Instant design enhance" },
    { id: "pro", icon: Sparkles, label: "MAKE PRO", description: "Make design look professional" },
    { id: "pop", icon: Zap, label: "Make It Pop", description: "High impact" },
    { id: "cleanup", icon: AlertCircle, label: "CLEAN UP", description: "Clean up design" },
    { id: "type", icon: FileText, label: "Fix Type", description: "Fix copy & typos" },
  ];

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Undo/Redo Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/2">
        <div className="flex gap-4">
          <button 
            onClick={undo}
            disabled={!canUndo}
            className="p-1 text-white/40 hover:text-white transition-colors disabled:opacity-20"
          >
            <Undo2 className="w-5 h-5" />
          </button>
          <button 
            onClick={redo}
            disabled={!canRedo}
            className="p-1 text-white/40 hover:text-white transition-colors disabled:opacity-20"
          >
            <Redo2 className="w-5 h-5" />
          </button>
          <button onClick={() => setShowHistory(!showHistory)} className={cn("p-1 transition-colors", showHistory ? "text-white" : "text-white/40 hover:text-white")}>
            <History className="w-5 h-5" />
          </button>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={handleExport}
            disabled={!file}
            className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-xs font-bold uppercase tracking-widest hover:bg-white/20 transition-all disabled:opacity-20"
          >
            <Download className="w-3 h-3" />
            Export
          </button>
        </div>
      </div>

      {/* Global Versioning Tip */}

      {/* Main Workspace */}
      <div className="visible-scrollbar flex-1 relative overflow-y-auto flex flex-col items-center justify-center p-4 pr-2">
        <div className="w-full h-full flex flex-col gap-4">
          <section className="w-full max-w-3xl space-y-2 text-center">
            <h2 className="text-2xl font-bold tracking-tight rainbow-text">Polish</h2>
            <p className="text-sm text-white/50">Make visuals look better, cleaner, sharper &amp; more polished.</p>
          </section>
        {!file ? (
          <div 
            {...getRootProps()} 
            className={cn(
              "w-full max-w-md aspect-[3/4] rounded-3xl border-2 border-dashed border-white/10 flex flex-col items-center justify-center p-8 text-center transition-all",
              isDragActive ? "bg-white/10 border-white/30" : "bg-white/5 hover:bg-white/10 hover:border-white/20"
            )}
          >
            <input {...getInputProps()} />
            <div className="p-6 rounded-full bg-white/5 mb-6">
              <Upload className="w-12 h-12 text-white/30" />
            </div>
            <h3 className="text-xl font-bold mb-2">Upload Your Design</h3>
            <p className="text-sm text-white/40 mb-8">PDF, PNG, or JPG files supported.</p>
            <button className="px-8 py-3 rounded-full bg-white text-black font-bold uppercase tracking-widest hover:bg-white/90 transition-colors">
              Choose File
            </button>
          </div>
        ) : (
          <div className="w-full h-full flex flex-col gap-4">
            {/* Comparison View */}
            <div className="flex-1 relative rounded-3xl overflow-hidden bg-white/5 border border-white/10">
              <img src={file} alt="Result" className="w-full h-full object-contain" />
              
              
              {isAnalyzing && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
                  <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
                  <p className="text-sm font-bold uppercase tracking-widest animate-pulse">AI is working...</p>
                </div>
              )}

              <AnimatePresence>
                {result && !isAnalyzing && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    className="absolute inset-0 flex items-center justify-center p-6 z-30"
                  >
                    <div className="w-full max-w-md bg-black/90 backdrop-blur-xl border border-white/20 rounded-3xl p-6 shadow-2xl relative flex flex-col max-h-[80%]">
                      <button 
                        onClick={() => setResult(null)}
                        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      
                      <div className="overflow-y-auto pr-2 space-y-6">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-lg">Design Audit</h4>
                          <div className="px-3 py-1 rounded-full bg-white/10 text-xl font-bold rainbow-text">
                            {result.score}/100
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-3 gap-4 text-[10px] uppercase tracking-tighter font-bold text-white/40">
                          <div>Hierarchy: <span className="text-white block mt-1">{result.hierarchy}</span></div>
                          <div>Contrast: <span className="text-white block mt-1">{result.contrast}</span></div>
                          <div>Balance: <span className="text-white block mt-1">{result.balance}</span></div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-bold uppercase tracking-widest text-white/30">Suggestions</p>
                          <ul className="space-y-2">
                            {result.suggestions.map((s, i) => (
                              <li key={i} className="text-xs flex items-start gap-2 text-white/70 leading-relaxed">
                                <div className="w-1 h-1 rounded-full bg-white mt-1.5 flex-shrink-0" />
                                {s}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button 
              onClick={() => {
                reset(null);
              }}
              className="self-center flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/30 hover:text-white transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              Replace Design
            </button>
          </div>
        )}
        </div>
        <HistoryDrawer open={showHistory} title="Design history" items={historyEntries} currentItem={file} onClose={() => setShowHistory(false)} onSelect={selectHistory} />
      </div>

      {/* Tools Carousel */}
      <div className="safe-area-bottom bg-black border-t border-white/10 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold tracking-widest text-white/30">Polish</span>
          <div className="flex gap-2">
            
          </div>
        </div>

        <div className="visible-horizontal-scrollbar flex gap-3 overflow-x-auto pb-2">
          {/* Free Tools */}
          {freeTools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => handleProcess(tool.id)}
              className={cn(
                "flex-shrink-0 flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all min-w-[100px]",
                activeTool === tool.id ? "bg-white text-black border-white" : "bg-white/5 border-white/10 text-white hover:bg-white/10"
              )}
            >
              <tool.icon className="w-5 h-5" />
              <div className="text-center">
                <p className="text-[10px] font-bold uppercase leading-none">{tool.label}</p>
                <p className="text-[8px] opacity-50 mt-1">{tool.description}</p>
              </div>
            </button>
          ))}

          {/* Divider */}
          <div className="w-px h-12 bg-white/10 self-center" />

          {/* Premium Tools */}
          {premiumTools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => handleProcess(tool.id)}
              className={cn(
                "flex-shrink-0 flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all min-w-[100px]",
                activeTool === tool.id ? "bg-white text-black border-white" : "bg-white/5 border-white/10 text-white hover:bg-white/10"
              )}
            >
              <div className="relative">
                <tool.icon className="w-5 h-5" />
                <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-yellow-400 border border-black" />
              </div>
              <div className="text-center">
                <p className="text-[10px] font-bold uppercase leading-none">{tool.label}</p>
                {getToolConfig(POLISH_TOOL_TO_INTERNAL_ID[tool.id])?.trialEligible ? (
                  <p className={cn("mt-1 text-[7px] font-bold uppercase tracking-[0.16em]", activeTool === tool.id ? "text-black/70" : "text-yellow-300")}>Free trial</p>
                ) : null}
                <p className="text-[8px] opacity-50 mt-1">{tool.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
