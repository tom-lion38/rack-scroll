/* Rack serveur qui se monte au fil du défilement.
   Démo autonome : Canvas 2D et une petite projection 3D maison, aucune bibliothèque.
   La géométrie, la chronologie et le calcul de la progression sont repris du
   composant React du site (qui, lui, dessine avec Three.js). */
(function () {
  "use strict";

  var root = document.getElementById("rack");
  if (!root) return;

  /* ---------- Outils ---------- */

  var DEG = Math.PI / 180;
  var clamp = function (v, a, b) {
    if (a === undefined) a = 0;
    if (b === undefined) b = 1;
    return Math.min(b, Math.max(a, v));
  };
  var remap = function (v, a, b) { return clamp((v - a) / (b - a)); };
  var smooth = function (t) { return t * t * (3 - 2 * t); };
  var smoother = function (t) { return t * t * t * (t * (t * 6 - 15) + 10); };
  var easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var rnd = function (n) {
    var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  var hash = function (n) {
    var x = Math.sin(n) * 43758.5453;
    return x - Math.floor(x);
  };
  var two = function (i) { return String(i + 1).padStart(2, "0"); };
  var lerp3 = function (a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  };

  /* ---------- Géométrie (1 unité = 1 U = 44,45 mm) ---------- */

  var OUT_W = 13.5;
  var OUT_D = 13.5;
  var POST = 0.5;
  var PANEL_W = 10.86;
  var BODY_W = 9.7;
  var RAIL_X = 5.25;
  var RAIL_W = 0.6;
  var FRONT = OUT_D / 2;
  var RAIL_Z = FRONT - 1.1;
  var PANEL_Z = RAIL_Z + 0.22;
  var PLINTH = 0.6;
  var FEET = 0.35;
  var FLOOR_Y = -PLINTH - FEET;
  var CH_X = PANEL_W / 2 + 0.34;
  var DIM_OFF = 1.9;
  var HEIGHT_DIM_X = -OUT_W / 2 - 1.3;
  var HEIGHT_LABEL_HALF = 0.75;
  var SLIDE_Z = 17;

  var UNITS = { firewall: 1, switch: 1, hypervisor: 2, storage: 2, ups: 2 };
  var DEPTH = { firewall: 6.4, switch: 5.6, hypervisor: 11.6, storage: 10.8, ups: 9.2 };
  var NETWORK = { firewall: true, switch: true };

  var FOV = 26;
  var AZ0 = 38 * DEG;
  var AZ1 = 0;
  var EL0 = 21 * DEG;
  var EL1 = 6.5 * DEG;

  /* Façade d'un équipement : segments, voyants et ports dans un repère local
     centré sur la face avant (z = 0). */
  function faceOf(kind) {
    var segs = [];
    var leds = [];
    var ports = [];
    var Z = 0.016;
    var line = function (x1, y1, x2, y2) { segs.push([[x1, y1, Z], [x2, y2, Z]]); };
    var rect = function (cx, cy, w, h) {
      var x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
      line(x0, y0, x1, y0);
      line(x1, y0, x1, y1);
      line(x1, y1, x0, y1);
      line(x0, y1, x0, y0);
    };
    var led = function (x, y, k) { leds.push({ p: [x, y, Z + 0.03], kind: k }); };
    var port = function (x, y) { ports.push([x, y, Z]); };
    var i, c, cx, j, k;

    switch (kind) {
      case "firewall":
        for (i = 0; i < 12; i++) line(-4.75 + i * 0.17, -0.22, -4.75 + i * 0.17, 0.22);
        for (i = 0; i < 4; i++) {
          cx = -0.9 + i * 0.64;
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
      case "switch":
        for (i = 0; i < 8; i++) line(-4.8 + i * 0.17, -0.2, -4.8 + i * 0.17, 0.2);
        led(-3.05, 0.17, 0);
        led(-3.05, -0.15, 0);
        for (c = 0; c < 12; c++) {
          cx = -2.45 + c * 0.5;
          rect(cx, -0.1, 0.42, 0.34);
          line(cx - 0.08, -0.21, cx + 0.08, -0.21);
          led(cx, 0.27, 1);
        }
        for (c = 11; c >= 7; c--) port(-2.45 + c * 0.5, -0.1);
        [3.75, 4.37].forEach(function (x) {
          rect(x, -0.08, 0.5, 0.28);
          led(x, 0.27, 0);
        });
        break;
      case "hypervisor":
        for (i = 0; i < 8; i++) {
          cx = -4.5 + i * 0.64;
          rect(cx, -0.04, 0.56, 1.52);
          line(cx - 0.16, -0.62, cx + 0.16, -0.62);
          led(cx + 0.14, 0.58, 1);
        }
        rect(0.7, -0.58, 0.32, 0.22);
        rect(1.12, -0.58, 0.32, 0.22);
        port(1.12, -0.58);
        port(0.7, -0.58);
        for (j = 0; j < 8; j++) line(1.55, -0.62 + j * 0.177, 4.05, -0.62 + j * 0.177);
        rect(4.55, 0.55, 0.32, 0.32);
        led(4.55, 0.1, 0);
        led(4.55, -0.2, 0);
        break;
      case "storage":
        for (i = 0; i < 4; i++) {
          cx = -3.62 + i * 2.1;
          rect(cx, -0.02, 2, 1.56);
          line(cx - 0.8, -0.56, cx + 0.3, -0.56);
          [0.12, 0.26, 0.4].forEach(function (v) { line(cx - 0.8, v, cx + 0.25, v); });
          led(cx + 0.76, 0.58, 1);
          led(cx + 0.76, 0.34, 0);
        }
        led(4.5, 0.58, 0);
        rect(4.5, 0.12, 0.3, 0.3);
        rect(4.5, -0.55, 0.36, 0.22);
        port(4.5, -0.55);
        break;
      case "ups":
        rect(-3.4, 0.22, 2.3, 0.9);
        for (k = 0; k < 5; k++) line(-4.3 + k * 0.2, 0.0, -4.3 + k * 0.2, 0.44);
        line(-3.1, 0.45, -2.45, 0.45);
        line(-3.1, 0.3, -2.75, 0.3);
        [-4.1, -3.4, -2.7].forEach(function (x) { rect(x, -0.5, 0.38, 0.26); });
        led(-1.75, 0.45, 0);
        led(-1.35, 0.45, 0);
        led(-0.95, 0.45, 0);
        for (i = 0; i < 20; i++) line(-0.3 + i * 0.2, -0.62, -0.3 + i * 0.2, 0.62);
        rect(4.45, -0.52, 0.38, 0.26);
        led(4.45, 0.45, 1);
        port(4.45, -0.52);
        break;
    }
    return { segs: segs, leds: leds, ports: ports };
  }

  /* Catmull-Rom centripète échantillonnée : une courbe douce pour chaque câble. */
  function spline(points, samples) {
    var n = points.length;
    if (n < 3) return points.slice();
    var first = points[0], second = points[1], last = points[n - 1], before = points[n - 2];
    var pts = [[2 * first[0] - second[0], 2 * first[1] - second[1], 2 * first[2] - second[2]]]
      .concat(points)
      .concat([[2 * last[0] - before[0], 2 * last[1] - before[1], 2 * last[2] - before[2]]]);
    var knot = function (a, b) {
      return Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])));
    };
    var lv = function (a, b, ta, tb, t) { return lerp3(a, b, (t - ta) / (tb - ta)); };
    var out = [];
    for (var i = 1; i < pts.length - 2; i++) {
      var p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2];
      var t0 = 0;
      var t1 = t0 + knot(p0, p1);
      var t2 = t1 + knot(p1, p2);
      var t3 = t2 + knot(p2, p3);
      for (var s = 0; s < samples; s++) {
        var t = t1 + ((t2 - t1) * s) / samples;
        var a1 = lv(p0, p1, t0, t1, t);
        var a2 = lv(p1, p2, t1, t2, t);
        var a3 = lv(p2, p3, t2, t3, t);
        var b1 = lv(a1, a2, t0, t2, t);
        var b2 = lv(a2, a3, t1, t3, t);
        out.push(lv(b1, b2, t1, t2, t));
      }
    }
    out.push(last);
    return out;
  }

  /* Câble : sort du port, rejoint la goulotte de droite, descend, revient au port. */
  function cableRoute(a, b, k) {
    var x = CH_X + k * 0.15;
    var z = PANEL_Z + 0.42 + k * 0.07;
    var down = a[1] > b[1] ? 1 : -1;
    var pts = [a, [a[0], a[1], a[2] + 0.3], [a[0] + (x - a[0]) * 0.55, a[1] - 0.05 * down, z]];
    if (Math.abs(a[1] - b[1]) > 1.2) pts.push([x, a[1] - 0.45 * down, z], [x, b[1] + 0.45 * down, z]);
    else pts.push([x, (a[1] + b[1]) / 2, z]);
    pts.push([b[0] + (x - b[0]) * 0.55, b[1] + 0.05 * down, z], [b[0], b[1], b[2] + 0.3], b);
    return spline(pts, 9);
  }

  /* Plan du rack : emplacements, câbles et chronologie (en fraction du défilement). */
  function computePlan(list) {
    list = list.slice(0, 8);
    var gaps = list.map(function (d, i) {
      if (i === 0) return 0;
      if (d.kind === "ups") return 1;
      return NETWORK[list[i - 1].kind] && !NETWORK[d.kind] ? 1 : 0;
    });
    var used = list.reduce(function (sum, d, i) { return sum + d.units + gaps[i]; }, 0);
    var rackU = Math.max(6, used);
    var top = rackU;
    var slots = list.map(function (d, i) {
      top -= gaps[i];
      var y1 = top;
      var y0 = top - d.units;
      top = y0;
      return { kind: d.kind, units: d.units, h: d.units - 0.08, yc: (y0 + y1) / 2, depth: DEPTH[d.kind], face: faceOf(d.kind) };
    });

    // Le switch dessert tout le monde, l'onduleur prévient l'hyperviseur.
    var world = function (s, p) { return [p[0], s.yc + p[1], PANEL_Z + p[2]]; };
    var pairs = [];
    var sw = slots.findIndex(function (s) { return s.kind === "switch"; });
    if (sw >= 0) {
      var k = 0;
      slots.forEach(function (s, i) {
        if (i === sw || s.kind === "ups" || !s.face.ports.length) return;
        var swPorts = slots[sw].face.ports;
        pairs.push([world(slots[sw], swPorts[k % swPorts.length]), world(s, s.face.ports[0])]);
        k += 1;
      });
    } else {
      var net = slots.filter(function (s) { return s.kind !== "ups" && s.face.ports.length; });
      for (var i = 1; i < net.length; i++) {
        pairs.push([world(net[i - 1], net[i - 1].face.ports[0]), world(net[i], net[i].face.ports[0])]);
      }
    }
    var ups = slots.find(function (s) { return s.kind === "ups"; });
    var host = slots.find(function (s) { return s.kind === "hypervisor"; }) || slots.find(function (s) { return s.kind === "storage"; });
    if (ups && host && ups.face.ports.length) {
      var hp = host.face.ports[1] || host.face.ports[0];
      pairs.push([world(ups, ups.face.ports[0]), world(host, hp)]);
    }
    var cables = pairs.map(function (pair, idx) { return cableRoute(pair[0], pair[1], idx); });

    var n = Math.max(1, slots.length);
    var DEV0 = 0.19;
    var DEV1 = 0.64;
    var step = (DEV1 - DEV0) / n;
    var slide = Math.min(0.085, step * 0.95);
    var boot = 0.03;
    var starts = slots.map(function (_, i) { return DEV0 + i * step; });
    var lands = starts.map(function (s) { return s + slide; });
    var lastLand = lands.length ? lands[lands.length - 1] : DEV1;
    var c0 = Math.max(DEV1, lastLand + boot) - 0.01;
    var cDur = 0.07;
    var stagger = cables.length > 1 ? (0.8 - cDur - c0) / (cables.length - 1) : 0;
    var cableTimes = cables.map(function (_, idx) { return [c0 + idx * stagger, c0 + idx * stagger + cDur]; });

    return {
      rackU: rackU,
      slots: slots,
      cables: cables,
      tl: { starts: starts, lands: lands, boot: boot, cables: cableTimes, green: [0.8, 0.86], final: 0.865, cam: 0.9 },
    };
  }

  /* ---------- Segments : châssis, rails, cotes ---------- */

  // Sommets et faces d'un pavé ; chaque arête connaît ses deux faces (pour masquer les arêtes cachées).
  var BOX_FACES = [
    { n: [0, 0, 1], v: [4, 5, 6, 7] },
    { n: [0, 0, -1], v: [1, 0, 3, 2] },
    { n: [1, 0, 0], v: [5, 1, 2, 6] },
    { n: [-1, 0, 0], v: [0, 4, 7, 3] },
    { n: [0, 1, 0], v: [7, 6, 2, 3] },
    { n: [0, -1, 0], v: [0, 1, 5, 4] },
  ];
  var BOX_EDGES = [
    [0, 1, 1, 5], [1, 2, 1, 2], [2, 3, 1, 4], [3, 0, 1, 3],
    [4, 5, 0, 5], [5, 6, 0, 2], [6, 7, 0, 4], [7, 4, 0, 3],
    [0, 4, 3, 5], [1, 5, 2, 5], [2, 6, 2, 4], [3, 7, 3, 4],
  ];
  function boxVerts(c, s) {
    var x0 = c[0] - s[0] / 2, x1 = c[0] + s[0] / 2;
    var y0 = c[1] - s[1] / 2, y1 = c[1] + s[1] / 2;
    var z0 = c[2] - s[2] / 2, z1 = c[2] + s[2] / 2;
    return [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ];
  }
  function boxEdges(c, s) {
    var v = boxVerts(c, s);
    return BOX_EDGES.map(function (e) { return [v[e[0]], v[e[1]]]; });
  }

  function chassisBoxes(rackH) {
    var px = OUT_W / 2 - POST / 2;
    var pz = OUT_D / 2 - POST / 2;
    var fx = OUT_W / 2 - 0.7;
    var fz = OUT_D / 2 - 0.7;
    var boxes = [];
    [-1, 1].forEach(function (sx) {
      [-1, 1].forEach(function (sz) {
        boxes.push({ c: [sx * fx, -PLINTH - FEET / 2, sz * fz], s: [0.7, FEET, 0.7], w: 0.7 });
        boxes.push({ c: [sx * px, rackH / 2, sz * pz], s: [POST, rackH, POST], w: 1 });
      });
      boxes.push({ c: [sx * px, rackH / 2, 0], s: [POST * 0.6, 0.3, OUT_D - POST * 2], w: 0.55 });
    });
    boxes.push({ c: [0, -PLINTH / 2, 0], s: [OUT_W, PLINTH, OUT_D], w: 1 });
    boxes.push({ c: [0, rackH + PLINTH / 2, 0], s: [OUT_W, PLINTH, OUT_D], w: 1 });
    return boxes;
  }

  /* Ordre de tracé du châssis : de bas en haut en tournant, les montants poussent vers le haut.
     t0 et t1 disent quand chaque segment commence et finit de se tracer (0 à 1). */
  function orderTrace(items) {
    var norm = items.map(function (it) {
      var a = it.seg[0], b = it.seg[1];
      if (Math.abs(a[1] - b[1]) > 1e-3 && a[1] > b[1]) { var tmp = a; a = b; b = tmp; }
      var len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      var key = Math.min(a[1], b[1]) * 10 + Math.atan2(a[2] + b[2], a[0] + b[0]) * 0.08;
      return { a: a, b: b, w: it.w, front: it.front, len: len, key: key };
    });
    norm.sort(function (p, q) { return p.key - q.key; });
    var maxLen = Math.max.apply(null, [1].concat(norm.map(function (s) { return s.len; })));
    var count = norm.length;
    var out = norm.map(function (s, i) {
      var t0 = (count > 1 ? i / (count - 1) : 0) * 0.62;
      return { a: s.a, b: s.b, w: s.w, front: s.front, t0: t0, t1: t0 + 0.06 + (0.32 * s.len) / maxLen };
    });
    var maxT = Math.max.apply(null, out.map(function (s) { return s.t1; }));
    out.forEach(function (s) { s.t0 /= maxT; s.t1 /= maxT; });
    return out;
  }

  function railTrace(rackU) {
    var out = [];
    var add = function (a, b, w) { out.push({ a: a, b: b, w: w, t0: clamp(a[1] / rackU), t1: clamp(b[1] / rackU) }); };
    [-1, 1].forEach(function (sx) {
      [1, -1].forEach(function (sz) {
        var w = sz > 0 ? 1 : 0.45;
        boxEdges([sx * RAIL_X, rackU / 2, sz * RAIL_Z], [RAIL_W, rackU, 0.12]).forEach(function (e) { add(e[0], e[1], w); });
        if (sz < 0) return;
        for (var u = 0; u < rackU; u++) {
          [0.25, 0.5, 0.75].forEach(function (k) {
            var x = sx * RAIL_X, y = u + k, z = RAIL_Z + 0.07, r = 0.07;
            add([x - r, y - r, z], [x + r, y - r, z], 0.7);
            add([x + r, y - r, z], [x + r, y + r, z], 0.7);
            add([x - r, y + r, z], [x + r, y + r, z], 0.7);
            add([x - r, y - r, z], [x - r, y + r, z], 0.7);
          });
        }
      });
    });
    var x1 = -RAIL_X - RAIL_W / 2;
    for (var u = 0; u <= rackU; u++) add([x1 - 0.32, u, RAIL_Z + 0.06], [x1, u, RAIL_Z + 0.06], 0.6);
    return out;
  }

  /* Cotes au sol et en façade ; la profondeur, à part, s'efface quand la vue passe de face. */
  function dimTrace(rackU) {
    var y = FLOOR_Y + 0.01, X = OUT_W / 2, Zf = OUT_D / 2, tick = 0.2;
    var main = [], depth = [];
    var add = function (a, b, t0, t1, w) { main.push({ a: a, b: b, t0: t0, t1: t1, w: w === undefined ? 1 : w }); };
    var addD = function (a, b, t0, t1, w) { depth.push({ a: a, b: b, t0: t0, t1: t1, w: w === undefined ? 1 : w }); };
    var fp = [[-X, y, -Zf], [X, y, -Zf], [X, y, Zf], [-X, y, Zf]];
    for (var i = 0; i < 4; i++) add(fp[i], fp[(i + 1) % 4], 0, 0.35, 0.5);
    var wz = Zf + DIM_OFF;
    add([-X, y, Zf], [-X, y, wz + 0.35], 0.05, 0.3, 0.7);
    add([X, y, Zf], [X, y, wz + 0.35], 0.05, 0.3, 0.7);
    add([-X, y, wz], [X, y, wz], 0.25, 0.8);
    add([-X - tick, y, wz + tick], [-X + tick, y, wz - tick], 0.78, 0.84);
    add([X - tick, y, wz + tick], [X + tick, y, wz - tick], 0.78, 0.84);
    var dx = X + DIM_OFF;
    addD([X, y, Zf], [dx + 0.35, y, Zf], 0.05, 0.3, 0.7);
    addD([X, y, -Zf], [dx + 0.35, y, -Zf], 0.05, 0.3, 0.7);
    addD([dx, y, Zf], [dx, y, -Zf], 0.25, 0.8);
    addD([dx - tick, y, Zf - tick], [dx + tick, y, Zf + tick], 0.78, 0.84);
    addD([dx - tick, y, -Zf - tick], [dx + tick, y, -Zf + tick], 0.78, 0.84);
    var hx = HEIGHT_DIM_X, z = Zf;
    add([-X, 0, z], [hx - 0.35, 0, z], 0.1, 0.35, 0.7);
    add([-X, rackU, z], [hx - 0.35, rackU, z], 0.1, 0.35, 0.7);
    add([hx, 0, z], [hx, rackU, z], 0.3, 0.9);
    add([hx - tick, -tick, z], [hx + tick, tick, z], 0.85, 0.9);
    add([hx - tick, rackU - tick, z], [hx + tick, rackU + tick, z], 0.85, 0.9);
    return { main: main, depth: depth };
  }

  function dimAnchors(rackU) {
    return [
      [0, FLOOR_Y, OUT_D / 2 + DIM_OFF + 0.95],
      [OUT_W / 2 + DIM_OFF + 1.1, FLOOR_Y, 0],
      [HEIGHT_DIM_X, rackU / 2, OUT_D / 2],
    ];
  }

  /* ---------- Couleurs, lues sur les variables CSS de la section ---------- */

  function parseColor(raw) {
    var value = String(raw || "").trim();
    if (value.charAt(0) === "#") {
      var hex = value.slice(1);
      var full = hex.length === 3 ? hex.replace(/./g, function (c) { return c + c; }) : hex.slice(0, 6);
      if (!/^[0-9a-f]{6}$/i.test(full)) return null;
      return [parseInt(full.slice(0, 2), 16) / 255, parseInt(full.slice(2, 4), 16) / 255, parseInt(full.slice(4, 6), 16) / 255];
    }
    var m = value.match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;
    var parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number.parseFloat);
    if (parts.length < 3) return null;
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
  }
  var readVar = function (name, fb) { return parseColor(getComputedStyle(root).getPropertyValue(name)) || fb; };
  var mix = function (a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
  var rgb = function (c) {
    return "rgb(" + Math.round(clamp(c[0]) * 255) + "," + Math.round(clamp(c[1]) * 255) + "," + Math.round(clamp(c[2]) * 255) + ")";
  };
  var WHITE = [1, 1, 1];

  /* =========================================================================
     Rendu : une caméra perspective, des segments, des pavés, des points
     ========================================================================= */

  function createRenderer(canvas, stage, plan, opts) {
    var ctx = canvas.getContext("2d");
    if (!ctx) return null;
    var low = opts.low;
    var rackU = plan.rackU;
    var C = {};
    var A = {};

    function applyColors() {
      var accent = readVar("--accent", [0.184, 0.902, 0.784]);
      var ok = readVar("--ok", [0.294, 0.816, 0.498]);
      var warn = readVar("--warn", [1, 0.769, 0.302]);
      var bg = readVar("--bg", [0.016, 0.02, 0.039]);
      var top = readVar("--surface-top", [0.07, 0.094, 0.157]);
      var txt1 = readVar("--txt-1", [0.93, 0.945, 0.973]);
      var txt2 = readVar("--txt-2", [0.65, 0.686, 0.768]);
      var txt3 = readVar("--txt-3", [0.486, 0.522, 0.612]);
      C.accent = accent;
      C.edge = accent;
      C.ok = ok;
      C.bodyLo = mix(bg, top, 0.3);
      C.bodyHi = mix(mix(top, txt1, 0.09), accent, 0.04);
      C.ledOff = mix(bg, txt3, 0.5);
      C.ledBoot = warn;
      C.cable = mix(mix(accent, bg, 0.62), accent, 0.7);
      C.pulse = mix(ok, WHITE, 0.45);
      C.head = mix(accent, WHITE, 0.55);
      C.chassis = mix(txt2, accent, 0.2);
      C.rails = mix(txt3, accent, 0.12);
      C.dims = txt3;
      A.chassis = 0.72;
      A.chassisGhost = 0.16;
      A.rails = 0.7;
      A.railsGhost = 0.06;
      A.dims = 0.75;
      A.grid = 0.2;
      A.shadow = 0.55;
    }

    /* --- Données préparées une fois --- */

    var topY = Math.max.apply(null, [0].concat(plan.slots.map(function (s) { return s.yc + s.h / 2; })));
    var chassisItems = [];
    chassisBoxes(rackU).forEach(function (box) {
      boxEdges(box.c, box.s).forEach(function (seg) {
        var xMin = Math.min(seg[0][0], seg[1][0]);
        var zMin = Math.min(seg[0][2], seg[1][2]);
        var yMin = Math.min(seg[0][1], seg[1][1]);
        // Ce qui est à droite, devant ou au-dessus des équipements passe par-dessus eux.
        var front = xMin >= BODY_W / 2 + 0.05 || zMin >= PANEL_Z - 0.05 || yMin >= topY - 0.01;
        chassisItems.push({ seg: seg, w: box.w, front: front });
      });
    });
    var chassis = orderTrace(chassisItems);
    var chassisBack = chassis.filter(function (s) { return !s.front; });
    var chassisFront = chassis.filter(function (s) { return s.front; });
    var rails = railTrace(rackU);
    var dims = dimTrace(rackU);

    var devices = plan.slots.map(function (s, i) {
      var boxes = [
        { c: [0, 0, -0.2 - (s.depth - 0.2) / 2], s: [BODY_W, s.h - 0.06, s.depth - 0.2], w: 0.5 },
        { c: [0, 0, -0.1], s: [PANEL_W, s.h, 0.2], w: 1 },
      ].map(function (b) { return { v: boxVerts(b.c, b.s), c: b.c, s: b.s, w: b.w }; });
      var leds = s.face.leds.map(function (l, j) {
        return { p: l.p, kind: l.kind, phase: rnd(i * 31 + j), rate: 3 + rnd(i * 17 + j * 7) * 8 };
      });
      var hx = PANEL_W / 2 + 0.1, hy = s.h / 2 + 0.08, z = PANEL_Z + 0.02, y = s.yc;
      var frame = [
        [[-hx, y - hy, z], [hx, y - hy, z]],
        [[hx, y - hy, z], [hx, y + hy, z]],
        [[hx, y + hy, z], [-hx, y + hy, z]],
        [[-hx, y + hy, z], [-hx, y - hy, z]],
      ];
      return { slot: s, boxes: boxes, details: s.face.segs, leds: leds, frame: frame };
    });

    var cables = plan.cables.map(function (pts, k) {
      var acc = [0];
      for (var i = 1; i < pts.length; i++) {
        acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
      }
      return { pts: pts, acc: acc, len: acc[acc.length - 1], offset: k * 0.29 };
    });

    // Grille du sol : petits morceaux rangés par niveau d'opacité (fondu radial, une passe par niveau).
    var LEVELS = 6;
    var gridLevels = [];
    for (var lv = 0; lv < LEVELS; lv++) gridLevels.push([]);
    var G = 24;
    var gstep = low ? 2.25 : 1.5;
    var gy = FLOOR_Y - 0.01;
    for (var v = -G; v <= G + 1e-6; v += gstep) {
      for (var u = -G; u < G - 1e-6; u += gstep) {
        [[[u, gy, v], [u + gstep, gy, v]], [[v, gy, u], [v, gy, u + gstep]]].forEach(function (seg) {
          var mx = (seg[0][0] + seg[1][0]) / 2, mz = (seg[0][2] + seg[1][2]) / 2;
          var a = 1 - smooth(remap(Math.hypot(mx, mz), 9, 24));
          if (a < 0.02) return;
          gridLevels[Math.min(LEVELS - 1, Math.floor(a * LEVELS))].push(seg);
        });
      }
    }

    /* --- Caméra --- */

    var W = 1, H = 1, dpr = 1;
    var insets = { top: 60, bottom: 80 };
    var half = Math.tan((FOV * DEG) / 2);
    var focal = 1;
    var cam = { x: 0, y: 0, z: 0, rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, dx: 0, dy: 0, dz: 1, offX: 0, offY: 0 };
    var target = [0, (FLOOR_Y + rackU + PLINTH) / 2, 0.6];
    var PX = 0, PY = 0, PD = 1;

    function layout() {
      W = Math.max(1, stage.clientWidth);
      H = Math.max(1, stage.clientHeight);
      insets = opts.insets();
      dpr = Math.min(window.devicePixelRatio || 1, low ? 1.5 : 1.75);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      focal = H / 2 / half;
    }

    // Repère de la caméra pour un azimut et une élévation donnés (comme lookAt).
    function setCamera(az, el, dist) {
      var ce = Math.cos(el);
      var dx = Math.sin(az) * ce, dy = Math.sin(el), dz = Math.cos(az) * ce;
      var rl = Math.hypot(dz, dx) || 1;
      var rx = dz / rl, ry = 0, rz = -dx / rl;
      cam.dx = dx; cam.dy = dy; cam.dz = dz;
      cam.rx = rx; cam.ry = ry; cam.rz = rz;
      cam.ux = dy * rz - dz * ry;
      cam.uy = dz * rx - dx * rz;
      cam.uz = dx * ry - dy * rx;
      cam.x = target[0] + dx * dist;
      cam.y = target[1] + dy * dist;
      cam.z = target[2] + dz * dist;
    }

    // Projection perspective d'un point, résultat dans PX, PY (pixels CSS) et PD (profondeur).
    function project(x, y, z) {
      var qx = x - cam.x, qy = y - cam.y, qz = z - cam.z;
      var d = -(qx * cam.dx + qy * cam.dy + qz * cam.dz);
      if (d < 0.05) d = 0.05;
      PD = d;
      PX = W / 2 + ((qx * cam.rx + qy * cam.ry + qz * cam.rz) / d) * focal - cam.offX;
      PY = H / 2 - ((qx * cam.ux + qy * cam.uy + qz * cam.uz) / d) * focal - cam.offY;
    }

    /* Cadrage exact : distance telle que tout tienne dans la zone libre entre les
       surcouches, puis décalage de la vue pour centrer l'emprise projetée. */
    var corners = [];
    [-OUT_W / 2, OUT_W / 2].forEach(function (x) {
      [FLOOR_Y, rackU + PLINTH].forEach(function (y) {
        [-OUT_D / 2, OUT_D / 2].forEach(function (z) { corners.push([x, y, z]); });
      });
    });
    corners.push(
      [-OUT_W / 2, FLOOR_Y, OUT_D / 2 + DIM_OFF + 1.2],
      [OUT_W / 2, FLOOR_Y, OUT_D / 2 + DIM_OFF + 1.2],
      [0, FLOOR_Y - 0.7, OUT_D / 2 + DIM_OFF + 0.95],
      [HEIGHT_DIM_X - HEIGHT_LABEL_HALF, rackU / 2, OUT_D / 2],
      [-(HEIGHT_DIM_X - HEIGHT_LABEL_HALF), rackU / 2, OUT_D / 2]
    );
    var depthCorners = [
      [OUT_W / 2 + DIM_OFF + 1.7, FLOOR_Y, OUT_D / 2],
      [OUT_W / 2 + DIM_OFF + 1.7, FLOOR_Y, -OUT_D / 2],
      [OUT_W / 2 + DIM_OFF + 3, FLOOR_Y, 0],
    ];
    var depthWeight = function (az) { return smooth(remap(az, 2 * DEG, 14 * DEG)); };
    var depthAlpha = function (az) { return smooth(remap(az, 12 * DEG, 24 * DEG)); };
    var proj = new Float64Array((corners.length + depthCorners.length) * 3);
    var shot = { dist: 40, offX: 0, offY: 0 };

    function frameCamera(az, el) {
      var ce = Math.cos(el);
      var dir = [Math.sin(az) * ce, Math.sin(el), Math.cos(az) * ce];
      var rl = Math.hypot(dir[2], dir[0]) || 1;
      var right = [dir[2] / rl, 0, -dir[0] / rl];
      var up = [
        dir[1] * right[2] - dir[2] * right[1],
        dir[2] * right[0] - dir[0] * right[2],
        dir[0] * right[1] - dir[1] * right[0],
      ];
      var aspect = W / H;
      var availV = Math.max(0.25, (H - insets.top - insets.bottom) / H);
      var tanV = half * availV * 0.96;
      var tanH = half * aspect * 0.93;
      var wd = depthWeight(az);
      var count = corners.length + depthCorners.length;
      var d = 0, i;
      for (i = 0; i < count; i++) {
        var c = i < corners.length ? corners[i] : depthCorners[i - corners.length];
        var cxw = i < corners.length ? c[0] : OUT_W / 2 + (c[0] - OUT_W / 2) * wd;
        var rx = cxw - target[0], ry = c[1] - target[1], rz = c[2] - target[2];
        var pr = rx * right[0] + ry * right[1] + rz * right[2];
        var pu = rx * up[0] + ry * up[1] + rz * up[2];
        var pf = rx * dir[0] + ry * dir[1] + rz * dir[2];
        proj[i * 3] = pr;
        proj[i * 3 + 1] = pu;
        proj[i * 3 + 2] = pf;
        d = Math.max(d, pf + Math.abs(pr) / tanH, pf + Math.abs(pu) / tanV);
      }
      var minX = 0, maxX = 0, minY = 0, maxY = 0;
      var bounds = function () {
        minX = Infinity; maxX = -Infinity; minY = Infinity; maxY = -Infinity;
        for (var j = 0; j < count; j++) {
          var k = 1 / Math.max(0.5, d - proj[j * 3 + 2]);
          minX = Math.min(minX, proj[j * 3] * k);
          maxX = Math.max(maxX, proj[j * 3] * k);
          minY = Math.min(minY, proj[j * 3 + 1] * k);
          maxY = Math.max(maxY, proj[j * 3 + 1] * k);
        }
      };
      for (i = 0; i < 3; i++) {
        bounds();
        var sc = Math.max((maxX - minX) / 2 / tanH, (maxY - minY) / 2 / tanV);
        d *= clamp(sc, 0.6, 1.6);
      }
      bounds();
      shot.dist = d;
      var cx = ((minX + maxX) / 2 / (half * aspect)) * (W / 2);
      var cy = ((minY + maxY) / 2 / half) * (H / 2);
      shot.offX = cx;
      shot.offY = -((insets.top - insets.bottom) / 2 + cy);
      return shot;
    }

    /* --- Dessin --- */

    var buckets = {};
    function bucket(key) { return buckets[key] || (buckets[key] = []); }
    function flush(color, alphaOf) {
      Object.keys(buckets).forEach(function (key) {
        var list = buckets[key];
        if (!list.length) return;
        ctx.globalAlpha = clamp(alphaOf(Number(key)));
        ctx.strokeStyle = color;
        ctx.beginPath();
        for (var i = 0; i < list.length; i += 4) {
          ctx.moveTo(list[i], list[i + 1]);
          ctx.lineTo(list[i + 2], list[i + 3]);
        }
        ctx.stroke();
        list.length = 0;
      });
    }
    function pushSeg(list, a, b, ox, oy, oz) {
      project(a[0] + ox, a[1] + oy, a[2] + oz);
      list.push(PX, PY);
      project(b[0] + ox, b[1] + oy, b[2] + oz);
      list.push(PX, PY);
    }

    /* Tracé progressif : chaque segment pousse de t0 à t1 quand « draw » avance.
       La partie pas encore tracée reste en fantôme très pâle, la pointe est plus claire. */
    function drawLines(segs, draw, alpha, ghost, color) {
      if (alpha <= 0.003) return;
      var heads = [];
      var ghosts = [];
      for (var i = 0; i < segs.length; i++) {
        var s = segs[i];
        var span = s.t1 - s.t0;
        var e = span > 1e-6 ? clamp((draw - s.t0) / span) : s.t0 <= draw ? 1 : 0;
        if (e > 0) {
          var end = e < 1 ? lerp3(s.a, s.b, e) : s.b;
          pushSeg(bucket(s.w), s.a, end, 0, 0, 0);
          if (draw < 0.999 && span > 1e-6) {
            var h0 = clamp((draw - 0.06 - s.t0) / span);
            if (h0 < e) pushSeg(heads, lerp3(s.a, s.b, h0), end, 0, 0, 0);
          }
        }
        if (ghost > 0 && e < 1) pushSeg(ghosts, e > 0 ? lerp3(s.a, s.b, e) : s.a, s.b, 0, 0, 0);
      }
      flush(rgb(color), function (w) { return alpha * w; });
      if (ghosts.length) {
        buckets.g = ghosts;
        flush(rgb(color), function () { return ghost * 0.7; });
        delete buckets.g;
      }
      if (heads.length) {
        buckets.h = heads;
        flush(rgb(C.head), function () { return alpha; });
        delete buckets.h;
      }
    }

    function drawGrid() {
      ctx.strokeStyle = rgb(C.dims);
      for (var l = 0; l < LEVELS; l++) {
        var list = gridLevels[l];
        ctx.globalAlpha = A.grid * ((l + 0.5) / LEVELS);
        ctx.beginPath();
        for (var i = 0; i < list.length; i++) {
          project(list[i][0][0], list[i][0][1], list[i][0][2]);
          ctx.moveTo(PX, PY);
          project(list[i][1][0], list[i][1][1], list[i][1][2]);
          ctx.lineTo(PX, PY);
        }
        ctx.stroke();
      }
    }

    // Ombre portée : un dégradé radial posé sur le sol (transformation affine du plan).
    function drawShadow() {
      var R = (OUT_W * 2.3) / 2;
      project(0, FLOOR_Y, 0);
      var cx = PX, cy = PY;
      project(R, FLOOR_Y, 0);
      var ax = PX - cx, ay = PY - cy;
      project(0, FLOOR_Y, R);
      var bx = PX - cx, by = PY - cy;
      ctx.save();
      ctx.setTransform(dpr * ax, dpr * ay, dpr * bx, dpr * by, dpr * cx, dpr * cy);
      var g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      for (var i = 0; i <= 6; i++) {
        var r = i / 6;
        var t = clamp((r - 0.18) / 0.82);
        var a = A.shadow * Math.pow(1 - smooth(t), 1.8);
        g.addColorStop(r, "rgba(0,0,0," + a.toFixed(3) + ")");
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    }

    var ledPos = [];
    function drawDevice(d, i, p, time, paused, active) {
      var tl = plan.tl;
      var local = remap(p, tl.starts[i], tl.lands[i]);
      if (local <= 0) return;
      var s = d.slot;
      var oy = s.yc;
      var oz = PANEL_Z + (1 - easeOut(local)) * SLIDE_Z;
      var op = smooth(remap(local, 0, 0.45));
      var focus = i === active && p < tl.final ? 1 - remap(p, tl.lands[i] + tl.boot, tl.lands[i] + tl.boot + 0.05) : 0;

      // Volumes : faces tournées vers la caméra, éclairées selon leur orientation.
      var visible = [];
      d.boxes.forEach(function (box, b) {
        var vis = BOX_FACES.map(function (f) {
          var fc = [box.c[0] + f.n[0] * box.s[0] / 2, box.c[1] + oy + f.n[1] * box.s[1] / 2, box.c[2] + oz + f.n[2] * box.s[2] / 2];
          return f.n[0] * (cam.x - fc[0]) + f.n[1] * (cam.y - fc[1]) + f.n[2] * (cam.z - fc[2]) > 0;
        });
        visible[b] = vis;
        BOX_FACES.forEach(function (f, fi) {
          if (!vis[fi]) return;
          var n = f.n;
          var l = clamp(0.42 + 0.5 * n[1] + 0.22 * n[2] - 0.12 * Math.abs(n[0]));
          var c = mix(C.bodyLo, C.bodyHi, l);
          c = mix(c, C.accent, focus * 0.07 * Math.max(n[2], 0));
          ctx.globalAlpha = op;
          ctx.fillStyle = rgb(c);
          ctx.beginPath();
          f.v.forEach(function (vi, k) {
            var v = box.v[vi];
            project(v[0], v[1] + oy, v[2] + oz);
            if (k === 0) ctx.moveTo(PX, PY);
            else ctx.lineTo(PX, PY);
          });
          ctx.closePath();
          ctx.fill();
        });
      });

      // Arêtes : seulement celles qui bordent une face visible (pas d'effet fil de fer).
      d.boxes.forEach(function (box, b) {
        BOX_EDGES.forEach(function (e) {
          if (!visible[b][e[2]] && !visible[b][e[3]]) return;
          pushSeg(bucket(box.w), box.v[e[0]], box.v[e[1]], 0, oy, oz);
        });
      });
      d.details.forEach(function (seg) { pushSeg(bucket(0.6), seg[0], seg[1], 0, oy, oz); });
      flush(rgb(C.edge), function (w) { return op * (0.82 + 0.18 * focus) * w; });

      // Voyants : éteints, clignotement ambre au démarrage, activité, puis tous verts.
      var power = remap(p, tl.lands[i], tl.lands[i] + tl.boot);
      var green = smooth(remap(p, tl.green[0], tl.green[1]));
      var booting = power > 0.001 && power < 0.999;
      var running = power >= 0.999;
      ctx.globalCompositeOperation = "lighter";
      d.leds.forEach(function (l) {
        var flick = l.kind > 0.5 ? (hash(Math.floor(time * l.rate) + l.phase * 113) >= 0.34 ? 1 : 0) : 1;
        var blink = (time * 2.2 + l.phase) % 1 >= 0.5 ? 1 : 0;
        var col = C.ledOff, a = 0.6, glow = 0;
        if (booting) { col = C.ledBoot; a = lerp(0.45, 1, blink); glow = blink; }
        if (running) { col = mix(C.edge, C.ok, green); a = lerp(0.5, 1, flick); glow = flick; }
        project(l.p[0], l.p[1] + oy, l.p[2] + oz);
        var size = (0.46 * focal * (1 + glow * 0.6)) / PD;
        var r = Math.max(0.6, size / 2);
        ctx.globalAlpha = a * op;
        if (glow > 0) {
          var g = ctx.createRadialGradient(PX, PY, 0, PX, PY, r);
          g.addColorStop(0, rgb(col));
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.globalAlpha = a * op * 0.32 * glow;
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(PX, PY, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = a * op;
        }
        ctx.fillStyle = rgb(mix(col, WHITE, 0.3 * glow));
        ctx.beginPath();
        ctx.arc(PX, PY, Math.max(0.5, r * 0.38), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalCompositeOperation = "source-over";
      return local;
    }

    // Câble : se trace le long de sa longueur, puis des impulsions de données le parcourent.
    function drawCable(c, draw, time, flow) {
      if (draw <= 0.001) return;
      var stop = draw * c.len;
      var pts = [];
      var depthSum = 0;
      for (var i = 0; i < c.pts.length; i++) {
        var p = c.pts[i];
        if (c.acc[i] > stop) {
          var prev = c.pts[i - 1];
          var t = (stop - c.acc[i - 1]) / Math.max(1e-6, c.acc[i] - c.acc[i - 1]);
          p = lerp3(prev, p, t);
          project(p[0], p[1], p[2]);
          pts.push([PX, PY, stop / c.len]);
          depthSum += PD;
          break;
        }
        project(p[0], p[1], p[2]);
        pts.push([PX, PY, c.acc[i] / c.len]);
        depthSum += PD;
      }
      if (pts.length < 2) return;
      var width = (0.2 * focal) / (depthSum / pts.length);
      var path = function (from, to) {
        ctx.beginPath();
        var started = false;
        for (var k = 0; k < pts.length; k++) {
          if (pts[k][2] < from || pts[k][2] > to) continue;
          if (!started) { ctx.moveTo(pts[k][0], pts[k][1]); started = true; }
          else ctx.lineTo(pts[k][0], pts[k][1]);
        }
        return started;
      };
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = 1;
      ctx.strokeStyle = rgb(C.cable);
      ctx.lineWidth = width;
      path(0, 1);
      ctx.stroke();
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = rgb(C.edge);
      ctx.lineWidth = width * 0.4;
      path(0, 1);
      ctx.stroke();
      if (flow > 0) {
        var kk = ((time * 0.2 + c.offset) % 1) * 1.3 - 0.15;
        ctx.globalAlpha = flow;
        ctx.strokeStyle = rgb(C.pulse);
        ctx.lineWidth = width;
        if (path(kk - 0.045, kk + 0.045)) ctx.stroke();
      }
      if (draw < 0.999) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = rgb(C.head);
        ctx.lineWidth = width;
        if (path(draw - 0.06, draw)) ctx.stroke();
      }
      ctx.lineWidth = 1;
      ctx.lineCap = "butt";
    }

    /* --- Étiquettes de cotes (HTML) --- */

    var anchors = dimAnchors(rackU);
    var labelState = opts.labels.map(function () { return { x: -1, y: -1, a: -1 }; });
    function placeLabels(alpha, az, sliding) {
      opts.labels.forEach(function (el, i) {
        var a = i === 1 ? alpha * depthAlpha(az) : alpha * (1 - 0.8 * sliding);
        project(anchors[i][0], anchors[i][1], anchors[i][2]);
        var st = labelState[i];
        if (Math.abs(st.x - PX) > 0.25 || Math.abs(st.y - PY) > 0.25) {
          st.x = PX;
          st.y = PY;
          el.style.transform = "translate3d(" + PX.toFixed(1) + "px," + PY.toFixed(1) + "px,0)";
        }
        if (Math.abs(st.a - a) > 0.005) {
          st.a = a;
          el.style.opacity = a.toFixed(3);
        }
      });
    }

    /* --- Image complète pour une progression p --- */

    var time = opts.time || 0;
    var paused = false;

    applyColors();
    layout();

    return {
      layout: layout,
      setPaused: function (next) { paused = next; },
      render: function (p, dt, px, py) {
        if (!paused) time += dt;
        var tl = plan.tl;
        var q = smoother(remap(p, 0, tl.cam));
        var az = lerp(AZ0, AZ1, q);
        var el = lerp(EL0, EL1, q);
        frameCamera(az, el);
        cam.offX = shot.offX;
        cam.offY = shot.offY;
        setCamera(az + px * 4 * DEG, el - py * 2.5 * DEG, shot.dist);

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, W, H);
        ctx.lineWidth = 1;

        drawGrid();
        drawShadow();

        var chassisDraw = smooth(remap(p, 0, 0.16));
        var dimDraw = remap(p, 0.03, 0.19);
        drawLines(chassisBack, chassisDraw, A.chassis, A.chassisGhost, C.chassis);
        drawLines(rails, remap(p, 0.07, 0.2), A.rails, A.railsGhost, C.rails);
        drawLines(dims.main, dimDraw, A.dims, 0, C.dims);
        drawLines(dims.depth, dimDraw, A.dims * depthAlpha(az), 0, C.dims);

        var active = -1;
        for (var i = 0; i < devices.length; i++) if (p >= tl.starts[i] - 0.012) active = i;

        // Ordre de dessin : du bas vers le haut (la caméra est au-dessus), puis ce qui glisse.
        var order = devices.map(function (d, idx) { return idx; }).sort(function (a, b) {
          return devices[a].slot.yc - devices[b].slot.yc;
        });
        var settled = order.filter(function (idx) { return remap(p, tl.starts[idx], tl.lands[idx]) >= 1; });
        var moving = order.filter(function (idx) {
          var l = remap(p, tl.starts[idx], tl.lands[idx]);
          return l > 0 && l < 1;
        });
        settled.forEach(function (idx) { drawDevice(devices[idx], idx, p, time, paused, active); });

        // Emplacement visé : un cadre s'allume sur les rails pendant la glissade.
        var sliding = 0;
        moving.forEach(function (idx) {
          var l = remap(p, tl.starts[idx], tl.lands[idx]);
          var frame = devices[idx].frame.map(function (seg) { return { a: seg[0], b: seg[1], t0: 0, t1: 0, w: 1 }; });
          drawLines(frame, 1, Math.sin(Math.PI * l) * 0.85, 0, C.accent);
          sliding = Math.max(sliding, smooth(Math.min(1, l / 0.15, (1 - l) / 0.2)));
        });

        var flow = remap(p, tl.green[0], tl.final + 0.04);
        cables.forEach(function (c, k) { drawCable(c, remap(p, tl.cables[k][0], tl.cables[k][1]), time, flow); });

        drawLines(chassisFront, chassisDraw, A.chassis, A.chassisGhost, C.chassis);
        moving.forEach(function (idx) { drawDevice(devices[idx], idx, p, time, paused, active); });

        placeLabels(remap(p, 0.05, 0.16), az, sliding);
      },
    };
  }

  /* =========================================================================
     Page : légendes, progression au défilement, réglage des animations
     ========================================================================= */

  var params = new URLSearchParams(location.search);
  var forced = params.has("p") ? clamp(Number.parseFloat(params.get("p")) || 0) : null;

  var stepsEl = root.querySelector(".rack-steps");
  var items = Array.prototype.slice.call(root.querySelectorAll(".rack-step"));
  var list = items.map(function (li) {
    var kind = li.getAttribute("data-kind");
    return {
      kind: kind,
      units: Number(li.getAttribute("data-units")) || UNITS[kind] || 1,
      title: (li.querySelector(".rack-step-title") || {}).textContent || "",
    };
  });
  var plan = computePlan(list);
  var n = plan.slots.length;

  var els = {
    track: root.querySelector(".rack-track"),
    frame: root.querySelector(".rack-frame"),
    stage: root.querySelector(".rack-stage"),
    canvas: root.querySelector(".rack-canvas"),
    hud: root.querySelector(".rack-hud"),
    caption: root.querySelector(".rack-caption"),
    intro: root.querySelector(".rack-intro"),
    phase: root.querySelector(".rack-hud-live"),
    pct: root.querySelector(".rack-hud-pct"),
    plan: root.querySelector(".rack-hud-plan"),
    pause: root.querySelector(".rack-control"),
    ticks: root.querySelector(".rack-ticks"),
    announce: document.getElementById("rack-annonce"),
    labels: Array.prototype.slice.call(root.querySelectorAll(".rack-dim")),
    toggle: document.getElementById("reglage-animations"),
  };
  if (els.plan) els.plan.textContent = "Plan · rack " + plan.rackU + " U";
  var vLabel = root.querySelector(".rack-dim-v > span");
  if (vLabel) vLabel.textContent = plan.rackU + " U";
  if (els.ticks && !els.ticks.children.length) {
    for (var t = 0; t < n; t++) els.ticks.appendChild(document.createElement("i"));
  }
  var ticks = els.ticks ? Array.prototype.slice.call(els.ticks.children) : [];

  var motion = function () { return document.documentElement.getAttribute("data-motion") === "full" ? "full" : "reduced"; };

  var coarse = window.matchMedia("(pointer: coarse)").matches;
  var low = coarse || window.innerWidth < 720 || (navigator.hardwareConcurrency || 8) <= 4;

  var current = null;

  function setStates(active, isStatic) {
    var shown = Math.min(Math.max(active, 0), n - 1);
    items.forEach(function (li, i) {
      var state = isStatic ? "done" : i < active ? "done" : i === active ? "active" : "todo";
      li.setAttribute("data-state", state);
      if (i === shown && !isStatic) li.setAttribute("data-shown", "");
      else li.removeAttribute("data-shown");
      if (!isStatic && i === active) li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
      if (ticks[i]) ticks[i].setAttribute("data-state", state);
    });
  }

  function say(message) {
    if (!els.announce) return;
    els.announce.textContent = "";
    window.setTimeout(function () { els.announce.textContent = message; }, 30);
  }

  /* Mode statique : animations réduites. Le rack est dessiné assemblé, une seule image. */
  function startStatic() {
    root.classList.remove("is-scroll");
    root.setAttribute("data-final", "");
    setStates(n, true);
    var r = createRenderer(els.canvas, els.canvas.parentNode, plan, {
      low: low,
      labels: els.labels,
      time: 1.3,
      insets: function () { return { top: 8, bottom: 8 }; },
    });
    if (!r) return { stop: function () {} };
    root.classList.add("has-canvas");
    var draw = function () { r.layout(); r.render(1, 0, 0, 0); };
    draw();
    var ro = new ResizeObserver(draw);
    ro.observe(els.canvas.parentNode);
    return { stop: function () { ro.disconnect(); } };
  }

  /* Mode défilement : la piste donne la progression, la scène collante l'affiche. */
  function startScroll() {
    root.classList.add("is-scroll");
    var r = createRenderer(els.canvas, els.stage, plan, {
      low: low,
      labels: els.labels,
      time: forced !== null ? 1.3 : 0,
      insets: function () {
        return { top: (els.hud ? els.hud.offsetHeight : 44) + 22, bottom: (els.caption ? els.caption.offsetHeight : 60) + 10 };
      },
    });
    if (!r) {
      root.classList.remove("is-scroll");
      return startStatic();
    }
    root.classList.add("has-canvas");
    var tl = plan.tl;
    var knot = clamp((tl.starts[0] || 0.19) - 0.015, 0.05, 0.5);
    var geo = { top: 0, height: 1, stickTop: 0, stickH: 1, gate: -Infinity };
    var vw = window.innerWidth, vh = window.innerHeight;
    var raf = 0, last = 0, inView = false, pd = -1;
    var par = { x: 0, y: 0, gx: 0, gy: 0 };
    var lastActive = -2, lastFinal = null, lastK = -1, lastPhase = "", lastPct = -1;
    var announced = false, paused = false;

    function measure() {
      r.layout();
      var rect = els.track.getBoundingClientRect();
      var y = window.scrollY;
      geo.top = rect.top + y;
      geo.height = rect.height;
      var split = getComputedStyle(els.frame).display === "contents";
      var sticky = split ? els.stage : els.frame;
      geo.stickTop = Number.parseFloat(getComputedStyle(sticky).top) || 0;
      geo.stickH = sticky.offsetHeight || window.innerHeight;
      vw = window.innerWidth;
      vh = window.innerHeight;
      // Deux colonnes : les équipements attendent que la première légende soit lisible.
      geo.gate = -Infinity;
      var first = stepsEl.querySelector("li");
      if (split && first) {
        var rowTop = els.intro ? els.intro.getBoundingClientRect().bottom + y : geo.top;
        var inner = first.getBoundingClientRect().bottom - stepsEl.getBoundingClientRect().top;
        geo.gate = rowTop + inner - vh * 0.82;
      }
      wake();
    }

    // 0 quand la scène arrive aux trois quarts de l'écran, 1 quand elle se décolle.
    function goal() {
      if (forced !== null) return forced;
      var y = window.scrollY;
      var lead = geo.stickH * 0.25;
      var y0 = geo.top - geo.stickTop - lead;
      var y1 = geo.top + geo.height - geo.stickH - geo.stickTop;
      var span = Math.max(1, y1 - y0);
      var yk = Math.min(y0 + span * 0.6, Math.max(y0 + span * knot, geo.gate));
      if (y < yk) return clamp((knot * (y - y0)) / Math.max(1, yk - y0));
      return clamp(knot + ((1 - knot) * (y - yk)) / Math.max(1, y1 - yk));
    }

    function ui(p) {
      var a = -1;
      for (var i = 0; i < n; i++) if (p >= tl.starts[i] - 0.012) a = i;
      var fin = p >= tl.final;
      if (fin) a = n;
      if (a !== lastActive) {
        lastActive = a;
        setStates(a, false);
      }
      if (fin !== lastFinal) {
        lastFinal = fin;
        if (fin) root.setAttribute("data-final", "");
        else root.removeAttribute("data-final");
        if (fin && !announced && forced === null) {
          announced = true;
          say("Rack assemblé : les " + n + " équipements sont en ligne. Tout est vert.");
        }
      }
      var k = a >= 0 && a < n ? remap(p, tl.starts[a], tl.lands[a] + tl.boot) : a >= n ? 1 : 0;
      if (Math.abs(k - lastK) > 0.004) {
        lastK = k;
        // Variable posée sur la colonne des légendes seulement : seul ce sous-arbre recalcule ses styles.
        stepsEl.style.setProperty("--k", k.toFixed(3));
      }
      var phase = fin
        ? "Tout est vert"
        : p >= tl.green[0]
          ? "Vérification des voyants"
          : tl.cables.length && p >= tl.cables[0][0]
            ? "Câblage"
            : a >= 0
              ? two(a) + " · " + list[a].title
              : "Châssis et rails";
      if (phase !== lastPhase && els.phase) {
        lastPhase = phase;
        els.phase.textContent = phase;
      }
      var pct = Math.round(p * 100);
      if (pct !== lastPct && els.pct) {
        lastPct = pct;
        els.pct.textContent = pct + " %";
      }
    }

    function tick(now) {
      raf = 0;
      var dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      var g = goal();
      // Lissage indépendant du nombre d'images par seconde ; grand saut = on suit tout de suite.
      if (pd < 0 || Math.abs(g - pd) > 0.25) pd = g;
      else {
        pd += (g - pd) * (1 - Math.exp(-dt * 8));
        if (Math.abs(g - pd) < 0.0005) pd = g;
      }
      var ease = 1 - Math.exp(-dt * 4);
      par.x += (par.gx - par.x) * ease;
      par.y += (par.gy - par.y) * ease;
      var parMoving = Math.abs(par.gx - par.x) + Math.abs(par.gy - par.y) > 0.002;
      ui(pd);
      r.render(pd, forced !== null ? 0 : dt, par.x, par.y);
      // Tant qu'aucun voyant n'est sous tension, rien ne bouge seul : la boucle s'arrête.
      var living = n > 0 && pd >= tl.lands[0];
      var busy = forced === null && (pd !== g || parMoving || (living && !paused));
      if (busy && inView && !document.hidden) raf = requestAnimationFrame(tick);
    }

    function wake() {
      if (raf || !inView || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
    function sleep() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    var io = new IntersectionObserver(function (entries) {
      inView = entries.some(function (e) { return e.isIntersecting; });
      if (inView) measure();
      else sleep();
    }, { rootMargin: "80px 0px" });
    io.observe(root);

    var onScroll = function () { wake(); };
    var onVisibility = function () { if (document.hidden) sleep(); else wake(); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    var ro = new ResizeObserver(measure);
    ro.observe(els.track);
    ro.observe(document.documentElement);

    // Parallaxe : souris uniquement, jamais au doigt.
    var fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches && forced === null;
    var onPointer = function (event) {
      if (event.pointerType !== "mouse") return;
      par.gx = clamp((event.clientX / vw) * 2 - 1, -1, 1);
      par.gy = clamp((event.clientY / vh) * 2 - 1, -1, 1);
      wake();
    };
    if (fine) window.addEventListener("pointermove", onPointer, { passive: true });

    var onPause = function () {
      paused = !paused;
      r.setPaused(paused);
      if (paused) root.setAttribute("data-paused", "");
      else root.removeAttribute("data-paused");
      els.pause.textContent = paused ? "Reprendre" : "Pause";
      say(paused ? "Voyants figés." : "Voyants de nouveau animés.");
      wake();
    };
    if (els.pause && forced === null) {
      els.pause.hidden = false;
      els.pause.addEventListener("click", onPause);
    }

    measure();
    if (forced !== null) {
      inView = true;
      pd = forced;
      ui(forced);
      r.render(forced, 0, 0, 0);
    }

    return {
      stop: function () {
        sleep();
        io.disconnect();
        ro.disconnect();
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", measure);
        document.removeEventListener("visibilitychange", onVisibility);
        if (fine) window.removeEventListener("pointermove", onPointer);
        if (els.pause) {
          els.pause.removeEventListener("click", onPause);
          els.pause.hidden = true;
        }
        root.removeAttribute("data-paused");
      },
      isStuck: function () {
        var y = window.scrollY;
        return y >= geo.top - geo.stickTop - geo.stickH * 0.25 && y <= geo.top + geo.height - geo.stickH - geo.stickTop;
      },
    };
  }

  function start() {
    if (current) current.stop();
    root.removeAttribute("data-final");
    current = motion() === "full" ? startScroll() : startStatic();
  }

  /* Réglage « Animations » de la page : auto (préférence du système), activées, réduites. */
  function label() {
    if (!els.toggle) return;
    els.toggle.textContent = "Animations : " + (motion() === "full" ? "activées" : "réduites");
    els.toggle.setAttribute("aria-pressed", motion() === "full" ? "true" : "false");
  }
  if (els.toggle) {
    els.toggle.addEventListener("click", function () {
      var next = motion() === "full" ? "reduced" : "full";
      var wasStuck = current && current.isStuck && current.isStuck();
      try { localStorage.setItem("rack-motion", next); } catch (e) { /* stockage bloqué : appliqué pour cette page seulement */ }
      document.documentElement.setAttribute("data-motion", next);
      label();
      start();
      // La piste disparaît d'un coup : si on était dans le rack, on revient à son début.
      if (next === "reduced" && wasStuck) root.scrollIntoView({ block: "start" });
    });
  }

  label();
  start();
})();
