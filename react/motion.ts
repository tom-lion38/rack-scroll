import { useSyncExternalStore } from "react";

/* Réglage des animations : une seule source de vérité, l'attribut data-motion de <html>
   ("full" ou "reduced"). Le CSS du rack ne passe en mode défilement qu'avec
   data-motion="full", et le composant lit le même attribut.

   Pour éviter un saut de mise en page, pose l'attribut avant le premier affichage
   avec MOTION_BOOT_SCRIPT dans le <head>. Sans lui, initMotion() le pose au
   premier rendu côté navigateur. */

export type Motion = "full" | "reduced";
export type MotionPreference = Motion | "auto";

const ATTR = "data-motion";
const STORAGE_KEY = "rack-motion";
const QUERY = "(prefers-reduced-motion: reduce)";

/** Script à placer tel quel dans le <head> (avant les styles). */
export const MOTION_BOOT_SCRIPT = `(function(){try{var s=localStorage.getItem("${STORAGE_KEY}");var m=s==="full"||s==="reduced"?s:(matchMedia("${QUERY}").matches?"reduced":"full");document.documentElement.setAttribute("${ATTR}",m)}catch(e){document.documentElement.setAttribute("${ATTR}","full")}})();`;

const isMotion = (value: unknown): value is Motion => value === "full" || value === "reduced";

export function systemMotion(): Motion {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "full";
  return window.matchMedia(QUERY).matches ? "reduced" : "full";
}

function storedPreference(): MotionPreference {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isMotion(value) ? value : "auto";
  } catch {
    return "auto";
  }
}

/** Mode effectif : l'attribut s'il est posé, sinon le choix enregistré ou la préférence du système. */
export function getMotion(): Motion {
  if (typeof document === "undefined") return "full";
  const attr = document.documentElement.getAttribute(ATTR);
  if (isMotion(attr)) return attr;
  const pref = storedPreference();
  return pref === "auto" ? systemMotion() : pref;
}

/** Enregistre le choix du visiteur et l'applique tout de suite à la page. */
export function setMotionPreference(preference: MotionPreference): void {
  try {
    if (preference === "auto") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Stockage bloqué : appliqué pour la page en cours seulement.
  }
  document.documentElement.setAttribute(ATTR, preference === "auto" ? systemMotion() : preference);
}

/** Pose l'attribut s'il manque et suit la préférence du système en mode auto. Renvoie le désabonnement. */
export function initMotion(): () => void {
  const root = document.documentElement;
  if (!isMotion(root.getAttribute(ATTR))) root.setAttribute(ATTR, getMotion());
  const media = window.matchMedia(QUERY);
  const onChange = () => {
    if (storedPreference() === "auto") root.setAttribute(ATTR, systemMotion());
  };
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function subscribe(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [ATTR] });
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", listener);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", listener);
  };
}

/** true si les animations sont réduites ; `serverValue` sert au rendu serveur et à l'hydratation. */
export function useReducedMotion(serverValue = false): boolean {
  return useSyncExternalStore(
    subscribe,
    () => getMotion() === "reduced",
    () => serverValue,
  );
}
