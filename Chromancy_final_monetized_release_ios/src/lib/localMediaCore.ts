export type LocalPhotoToolId = "1tap" | "light" | "sharp" | "hd";

export interface ProcessedImageResult {
  blob: Blob;
  width: number;
  height: number;
}

export interface ProcessPhotoOptions {
  maxDimension?: number;
}

const DEFAULT_PREVIEW_MAX_DIMENSION = 960;

type ScratchBuffers = {
  primary?: Uint8ClampedArray;
  secondary?: Uint8ClampedArray;
  tertiary?: Uint8ClampedArray;
  luma?: Float32Array;
  edges?: Float32Array;
};

const scratchPool = new Map<string, ScratchBuffers>();

function getScratch(width: number, height: number): ScratchBuffers {
  const key = `${width}x${height}`;
  let scratch = scratchPool.get(key);
  if (!scratch) {
    scratch = {};
    scratchPool.set(key, scratch);
  }

  const rgbaLength = width * height * 4;
  const scalarLength = width * height;
  if (!scratch.primary || scratch.primary.length !== rgbaLength) scratch.primary = new Uint8ClampedArray(rgbaLength);
  if (!scratch.secondary || scratch.secondary.length !== rgbaLength) scratch.secondary = new Uint8ClampedArray(rgbaLength);
  if (!scratch.tertiary || scratch.tertiary.length !== rgbaLength) scratch.tertiary = new Uint8ClampedArray(rgbaLength);
  if (!scratch.luma || scratch.luma.length !== scalarLength) scratch.luma = new Float32Array(scalarLength);
  if (!scratch.edges || scratch.edges.length !== scalarLength) scratch.edges = new Float32Array(scalarLength);
  return scratch;
}

function clamp(value: number, min = 0, max = 255) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function computeLuma(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function scaleDimensions(width: number, height: number, maxDimension?: number) {
  const target = maxDimension && maxDimension > 0 ? maxDimension : 0;
  if (!target || Math.max(width, height) <= target) return { width, height, scale: 1 };
  const scale = target / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

function copyInto(source: Uint8ClampedArray, target: Uint8ClampedArray) {
  target.set(source);
  return target;
}

function applyPerPixelTone(data: Uint8ClampedArray, adjust: (r: number, g: number, b: number, luma: number) => [number, number, number]) {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const luma = computeLuma(r, g, b);
    const [nr, ng, nb] = adjust(r, g, b, luma);
    data[i] = clamp(nr * 255);
    data[i + 1] = clamp(ng * 255);
    data[i + 2] = clamp(nb * 255);
  }
}

function adjustHighlights(data: Uint8ClampedArray, amount: number) {
  applyPerPixelTone(data, (r, g, b, luma) => {
    const weight = Math.pow(clamp01((luma - 0.55) / 0.45), 1.7);
    const delta = amount * weight;
    return [clamp01(r + delta), clamp01(g + delta), clamp01(b + delta)];
  });
}

function adjustWhites(data: Uint8ClampedArray, amount: number) {
  applyPerPixelTone(data, (r, g, b, luma) => {
    const weight = Math.pow(clamp01((luma - 0.72) / 0.28), 2.4);
    const delta = amount * weight;
    return [clamp01(r + delta), clamp01(g + delta), clamp01(b + delta)];
  });
}

function adjustBlacks(data: Uint8ClampedArray, amount: number) {
  applyPerPixelTone(data, (r, g, b, luma) => {
    const weight = Math.pow(clamp01((0.24 - luma) / 0.24), 1.5);
    const delta = amount * weight;
    return [clamp01(r + delta), clamp01(g + delta), clamp01(b + delta)];
  });
}

function adjustShadows(data: Uint8ClampedArray, amount: number) {
  applyPerPixelTone(data, (r, g, b, luma) => {
    const weight = Math.pow(clamp01((0.62 - luma) / 0.62), 1.45);
    const delta = amount * weight;
    return [clamp01(r + delta), clamp01(g + delta), clamp01(b + delta)];
  });
}

function adjustContrast(data: Uint8ClampedArray, amount: number) {
  const factor = 1 + amount;
  applyPerPixelTone(data, (r, g, b) => [
    clamp01((r - 0.5) * factor + 0.5),
    clamp01((g - 0.5) * factor + 0.5),
    clamp01((b - 0.5) * factor + 0.5),
  ]);
}

function adjustBrightness(data: Uint8ClampedArray, amount: number) {
  applyPerPixelTone(data, (r, g, b) => [clamp01(r + amount), clamp01(g + amount), clamp01(b + amount)]);
}

function adjustSaturation(data: Uint8ClampedArray, amount: number) {
  const scale = 1 + amount;
  applyPerPixelTone(data, (r, g, b) => {
    const gray = (r + g + b) / 3;
    return [
      clamp01(gray + (r - gray) * scale),
      clamp01(gray + (g - gray) * scale),
      clamp01(gray + (b - gray) * scale),
    ];
  });
}

function adjustTemperature(data: Uint8ClampedArray, warmth: number) {
  const normalized = warmth / 100;
  applyPerPixelTone(data, (r, g, b) => [
    clamp01(r + normalized * 0.08),
    clamp01(g + normalized * 0.01),
    clamp01(b - normalized * 0.08),
  ]);
}

function clampLuminance(data: Uint8ClampedArray, maxLuma = 246 / 255) {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const luma = computeLuma(r, g, b);
    if (luma <= maxLuma) continue;
    const ratio = maxLuma / Math.max(luma, 1e-5);
    data[i] = clamp(r * ratio * 255);
    data[i + 1] = clamp(g * ratio * 255);
    data[i + 2] = clamp(b * ratio * 255);
  }
}

function gaussianBlurApprox(source: Uint8ClampedArray, width: number, height: number, scratch: ScratchBuffers, radius = 1.2) {
  const horizontal = scratch.primary!;
  const output = scratch.secondary!;
  const r = Math.max(1, Math.round(radius));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let rr = 0, gg = 0, bb = 0, aa = 0, w = 0;
      for (let k = -r; k <= r; k += 1) {
        const sx = Math.max(0, Math.min(width - 1, x + k));
        const weight = k === 0 ? 4 : 2 - Math.min(Math.abs(k), 1);
        const idx = (y * width + sx) * 4;
        rr += source[idx] * weight;
        gg += source[idx + 1] * weight;
        bb += source[idx + 2] * weight;
        aa += source[idx + 3] * weight;
        w += weight;
      }
      const di = (y * width + x) * 4;
      horizontal[di] = clamp(rr / w);
      horizontal[di + 1] = clamp(gg / w);
      horizontal[di + 2] = clamp(bb / w);
      horizontal[di + 3] = clamp(aa / w);
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let rr = 0, gg = 0, bb = 0, aa = 0, w = 0;
      for (let k = -r; k <= r; k += 1) {
        const sy = Math.max(0, Math.min(height - 1, y + k));
        const weight = k === 0 ? 4 : 2 - Math.min(Math.abs(k), 1);
        const idx = (sy * width + x) * 4;
        rr += horizontal[idx] * weight;
        gg += horizontal[idx + 1] * weight;
        bb += horizontal[idx + 2] * weight;
        aa += horizontal[idx + 3] * weight;
        w += weight;
      }
      const di = (y * width + x) * 4;
      output[di] = clamp(rr / w);
      output[di + 1] = clamp(gg / w);
      output[di + 2] = clamp(bb / w);
      output[di + 3] = clamp(aa / w);
    }
  }

  return output;
}

function subtractArrays(source: Uint8ClampedArray, blurred: Uint8ClampedArray, target: Uint8ClampedArray) {
  for (let i = 0; i < source.length; i += 4) {
    target[i] = clamp(source[i] - blurred[i] + 128);
    target[i + 1] = clamp(source[i + 1] - blurred[i + 1] + 128);
    target[i + 2] = clamp(source[i + 2] - blurred[i + 2] + 128);
    target[i + 3] = source[i + 3];
  }
  return target;
}

function computeEdgeStrength(mask: Uint8ClampedArray, width: number, height: number, scratch: ScratchBuffers) {
  const luma = scratch.luma!;
  const edges = scratch.edges!;
  for (let i = 0, p = 0; i < mask.length; i += 4, p += 1) {
    luma[p] = computeLuma(mask[i], mask[i + 1], mask[i + 2]) / 255;
  }
  edges.fill(0);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const gx =
        -luma[i - width - 1] - 2 * luma[i - 1] - luma[i + width - 1]
        + luma[i - width + 1] + 2 * luma[i + 1] + luma[i + width + 1];
      const gy =
        -luma[i - width - 1] - 2 * luma[i - width] - luma[i - width + 1]
        + luma[i + width - 1] + 2 * luma[i + width] + luma[i + width + 1];
      const magnitude = Math.sqrt(gx * gx + gy * gy);
      edges[i] = clamp01((magnitude - 0.03) / 0.22);
    }
  }

  return edges;
}

function applyClarity(data: Uint8ClampedArray, width: number, height: number, amount: number, scratch: ScratchBuffers) {
  const soft = gaussianBlurApprox(data, width, height, scratch, 2);
  const clarityMix = scratch.tertiary!;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const current = data[i + c];
      const detail = current - soft[i + c];
      clarityMix[i + c] = clamp(current + detail * amount * 0.35);
    }
    clarityMix[i + 3] = data[i + 3];
  }
  return clarityMix;
}

function blend(source: Uint8ClampedArray, overlay: Uint8ClampedArray, amount: number) {
  for (let i = 0; i < source.length; i += 4) {
    source[i] = clamp(source[i] * (1 - amount) + overlay[i] * amount);
    source[i + 1] = clamp(source[i + 1] * (1 - amount) + overlay[i + 1] * amount);
    source[i + 2] = clamp(source[i + 2] * (1 - amount) + overlay[i + 2] * amount);
  }
}

function applyEdgeAwareSharpenPipeline(data: Uint8ClampedArray, width: number, height: number) {
  const scratch = getScratch(width, height);
  const original = copyInto(data, scratch.primary!);
  const blurred = gaussianBlurApprox(original, width, height, scratch, 1.4);
  const edges = computeEdgeStrength(original, width, height, scratch);

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const edgeStrength = edges[p];
    if (edgeStrength <= 0.02) continue;

    const edgeMix = Math.min(1, Math.max(0, (edgeStrength - 0.02) / 0.25));
    const localSharpenStrength = 1.0 + edgeMix * 0.4;
    const localContrastStrength = 0.5 + edgeMix * 0.3;

    const originalLuma = computeLuma(original[i], original[i + 1], original[i + 2]) / 255;
    const skinGuard = clamp01((0.7 - edgeStrength) / 0.7) * clamp01((0.82 - originalLuma) / 0.82);
    const protection = 1 - skinGuard * 0.22;

    for (let c = 0; c < 3; c += 1) {
      const detail = (original[i + c] - blurred[i + c]) * localSharpenStrength * protection;
      const limited = clamp(detail, -24, 24);
      const value = original[i + c] + limited;
      const centered = value - 128;
      data[i + c] = clamp(128 + centered * (1 + localContrastStrength * edgeMix * 0.18));
    }
  }

  const clarityBoost = applyClarity(data, width, height, 0.8, scratch);
  blend(data, clarityBoost, 0.82);
  clampLuminance(data, 247 / 255);
}

function applyDenoise(data: Uint8ClampedArray, width: number, height: number, amount: number, scratch: ScratchBuffers) {
  const blurred = gaussianBlurApprox(data, width, height, scratch, 1.1);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      data[i + c] = clamp(data[i + c] * (1 - amount) + blurred[i + c] * amount);
    }
  }
}

function enhanceTexture(data: Uint8ClampedArray, width: number, height: number, amount: number, scratch: ScratchBuffers) {
  const soft = gaussianBlurApprox(data, width, height, scratch, 1.5);
  const gain = amount / 100;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const detail = data[i + c] - soft[i + c];
      data[i + c] = clamp(data[i + c] + detail * gain);
    }
  }
}

function getSkinLikelihood(r: number, g: number, b: number) {
  const maxChannel = Math.max(r, g, b);
  const minChannel = Math.min(r, g, b);
  const spread = maxChannel - minChannel;
  if (r < 0.16 || g < 0.1 || b < 0.06) return 0;
  if (spread < 0.04) return 0;
  const warmth = clamp01((r - b) * 2.1);
  const balance = clamp01(1 - Math.abs(r - g) * 2.4);
  const redLead = clamp01((r - g * 0.94) * 4.5);
  return clamp01(warmth * 0.52 + balance * 0.24 + redLead * 0.24);
}

function applySkinToneRefinement(data: Uint8ClampedArray, width: number, height: number, scratch: ScratchBuffers, strength: number) {
  const original = copyInto(data, scratch.tertiary!);
  const softened = gaussianBlurApprox(original, width, height, scratch, 2);
  const edges = computeEdgeStrength(original, width, height, scratch);

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const r = original[i] / 255;
    const g = original[i + 1] / 255;
    const b = original[i + 2] / 255;
    const luma = computeLuma(r, g, b);
    const skin = getSkinLikelihood(r, g, b);
    if (skin < 0.18) continue;

    const edgeGuard = 1 - clamp01(edges[p] * 1.9);
    const midtoneGuard = clamp01(1 - Math.abs(luma - 0.58) * 2.2);
    const blendAmount = strength * skin * edgeGuard * midtoneGuard;
    if (blendAmount <= 0.01) continue;

    data[i] = clamp(original[i] * (1 - blendAmount) + softened[i] * blendAmount + blendAmount * 3);
    data[i + 1] = clamp(original[i + 1] * (1 - blendAmount) + softened[i + 1] * blendAmount + blendAmount * 2);
    data[i + 2] = clamp(original[i + 2] * (1 - blendAmount) + softened[i + 2] * blendAmount + blendAmount * 1.5);
  }
}

function getAverageLuma(image: Uint8ClampedArray) {
  let total = 0;
  let count = 0;
  for (let i = 0; i < image.length; i += 16) {
    total += (0.299 * image[i] + 0.587 * image[i + 1] + 0.114 * image[i + 2]) / 255;
    count += 1;
  }
  return count ? total / count : 0.5;
}

function fixLighting(image: Uint8ClampedArray, width: number, height: number) {
  const averageLuma = getAverageLuma(image);
  const scratch = getScratch(width, height);

  if (averageLuma < 0.47) {
    const darkLift = clamp01((0.5 - averageLuma) / 0.22);
    adjustShadows(image, 0.14 + darkLift * 0.18);
    adjustBrightness(image, 0.035 + darkLift * 0.075);
    adjustContrast(image, 0.06 + darkLift * 0.08);
    adjustHighlights(image, -0.02);
    adjustSaturation(image, 0.02 + darkLift * 0.03);
    applyDenoise(image, width, height, 0.08 + darkLift * 0.1, scratch);
  } else if (averageLuma > 0.66) {
    const brightClamp = clamp01((averageLuma - 0.66) / 0.2);
    adjustBrightness(image, -(0.03 + brightClamp * 0.08));
    adjustHighlights(image, -(0.08 + brightClamp * 0.16));
    adjustShadows(image, 0.04 + brightClamp * 0.06);
    adjustContrast(image, 0.05 + brightClamp * 0.06);
    adjustSaturation(image, -0.01 + brightClamp * 0.015);
  } else {
    adjustShadows(image, 0.09);
    adjustHighlights(image, -0.05);
    adjustBrightness(image, 0.018);
    adjustContrast(image, 0.06);
    adjustSaturation(image, 0.025);
  }

  clampLuminance(image, 246 / 255);
  return image;
}

function sharpenImage(image: Uint8ClampedArray, width: number, height: number) {
  applyEdgeAwareSharpenPipeline(image, width, height);
  return image;
}

function hdUpgrade(image: Uint8ClampedArray, width: number, height: number) {
  const scratch = getScratch(width, height);
  applyDenoise(image, width, height, 0.35, scratch);
  applyEdgeAwareSharpenPipeline(image, width, height);
  enhanceTexture(image, width, height, 25, scratch);
  adjustContrast(image, +0.10);
  clampLuminance(image, 247 / 255);
  return image;
}

function oneTapFix(image: Uint8ClampedArray, width: number, height: number) {
  const scratch = getScratch(width, height);
  adjustShadows(image, 0.12);
  adjustHighlights(image, -0.015);
  adjustContrast(image, 0.11);
  adjustBrightness(image, 0.035);
  adjustSaturation(image, 0.07);
  adjustTemperature(image, 0.65);
  applyDenoise(image, width, height, 0.1, scratch);
  applySkinToneRefinement(image, width, height, scratch, 0.22);
  applyEdgeAwareSharpenPipeline(image, width, height);
  adjustContrast(image, 0.03);
  clampLuminance(image, 247 / 255);
  return image;
}

function createCanvas(width: number, height: number) {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function decodeImage(source: Blob | ImageBitmap) {
  if (source instanceof ImageBitmap) return source;
  return await createImageBitmap(source, { colorSpaceConversion: "default", premultiplyAlpha: "default" });
}

async function canvasToBlob(canvas: OffscreenCanvas | HTMLCanvasElement, type = "image/jpeg", quality = 0.96): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    return await (canvas as OffscreenCanvas).convertToBlob({ type, quality });
  }
  return await new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to encode processed image."));
    }, type, quality);
  });
}

export async function processPhotoLocallyCore(
  source: Blob | ImageBitmap,
  toolId: LocalPhotoToolId,
  options: ProcessPhotoOptions = {},
): Promise<ProcessedImageResult> {
  const bitmap = await decodeImage(source);
  const baseUpscale = toolId === "hd" ? 2.5 : 1;
  const desiredWidth = Math.max(1, Math.round(bitmap.width * baseUpscale));
  const desiredHeight = Math.max(1, Math.round(bitmap.height * baseUpscale));
  const scaled = scaleDimensions(desiredWidth, desiredHeight, options.maxDimension ?? (toolId === "hd" ? undefined : DEFAULT_PREVIEW_MAX_DIMENSION));
  const width = scaled.width;
  const height = scaled.height;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true } as any) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new Error("Could not create processing canvas.");

  (ctx as any).imageSmoothingEnabled = true;
  (ctx as any).imageSmoothingQuality = "high";
  (ctx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D).drawImage(bitmap, 0, 0, width, height);

  const image = (ctx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D).getImageData(0, 0, width, height);
  const data = image.data;

  if (toolId === "1tap") {
    oneTapFix(data, width, height);
  } else if (toolId === "light") {
    fixLighting(data, width, height);
  } else if (toolId === "sharp") {
    sharpenImage(data, width, height);
  } else {
    hdUpgrade(data, width, height);
  }

  (ctx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D).putImageData(image, 0, 0);
  const blob = await canvasToBlob(canvas, "image/jpeg", toolId === "hd" ? 0.98 : 0.96);
  return { blob, width, height };
}
