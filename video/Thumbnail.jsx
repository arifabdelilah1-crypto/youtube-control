// The video's thumbnail. Same component in the editor preview (Remotion Player) and the final image (renderStill).
import React from "react";
import { AbsoluteFill, Img, OffthreadVideo } from "remotion";
import { ARABIC, LATIN, useFonts } from "./fonts.js";
import { THUMBNAIL_STYLES } from "./layout.js";

const LOOKS = {
  dark: { filter: "contrast(1.15) saturate(.55) brightness(.72)", shade: "radial-gradient(ellipse at center, rgba(0,0,0,0) 35%, rgba(0,0,0,.82) 100%)", shadow: "0 6px 0 #000, 0 0 34px rgba(0,0,0,.95)" },
  horror: { filter: "contrast(1.3) saturate(.3) brightness(.55)", shade: "radial-gradient(ellipse at center, rgba(40,0,0,.12) 25%, rgba(0,0,0,.93) 100%)", shadow: "0 0 26px rgba(179,0,0,.95), 0 6px 0 #000" },
  love: { filter: "saturate(1.1) brightness(.92)", shade: "linear-gradient(180deg, rgba(255,70,120,.16), rgba(90,0,50,.6))", shadow: "0 4px 18px rgba(70,0,35,.9)" },
  funny: { filter: "saturate(1.35) contrast(1.05)", shade: "none", stroke: "#000", shadow: "0 8px 0 #000", tilt: -3 },
  clean: { filter: "none", shade: "none", box: "#FFFFFF" },
};

// Vertical apps cover the top and bottom of the picture (buttons, name, caption): the text stays out of those parts.
const PADDING = { "9:16": "260px 90px 460px", "16:9": 56, "1:1": 72 };

/** @param {{image?: {type?: string, url?: string, trim?: number}, text?: string, style?: string, color?: string, accent?: string, size?: number, position?: string, aspect?: string, assetBase?: string|null}} props */
export function Thumbnail({ image, text = "", style = "dark", color, accent, size = 110, position = "bottom", aspect = "16:9", assetBase = null }) {
  useFonts(assetBase);
  const look = LOOKS[style] || LOOKS.dark;
  const base = THUMBNAIL_STYLES[style] || THUMBNAIL_STYLES.dark;
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const last = words.length > 1 ? words.pop() : null;
  const media = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: look.filter };
  const justify = { top: "flex-start", center: "center", bottom: "flex-end" }[position] || "flex-end";
  return (
    <AbsoluteFill style={{ background: "#0B0B0D", overflow: "hidden" }}>
      {image?.url && image.type === "video" ? <OffthreadVideo src={image.url} muted startFrom={Math.round((image.trim || 0) * 30)} style={media} /> : null}
      {image?.url && image.type !== "video" ? <Img src={image.url} style={media} /> : null}
      {look.shade !== "none" ? <AbsoluteFill style={{ background: look.shade }} /> : null}
      <AbsoluteFill style={{ padding: PADDING[aspect] || PADDING["16:9"], justifyContent: justify, alignItems: "center" }}>
        {words.length || last ? (
          <div dir="auto" style={{
            fontFamily: `"${LATIN}", "${ARABIC}", sans-serif`, fontWeight: 800, fontSize: size, lineHeight: 1.02, textAlign: "center", textTransform: "uppercase",
            color: color || base.color, textShadow: look.shadow || "none", WebkitTextStroke: look.stroke ? `3px ${look.stroke}` : undefined, paintOrder: "stroke fill",
            transform: look.tilt ? `rotate(${look.tilt}deg)` : undefined, background: look.box || undefined, padding: look.box ? "14px 28px" : 0, borderRadius: look.box ? 10 : 0, maxWidth: "100%", overflowWrap: "anywhere",
          }}>
            {words.join(" ")}{last ? " " : ""}{last ? <span style={{ color: accent || base.accent }}>{last}</span> : null}
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
