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
  resize: "resize_design",
};

// Target formats for RESIZE DESIGN. `aspect` must be one of the aspect ratios the
// image model supports natively; the exact pixel/print target is reinforced in the prompt.
const RESIZE_FORMATS: { id: string; label: string; target: string; aspect: string }[] = [
  { id: "ig_post", label: "Instagram Post — 1080×1080 (1:1)", target: "Instagram feed post, 1080x1080 pixels, square 1:1", aspect: "1:1" },
  { id: "ig_portrait", label: "Instagram Portrait — 1080×1350 (4:5)", target: "Instagram portrait post, 1080x1350 pixels, 4:5 vertical", aspect: "4:5" },
  { id: "ig_story", label: "Instagram Story / Reel — 1080×1920 (9:16)", target: "Instagram story or reel, 1080x1920 pixels, 9:16 vertical", aspect: "9:16" },
  { id: "tiktok", label: "TikTok — 1080×1920 (9:16)", target: "TikTok cover, 1080x1920 pixels, 9:16 vertical", aspect: "9:16" },
  { id: "whatsapp_status", label: "WhatsApp Status — 1080×1920 (9:16)", target: "WhatsApp status, 1080x1920 pixels, 9:16 vertical", aspect: "9:16" },
  { id: "fb_post", label: "Facebook Post — 1200×630", target: "Facebook post image, 1200x630 pixels, wide landscape", aspect: "16:9" },
  { id: "fb_cover", label: "Facebook Cover — 820×312", target: "Facebook page cover banner, 820x312 pixels, ultra-wide banner", aspect: "21:9" },
  { id: "li_post", label: "LinkedIn Post — 1200×627", target: "LinkedIn post image, 1200x627 pixels, wide landscape", aspect: "16:9" },
  { id: "li_banner", label: "LinkedIn Banner — 1584×396", target: "LinkedIn profile banner, 1584x396 pixels, ultra-wide banner", aspect: "21:9" },
  { id: "x_post", label: "X / Twitter Post — 1600×900 (16:9)", target: "X (Twitter) post image, 1600x900 pixels, 16:9 landscape", aspect: "16:9" },
  { id: "yt_thumb", label: "YouTube Thumbnail — 1280×720 (16:9)", target: "YouTube thumbnail, 1280x720 pixels, 16:9 landscape", aspect: "16:9" },
  { id: "pinterest", label: "Pinterest Pin — 1000×1500 (2:3)", target: "Pinterest pin, 1000x1500 pixels, 2:3 vertical", aspect: "2:3" },
  { id: "square", label: "Square — 1:1", target: "square 1:1 format", aspect: "1:1" },
  { id: "a4_portrait", label: "A4 Portrait — 210×297 mm", target: "A4 portrait print document, 210x297 mm", aspect: "3:4" },
  { id: "a4_landscape", label: "A4 Landscape — 297×210 mm", target: "A4 landscape print document, 297x210 mm", aspect: "4:3" },
  { id: "a5_flyer", label: "A5 Flyer — 148×210 mm", target: "A5 portrait flyer, 148x210 mm", aspect: "3:4" },
  { id: "a3_poster", label: "A3 Poster — 297×420 mm", target: "A3 portrait poster, 297x420 mm", aspect: "3:4" },
  { id: "us_letter", label: "US Letter — 8.5×11 in", target: "US Letter portrait document, 8.5x11 inches", aspect: "3:4" },
  { id: "business_card", label: "Business Card — 3.5×2 in", target: "landscape business card, 3.5x2 inches", aspect: "16:9" },
  { id: "slide", label: "Presentation Slide — 1920×1080 (16:9)", target: "presentation slide, 1920x1080 pixels, 16:9 landscape", aspect: "16:9" },
  { id: "web_banner", label: "Website Banner — 1500×500", target: "website hero banner, 1500x500 pixels, ultra-wide", aspect: "21:9" },
  { id: "email_header", label: "Email Header — 1200×400", target: "email header banner, 1200x400 pixels, wide banner", aspect: "21:9" },
];

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
  const [showResizePanel, setShowResizePanel] = useState(false);
  const [resizeTarget, setResizeTarget] = useState("");
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
    setShowResizePanel(false);
    setResizeTarget("");
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

    if (toolId === "resize" && !RESIZE_FORMATS.some((format) => format.id === resizeTarget)) {
      toast.error("Please choose a target size");
      return;
    }

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
        const POLISH_DESIGN_GUARD = "Re-render every piece of existing visible text exactly word-for-word with clean, sharp, correctly spelled letterforms — never gibberish, warped glyphs, broken letters, or approximated words; if a word cannot be re-rendered cleanly, keep its original pixels untouched instead of corrupting it. Preserve all logos, brand marks, brand colours, product shots, and photos faithfully. You MAY add tasteful abstract graphic design elements when they clearly elevate the design — panels, cards, shapes, dividers, frames, borders, badges shapes, accents, refined gradients, glows, light effects, depth layers, textures, patterns, and premium background treatments — as long as every addition looks professionally art-directed and intentional. You may NOT add new words, text blocks, slogans, app names, watermarks, invented logos or brand marks, fake contact details, new people, faces, hands, characters, or unrelated photos and stock-style imagery. Never change, regenerate, beautify, or distort any face or person already in the design. The final output must look like an expensive finished deliverable from a top design studio — never like an AI-processed image.";
        let prompt = "";
        let resizeAspectRatio: string | undefined;
        let resizeFormatLabel: string | undefined;
        switch (toolId) {
          case 'resize': {
            const format = RESIZE_FORMATS.find((entry) => entry.id === resizeTarget);
            if (!format) {
              toast.error("Please choose a target size");
              return;
            }
            resizeAspectRatio = format.aspect;
            resizeFormatLabel = format.target;
            prompt = `Resize Design: Adapt this exact design to a new target format: ${format.target}. Re-lay out the SAME design intelligently for the new canvas like a senior production designer adapting a master design: first detect every design element precisely (logos, headlines, subheadings, body text, contact details, photos, product shots, icons, decorative shapes, and background treatments), then rearrange, scale, and re-flow the elements on a clean grid so the composition looks purpose-made for the target format. Extend, crop, or regenerate the background treatment naturally to fill the new canvas edge-to-edge. The output canvas MUST match the requested target aspect ratio exactly. Never letterbox, never leave awkward empty bands, dead space, or stretched or squashed elements, never crop away or drop any text or important content, and never distort logos, faces, photos, or letterforms. Re-render every piece of existing text word-for-word exactly with clean correct letterforms, and preserve brand colours, hierarchy, and the design's intent exactly. ${POLISH_DESIGN_GUARD}`;
            break;
          }
          case 'fix':
          case 'fixer':
            prompt = `Rebuild this design at the standard of a senior art director at a top-tier branding agency. Re-typeset the existing content on a disciplined layout grid with precise optical alignment, intentional margins, generous negative space, and a clear focal hierarchy where the most important element commands attention first. Establish a refined typographic scale with consistent font pairing, correct kerning, tracking, and line spacing. Harmonise the colour palette into a sophisticated, confident scheme with controlled contrast and premium depth — subtle refined gradients, soft accurate shadows, and polished surface treatment, never cheap effects. Remove every amateur layout mistake: crooked alignment, cramped spacing, competing focal points, weak type pairing, and muddy contrast. Preserve the core message, every original text element, and the brand feel exactly. ${POLISH_DESIGN_GUARD}`;
            break;
          case 'pro':
            prompt = `Elevate this design into a luxury-grade professional piece that looks like it was produced by a premium branding agency for an expensive client. Rebuild the typography with an elegant editorial scale, refined font pairing, and immaculate spacing. Structure the layout on a strict grid with disciplined margins, balanced asymmetry or confident symmetry, and deliberate breathing room around the focal point. Recompose the colour story into a premium, harmonious palette with rich-but-controlled contrast, tasteful accent usage, and refined material depth. Every detail must read as intentional, expensive, and commercially ready — the level of finish seen in high-end campaign work. Preserve the core content and brand intent exactly. ${POLISH_DESIGN_GUARD}`;
            break;
          case 'pop':
          case 'standout':
            prompt = `Give this design dramatically more stopping power while keeping it premium and tasteful — bold, not tacky. Strengthen the single primary focal point, push scale contrast between the hero element and supporting content, deepen tonal and colour contrast for instant readability at a glance, and add controlled visual energy through confident cropping and dynamic-but-clean composition. Actively introduce premium graphic accents where they amplify impact: expensive-looking glows, light sweeps, depth layers, bold background shapes or colour blocking, refined frames, gradient washes, and dramatic-but-controlled lighting — the kind of elevating design elements a senior art director would add to make a piece pop. The result should stop a scrolling thumb instantly yet still look professionally art-directed. Avoid chaotic effects, clutter, cheap gradients, neon overload, and messy typography. ${POLISH_DESIGN_GUARD}`;
            break;
          case 'cleanup':
          case 'clean': prompt = `Declutter and simplify this design like a minimalist senior designer doing a final pass before client delivery. Remove visual noise, redundant decoration, competing elements, and anything that weakens the message. Regroup related content with clear proximity, open up generous breathing room, snap everything to clean alignment, and rebalance the composition so the hierarchy reads instantly: one hero, clear support, quiet background. Keep all important content, key text, logos, and subject matter — the design must feel calm, ordered, premium, and intentional, not empty. ${POLISH_DESIGN_GUARD}`; break;
          case 'type': prompt = `Perform a professional copy-editing and typography pass on this design. Detect and fix every typo, spelling mistake, grammar issue, awkward phrasing, poor line break, and weak hierarchy. Where the copy is weak or boring, rewrite it to be clearer, tighter, and more persuasive while preserving the original meaning, tone, and all proper nouns (names, brands, contact details, dates, prices) exactly. Then re-typeset the corrected text with an editorial-grade typographic system: clear scale between headline, subhead, and body, consistent font pairing, refined kerning and leading, and comfortable measure. The corrected text must be rendered perfectly legibly with zero corrupted letterforms. Keep the overall design style and message intact. ${POLISH_DESIGN_GUARD}`; break;
        }
        // resizeFormat triggers the server-side vision planner, which reads the design
        // and plans a genuine re-layout for the target canvas before rendering.
        const res = await enhancePhoto(file, prompt, undefined, {
          imageSize: "2K",
          ...(resizeAspectRatio ? { aspectRatio: resizeAspectRatio } : {}),
          ...(resizeFormatLabel ? { resizeFormat: resizeFormatLabel } : {}),
          ...aiMeta,
        });
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

  // Display order: Design Critic, 1-Tap Design Fix, Resize Design, Fix Type,
  // Make Pro, Make It Pop, Clean Up.
  const premiumTools = [
    { id: "critic", icon: Search, label: "Design Critic", description: "What's wrong?" },
    { id: "fixer", icon: Wand2, label: "1-Tap Design Fix", description: "Instant design enhance" },
    { id: "resize", icon: Maximize, label: "Resize Design", description: "Resize to any format" },
    { id: "type", icon: FileText, label: "Fix Type", description: "Fix copy & typos" },
    { id: "pro", icon: Sparkles, label: "MAKE PRO", description: "Make design look professional" },
    { id: "pop", icon: Zap, label: "Make It Pop", description: "High impact" },
    { id: "cleanup", icon: AlertCircle, label: "CLEAN UP", description: "Clean up design" },
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
      <div className="visible-scrollbar flex-1 relative overflow-y-auto p-4 pr-2">
        <div className="min-h-full flex flex-col items-center gap-6 pb-28">
          <section className="w-full max-w-3xl space-y-2 text-center">
            <h2 className="text-2xl font-bold tracking-tight rainbow-text">Polish</h2>
            <p className="text-sm text-white/50">Upgrade your graphics &amp; designs — cleaner, sharper &amp; more professional.</p>
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
          <div className="w-full max-w-4xl flex flex-col gap-6">
            {/* Comparison View */}
            <div className="relative rounded-3xl overflow-hidden bg-white/5 border border-white/10 min-h-[360px] flex items-center justify-center">
              <div className="relative flex h-full w-full items-center justify-center p-4">
                <img src={file} alt="Polish preview" className={cn("max-w-full max-h-[72vh] object-contain", isAnalyzing && "blur-sm opacity-50")} />
              </div>

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
                    <div className="w-full max-w-md bg-black/90 backdrop-blur-xl border border-white/20 rounded-3xl p-5 shadow-2xl relative flex flex-col max-h-full min-h-0 overflow-hidden">
                      <div className="flex items-center justify-between gap-3 pb-4 border-b border-white/10 flex-shrink-0">
                        <h4 className="font-bold text-lg">Design Audit</h4>
                        <div className="flex items-center gap-2">
                          <div className="px-3 py-1 rounded-full bg-white/10 text-xl font-bold rainbow-text">
                            {result.score}/100
                          </div>
                          <button
                            onClick={() => setResult(null)}
                            aria-label="Close design audit"
                            className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors flex-shrink-0"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="overflow-y-auto overscroll-contain pr-2 pt-4 space-y-6 min-h-0">
                        <div className="grid grid-cols-3 gap-4 text-[10px] uppercase tracking-tighter font-bold text-white/40">
                          <div>Hierarchy: <span className="text-white block mt-1">{result.hierarchy}</span></div>
                          <div>Contrast: <span className="text-white block mt-1">{result.contrast}</span></div>
                          <div>Balance: <span className="text-white block mt-1">{result.balance}</span></div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-bold uppercase tracking-widest text-white/30">Suggestions</p>
                          <ul className="space-y-2">
                            {(result.suggestions || []).map((s, i) => (
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

        <AnimatePresence>
          {showResizePanel && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="space-y-3">
              <select
                value={resizeTarget}
                onChange={(e) => setResizeTarget(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-white/30 transition-all"
              >
                <option value="">Choose a size</option>
                {RESIZE_FORMATS.map((format) => (
                  <option key={format.id} value={format.id}>{format.label}</option>
                ))}
              </select>
              <button
                onClick={() => handleProcess("resize")}
                disabled={!file || isAnalyzing || !resizeTarget}
                className="w-full py-4 rounded-2xl bg-white text-black font-bold uppercase tracking-[0.2em] hover:bg-white/90 disabled:opacity-20 transition-all flex items-center justify-center gap-2"
              >
                {isAnalyzing ? <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" /> : <Sparkles className="w-4 h-4" />}
                <span>Generate Resize</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="visible-horizontal-scrollbar flex gap-3 overflow-x-auto pb-2">
          {/* Free Tools */}
          {freeTools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => handleProcess(tool.id)}
              className={cn(
                "flex-shrink-0 flex flex-col items-center gap-2 p-3 rounded-2xl border transition-all min-w-[80px]",
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
              onClick={() => {
                if (tool.id === "resize") {
                  setShowResizePanel((open) => !open);
                  return;
                }
                setShowResizePanel(false);
                handleProcess(tool.id);
              }}
              className={cn(
                "flex-shrink-0 flex flex-col items-center gap-2 p-3 rounded-2xl border transition-all min-w-[80px]",
                (activeTool === tool.id || (tool.id === "resize" && showResizePanel)) ? "bg-white text-black border-white" : "bg-white/5 border-white/10 text-white hover:bg-white/10"
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
