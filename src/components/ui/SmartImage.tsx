import { useState, type CSSProperties } from "react";
import { cn } from "@/lib/cn";

export interface SmartImageProps {
  src?: string | null;
  /** Used for alt text and the placeholder initial. */
  name?: string;
  className?: string;
  imgClassName?: string;
  style?: CSSProperties;
  fit?: "cover" | "contain";
  /** Fade the image in once loaded (default true). */
  fade?: boolean;
}

type Status = { src: string | null | undefined; state: "loading" | "loaded" | "error" };

/**
 * Lazy image that fades in, and swaps to a gradient + initial placeholder (same dimensions) when missing or broken.
 * The wrapper is `relative overflow-hidden`; size it with `className`.
 */
export function SmartImage({ src, name, className, imgClassName, style, fit = "cover", fade = true }: SmartImageProps) {
  const [status, setStatus] = useState<Status>({ src, state: "loading" });
  const state = status.src === src ? status.state : "loading";
  const showImg = !!src && state !== "error";
  const initial = (name?.trim()[0] ?? "?").toUpperCase();

  return (
    <div className={cn(!/\b(absolute|fixed|sticky)\b/.test(className ?? "") && "relative", "overflow-hidden bg-raised", className)} style={style}>
      {state !== "loaded" && (
        <div
          aria-hidden
          className="absolute inset-0 flex items-center justify-center text-2xl font-semibold text-white/70"
          style={{ background: "linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)", opacity: 0.55 }}
        >
          {state === "error" || !src ? initial : null}
        </div>
      )}
      {showImg && (
        <img
          src={src}
          alt={name ?? ""}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setStatus({ src, state: "loaded" })}
          onError={() => setStatus({ src, state: "error" })}
          className={cn(
            "absolute inset-0 h-full w-full",
            fade && "transition-opacity duration-300",
            fit === "cover" ? "object-cover" : "object-contain",
            state === "loaded" ? "opacity-100" : "opacity-0",
            imgClassName,
          )}
        />
      )}
    </div>
  );
}
