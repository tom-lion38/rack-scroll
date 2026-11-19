"use client";

/* RackScroll : rack serveur qui se monte au fil du défilement.
   Extrait du site tlnetwork.fr, sans les dépendances internes du site.
   Dépendances : react (18 ou 19) et three. Styles : rack-scroll.module.css + tokens.css.
   Le mode défilement n'existe qu'avec <html data-motion="full"> (voir motion.ts). */


import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { onAppearanceChange, readCssColor, type Rgb } from "./colors";
import { useReducedMotion } from "./motion";
import styles from "./rack-scroll.module.css";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/* =========================================================================
   Rack serveur qui s'assemble au défilement.
   Une zone collante garde la scène 3D fixe pendant que la progression du
   défilement trace le châssis, pose les rails, glisse les équipements un à
   un, tire les câbles puis passe tous les voyants au vert.
   Three.js n'est chargé que si la scène approche de l'écran. Animations
   réduites, absence de JavaScript ou de WebGL : rack assemblé statique (SVG),
   légendes toutes listées, pas de zone collante.
   Toutes les données sont fictives : représentation d'un homelab type.
   ========================================================================= */

type Three = typeof import("three");
type V3 = [number, number, number];
type Seg = [V3, V3];
type Status = "loading" | "ready" | "fallback" | "lost";

export type RackDeviceKind = "firewall" | "switch" | "hypervisor" | "storage" | "ups";

export type RackDevice = {
  /** Clé stable (sert aussi de clé React). */
  id: string;
  /** Modèle 3D et façade utilisés. */
  kind: RackDeviceKind;
  /** Titre de la légende (niveau de titre réglable via headingLevel). */
  title: string;
  /** Ligne courte, impersonnelle. */
  line: string;
  /** Hauteur en unités de rack ; par défaut selon le type (1 U ou 2 U). */
  units?: 1 | 2 | 3;
};

export type RackScrollProps = {
  /** Équipements, du haut vers le bas du rack (8 au maximum). */
  devices?: RackDevice[];
  className?: string;
  /** En-tête de section (eyebrow, h2, lead) placé dans la colonne des légendes. */
  children?: ReactNode;
  /** Niveau des titres de légende : 3 par défaut, sous un h2 de section. */
  headingLevel?: 2 | 3 | 4;
  /** Mention d'honnêteté affichée sur le visuel. */
  note?: string;
  /** Libellé de l'état final. */
  finalLabel?: string;
  /** « auto » allège le rendu sur mobile et sur les petites configurations. */
  quality?: "auto" | "high" | "low";
};

export const RACK_DEFAULT_DEVICES: RackDevice[] = [
  {
    id: "pare-feu",
    kind: "firewall",
    title: "Pare-feu et routeur",
    line: "Filtre tout ce qui entre, journalise ce qui sort.",
  },
  {
    id: "switch",
    kind: "switch",
    title: "Switch administrable",
    line: "Un port par machine, des VLAN pour cloisonner les usages.",
  },
  {
    id: "hyperviseur",
    kind: "hypervisor",
    title: "Hyperviseur",
    line: "Fait tourner machines virtuelles et conteneurs sur un seul hôte.",
  },
  {
    id: "stockage",
    kind: "storage",
    title: "Stockage ZFS",
    line: "Quatre disques, des sommes de contrôle et un instantané chaque nuit.",
  },
  {
    id: "onduleur",
    kind: "ups",
    title: "Onduleur",
    line: "Encaisse les microcoupures et déclenche un arrêt propre si elles durent.",
  },
];

/* ---------- Géométrie (1 unité = 1 U = 44,45 mm) ---------- */

const OUT_W = 13.5; // 600 mm hors tout
const OUT_D = 13.5; // 600 mm de profondeur
const POST = 0.5;
const PANEL_W = 10.86; // façade 19 pouces
const BODY_W = 9.7;
const RAIL_X = 5.25;
const RAIL_W = 0.6;
const FRONT = OUT_D / 2;
const RAIL_Z = FRONT - 1.1;
const PANEL_Z = RAIL_Z + 0.22;
const PLINTH = 0.6;
const FEET = 0.35;
const FLOOR_Y = -PLINTH - FEET;
const CH_X = PANEL_W / 2 + 0.34;
const DIM_OFF = 1.9;
const HEIGHT_DIM_X = -OUT_W / 2 - 1.3;
const SLIDE_Z = 17;

const UNITS: Record<RackDeviceKind, 1 | 2> = {
  firewall: 1,
  switch: 1,
  hypervisor: 2,
  storage: 2,
  ups: 2,
};
const DEPTH: Record<RackDeviceKind, number> = {
  firewall: 6.4,
  switch: 5.6,
  hypervisor: 11.6,
  storage: 10.8,
  ups: 9.2,
};
const NETWORK = new Set<RackDeviceKind>(["firewall", "switch"]);

const unitsOf = (d: RackDevice) => d.units ?? UNITS[d.kind];

/* ---------- Outils ---------- */

const DEG = Math.PI / 180;
const FOV = 26;
const AZ0 = 38 * DEG;
const AZ1 = 0;
const EL0 = 21 * DEG;
const EL1 = 6.5 * DEG;

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const remap = (v: number, a: number, b: number) => clamp((v - a) / (b - a));
const smooth = (t: number) => t * t * (3 - 2 * t);
const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rnd = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const two = (i: number) => String(i + 1).padStart(2, "0");

function parseColor(raw: string): Rgb | null {
  const value = raw.trim();
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex.slice(0, 6);
    if (!/^[0-9a-f]{6}$/i.test(full)) return null;
    return [
      parseInt(full.slice(0, 2), 16) / 255,
      parseInt(full.slice(2, 4), 16) / 255,
      parseInt(full.slice(4, 6), 16) / 255,
    ];
  }
  const match = value.match(/rgba?\(([^)]+)\)/i);
  if (!match) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number.parseFloat);
  if (parts.length < 3 || !parts.slice(0, 3).every(Number.isFinite)) return null;
  return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
}

/** Lit une couleur sur l'élément lui-même : une variable redéfinie sur la section est respectée. */
function readVar(el: Element, name: string, fallback: Rgb): Rgb {
  const raw = getComputedStyle(el).getPropertyValue(name);
  return (raw && parseColor(raw)) || readCssColor(name, fallback);
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const luminance = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const WHITE: Rgb = [1, 1, 1];

/* =========================================================================
   Plan du rack : emplacements, façades, câbles, chronologie
   ========================================================================= */

type Led = { p: V3; kind: 0 | 1 };
type Face = { segs: Seg[]; leds: Led[]; ports: V3[] };
type Slot = { kind: RackDeviceKind; units: number; h: number; yc: number; depth: number; face: Face };
type Box = { c: V3; s: V3; w: number };
type TSeg = { a: V3; b: V3; t0: number; t1: number; w: number };
type Timeline = {
  starts: number[];
  lands: number[];
  boot: number;
  cables: Array<[number, number]>;
  green: [number, number];
  final: number;
  cam: number;
};
type Plan = { rackU: number; slots: Slot[]; cables: V3[][]; tl: Timeline };

/** Façade d'un équipement : repère local centré sur la face avant (z = 0). */
function faceOf(kind: RackDeviceKind): Face {
  const segs: Seg[] = [];
  const leds: Led[] = [];
  const ports: V3[] = [];
  const Z = 0.016;
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    segs.push([
      [x1, y1, Z],
      [x2, y2, Z],
    ]);
  };
  const rect = (cx: number, cy: number, w: number, h: number) => {
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const y0 = cy - h / 2;
    const y1 = cy + h / 2;
    line(x0, y0, x1, y0);
    line(x1, y0, x1, y1);
    line(x1, y1, x0, y1);
    line(x0, y1, x0, y0);
  };
  const led = (x: number, y: number, k: 0 | 1) => leds.push({ p: [x, y, Z + 0.03], kind: k });
  const port = (x: number, y: number) => ports.push([x, y, Z]);

  switch (kind) {
    case "firewall": {
      for (let i = 0; i < 12; i++) line(-4.75 + i * 0.17, -0.22, -4.75 + i * 0.17, 0.22);
      for (let i = 0; i < 4; i++) {
        const cx = -0.9 + i * 0.64;
        rect(cx, -0.07, 0.5, 0.38);
        line(cx - 0.09, -0.19, cx + 0.09, -0.19);
        led(cx - 0.16, 0.24, 1);
      }
      port(-0.9 + 3 * 0.64, -0.07);
      rect(1.95, -0.07, 0.4, 0.28);
      line(2.7, -0.2, 3.95, -0.2);
      led(2.8, 0.15, 0);
      led(3.2, 0.15, 1);
      led(3.6, 0.15, 0);
      rect(4.55, 0, 0.3, 0.3);
      break;
    }
    case "switch": {
      for (let i = 0; i < 8; i++) line(-4.8 + i * 0.17, -0.2, -4.8 + i * 0.17, 0.2);
      led(-3.05, 0.17, 0);
      led(-3.05, -0.15, 0);
      for (let c = 0; c < 12; c++) {
        const cx = -2.45 + c * 0.5;
        rect(cx, -0.1, 0.42, 0.34);
        line(cx - 0.08, -0.21, cx + 0.08, -0.21);
        led(cx, 0.27, 1);
      }
      for (let c = 11; c >= 7; c--) port(-2.45 + c * 0.5, -0.1);
      for (const cx of [3.75, 4.37]) {
        rect(cx, -0.08, 0.5, 0.28);
        led(cx, 0.27, 0);
      }
      break;
    }
    case "hypervisor": {
      for (let i = 0; i < 8; i++) {
        const cx = -4.5 + i * 0.64;
        rect(cx, -0.04, 0.56, 1.52);
        line(cx - 0.16, -0.62, cx + 0.16, -0.62);
        led(cx + 0.14, 0.58, 1);
      }
      rect(0.7, -0.58, 0.32, 0.22);
      rect(1.12, -0.58, 0.32, 0.22);
      port(1.12, -0.58);
      port(0.7, -0.58);
      for (let j = 0; j < 8; j++) line(1.55, -0.62 + j * 0.177, 4.05, -0.62 + j * 0.177);
      rect(4.55, 0.55, 0.32, 0.32);
      led(4.55, 0.1, 0);
      led(4.55, -0.2, 0);
      break;
    }
    case "storage": {
      for (let i = 0; i < 4; i++) {
        const cx = -3.62 + i * 2.1;
        rect(cx, -0.02, 2, 1.56);
        line(cx - 0.8, -0.56, cx + 0.3, -0.56);
        for (const v of [0.12, 0.26, 0.4]) line(cx - 0.8, v, cx + 0.25, v);
        led(cx + 0.76, 0.58, 1);
        led(cx + 0.76, 0.34, 0);
      }
      led(4.5, 0.58, 0);
      rect(4.5, 0.12, 0.3, 0.3);
      rect(4.5, -0.55, 0.36, 0.22);
      port(4.5, -0.55);
      break;
    }
    case "ups": {
      rect(-3.4, 0.22, 2.3, 0.9);
      for (let k = 0; k < 5; k++) line(-4.3 + k * 0.2, 0.0, -4.3 + k * 0.2, 0.44);
      line(-3.1, 0.45, -2.45, 0.45);
      line(-3.1, 0.3, -2.75, 0.3);
      for (const cx of [-4.1, -3.4, -2.7]) rect(cx, -0.5, 0.38, 0.26);
      led(-1.75, 0.45, 0);
      led(-1.35, 0.45, 0);
      led(-0.95, 0.45, 0);
      for (let i = 0; i < 20; i++) line(-0.3 + i * 0.2, -0.62, -0.3 + i * 0.2, 0.62);
      rect(4.45, -0.52, 0.38, 0.26);
      led(4.45, 0.45, 1);
      port(4.45, -0.52);
      break;
    }
  }
  return { segs, leds, ports };
}

/** Catmull-Rom centripète, échantillonné : même courbe en 3D et en SVG. */
function spline(points: V3[], samples = 10): V3[] {
  const n = points.length;
  if (n < 3) return points.slice();
  const first = points[0];
  const second = points[1];
  const last = points[n - 1];
  const before = points[n - 2];
  const pts: V3[] = [
    [2 * first[0] - second[0], 2 * first[1] - second[1], 2 * first[2] - second[2]],
    ...points,
    [2 * last[0] - before[0], 2 * last[1] - before[1], 2 * last[2] - before[2]],
  ];
  const knot = (a: V3, b: V3) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])));
  const lerpV = (a: V3, b: V3, ta: number, tb: number, t: number): V3 => {
    const u = (t - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  };
  const out: V3[] = [];
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2];
    const t0 = 0;
    const t1 = t0 + knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    for (let s = 0; s < samples; s++) {
      const t = t1 + ((t2 - t1) * s) / samples;
      const a1 = lerpV(p0, p1, t0, t1, t);
      const a2 = lerpV(p1, p2, t1, t2, t);
      const a3 = lerpV(p2, p3, t2, t3, t);
      const b1 = lerpV(a1, a2, t0, t2, t);
      const b2 = lerpV(a2, a3, t1, t3, t);
      out.push(lerpV(b1, b2, t1, t2, t));
    }
  }
  out.push(last);
  return out;
}

/** Câble : sort du port, rejoint la goulotte de droite, descend, revient au port. */
function cableRoute(a: V3, b: V3, k: number): V3[] {
  const x = CH_X + k * 0.15;
  const z = PANEL_Z + 0.42 + k * 0.07;
  const down = a[1] > b[1] ? 1 : -1;
  const pts: V3[] = [
    a,
    [a[0], a[1], a[2] + 0.3],
    [a[0] + (x - a[0]) * 0.55, a[1] - 0.05 * down, z],
  ];
  if (Math.abs(a[1] - b[1]) > 1.2) {
    pts.push([x, a[1] - 0.45 * down, z], [x, b[1] + 0.45 * down, z]);
  } else {
    pts.push([x, (a[1] + b[1]) / 2, z]);
  }
  pts.push([b[0] + (x - b[0]) * 0.55, b[1] + 0.05 * down, z], [b[0], b[1], b[2] + 0.3], b);
  return spline(pts, 9);
}

function computePlan(devices: RackDevice[]): Plan {
  const list = devices.slice(0, 8);
  const gaps = list.map((d, i) => {
    if (i === 0) return 0;
    if (d.kind === "ups") return 1;
    return NETWORK.has(list[i - 1].kind) && !NETWORK.has(d.kind) ? 1 : 0;
  });
  const used = list.reduce((sum, d, i) => sum + unitsOf(d) + gaps[i], 0);
  const rackU = Math.max(6, used);
  let top = rackU;
  const slots: Slot[] = list.map((d, i) => {
    top -= gaps[i];
    const units = unitsOf(d);
    const y1 = top;
    const y0 = top - units;
    top = y0;
    return {
      kind: d.kind,
      units,
      h: units - 0.08,
      yc: (y0 + y1) / 2,
      depth: DEPTH[d.kind],
      face: faceOf(d.kind),
    };
  });

  // Câbles : le switch dessert tout le monde, l'onduleur prévient l'hyperviseur.
  const world = (s: Slot, p: V3): V3 => [p[0], s.yc + p[1], PANEL_Z + p[2]];
  const pairs: Array<[V3, V3]> = [];
  const sw = slots.findIndex((s) => s.kind === "switch");
  if (sw >= 0) {
    let k = 0;
    slots.forEach((s, i) => {
      if (i === sw || s.kind === "ups" || !s.face.ports.length) return;
      const swPorts = slots[sw].face.ports;
      pairs.push([world(slots[sw], swPorts[k % swPorts.length]), world(s, s.face.ports[0])]);
      k += 1;
    });
  } else {
    const net = slots.filter((s) => s.kind !== "ups" && s.face.ports.length);
    for (let i = 1; i < net.length; i++) {
      pairs.push([world(net[i - 1], net[i - 1].face.ports[0]), world(net[i], net[i].face.ports[0])]);
    }
  }
  const ups = slots.find((s) => s.kind === "ups");
  const host = slots.find((s) => s.kind === "hypervisor") ?? slots.find((s) => s.kind === "storage");
  if (ups && host && ups.face.ports.length) {
    const hp = host.face.ports[1] ?? host.face.ports[0];
    pairs.push([world(ups, ups.face.ports[0]), world(host, hp)]);
  }
  const cables = pairs.map(([a, b], k) => cableRoute(a, b, k));

  // Chronologie, en fraction de la progression du défilement.
  const n = Math.max(1, slots.length);
  const DEV0 = 0.19;
  const DEV1 = 0.64;
  const step = (DEV1 - DEV0) / n;
  const slide = Math.min(0.085, step * 0.95);
  const boot = 0.03;
  const starts = slots.map((_, i) => DEV0 + i * step);
  const lands = starts.map((s) => s + slide);
  const c0 = Math.max(DEV1, (lands[lands.length - 1] ?? DEV1) + boot) - 0.01;
  const cDur = 0.07;
  const stagger = cables.length > 1 ? (0.8 - cDur - c0) / (cables.length - 1) : 0;
  const cableTimes = cables.map((_, k): [number, number] => [c0 + k * stagger, c0 + k * stagger + cDur]);

  return {
    rackU,
    slots,
    cables,
    tl: { starts, lands, boot, cables: cableTimes, green: [0.8, 0.86], final: 0.865, cam: 0.9 },
  };
}

/* ---------- Segments partagés par la 3D et le SVG ---------- */

function boxEdges(c: V3, s: V3): Seg[] {
  const x0 = c[0] - s[0] / 2;
  const x1 = c[0] + s[0] / 2;
  const y0 = c[1] - s[1] / 2;
  const y1 = c[1] + s[1] / 2;
  const z0 = c[2] - s[2] / 2;
  const z1 = c[2] + s[2] / 2;
  return [
    [[x0, y0, z0], [x1, y0, z0]],
    [[x1, y0, z0], [x1, y0, z1]],
    [[x1, y0, z1], [x0, y0, z1]],
    [[x0, y0, z1], [x0, y0, z0]],
    [[x0, y1, z0], [x1, y1, z0]],
    [[x1, y1, z0], [x1, y1, z1]],
    [[x1, y1, z1], [x0, y1, z1]],
    [[x0, y1, z1], [x0, y1, z0]],
    [[x0, y0, z0], [x0, y1, z0]],
    [[x1, y0, z0], [x1, y1, z0]],
    [[x1, y0, z1], [x1, y1, z1]],
    [[x0, y0, z1], [x0, y1, z1]],
  ];
}

function chassisBoxes(rackH: number): Box[] {
  const px = OUT_W / 2 - POST / 2;
  const pz = OUT_D / 2 - POST / 2;
  const fx = OUT_W / 2 - 0.7;
  const fz = OUT_D / 2 - 0.7;
  const boxes: Box[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      boxes.push({ c: [sx * fx, -PLINTH - FEET / 2, sz * fz], s: [0.7, FEET, 0.7], w: 0.7 });
      boxes.push({ c: [sx * px, rackH / 2, sz * pz], s: [POST, rackH, POST], w: 1 });
    }
    boxes.push({ c: [sx * px, rackH / 2, 0], s: [POST * 0.6, 0.3, OUT_D - POST * 2], w: 0.55 });
  }
  boxes.push({ c: [0, -PLINTH / 2, 0], s: [OUT_W, PLINTH, OUT_D], w: 1 });
  boxes.push({ c: [0, rackH + PLINTH / 2, 0], s: [OUT_W, PLINTH, OUT_D], w: 1 });
  return boxes;
}

/** Ordre de tracé du châssis : de bas en haut, en tournant ; les montants poussent vers le haut. */
function orderTrace(items: Array<{ seg: Seg; w: number }>): TSeg[] {
  const norm = items.map(({ seg, w }) => {
    let a = seg[0];
    let b = seg[1];
    if (Math.abs(a[1] - b[1]) > 1e-3 && a[1] > b[1]) [a, b] = [b, a];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const key = Math.min(a[1], b[1]) * 10 + Math.atan2(a[2] + b[2], a[0] + b[0]) * 0.08;
    return { a, b, w, len, key };
  });
  norm.sort((p, q) => p.key - q.key);
  const maxLen = Math.max(1, ...norm.map((s) => s.len));
  const count = norm.length;
  const out = norm.map((s, i) => {
    const t0 = (count > 1 ? i / (count - 1) : 0) * 0.62;
    return { a: s.a, b: s.b, w: s.w, t0, t1: t0 + 0.06 + (0.32 * s.len) / maxLen };
  });
  const maxT = Math.max(...out.map((s) => s.t1));
  for (const s of out) {
    s.t0 /= maxT;
    s.t1 /= maxT;
  }
  return out;
}

function railTrace(rackU: number): TSeg[] {
  const out: TSeg[] = [];
  const add = (a: V3, b: V3, w: number) =>
    out.push({ a, b, w, t0: clamp(a[1] / rackU), t1: clamp(b[1] / rackU) });
  for (const sx of [-1, 1]) {
    for (const sz of [1, -1]) {
      const w = sz > 0 ? 1 : 0.45;
      for (const [a, b] of boxEdges([sx * RAIL_X, rackU / 2, sz * RAIL_Z], [RAIL_W, rackU, 0.12])) add(a, b, w);
      if (sz < 0) continue;
      for (let u = 0; u < rackU; u++) {
        for (const k of [0.25, 0.5, 0.75]) {
          const x = sx * RAIL_X;
          const y = u + k;
          const z = RAIL_Z + 0.07;
          const r = 0.07;
          add([x - r, y - r, z], [x + r, y - r, z], 0.7);
          add([x + r, y - r, z], [x + r, y + r, z], 0.7);
          add([x - r, y + r, z], [x + r, y + r, z], 0.7);
          add([x - r, y - r, z], [x - r, y + r, z], 0.7);
        }
      }
    }
  }
  const x1 = -RAIL_X - RAIL_W / 2;
  for (let u = 0; u <= rackU; u++) add([x1 - 0.32, u, RAIL_Z + 0.06], [x1, u, RAIL_Z + 0.06], 0.6);
  return out;
}

/** Cotes au sol et en façade ; la profondeur, à part, s'efface quand la vue passe de face. */
function dimTrace(rackU: number): { main: TSeg[]; depth: TSeg[] } {
  const y = FLOOR_Y + 0.01;
  const X = OUT_W / 2;
  const Zf = OUT_D / 2;
  const out: TSeg[] = [];
  const depth: TSeg[] = [];
  const add = (a: V3, b: V3, t0: number, t1: number, w = 1) => out.push({ a, b, t0, t1, w });
  const addD = (a: V3, b: V3, t0: number, t1: number, w = 1) => depth.push({ a, b, t0, t1, w });
  const fp: V3[] = [
    [-X, y, -Zf],
    [X, y, -Zf],
    [X, y, Zf],
    [-X, y, Zf],
  ];
  for (let i = 0; i < 4; i++) add(fp[i], fp[(i + 1) % 4], 0, 0.35, 0.5);
  const tick = 0.2;
  // Largeur, devant.
  const wz = Zf + DIM_OFF;
  add([-X, y, Zf], [-X, y, wz + 0.35], 0.05, 0.3, 0.7);
  add([X, y, Zf], [X, y, wz + 0.35], 0.05, 0.3, 0.7);
  add([-X, y, wz], [X, y, wz], 0.25, 0.8);
  add([-X - tick, y, wz + tick], [-X + tick, y, wz - tick], 0.78, 0.84);
  add([X - tick, y, wz + tick], [X + tick, y, wz - tick], 0.78, 0.84);
  // Profondeur, à droite.
  const dx = X + DIM_OFF;
  addD([X, y, Zf], [dx + 0.35, y, Zf], 0.05, 0.3, 0.7);
  addD([X, y, -Zf], [dx + 0.35, y, -Zf], 0.05, 0.3, 0.7);
  addD([dx, y, Zf], [dx, y, -Zf], 0.25, 0.8);
  addD([dx - tick, y, Zf - tick], [dx + tick, y, Zf + tick], 0.78, 0.84);
  addD([dx - tick, y, -Zf - tick], [dx + tick, y, -Zf + tick], 0.78, 0.84);
  // Hauteur utile, à gauche, dans le plan avant.
  const hx = HEIGHT_DIM_X;
  const z = Zf;
  add([-X, 0, z], [hx - 0.35, 0, z], 0.1, 0.35, 0.7);
  add([-X, rackU, z], [hx - 0.35, rackU, z], 0.1, 0.35, 0.7);
  add([hx, 0, z], [hx, rackU, z], 0.3, 0.9);
  add([hx - tick, -tick, z], [hx + tick, tick, z], 0.85, 0.9);
  add([hx - tick, rackU - tick, z], [hx + tick, rackU + tick, z], 0.85, 0.9);
  return { main: out, depth };
}

const DIM_TEXT = ["600 mm", "600 mm", ""];
/** Demi-largeur réservée à l'étiquette de hauteur, posée verticalement sur sa ligne de cote. */
const HEIGHT_LABEL_HALF = 0.75;
const dimAnchors = (rackU: number): V3[] => [
  [0, FLOOR_Y, OUT_D / 2 + DIM_OFF + 0.95],
  [OUT_W / 2 + DIM_OFF + 1.1, FLOOR_Y, 0],
  // Sur la ligne de cote elle-même (étiquette tournée, comme sur un plan) :
  // la marge latérale à réserver est bien plus étroite, le rack gagne en taille.
  [HEIGHT_DIM_X, rackU / 2, OUT_D / 2],
];

/* =========================================================================
   Shaders
   ========================================================================= */

const LINE_VERT = /* glsl */ `
attribute float aT;
attribute float aW;
varying float vT;
varying float vW;
void main() {
  vT = aT;
  vW = aW;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Tracé progressif : chaque segment pousse de t0 à t1, une tête plus claire
// marque la plume ; au-delà, une « construction » très pâle.
const LINE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHead;
uniform float uDraw;
uniform float uAlpha;
uniform float uGhost;
varying float vT;
varying float vW;
void main() {
  float drawn = step(vT, uDraw);
  float head = drawn * smoothstep(uDraw - 0.06, uDraw, vT) * (1.0 - step(0.999, uDraw));
  float a = mix(uGhost, uAlpha, drawn) * vW;
  a = max(a, head * uAlpha);
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(uColor, uHead, head), a);
}
`;

const GRID_VERT = /* glsl */ `
varying vec3 vPos;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const GRID_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uR0;
uniform float uR1;
varying vec3 vPos;
void main() {
  float a = uAlpha * (1.0 - smoothstep(uR0, uR1, length(vPos.xz)));
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

const SHADOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SHADOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  vec2 d = abs(vUv - 0.5) * 2.0;
  float r = length(max(d - 0.18, 0.0)) / 0.82;
  float a = uAlpha * pow(1.0 - smoothstep(0.0, 1.0, r), 1.8);
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

const BODY_VERT = /* glsl */ `
varying vec3 vN;
void main() {
  vN = normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Volume sombre éclairé par face : dessus clair, façade moyenne, flancs sombres.
const BODY_FRAG = /* glsl */ `
uniform vec3 uLo;
uniform vec3 uHi;
uniform vec3 uAccent;
uniform float uOpacity;
uniform float uGlow;
varying vec3 vN;
void main() {
  vec3 n = normalize(vN);
  float l = clamp(0.42 + 0.5 * n.y + 0.22 * n.z - 0.12 * abs(n.x), 0.0, 1.0);
  vec3 c = mix(uLo, uHi, l);
  c = mix(c, uAccent, uGlow * 0.07 * max(n.z, 0.0));
  gl_FragColor = vec4(c, uOpacity);
}
`;

// Voyants : éteints, clignotement ambre au démarrage, puis activité à la
// couleur d'accent, et enfin tous verts.
const LED_VERT = /* glsl */ `
attribute float aPhase;
attribute float aKind;
attribute float aRate;
uniform float uTime;
uniform float uPower;
uniform float uGreen;
uniform float uOpacity;
uniform float uPx;
uniform float uSize;
uniform vec3 uOff;
uniform vec3 uBoot;
uniform vec3 uOn;
uniform vec3 uOk;
varying vec3 vCol;
varying float vA;
varying float vGlow;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float booting = step(0.001, uPower) * (1.0 - step(0.999, uPower));
  float running = step(0.999, uPower);
  float flick = aKind > 0.5 ? step(0.34, hash(floor(uTime * aRate) + aPhase * 113.0)) : 1.0;
  float blink = step(0.5, fract(uTime * 2.2 + aPhase));
  vec3 col = uOff;
  float a = 0.6;
  float glow = 0.0;
  if (booting > 0.5) { col = uBoot; a = mix(0.45, 1.0, blink); glow = blink; }
  if (running > 0.5) { col = mix(uOn, uOk, uGreen); a = mix(0.5, 1.0, flick); glow = flick; }
  vCol = col;
  vA = a * uOpacity;
  vGlow = glow;
  gl_PointSize = max(1.0, uSize * uPx * (1.0 + glow * 0.6) / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const LED_FRAG = /* glsl */ `
uniform float uDark;
varying vec3 vCol;
varying float vA;
varying float vGlow;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float core = smoothstep(0.46, 0.3, r);
  float halo = smoothstep(1.0, 0.25, r) * 0.32 * vGlow;
  float a = (core + halo) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(vCol, vec3(1.0), core * 0.3 * uDark * vGlow), clamp(a, 0.0, 1.0));
}
`;

const CABLE_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

// Le câble se trace le long de sa longueur (uv.x), puis des impulsions
// de données le parcourent une fois tout au vert.
const CABLE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uLo;
uniform vec3 uPulse;
uniform vec3 uHead;
uniform float uDraw;
uniform float uTime;
uniform float uFlow;
uniform float uOffset;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  if (vUv.x > uDraw) discard;
  float facing = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  vec3 col = mix(uLo, uColor, 0.3 + 0.7 * facing);
  float k = fract(uTime * 0.2 + uOffset) * 1.3 - 0.15;
  float d = vUv.x - k;
  float pulse = exp(-d * d * 600.0) * uFlow;
  float head = smoothstep(uDraw - 0.06, uDraw, vUv.x) * (1.0 - step(0.999, uDraw));
  col = mix(col, uPulse, clamp(pulse, 0.0, 1.0));
  col = mix(col, uHead, head);
  gl_FragColor = vec4(col, 1.0);
}
`;

/* =========================================================================
   Scène WebGL
   ========================================================================= */

type SceneApi = {
  render(p: number, dt: number, px: number, py: number): void;
  setPaused(paused: boolean): void;
  /** release : le canvas a quitté le DOM, son contexte WebGL est rendu tout de suite. */
  dispose(release?: boolean): void;
};

type SceneOptions = {
  THREE: Three;
  canvas: HTMLCanvasElement;
  context: WebGL2RenderingContext;
  stage: HTMLElement;
  colorEl: HTMLElement;
  plan: Plan;
  low: boolean;
  paused: boolean;
  labels: HTMLElement[];
  insets(): { top: number; bottom: number };
  wake(): void;
  onReady(): void;
  onLost(): void;
  onRestored(): void;
};

function createScene(o: SceneOptions): SceneApi {
  const { THREE, canvas, stage, colorEl, plan, low } = o;
  const rackU = plan.rackU;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    context: o.context,
    antialias: !low,
    alpha: true,
    premultipliedAlpha: true,
  });
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 600);
  const trash: Array<{ dispose(): void }> = [];
  const keep = <T extends { dispose(): void }>(item: T): T => {
    trash.push(item);
    return item;
  };
  const vec = () => new THREE.Vector3();

  const uTime = { value: 0 };
  const uPx = { value: 1 };
  const uDark = { value: 1 };
  const shared = {
    uAccent: { value: vec() },
    uEdge: { value: vec() },
    uOk: { value: vec() },
    uBodyLo: { value: vec() },
    uBodyHi: { value: vec() },
    uLedOff: { value: vec() },
    uLedBoot: { value: vec() },
    uCableLo: { value: vec() },
    uPulse: { value: vec() },
    uHead: { value: vec() },
    uGreen: { value: 0 },
    uFlow: { value: 0 },
  };

  const makeLines = (segs: TSeg[], alpha: number, ghost: number, order: number) => {
    const pos = new Float32Array(segs.length * 6);
    const t = new Float32Array(segs.length * 2);
    const w = new Float32Array(segs.length * 2);
    segs.forEach((s, i) => {
      pos.set(s.a, i * 6);
      pos.set(s.b, i * 6 + 3);
      t[i * 2] = s.t0;
      t[i * 2 + 1] = s.t1;
      w[i * 2] = s.w;
      w[i * 2 + 1] = s.w;
    });
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aT", new THREE.BufferAttribute(t, 1));
    geo.setAttribute("aW", new THREE.BufferAttribute(w, 1));
    const mat = keep(
      new THREE.ShaderMaterial({
        vertexShader: LINE_VERT,
        fragmentShader: LINE_FRAG,
        uniforms: {
          uColor: { value: vec() },
          uHead: shared.uHead,
          uDraw: { value: 1 },
          uAlpha: { value: alpha },
          uGhost: { value: ghost },
        },
        transparent: true,
        depthWrite: false,
      }),
    );
    const obj = new THREE.LineSegments(geo, mat);
    obj.renderOrder = order;
    return { obj, mat };
  };

  /** Arêtes d'un volume via EdgesGeometry, remises en segments. */
  const edgesOf = (geometry: ConstructorParameters<Three["EdgesGeometry"]>[0], w: number, offset: V3 = [0, 0, 0]) => {
    const edges = new THREE.EdgesGeometry(geometry);
    const arr = edges.getAttribute("position").array;
    const out: Array<{ seg: Seg; w: number }> = [];
    for (let i = 0; i + 5 < arr.length; i += 6) {
      out.push({
        seg: [
          [arr[i] + offset[0], arr[i + 1] + offset[1], arr[i + 2] + offset[2]],
          [arr[i + 3] + offset[0], arr[i + 4] + offset[1], arr[i + 5] + offset[2]],
        ],
        w,
      });
    }
    edges.dispose();
    return out;
  };

  /* --- Sol : grille de plan et ombre portée --- */

  const G = 30;
  const gridStep = low ? 2.25 : 1.5;
  const gridPos: number[] = [];
  for (let v = -G; v <= G + 1e-6; v += gridStep) {
    gridPos.push(-G, FLOOR_Y - 0.01, v, G, FLOOR_Y - 0.01, v, v, FLOOR_Y - 0.01, -G, v, FLOOR_Y - 0.01, G);
  }
  const gridGeo = keep(new THREE.BufferGeometry());
  gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(gridPos, 3));
  const gridMat = keep(
    new THREE.ShaderMaterial({
      vertexShader: GRID_VERT,
      fragmentShader: GRID_FRAG,
      uniforms: { uColor: { value: vec() }, uAlpha: { value: 0.2 }, uR0: { value: 9 }, uR1: { value: 24 } },
      transparent: true,
      depthWrite: false,
    }),
  );
  const grid = new THREE.LineSegments(gridGeo, gridMat);
  grid.renderOrder = 0;
  scene.add(grid);

  const shadowGeo = keep(new THREE.PlaneGeometry(OUT_W * 2.3, OUT_D * 2.3));
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = keep(
    new THREE.ShaderMaterial({
      vertexShader: SHADOW_VERT,
      fragmentShader: SHADOW_FRAG,
      uniforms: { uColor: { value: vec() }, uAlpha: { value: 0.5 } },
      transparent: true,
      depthWrite: false,
    }),
  );
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.position.y = FLOOR_Y + 0.004;
  shadow.renderOrder = 0;
  scene.add(shadow);

  /* --- Châssis, rails, cotes --- */

  const chassisItems = chassisBoxes(rackU).flatMap((box) => {
    const geo = new THREE.BoxGeometry(box.s[0], box.s[1], box.s[2]);
    const items = edgesOf(geo, box.w, box.c);
    geo.dispose();
    return items;
  });
  const chassis = makeLines(orderTrace(chassisItems), 0.78, 0.1, 2);
  scene.add(chassis.obj);
  const rails = makeLines(railTrace(rackU), 0.7, 0.06, 2);
  scene.add(rails.obj);
  const dimSets = dimTrace(rackU);
  const dims = makeLines(dimSets.main, 0.75, 0, 2);
  scene.add(dims.obj);
  const depthDims = makeLines(dimSets.depth, 0.75, 0, 2);
  depthDims.mat.uniforms.uColor = dims.mat.uniforms.uColor;
  scene.add(depthDims.obj);

  /* --- Équipements --- */

  type Device = {
    group: InstanceType<Three["Group"]>;
    bodyMat: InstanceType<Three["ShaderMaterial"]>;
    lines: ReturnType<typeof makeLines>;
    ledMat: InstanceType<Three["ShaderMaterial"]>;
    slot: ReturnType<typeof makeLines>;
  };
  const devices: Device[] = plan.slots.map((s, i) => {
    const group = new THREE.Group();
    group.position.set(0, s.yc, PANEL_Z);
    const bodyMat = keep(
      new THREE.ShaderMaterial({
        vertexShader: BODY_VERT,
        fragmentShader: BODY_FRAG,
        uniforms: {
          uLo: shared.uBodyLo,
          uHi: shared.uBodyHi,
          uAccent: shared.uAccent,
          uOpacity: { value: 0 },
          uGlow: { value: 0 },
        },
        transparent: true,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
    const panelGeo = keep(new THREE.BoxGeometry(PANEL_W, s.h, 0.2));
    panelGeo.translate(0, 0, -0.1);
    const bodyGeo = keep(new THREE.BoxGeometry(BODY_W, s.h - 0.06, s.depth - 0.2));
    bodyGeo.translate(0, 0, -0.2 - (s.depth - 0.2) / 2);
    const panel = new THREE.Mesh(panelGeo, bodyMat);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    panel.renderOrder = 1;
    body.renderOrder = 1;
    group.add(panel, body);

    const segs: TSeg[] = [
      ...edgesOf(panelGeo, 1),
      ...edgesOf(bodyGeo, 0.5),
      ...s.face.segs.map((seg) => ({ seg, w: 0.6 })),
    ].map(({ seg, w }) => ({ a: seg[0], b: seg[1], t0: 0, t1: 0, w }));
    const lines = makeLines(segs, 0, 0, 3);
    lines.mat.uniforms.uColor = shared.uEdge;
    group.add(lines.obj);

    const count = s.face.leds.length;
    const lp = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const kind = new Float32Array(count);
    const rate = new Float32Array(count);
    s.face.leds.forEach((l, j) => {
      lp.set(l.p, j * 3);
      phase[j] = rnd(i * 31 + j);
      kind[j] = l.kind;
      rate[j] = 3 + rnd(i * 17 + j * 7) * 8;
    });
    const ledGeo = keep(new THREE.BufferGeometry());
    ledGeo.setAttribute("position", new THREE.BufferAttribute(lp, 3));
    ledGeo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    ledGeo.setAttribute("aKind", new THREE.BufferAttribute(kind, 1));
    ledGeo.setAttribute("aRate", new THREE.BufferAttribute(rate, 1));
    const ledMat = keep(
      new THREE.ShaderMaterial({
        vertexShader: LED_VERT,
        fragmentShader: LED_FRAG,
        uniforms: {
          uTime,
          uPx,
          uDark,
          uSize: { value: 0.46 },
          uPower: { value: 0 },
          uGreen: shared.uGreen,
          uOpacity: { value: 0 },
          uOff: shared.uLedOff,
          uBoot: shared.uLedBoot,
          uOn: shared.uEdge,
          uOk: shared.uOk,
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const leds = new THREE.Points(ledGeo, ledMat);
    leds.renderOrder = 4;
    group.add(leds);
    group.visible = false;
    scene.add(group);

    // Emplacement visé : un cadre s'allume sur les rails pendant la glissade.
    const hx = PANEL_W / 2 + 0.1;
    const hy = s.h / 2 + 0.08;
    const z = PANEL_Z + 0.02;
    const y = s.yc;
    const frame: Seg[] = [
      [[-hx, y - hy, z], [hx, y - hy, z]],
      [[hx, y - hy, z], [hx, y + hy, z]],
      [[hx, y + hy, z], [-hx, y + hy, z]],
      [[-hx, y + hy, z], [-hx, y - hy, z]],
    ];
    const slot = makeLines(
      frame.map(([a, b]) => ({ a, b, t0: 0, t1: 0, w: 1 })),
      0,
      0,
      3,
    );
    slot.mat.uniforms.uColor = shared.uAccent;
    slot.obj.visible = false;
    scene.add(slot.obj);
    return { group, bodyMat, lines, ledMat, slot };
  });

  /* --- Câbles --- */

  const cables = plan.cables.map((pts, k) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const geo = keep(new THREE.TubeGeometry(curve, low ? 90 : 160, 0.1, low ? 5 : 7, false));
    const mat = keep(
      new THREE.ShaderMaterial({
        vertexShader: CABLE_VERT,
        fragmentShader: CABLE_FRAG,
        uniforms: {
          uColor: shared.uEdge,
          uLo: shared.uCableLo,
          uPulse: shared.uPulse,
          uHead: shared.uHead,
          uDraw: { value: 0 },
          uTime,
          uFlow: shared.uFlow,
          uOffset: { value: k * 0.29 },
        },
      }),
    );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.renderOrder = 1;
    scene.add(mesh);
    return { mesh, mat };
  });

  /* --- Couleurs du thème --- */

  const applyColors = () => {
    const get = (name: string, fb: Rgb) => readVar(colorEl, name, fb);
    const accent = get("--accent", [0.184, 0.902, 0.784]);
    const ok = get("--ok", [0.294, 0.816, 0.498]);
    const warn = get("--warn", [1, 0.769, 0.302]);
    const bg = get("--bg", [0.016, 0.02, 0.039]);
    const top = get("--surface-top", [0.07, 0.094, 0.157]);
    const txt1 = get("--txt-1", [0.93, 0.945, 0.973]);
    const txt2 = get("--txt-2", [0.65, 0.686, 0.768]);
    const txt3 = get("--txt-3", [0.486, 0.522, 0.612]);
    const dark = luminance(bg) < 0.45;

    // Le matériel reste sombre dans les deux thèmes (volumes « encre ») ; sur
    // fond clair, l'accent est éclairci pour garder des arêtes lisibles.
    const ink7 = get("--ink-700", [0.051, 0.067, 0.106]);
    const ink5 = get("--ink-500", [0.102, 0.129, 0.2]);
    const ink4 = get("--ink-400", [0.137, 0.173, 0.259]);
    const edge = dark ? accent : mix(accent, WHITE, 0.3);
    uDark.value = 1;
    shared.uAccent.value.set(...accent);
    shared.uEdge.value.set(...edge);
    shared.uOk.value.set(...ok);
    shared.uBodyLo.value.set(...(dark ? mix(bg, top, 0.3) : mix(ink7, ink5, 0.35)));
    shared.uBodyHi.value.set(...(dark ? mix(mix(top, txt1, 0.09), accent, 0.04) : mix(ink4, accent, 0.05)));
    shared.uLedOff.value.set(...(dark ? mix(bg, txt3, 0.5) : mix(ink5, [0.49, 0.52, 0.61], 0.45)));
    shared.uLedBoot.value.set(...warn);
    shared.uCableLo.value.set(...(dark ? mix(accent, bg, 0.62) : accent));
    shared.uPulse.value.set(...(dark ? mix(ok, WHITE, 0.45) : mix(ok, WHITE, 0.25)));
    shared.uHead.value.set(...(dark ? mix(accent, WHITE, 0.55) : mix(accent, txt1, 0.25)));

    chassis.mat.uniforms.uColor.value.set(...mix(txt2, accent, 0.2));
    chassis.mat.uniforms.uAlpha.value = dark ? 0.72 : 0.78;
    chassis.mat.uniforms.uGhost.value = dark ? 0.16 : 0.18;
    rails.mat.uniforms.uColor.value.set(...mix(txt3, accent, 0.12));
    rails.mat.uniforms.uAlpha.value = dark ? 0.7 : 0.75;
    dims.mat.uniforms.uColor.value.set(...txt3);
    dims.mat.uniforms.uAlpha.value = dark ? 0.75 : 0.85;
    gridMat.uniforms.uColor.value.set(...txt3);
    gridMat.uniforms.uAlpha.value = dark ? 0.2 : 0.24;
    shadowMat.uniforms.uColor.value.set(...(dark ? ([0, 0, 0] as Rgb) : txt1));
    shadowMat.uniforms.uAlpha.value = dark ? 0.55 : 0.16;

    o.wake();
  };

  /* --- Cadrage : le rack remplit la zone libre entre les surcouches --- */

  let W = 1;
  let H = 1;
  let insets = { top: 60, bottom: 80 };
  const layout = () => {
    W = Math.max(1, stage.clientWidth);
    H = Math.max(1, stage.clientHeight);
    insets = o.insets();
    const dpr = Math.min(window.devicePixelRatio || 1, low ? 1.5 : 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    uPx.value = (dpr * (H / 2)) / Math.tan((FOV * DEG) / 2);
    o.wake();
  };

  const target = new THREE.Vector3(0, (FLOOR_Y + rackU + PLINTH) / 2, 0.6);
  const corners: V3[] = [];
  for (const x of [-OUT_W / 2, OUT_W / 2]) {
    for (const y of [FLOOR_Y, rackU + PLINTH]) {
      for (const z of [-OUT_D / 2, OUT_D / 2]) corners.push([x, y, z]);
    }
  }
  corners.push(
    [-OUT_W / 2, FLOOR_Y, OUT_D / 2 + DIM_OFF + 1.2],
    [OUT_W / 2, FLOOR_Y, OUT_D / 2 + DIM_OFF + 1.2],
    // Sous l'étiquette « 600 mm » de face : sa demi-hauteur reste hors du badge final.
    [0, FLOOR_Y - 0.7, OUT_D / 2 + DIM_OFF + 0.95],
    [HEIGHT_DIM_X - HEIGHT_LABEL_HALF, rackU / 2, OUT_D / 2],
    // Symétrique de la cote de hauteur : le rack reste centré, la cote vit dans la marge.
    [-(HEIGHT_DIM_X - HEIGHT_LABEL_HALF), rackU / 2, OUT_D / 2],
  );
  // Cote de profondeur : comptée seulement tant qu'elle est lisible (vue de trois quarts).
  const depthCorners: V3[] = [
    [OUT_W / 2 + DIM_OFF + 1.7, FLOOR_Y, OUT_D / 2],
    [OUT_W / 2 + DIM_OFF + 1.7, FLOOR_Y, -OUT_D / 2],
    [OUT_W / 2 + DIM_OFF + 3, FLOOR_Y, 0],
  ];
  // La place réservée à la cote ne se libère qu'une fois son étiquette effacée.
  const depthWeight = (az: number) => smooth(remap(az, 2 * DEG, 14 * DEG));
  const depthAlpha = (az: number) => smooth(remap(az, 12 * DEG, 24 * DEG));

  // Cadrage exact : distance telle que tout tienne dans la zone libre, puis
  // décalage de la vue pour centrer l'emprise projetée (souvent asymétrique).
  const shot = { dist: 40, offX: 0, offY: 0 };
  const proj = new Float64Array((corners.length + depthCorners.length) * 3);
  const frameCamera = (az: number, el: number) => {
    const ce = Math.cos(el);
    const dir: V3 = [Math.sin(az) * ce, Math.sin(el), Math.cos(az) * ce];
    const rl = Math.hypot(dir[2], dir[0]) || 1;
    const right: V3 = [dir[2] / rl, 0, -dir[0] / rl];
    const up: V3 = [
      dir[1] * right[2] - dir[2] * right[1],
      dir[2] * right[0] - dir[0] * right[2],
      dir[0] * right[1] - dir[1] * right[0],
    ];
    const half = Math.tan((FOV * DEG) / 2);
    const aspect = W / H;
    const availV = Math.max(0.25, (H - insets.top - insets.bottom) / H);
    const tanV = half * availV * 0.96;
    const tanH = half * aspect * 0.93;
    // Tampon préalloué : aucun tableau créé à chaque image.
    const wd = depthWeight(az);
    const count = corners.length + depthCorners.length;
    let d = 0;
    for (let i = 0; i < count; i++) {
      const c = i < corners.length ? corners[i] : depthCorners[i - corners.length];
      const cxw = i < corners.length ? c[0] : OUT_W / 2 + (c[0] - OUT_W / 2) * wd;
      const rx = cxw - target.x;
      const ry = c[1] - target.y;
      const rz = c[2] - target.z;
      const pr = rx * right[0] + ry * right[1] + rz * right[2];
      const pu = rx * up[0] + ry * up[1] + rz * up[2];
      const pf = rx * dir[0] + ry * dir[1] + rz * dir[2];
      proj[i * 3] = pr;
      proj[i * 3 + 1] = pu;
      proj[i * 3 + 2] = pf;
      d = Math.max(d, pf + Math.abs(pr) / tanH, pf + Math.abs(pu) / tanV);
    }
    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;
    const bounds = () => {
      minX = Infinity;
      maxX = -Infinity;
      minY = Infinity;
      maxY = -Infinity;
      for (let i = 0; i < count; i++) {
        const pr = proj[i * 3];
        const pu = proj[i * 3 + 1];
        const k = 1 / Math.max(0.5, d - proj[i * 3 + 2]);
        minX = Math.min(minX, pr * k);
        maxX = Math.max(maxX, pr * k);
        minY = Math.min(minY, pu * k);
        maxY = Math.max(maxY, pu * k);
      }
    };
    for (let i = 0; i < 3; i++) {
      bounds();
      const s = Math.max((maxX - minX) / 2 / tanH, (maxY - minY) / 2 / tanV);
      d *= clamp(s, 0.6, 1.6);
    }
    bounds();
    shot.dist = d;
    // Centre de l'emprise converti en pixels ; la vue est décalée pour le ramener au centre libre.
    const cx = (((minX + maxX) / 2) / (half * aspect)) * (W / 2);
    const cy = (((minY + maxY) / 2) / half) * (H / 2);
    shot.offX = cx;
    shot.offY = -((insets.top - insets.bottom) / 2 + cy);
    return shot;
  };

  /* --- Étiquettes de cotes (HTML décoratif) --- */

  const anchors = dimAnchors(rackU);
  const probe = new THREE.Vector3();
  const labelState = o.labels.map(() => ({ x: -1, y: -1, a: -1 }));
  // Pendant une glissade, l'équipement passe devant les cotes de façade
  // (largeur, hauteur) : leurs étiquettes HTML s'effacent pour ne pas le couvrir.
  const placeLabels = (alpha: number, az: number, sliding: number) => {
    o.labels.forEach((el, i) => {
      const a = i === 1 ? alpha * depthAlpha(az) : alpha * (1 - 0.8 * sliding);
      probe.set(anchors[i][0], anchors[i][1], anchors[i][2]).project(camera);
      const x = ((probe.x + 1) / 2) * W;
      const y = ((1 - probe.y) / 2) * H;
      const st = labelState[i];
      if (Math.abs(st.x - x) > 0.25 || Math.abs(st.y - y) > 0.25) {
        st.x = x;
        st.y = y;
        el.style.transform = "translate3d(" + x.toFixed(1) + "px," + y.toFixed(1) + "px,0)";
      }
      if (Math.abs(st.a - a) > 0.005) {
        st.a = a;
        el.style.opacity = a.toFixed(3);
      }
    });
  };

  /* --- Veille, perte de contexte --- */

  let time = 0;
  let paused = o.paused;
  let lost = false;
  let disposed = false;
  let readySent = false;

  const resizeObserver = new ResizeObserver(layout);
  resizeObserver.observe(stage);
  const stopAppearance = onAppearanceChange(applyColors);
  const onLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    o.onLost();
  };
  const onRestored = () => o.onRestored();
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  applyColors();
  layout();

  return {
    render(p, dt, px, py) {
      if (lost || disposed) return;
      if (!paused) time += dt;
      uTime.value = time;
      const tl = plan.tl;

      chassis.mat.uniforms.uDraw.value = smooth(remap(p, 0, 0.16));
      rails.mat.uniforms.uDraw.value = remap(p, 0.07, 0.2);
      dims.mat.uniforms.uDraw.value = remap(p, 0.03, 0.19);
      depthDims.mat.uniforms.uDraw.value = dims.mat.uniforms.uDraw.value;

      let active = -1;
      let sliding = 0;
      devices.forEach((d, i) => {
        if (p >= tl.starts[i] - 0.012) active = i;
      });
      devices.forEach((d, i) => {
        const local = remap(p, tl.starts[i], tl.lands[i]);
        const visible = local > 0;
        d.group.visible = visible;
        d.slot.obj.visible = visible && local < 1;
        if (!visible) return;
        d.group.position.z = PANEL_Z + (1 - easeOut(local)) * SLIDE_Z;
        const op = smooth(remap(local, 0, 0.45));
        d.bodyMat.uniforms.uOpacity.value = op;
        const focus = i === active && p < tl.final ? 1 - remap(p, tl.lands[i] + tl.boot, tl.lands[i] + tl.boot + 0.05) : 0;
        d.bodyMat.uniforms.uGlow.value = focus;
        d.lines.mat.uniforms.uAlpha.value = op * (0.82 + 0.18 * focus);
        d.ledMat.uniforms.uOpacity.value = op;
        d.ledMat.uniforms.uPower.value = remap(p, tl.lands[i], tl.lands[i] + tl.boot);
        d.slot.mat.uniforms.uAlpha.value = Math.sin(Math.PI * local) * 0.85;
        if (local < 1) sliding = Math.max(sliding, smooth(Math.min(1, local / 0.15, (1 - local) / 0.2)));
      });

      shared.uGreen.value = smooth(remap(p, tl.green[0], tl.green[1]));
      shared.uFlow.value = remap(p, tl.green[0], tl.final + 0.04);
      cables.forEach((c, k) => {
        const draw = remap(p, tl.cables[k][0], tl.cables[k][1]);
        c.mesh.visible = draw > 0.001;
        c.mat.uniforms.uDraw.value = draw;
      });

      // Caméra : de trois quarts vers la face, légère parallaxe au pointeur.
      const q = smoother(remap(p, 0, tl.cam));
      const az = lerp(AZ0, AZ1, q);
      depthDims.mat.uniforms.uAlpha.value = dims.mat.uniforms.uAlpha.value * depthAlpha(az);
      const el = lerp(EL0, EL1, q);
      const { dist, offX, offY } = frameCamera(az, el);
      camera.setViewOffset(W, H, offX, offY, W, H);
      const azP = az + px * 4 * DEG;
      const elP = el - py * 2.5 * DEG;
      camera.position.set(
        target.x + Math.sin(azP) * Math.cos(elP) * dist,
        target.y + Math.sin(elP) * dist,
        target.z + Math.cos(azP) * Math.cos(elP) * dist,
      );
      camera.lookAt(target);
      renderer.render(scene, camera);
      placeLabels(remap(p, 0.05, 0.16), az, sliding);

      if (!readySent) {
        readySent = true;
        o.onReady();
      }
    },
    setPaused(next) {
      paused = next;
    },
    dispose(release = false) {
      if (disposed) return;
      disposed = true;
      resizeObserver.disconnect();
      stopAppearance();
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      // Après une perte de contexte, les objets GPU ont déjà disparu : les
      // supprimer sur le contexte restauré ne ferait que remplir la console
      // d'avertissements. Le canvas est remplacé, tout le reste part au ramasse-miettes.
      if (lost) return;
      for (const item of trash) item.dispose();
      renderer.dispose();
      // Sans cela, le contexte ne disparaît qu'au ramasse-miettes : après quelques
      // navigations, le navigateur atteint sa limite et sacrifie le plus ancien
      // contexte encore affiché (le globe, par exemple).
      if (release) renderer.forceContextLoss();
    },
  };
}

/* =========================================================================
   Repli statique : rack assemblé en perspective cavalière (SVG)
   ========================================================================= */

const ART_U = 14;
const OBL_X = 0.4;
const OBL_Y = 0.25;

type ArtDevice = { key: string; side: string; top: string; panelSide: string; panelTop: string; face: string; detail: string; leds: string };

function buildArt(plan: Plan) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const xy = (p: V3, grow = true): [number, number] => {
    const x = (p[0] - p[2] * OBL_X) * ART_U;
    const y = (-p[1] + p[2] * OBL_Y) * ART_U;
    if (grow) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    return [x, y];
  };
  const pt = (p: V3, grow = true) => {
    const [x, y] = xy(p, grow);
    return x.toFixed(1) + " " + y.toFixed(1);
  };
  const segPath = (list: Seg[], grow = true) => list.map(([a, b]) => "M" + pt(a, grow) + "L" + pt(b, grow)).join("");
  const poly = (ps: V3[]) => "M" + ps.map((p) => pt(p)).join("L") + "Z";

  const rackU = plan.rackU;
  const topY = Math.max(...plan.slots.map((s) => s.yc + s.h / 2), 0);

  // Châssis : ce qui est devant (ou à droite, ou au-dessus) passe après les équipements.
  const frameBack: Seg[] = [];
  const frameFront: Seg[] = [];
  for (const box of chassisBoxes(rackU)) {
    for (const seg of boxEdges(box.c, box.s)) {
      const xMin = Math.min(seg[0][0], seg[1][0]);
      const zMin = Math.min(seg[0][2], seg[1][2]);
      const yMin = Math.min(seg[0][1], seg[1][1]);
      const front = xMin >= BODY_W / 2 + 0.05 || zMin >= PANEL_Z - 0.05 || yMin >= topY - 0.01;
      (front ? frameFront : frameBack).push(seg);
    }
  }
  const railSegs = railTrace(rackU).map((s): Seg => [s.a, s.b]);
  const dimSets = dimTrace(rackU);
  const dimSegs = [...dimSets.main, ...dimSets.depth].map((s): Seg => [s.a, s.b]);

  const devices: ArtDevice[] = plan.slots
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.yc - b.s.yc)
    .map(({ s, i }) => {
      const zF = PANEL_Z;
      const zP = PANEL_Z - 0.2;
      const zB = PANEL_Z - s.depth;
      const hy = s.h / 2;
      const by = (s.h - 0.06) / 2;
      const px = PANEL_W / 2;
      const bx = BODY_W / 2;
      const y = s.yc;
      const place = (p: V3): V3 => [p[0], p[1] + y, p[2] + zF];
      return {
        key: "d" + i,
        side: poly([
          [bx, y - by, zP],
          [bx, y - by, zB],
          [bx, y + by, zB],
          [bx, y + by, zP],
        ]),
        top: poly([
          [-bx, y + by, zP],
          [bx, y + by, zP],
          [bx, y + by, zB],
          [-bx, y + by, zB],
        ]),
        panelSide: poly([
          [px, y - hy, zF],
          [px, y - hy, zP],
          [px, y + hy, zP],
          [px, y + hy, zF],
        ]),
        panelTop: poly([
          [-px, y + hy, zF],
          [px, y + hy, zF],
          [px, y + hy, zP],
          [-px, y + hy, zP],
        ]),
        face: poly([
          [-px, y - hy, zF],
          [px, y - hy, zF],
          [px, y + hy, zF],
          [-px, y + hy, zF],
        ]),
        detail: segPath(s.face.segs.map(([a, b]): Seg => [place(a), place(b)])),
        leds: s.face.leds.map((l) => "M" + pt(place(l.p)) + "h0").join(""),
      };
    });

  const cables = plan.cables.map((pts) => "M" + pts.map((p) => pt(p)).join("L"));
  const labels = dimAnchors(rackU).map((p, i) => {
    // Dans le dessin, la cote de hauteur reste horizontale, à gauche de sa ligne :
    // sur téléphone, le texte grossit (unités SVG) et ne doit pas toucher la ligne.
    const [x, y] = xy(i === 2 ? [p[0] - 1.4, p[1], p[2]] : p);
    return { x, y, text: i === 2 ? rackU + " U" : DIM_TEXT[i] };
  });

  // Grille du sol : hors cadrage, fondue par un masque radial.
  const gridSegs: Seg[] = [];
  for (let v = -15; v <= 15; v += 1.5) {
    gridSegs.push([
      [-15, FLOOR_Y, v],
      [15, FLOOR_Y, v],
    ]);
    gridSegs.push([
      [v, FLOOR_Y, -15],
      [v, FLOOR_Y, 15],
    ]);
  }
  const center = xy([0, FLOOR_Y, 0], false);

  const art = {
    grid: segPath(gridSegs, false),
    back: segPath(frameBack),
    rails: segPath(railSegs),
    dims: segPath(dimSegs),
    front: segPath(frameFront),
    devices,
    cables,
    labels,
    shadow: { cx: center[0], cy: center[1], rx: OUT_W * 0.95 * ART_U, ry: OUT_W * 0.42 * ART_U },
    vb: "",
  };
  const pad = 26;
  art.vb = [minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2].map((v) => v.toFixed(1)).join(" ");
  return art;
}

const RackArt = memo(function RackArt({ plan, className }: { plan: Plan; className?: string }) {
  const art = useMemo(() => buildArt(plan), [plan]);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const fadeId = "rack-fade-" + uid;
  const maskId = "rack-mask-" + uid;
  const shadowId = "rack-shadow-" + uid;
  return (
    <svg className={className} viewBox={art.vb} preserveAspectRatio="xMidYMid meet" focusable="false">
      <defs>
        <radialGradient id={fadeId} cx={art.shadow.cx} cy={art.shadow.cy} r={art.shadow.rx * 1.25} gradientUnits="userSpaceOnUse">
          <stop offset="0.35" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id={maskId} maskUnits="userSpaceOnUse">
          <rect x="-2000" y="-2000" width="4000" height="4000" fill={"url(#" + fadeId + ")"} />
        </mask>
        <radialGradient id={shadowId}>
          <stop offset="0" className={styles.artShadowIn} />
          <stop offset="1" className={styles.artShadowOut} />
        </radialGradient>
      </defs>
      <path d={art.grid} className={styles.artGrid} mask={"url(#" + maskId + ")"} />
      <ellipse cx={art.shadow.cx} cy={art.shadow.cy} rx={art.shadow.rx} ry={art.shadow.ry} fill={"url(#" + shadowId + ")"} />
      <path d={art.dims} className={styles.artDim} />
      {art.labels.map((l) => (
        <text key={l.text + l.x} x={l.x} y={l.y} className={styles.artDimText} textAnchor="middle" dominantBaseline="middle">
          {l.text}
        </text>
      ))}
      <path d={art.back} className={styles.artBack} />
      <path d={art.rails} className={styles.artRail} />
      {art.devices.map((d) => (
        <g key={d.key}>
          <path d={d.side} className={styles.artSide} />
          <path d={d.top} className={styles.artTop} />
          <path d={d.panelSide} className={styles.artSide} />
          <path d={d.panelTop} className={styles.artTop} />
          <path d={d.face} className={styles.artFace} />
          <path d={d.detail} className={styles.artDetail} />
          <path d={d.leds} className={styles.artLedGlow} />
          <path d={d.leds} className={styles.artLed} />
        </g>
      ))}
      <path d={art.front} className={styles.artFrame} />
      {art.cables.map((d, i) => (
        <path key={"c" + i} d={d} className={styles.artCable} />
      ))}
    </svg>
  );
});

/* =========================================================================
   Composant
   ========================================================================= */

export function RackScroll({
  devices = RACK_DEFAULT_DEVICES,
  className,
  children,
  headingLevel = 3,
  note = "Représentation d’un homelab type, pas une infrastructure réelle.",
  finalLabel = "Tout est vert",
  quality = "auto",
}: RackScrollProps) {
  // Une liste vide retombe sur les équipements par défaut : jamais de rack creux.
  const list = (devices.length ? devices : RACK_DEFAULT_DEVICES).slice(0, 8);
  const count = list.length;
  const signature = list.map((d) => d.kind + ":" + unitsOf(d)).join("|");
  // Le plan ne dépend que des types et des hauteurs : titres et lignes n'y touchent pas.
  const plan = useMemo(() => computePlan(list), [signature]);

  const rootRef = useRef<HTMLDivElement>(null);
  const introRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLElement>(null);
  const phaseRef = useRef<HTMLSpanElement>(null);
  const pctRef = useRef<HTMLSpanElement>(null);
  const labelRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const sceneRef = useRef<SceneApi | null>(null);
  const wakeRef = useRef<() => void>(() => {});
  const pausedRef = useRef(false);
  const announcedRef = useRef(false);
  const announceCount = useRef(0);
  const titles = JSON.stringify(list.map((d) => d.title));
  const textRef = useRef({ finalLabel, titles: JSON.parse(titles) as string[], count });
  useEffect(() => {
    textRef.current = { finalLabel, titles: JSON.parse(titles) as string[], count };
  }, [finalLabel, titles, count]);

  const [status, setStatus] = useState<Status>("loading");
  // Réglage des animations (attribut data-motion), tenu à jour : une bascule à chaud passe du rack
  // statique au mode défilement (et inversement) sans recharger la page.
  const reduced = useReducedMotion();
  const [near, setNear] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [active, setActive] = useState(-1);
  const [final, setFinal] = useState(false);
  const [paused, setPaused] = useState(false);
  const [announce, setAnnounce] = useState("");

  const isStatic = reduced || status === "fallback";

  /* ----- Bascule « Animations réduites » en pleine lecture du rack -----
     La piste de défilement (plusieurs hauteurs d'écran) disparaît d'un coup : le visiteur
     se retrouvait plus bas, rack sorti de l'écran par le haut. S'il était dans la piste
     (scène collée à l'écran), on le replace au début du rack, désormais statique. */
  const stuckRef = useRef(false);
  const wasReduced = useRef(reduced);
  useIsoLayoutEffect(() => {
    const was = wasReduced.current;
    wasReduced.current = reduced;
    if (!reduced || was || !stuckRef.current) return;
    stuckRef.current = false;
    rootRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [reduced]);

  const sayRef = useRef((message: string) => {
    announceCount.current += 1;
    // Un espace insécable alterné force la relecture d'un message identique.
    setAnnounce(message + (announceCount.current % 2 ? "" : " "));
  });

  /* ----- Chargement paresseux : seulement quand la scène approche ----- */
  useEffect(() => {
    if (isStatic || near) return;
    const root = rootRef.current;
    if (!root) return;
    if (!("IntersectionObserver" in window)) {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "120% 0px" },
    );
    io.observe(root);
    return () => io.disconnect();
  }, [isStatic, near]);

  /* ----- Scène Three.js ----- */
  useEffect(() => {
    if (isStatic || !near) return;
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    const root = rootRef.current;
    if (!canvas || !stage || !root) return;

    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const low =
      quality === "low" ||
      (quality === "auto" && (coarse || window.innerWidth < 720 || (navigator.hardwareConcurrency || 8) <= 4));

    let context: WebGL2RenderingContext | null = null;
    try {
      context = canvas.getContext("webgl2", {
        alpha: true,
        antialias: !low,
        premultipliedAlpha: true,
        depth: true,
        stencil: false,
        powerPreference: "low-power",
      });
    } catch {
      context = null;
    }
    if (!context) {
      setStatus("fallback");
      return;
    }

    let cancelled = false;
    // Référence locale : après une perte de contexte, sceneRef est vidé (la
    // boucle ne doit plus dessiner), mais la scène doit quand même être libérée.
    let api: SceneApi | null = null;
    const gl = context;
    void (async () => {
      try {
        const THREE = await import("three");
        if (cancelled) return;
        api = createScene({
          THREE,
          canvas,
          context: gl,
          stage,
          colorEl: root,
          plan,
          low,
          paused: pausedRef.current,
          labels: labelRefs.current.filter((el): el is HTMLSpanElement => el !== null),
          insets: () => ({
            top: (hudRef.current?.offsetHeight ?? 44) + 22,
            // Toute la légende est réservée, badge final compris : sur une scène
            // basse (petit téléphone, téléphone à l'horizontale), le badge masquait
            // sinon le bas du rack et la cote de largeur.
            bottom: (captionRef.current?.offsetHeight ?? 60) + 10,
          }),
          wake: () => wakeRef.current(),
          onReady: () => setStatus("ready"),
          onLost: () => {
            sceneRef.current = null;
            setStatus("lost");
          },
          onRestored: () => {
            setStatus("loading");
            setGeneration((g) => g + 1);
          },
        });
        sceneRef.current = api;
        wakeRef.current();
      } catch {
        api?.dispose();
        api = null;
        sceneRef.current = null;
        if (!cancelled) setStatus("fallback");
      }
    })();

    return () => {
      cancelled = true;
      // Démontage réel (ou canvas remplacé) : le canvas n'est plus dans le document.
      api?.dispose(!canvas.isConnected);
      api = null;
      sceneRef.current = null;
    };
  }, [generation, isStatic, near, plan, quality]);

  /* ----- Défilement, puis progression, puis légendes et scène ----- */
  useEffect(() => {
    if (isStatic) return;
    const root = rootRef.current;
    const track = trackRef.current;
    const frame = frameRef.current;
    const stage = stageRef.current;
    const steps = stepsRef.current;
    if (!root || !track || !frame || !stage || !steps) return;
    const tl = plan.tl;
    const n = plan.slots.length;
    // Progression atteinte juste avant que le premier équipement ne glisse.
    const knot = clamp((tl.starts[0] ?? 0.19) - 0.015, 0.05, 0.5);

    const geo = { top: 0, height: 1, stickTop: 0, stickH: 1, gate: -Infinity };
    let vw = window.innerWidth;
    let vh = window.innerHeight;
    let raf = 0;
    let last = 0;
    let inView = false;
    let pd = -1;
    const par = { x: 0, y: 0, gx: 0, gy: 0 };
    let lastActive = -2;
    // null : l'état « final » est toujours republié au premier calcul. Après une bascule
    // réduit vers activé, l'état React gardait sinon la valeur du passage précédent et le
    // badge « Tout est vert » restait affiché sur un rack vide.
    let lastFinal: boolean | null = null;
    let lastK = -1;
    let lastPhase = "";
    let lastPct = -1;

    const measure = () => {
      const rect = track.getBoundingClientRect();
      const y = window.scrollY;
      geo.top = rect.top + y;
      geo.height = rect.height;
      const split = getComputedStyle(frame).display === "contents";
      const sticky = split ? stage : frame;
      geo.stickTop = Number.parseFloat(getComputedStyle(sticky).top) || 0;
      geo.stickH = sticky.offsetHeight || window.innerHeight;
      vw = window.innerWidth;
      vh = window.innerHeight;
      // Deux colonnes : les légendes commencent sous l'en-tête (children). Un
      // en-tête haut les repousse sous la ligne de flottaison ; la phase des
      // équipements attend alors que la première légende soit lisible (bas à
      // 82 % de l'écran). Position « au repos » : rectangles pris dans le même
      // élément collant, le décalage du collant s'annule dans la différence.
      noteStuck();
      geo.gate = -Infinity;
      const first = steps.querySelector("li");
      if (split && first) {
        const intro = introRef.current;
        const rowTop = intro ? intro.getBoundingClientRect().bottom + y : geo.top;
        const inner = first.getBoundingClientRect().bottom - steps.getBoundingClientRect().top;
        geo.gate = rowTop + inner - vh * 0.82;
      }
      wake();
    };

    // 0 quand la scène est aux trois quarts visible, 1 quand elle se décolle.
    // Élan court : le châssis se trace pendant l'approche, mais la scène (et,
    // sur téléphone, la légende sous elle) est entièrement collée avant que le
    // premier équipement ne glisse (≈ 17 % sur téléphone, ≈ 12 % sur ordinateur).
    // Si la première légende n'est pas encore à l'écran à ce moment-là, la
    // course est coupée en deux : le châssis se trace pendant la lecture de
    // l'en-tête, les équipements ne glissent qu'une fois leur légende visible.
    const goal = () => {
      const y = window.scrollY;
      const lead = geo.stickH * 0.25;
      const y0 = geo.top - geo.stickTop - lead;
      const y1 = geo.top + geo.height - geo.stickH - geo.stickTop;
      const span = Math.max(1, y1 - y0);
      const yk = Math.min(y0 + span * 0.6, Math.max(y0 + span * knot, geo.gate));
      if (y < yk) return clamp((knot * (y - y0)) / Math.max(1, yk - y0));
      return clamp(knot + ((1 - knot) * (y - yk)) / Math.max(1, y1 - yk));
    };

    // Scène collée à l'écran : le visiteur lit le rack (lu par l'effet de bascule ci-dessus).
    // Seulement en mode défilement réel : pendant l'hydratation d'une page en mode réduit,
    // cet effet tourne un instant sur la mise en page statique.
    const noteStuck = () => {
      const y = window.scrollY;
      stuckRef.current =
        document.documentElement.getAttribute("data-motion") === "full" &&
        y >= geo.top - geo.stickTop - geo.stickH * 0.25 &&
        y <= geo.top + geo.height - geo.stickH - geo.stickTop;
    };

    const ui = (p: number) => {
      let a = -1;
      for (let i = 0; i < n; i++) if (p >= tl.starts[i] - 0.012) a = i;
      const fin = p >= tl.final;
      if (fin) a = n;
      if (a !== lastActive) {
        lastActive = a;
        setActive(a);
      }
      if (fin !== lastFinal) {
        lastFinal = fin;
        setFinal(fin);
        if (fin && !announcedRef.current) {
          announcedRef.current = true;
          const t = textRef.current;
          sayRef.current(
            "Rack assemblé\u00a0: les " + t.count + " équipements sont en ligne. " + t.finalLabel + ".",
          );
        }
      }
      const k = a >= 0 && a < n ? remap(p, tl.starts[a], tl.lands[a] + tl.boot) : a >= n ? 1 : 0;
      if (Math.abs(k - lastK) > 0.004) {
        lastK = k;
        // Sur la colonne des légendes seulement : seul ce sous-arbre recalcule ses styles.
        steps.style.setProperty("--k", k.toFixed(3));
      }
      const t = textRef.current;
      const phase = fin
        ? t.finalLabel
        : p >= tl.green[0]
          ? "Vérification des voyants"
          : tl.cables.length && p >= tl.cables[0][0]
            ? "Câblage"
            : a >= 0
              ? two(a) + " · " + (t.titles[a] ?? "")
              : "Châssis et rails";
      if (phase !== lastPhase && phaseRef.current) {
        lastPhase = phase;
        phaseRef.current.textContent = phase;
      }
      const pct = Math.round(p * 100);
      if (pct !== lastPct && pctRef.current) {
        lastPct = pct;
        pctRef.current.textContent = pct + " %";
      }
    };

    const tick = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const g = goal();
      if (pd < 0 || Math.abs(g - pd) > 0.25) pd = g;
      else {
        pd += (g - pd) * (1 - Math.exp(-dt * 8));
        if (Math.abs(g - pd) < 0.0005) pd = g;
      }
      const ease = 1 - Math.exp(-dt * 4);
      par.x += (par.gx - par.x) * ease;
      par.y += (par.gy - par.y) * ease;
      const parMoving = Math.abs(par.gx - par.x) + Math.abs(par.gy - par.y) > 0.002;
      ui(pd);
      const scene = sceneRef.current;
      scene?.render(pd, dt, par.x, par.y);
      // Rien ne bouge avec le temps tant qu'aucun voyant n'est sous tension :
      // la boucle ne tourne alors que pour suivre le défilement ou la souris.
      const living = n > 0 && pd >= tl.lands[0];
      const busy = pd !== g || parMoving || (scene !== null && living && !pausedRef.current);
      if (busy && inView && !document.hidden) raf = requestAnimationFrame(tick);
    };

    function wake() {
      if (raf || !inView || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
    const sleep = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    wakeRef.current = wake;

    const io = new IntersectionObserver(
      (entries) => {
        inView = entries.some((e) => e.isIntersecting);
        if (inView) measure();
        else sleep();
      },
      { rootMargin: "80px 0px" },
    );
    io.observe(root);

    const onScroll = () => {
      noteStuck();
      wake();
    };
    const onVisibility = () => (document.hidden ? sleep() : wake());
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    ro.observe(document.documentElement);

    // Parallaxe : souris uniquement (jamais au doigt).
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      par.gx = clamp((event.clientX / vw) * 2 - 1, -1, 1);
      par.gy = clamp((event.clientY / vh) * 2 - 1, -1, 1);
      wake();
    };
    if (fine) window.addEventListener("pointermove", onPointer, { passive: true });

    measure();

    return () => {
      sleep();
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
      document.removeEventListener("visibilitychange", onVisibility);
      if (fine) window.removeEventListener("pointermove", onPointer);
      wakeRef.current = () => {};
    };
  }, [isStatic, plan]);

  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    pausedRef.current = next;
    sceneRef.current?.setPaused(next);
    wakeRef.current();
    sayRef.current(next ? "Voyants figés." : "Voyants de nouveau animés.");
  };

  const Heading = ("h" + headingLevel) as "h2" | "h3" | "h4";
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const endId = "rack-fin-" + uid;
  const shown = Math.min(Math.max(active, 0), count - 1);
  const stateOf = (i: number) => (isStatic ? "done" : i < active ? "done" : i === active ? "active" : "todo");
  const showPause = !isStatic && status === "ready";
  // « Stockage ZFS » devient « stockage ZFS » : seule l'initiale passe en minuscule.
  const lowered = list.map((d) =>
    /^\p{Lu}{2}/u.test(d.title) ? d.title : d.title.charAt(0).toLocaleLowerCase("fr-FR") + d.title.slice(1),
  );
  const names =
    lowered.length > 1 ? lowered.slice(0, -1).join(", ") + " et " + lowered[lowered.length - 1] : (lowered[0] ?? "");
  const summary =
    "Illustration\u00a0: un rack de " + plan.rackU + " U se monte pièce par pièce. Le châssis et les rails se tracent, puis " +
    names + " glissent à leur place\u202f; les câbles se tirent et tous les voyants passent au vert.";

  const rootClass = [styles.root, isStatic ? undefined : styles.scroll, className].filter(Boolean).join(" ");
  const rootStyle = { "--n": count } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className={rootClass}
      style={rootStyle}
      data-status={reduced && status !== "fallback" ? "static" : status}
      data-final={final || isStatic ? "" : undefined}
      data-paused={paused && !isStatic ? "" : undefined}
    >
      {!isStatic ? (
        <a className={styles.skip} href={"#" + endId}>
          Passer l’assemblage du rack
        </a>
      ) : null}

      <div className={styles.layout}>
        {children ? (
          <div ref={introRef} className={styles.intro}>
            {children}
          </div>
        ) : null}

        <div ref={trackRef} className={styles.track} aria-hidden="true" />

        <div ref={frameRef} className={styles.frame}>
          <figure ref={stageRef} className={styles.stage}>
            <div className={styles.scene} aria-hidden="true">
              <span className={styles.corners}>
                <i />
                <i />
                <i />
                <i />
              </span>
              <canvas key={generation} ref={canvasRef} className={styles.canvas} />
              <RackArt plan={plan} className={styles.art} />
              <div className={styles.dims}>
                {[DIM_TEXT[0], DIM_TEXT[1], plan.rackU + " U"].map((text, i) => (
                  <span
                    key={i}
                    ref={(el) => {
                      labelRefs.current[i] = el;
                    }}
                    className={i === 2 ? styles.dim + " " + styles.dimV : styles.dim}
                  >
                    <span>{text}</span>
                  </span>
                ))}
              </div>
            </div>

            <div ref={hudRef} className={styles.hud}>
              <p className={styles.hudText} aria-hidden="true">
                <span>Plan · rack {plan.rackU}&nbsp;U</span>
                <span className={styles.hudPhase}>
                  {/* Sans JavaScript ou avant l'hydratation, le rack est dessiné
                      assemblé : l'étiquette « live » n'apparaît qu'en mode défilement. */}
                  <span className={styles.hudStill}>Rack assemblé</span>
                  <span ref={phaseRef} className={styles.hudLive}>
                    Châssis et rails
                  </span>
                  <span ref={pctRef} className={styles.hudPct}>
                    0&#8239;%
                  </span>
                </span>
              </p>
              {showPause ? (
                <button type="button" className={styles.control} onClick={togglePause}>
                  {paused ? (
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M5 3.5v9M11 3.5v9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  )}
                  {paused ? "Reprendre" : "Pause"}
                  <span className="sr-only">{paused ? " l’animation des voyants" : " de l’animation des voyants"}</span>
                </button>
              ) : null}
            </div>

            <figcaption ref={captionRef} className={styles.caption}>
              <p className={styles.final} aria-hidden="true">
                <span className={styles.finalDot} />
                {finalLabel}
                <span className={styles.finalMeta}>
                  {count}/{count} en ligne
                </span>
              </p>
              <p className={styles.note}>
                <span className={styles.noteMark} aria-hidden="true">
                  i
                </span>
                {note}
              </p>
              <span className="sr-only">{summary}</span>
            </figcaption>
          </figure>

          <div ref={stepsRef} className={styles.steps}>
            <div className={styles.ticks} aria-hidden="true">
              {list.map((d, i) => (
                <i key={d.id} data-state={stateOf(i)} />
              ))}
            </div>
            <ol className={styles.list} aria-label="Étapes de l’assemblage">
              {list.map((d, i) => (
                <li
                  key={d.id}
                  className={styles.step}
                  data-state={stateOf(i)}
                  data-shown={i === shown ? "" : undefined}
                  aria-current={!isStatic && i === active ? "step" : undefined}
                >
                  <span className={styles.stepNum} aria-hidden="true">
                    {two(i)}
                  </span>
                  <div className={styles.stepBody}>
                    <Heading className={styles.stepTitle}>{d.title}</Heading>
                    <p className={styles.stepLine}>{d.line}</p>
                  </div>
                  <span className={styles.stepU}>
                    <span aria-hidden="true">{unitsOf(d)}&nbsp;U</span>
                    <span className="sr-only">
                      {unitsOf(d) > 1 ? unitsOf(d) + " unités de rack" : "1 unité de rack"}
                    </span>
                  </span>
                  <span className={styles.stepBar} aria-hidden="true" />
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <span id={endId} tabIndex={-1} className={styles.end} />
    </div>
  );
}
