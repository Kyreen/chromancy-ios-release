import React, { memo } from "react";

interface PreviewRendererProps {
  style?: React.CSSProperties;
  result: {
    type: "image" | "video";
    uri: string;
    thumbnailUri?: string | null;
  };
  alt: string;
  className?: string;
  controls?: boolean;
  muted?: boolean;
  autoPlay?: boolean;
  loop?: boolean;
}

export const PreviewRenderer = memo(function PreviewRenderer({
  result,
  alt,
  className,
  style,
  controls = false,
  muted = true,
  autoPlay = false,
  loop = false,
}: PreviewRendererProps) {
  if (result.type === "image") {
    return <img src={result.uri} alt={alt} className={className} style={style} loading="lazy" decoding="async" />;
  }

  return (
    <video
      key={result.uri}
      src={result.uri}
      poster={result.thumbnailUri || undefined}
      className={className}
      style={style}
      controls={controls}
      muted={muted}
      autoPlay={autoPlay}
      loop={loop}
      playsInline
      preload="metadata"
    />
  );
});
