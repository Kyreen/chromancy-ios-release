export async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  return pdfjs;
}

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export async function decodeImageDimensions(imageUrl: string): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = imageUrl;
  });
}

export async function renderPdfFirstPage(file: File, scale = 1.5): Promise<string> {
  const pdfjs = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Failed to render PDF page");
  }

  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);

  await page.render({ canvasContext: context, viewport, canvas }).promise;
  return canvas.toDataURL("image/png");
}

export async function watermarkImage(imageUrl: string, text: string, blur = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Failed to get canvas context"));

      canvas.width = img.width;
      canvas.height = img.height;

      if (blur) {
        ctx.filter = "blur(0.5px)";
      }

      ctx.drawImage(img, 0, 0);
      ctx.filter = "none";
      ctx.font = `${Math.floor(canvas.width / 20)}px Roboto Condensed`;
      ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const spacing = canvas.width / 4;
      for (let x = spacing / 2; x < canvas.width; x += spacing) {
        for (let y = spacing / 2; y < canvas.height; y += spacing) {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(-Math.PI / 4);
          ctx.fillText(text, 0, 0);
          ctx.restore();
        }
      }

      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = imageUrl;
  });
}

export function downloadFile(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
