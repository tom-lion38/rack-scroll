/* Lecture des couleurs du thème (variables CSS) pour la scène 3D. */

export type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb | null {
  const clean = hex.trim().replace("#", "");
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16) / 255,
      parseInt(clean[1] + clean[1], 16) / 255,
      parseInt(clean[2] + clean[2], 16) / 255,
    ];
  }
  if (clean.length >= 6) {
    return [
      parseInt(clean.slice(0, 2), 16) / 255,
      parseInt(clean.slice(2, 4), 16) / 255,
      parseInt(clean.slice(4, 6), 16) / 255,
    ];
  }
  return null;
}

function parseRgbFn(value: string): Rgb | null {
  const match = value.match(/rgba?\(([^)]+)\)/i);
  if (!match) return null;
  const parts = match[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map((p) => Number.parseFloat(p));
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
}

/** Lit une variable CSS de couleur sur <html> et la renvoie en composantes 0 à 1. */
export function readCssColor(name: string, fallback: Rgb): Rgb {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  if (!raw) return fallback;
  return hexToRgb(raw) ?? parseRgbFn(raw) ?? fallback;
}

/** Prévient quand l'apparence change : thème explicite (data-theme, class) ou préférence clair/sombre. */
export function onAppearanceChange(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "class"],
  });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", callback);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", callback);
  };
}
