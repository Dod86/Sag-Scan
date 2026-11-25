/* Scanner di sagome: linee deboli, bordo del cartone, zona chiusa. Usa window.Core. */
(function (root) {
  'use strict';
  var C = root.Core;

  // ---------- rettifica a colori ----------
  function rectifyRGB(rgba, iw, ih, Hwi, x0, y0, mmpp, W, H, lens) {
    var n = W * H, R = new Uint8Array(n), G = new Uint8Array(n), B = new Uint8Array(n), valid = new Uint8Array(n), lk = lens && lens.k1 ? lens : null;
    for (var j = 0; j < H; j++) {
      var wy = y0 + (j + 0.5) * mmpp;
      for (var i = 0; i < W; i++) {
        var wx = x0 + (i + 0.5) * mmpp, o = j * W + i;
        var w = Hwi[6] * wx + Hwi[7] * wy + Hwi[8];
        var sx = (Hwi[0] * wx + Hwi[1] * wy + Hwi[2]) / w, sy = (Hwi[3] * wx + Hwi[4] * wy + Hwi[5]) / w;
        if (lk) { var ux = (sx - lk.cx) / lk.sc, uy = (sy - lk.cy) / lk.sc, dd = 1 + lk.k1 * (ux * ux + uy * uy); sx = lk.cx + ux * dd * lk.sc; sy = lk.cy + uy * dd * lk.sc; }
        if (!(sx >= 0 && sy >= 0 && sx < iw - 1 && sy < ih - 1)) { R[o] = G[o] = B[o] = 128; continue; }
        valid[o] = 1;
        var xi = sx | 0, yi = sy | 0, fx = sx - xi, fy = sy - yi, p = (yi * iw + xi) * 4, q = p + iw * 4;
        var w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        R[o] = rgba[p] * w00 + rgba[p + 4] * w10 + rgba[q] * w01 + rgba[q + 4] * w11;
        G[o] = rgba[p + 1] * w00 + rgba[p + 5] * w10 + rgba[q + 1] * w01 + rgba[q + 5] * w11;
        B[o] = rgba[p + 2] * w00 + rgba[p + 6] * w10 + rgba[q + 2] * w01 + rgba[q + 6] * w11;
      }
    }
    return { R: R, G: G, B: B, valid: valid };
  }
  // canale "grigio": cancella il colore delle stampe (es. rosso) e lascia matita, penna, pennarello
  function solve3(A, b) {
    var a = A[0][0], bb = A[0][1], c = A[0][2], d = A[1][0], e = A[1][1], f = A[1][2], g = A[2][0], h = A[2][1], k = A[2][2];
    var det = a * (e * k - f * h) - bb * (d * k - f * g) + c * (d * h - e * g);
    if (Math.abs(det) < 1e-15) return null;
    var inv = [[e * k - f * h, c * h - bb * k, bb * f - c * e], [f * g - d * k, a * k - c * g, c * d - a * f], [d * h - e * g, bb * g - a * h, a * e - bb * d]];
    return [0, 1, 2].map(function (r) { return (inv[r][0] * b[0] + inv[r][1] * b[1] + inv[r][2] * b[2]) / det; });
  }
  function inkFreeChannel(c, W, H, mmpp, skip) {
    var n = W * H, i, LUT = new Float32Array(256);
    for (i = 0; i < 256; i++) LUT[i] = Math.log(i + 4);
    var L = [c.R, c.G, c.B].map(function (ch) { var a = new Float32Array(n); for (var k = 0; k < n; k++) a[k] = LUT[ch[k]]; return a; });
    var f = 4, Ws = Math.ceil(W / f), Hs = Math.ceil(H / f);
    var bgS = L.map(function (a) {
      var sm = new Float32Array(Ws * Hs), cnt = new Float32Array(Ws * Hs);
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) { var q = ((y / f) | 0) * Ws + ((x / f) | 0); sm[q] += a[y * W + x]; cnt[q]++; }
      for (var q2 = 0; q2 < sm.length; q2++) sm[q2] /= cnt[q2] || 1;
      return blur(sm, Ws, Hs, Math.max(1, 4 / mmpp / f));
    });
    var bg = bgS.map(function (b) { return { at: function (k) { var x = k % W, y = (k / W) | 0; return b[((y / f) | 0) * Ws + ((x / f) | 0)]; } }; });
    var g = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)], samp = [], step = Math.max(1, Math.floor(n / 150000));
    for (i = 0; i < n; i += step) {
      if (skip[i]) continue;
      var d = [L[0][i] - bg[0].at(i), L[1][i] - bg[1].at(i), L[2][i] - bg[2].at(i)], m = (d[0] + d[1] + d[2]) / 3;
      var ch = [d[0] - m, d[1] - m, d[2] - m], cm = Math.hypot(ch[0], ch[1], ch[2]);
      if (m < -0.04) samp.push({ d: d, cm: cm, i: i });
    }
    var w = g;
    if (samp.length > 200) {
      samp.sort(function (a, b) { return b.cm - a.cm; });
      var top = samp.slice(0, Math.max(50, Math.floor(samp.length * 0.25)));
      // è davvero una stampa colorata? (chiara e satura; pennarelli e matita sono scuri o grigi)
      var mr = 0, mg = 0, mb = 0;
      top.forEach(function (t) { mr += c.R[t.i]; mg += c.G[t.i]; mb += c.B[t.i]; });
      mr /= top.length; mg /= top.length; mb /= top.length;
      var vmax = Math.max(mr, mg, mb), sat = vmax ? (vmax - Math.min(mr, mg, mb)) / vmax : 0;
      if (root.DEBUG_INK) console.log('stampa: colore medio', Math.round(mr), Math.round(mg), Math.round(mb), 'saturazione', sat.toFixed(2));
      if (vmax < 90 || sat < 0.3) top = [];
      // pesi che annullano le macchie colorate: min sum (w.d)^2 con w.(1,1,1) = 1
      if (!top.length) return finish(g);
      var M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      top.forEach(function (t) { for (var r = 0; r < 3; r++) for (var q = 0; q < 3; q++) M[r][q] += t.d[r] * t.d[q]; });
      var tr = (M[0][0] + M[1][1] + M[2][2]) / 3;
      for (var r2 = 0; r2 < 3; r2++) M[r2][r2] += 0.03 * tr;
      var sol = solve3(M, [1, 1, 1]);
      if (sol) {
        var sm = sol[0] + sol[1] + sol[2];
        var cand = [sol[0] / sm, sol[1] / sm, sol[2] / sm];
        // guadagno sul grigio vs sulle stampe
        var gainInk = 0, gainGray = 0;
        top.forEach(function (t) { gainInk += Math.abs(cand[0] * t.d[0] + cand[1] * t.d[1] + cand[2] * t.d[2]); gainGray += Math.abs((t.d[0] + t.d[1] + t.d[2]) / 3); });
        if (root.DEBUG_INK) console.log('pesi', cand.map(function (x) { return x.toFixed(2); }).join(' '), 'stampa residua', (gainInk / gainGray).toFixed(2));
        if (gainInk < 0.6 * gainGray && Math.max.apply(0, cand.map(Math.abs)) < 4) w = cand;
      }
    }
    return finish(w);
    function finish(w) {
      var ws = w[0] + w[1] + w[2], out = new Float32Array(n);
      for (var k = 0; k < n; k++) out[k] = Math.exp((w[0] * L[0][k] + w[1] * L[1][k] + w[2] * L[2][k]) / ws) - 4;
      return { v: out, w: w.map(function (x) { return x / ws; }) };
    }
  }

  function prepare2(o) {
    var Hwi = o.Hwi || C.homography(o.world, o.imgPts);
    if (!Hwi) return { error: 'I 4 riferimenti sono allineati o coincidenti.' };
    var imgPts = o.imgPts || o.world.map(function (q) { return C.applyH(Hwi, q.x, q.y); });
    var xs = o.world.map(function (p) { return p.x; }), ys = o.world.map(function (p) { return p.y; });
    var x0 = Math.min.apply(0, xs), x1 = Math.max.apply(0, xs), y0 = Math.min.apply(0, ys), y1 = Math.max.apply(0, ys);
    var mg = 0.25 * Math.max(x1 - x0, y1 - y0) + 60;
    x0 -= mg; y0 -= mg; x1 += mg; y1 += mg;
    var photoRes = (C.dist(o.world[0], o.world[2]) / C.dist(imgPts[0], imgPts[2]) + C.dist(o.world[1], o.world[3]) / C.dist(imgPts[1], imgPts[3])) / 2;
    var mmpp = Math.max(0.4, photoRes * 0.9, Math.max(x1 - x0, y1 - y0) / (o.maxPx || 2400));
    var W = Math.ceil((x1 - x0) / mmpp), H = Math.ceil((y1 - y0) / mmpp);
    var c = rectifyRGB(o.rgba, o.iw, o.ih, Hwi, x0, y0, mmpp, W, H, o.lens), n = W * H;
    var R = { Hwi: Hwi, x0: x0, y0: y0, mmpp: mmpp, W: W, H: H, valid: c.valid, photoRes: photoRes, world: o.world };
    // fogli dei marker: esclusi dalla ricerca delle linee
    R.sheet = new Uint8Array(n);
    (o.erasePolys || []).forEach(function (P) { fillPoly(R.sheet, W, H, P.map(function (q) { return toPx(R, q); }), 1); });
    R.s = new Uint8Array(n); R.g = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var mx = Math.max(c.R[i], c.G[i], c.B[i]), mn = Math.min(c.R[i], c.G[i], c.B[i]);
      R.s[i] = mx > 1 ? 255 * (mx - mn) / mx : 0; R.g[i] = (c.R[i] * 0.3 + c.G[i] * 0.59 + c.B[i] * 0.11);
    }
    var skip = new Uint8Array(n); for (i = 0; i < n; i++) skip[i] = (!c.valid[i] || R.sheet[i] || R.s[i] < 25) ? 1 : 0; // stima sull'area colorata (cartone)
    var ink = inkFreeChannel(c, W, H, mmpp, skip);
    R.v = ink.v; R.inkW = ink.w;
    return R;
  }
  function toPx(R, q) { return { x: (q.x - R.x0) / R.mmpp - 0.5, y: (q.y - R.y0) / R.mmpp - 0.5 }; }
  function toMm(R, p) { return { x: R.x0 + (p.x + 0.5) * R.mmpp, y: R.y0 + (p.y + 0.5) * R.mmpp }; }
  function fillPoly(m, W, H, P, val) {
    var y0 = H, y1 = 0;
    P.forEach(function (q) { y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); });
    y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(H - 1, Math.ceil(y1));
    for (var y = y0; y <= y1; y++) {
      var xs = [];
      for (var i = 0, j = P.length - 1; i < P.length; j = i++)
        if ((P[i].y > y) !== (P[j].y > y)) xs.push((P[j].x - P[i].x) * (y - P[i].y) / (P[j].y - P[i].y) + P[i].x);
      xs.sort(function (a, b) { return a - b; });
      for (var k = 0; k + 1 < xs.length; k += 2)
        for (var x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(W - 1, Math.floor(xs[k + 1])); x++) m[y * W + x] = val;
    }
  }

  // ---------- sfocatura gaussiana separabile ----------
  function blur(src, W, H, sg) {
    var r = Math.max(1, Math.ceil(3 * sg)), k = new Float32Array(2 * r + 1), s = 0, i;
    for (i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * sg * sg)); s += k[i + r]; }
    for (i = 0; i < k.length; i++) k[i] /= s;
    var tmp = new Float32Array(W * H), out = new Float32Array(W * H), x, y, t, acc;
    for (y = 0; y < H; y++) {
      var row = y * W;
      for (x = 0; x < W; x++) {
        acc = 0;
        for (t = -r; t <= r; t++) { var xx = x + t; xx = xx < 0 ? 0 : xx >= W ? W - 1 : xx; acc += src[row + xx] * k[t + r]; }
        tmp[row + x] = acc;
      }
    }
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      acc = 0;
      for (t = -r; t <= r; t++) { var yy = y + t; yy = yy < 0 ? 0 : yy >= H ? H - 1 : yy; acc += tmp[yy * W + x] * k[t + r]; }
      out[y * W + x] = acc;
    }
    return out;
  }

  // ---------- bordo del cartone (colore) ----------
  function findCard(R) {
    var W = R.W, H = R.H, n = W * H, m = new Uint8Array(n), i;
    for (i = 0; i < n; i++) m[i] = (R.valid[i] && !R.sheet[i] && R.s[i] > 40 && R.v[i] > 60) ? 1 : 0;
    // chiusura: riempie scritte e graffi
    var rad = Math.max(2, Math.round(6 / R.mmpp)), inv = new Uint8Array(n);
    for (i = 0; i < n; i++) inv[i] = m[i] ? 0 : 1;
    var d1 = C.edt(inv, W, H), m2 = new Uint8Array(n);
    for (i = 0; i < n; i++) m2[i] = (m[i] || d1[i] <= rad) ? 1 : 0;
    var d2 = C.edt(m2, W, H);
    for (i = 0; i < n; i++) m[i] = (m2[i] && d2[i] > rad) ? 1 : 0;
    // componente più grande
    var lab = new Int32Array(n), st = new Int32Array(n), best = 0, bestN = 0, id = 0;
    for (i = 0; i < n; i++) {
      if (!m[i] || lab[i]) continue;
      id++; var sp = 0, cnt = 0; st[sp++] = i; lab[i] = id;
      while (sp) {
        var p = st[--sp], x = p % W; cnt++;
        if (x > 0 && m[p - 1] && !lab[p - 1]) { lab[p - 1] = id; st[sp++] = p - 1; }
        if (x < W - 1 && m[p + 1] && !lab[p + 1]) { lab[p + 1] = id; st[sp++] = p + 1; }
        if (p >= W && m[p - W] && !lab[p - W]) { lab[p - W] = id; st[sp++] = p - W; }
        if (p < n - W && m[p + W] && !lab[p + W]) { lab[p + W] = id; st[sp++] = p + W; }
      }
      if (cnt > bestN) { bestN = cnt; best = id; }
    }
    if (bestN < 0.05 * n) return null;
    // involucro convesso dei pixel di bordo
    var pts = [];
    for (var y = 0; y < H; y++) {
      var a = -1, b = -1;
      for (var x = 0; x < W; x++) if (lab[y * W + x] === best) { if (a < 0) a = x; b = x; }
      if (a >= 0) { pts.push({ x: a - 0.5, y: y }); pts.push({ x: b + 0.5, y: y }); }
    }
    var hull = convexHull(pts);
    var ha = Math.abs(C.area(hull));
    if (bestN < 0.6 * ha) return null;          // forma troppo irregolare: probabilmente non è il cartone
    var touch = 0;
    hull.forEach(function (q) { if (q.x < 2 || q.y < 2 || q.x > W - 3 || q.y > H - 3) touch++; });
    if (touch > hull.length / 2) return null;
    hull = simplifyHull(hull, 1.5);
    var quad = fitQuad(hull, ha);
    if (quad) hull = quad;
    var mask = new Uint8Array(n);
    fillPoly(mask, W, H, hull, 1);
    return { hull: hull, mask: mask, area: Math.abs(C.area(hull)), quad: !!quad };
  }
  // cartone rettangolare: ricostruisce i 4 lati anche se un angolo è coperto da un foglio
  function fitQuad(h, ha) {
    if (h.length < 4) return null;
    var e = h.map(function (p, i) { var q = h[(i + 1) % h.length]; return { i: i, a: p, b: q, len: C.dist(p, q) }; });
    var top = e.slice().sort(function (x, y) { return y.len - x.len; }).slice(0, 4).sort(function (x, y) { return x.i - y.i; });
    var per = e.reduce(function (s, x) { return s + x.len; }, 0), cov = top.reduce(function (s, x) { return s + x.len; }, 0);
    if (cov < 0.7 * per) return null;
    var Q = [];
    for (var k = 0; k < 4; k++) {
      var A = top[k], B = top[(k + 1) % 4];
      var X = lineXY(A.a, A.b, B.a, B.b); if (!X) return null;
      Q.push(X);
    }
    var qa = Math.abs(C.area(Q));
    if (qa < ha * 0.98 || qa > ha * 1.12) return null;
    return Q;
  }
  function lineXY(a, b, c, d) {
    var r = { x: b.x - a.x, y: b.y - a.y }, s2 = { x: d.x - c.x, y: d.y - c.y }, den = r.x * s2.y - r.y * s2.x;
    if (Math.abs(den) < 1e-9) return null;
    var t = ((c.x - a.x) * s2.y - (c.y - a.y) * s2.x) / den;
    return { x: a.x + t * r.x, y: a.y + t * r.y };
  }
  function convexHull(P) {
    P = P.slice().sort(function (a, b) { return a.x - b.x || a.y - b.y; });
    function cr(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
    var lo = [], up = [], i;
    for (i = 0; i < P.length; i++) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], P[i]) <= 0) lo.pop(); lo.push(P[i]); }
    for (i = P.length - 1; i >= 0; i--) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], P[i]) <= 0) up.pop(); up.push(P[i]); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function simplifyHull(P, tol) {
    var out = P.slice(), changed = true;
    while (changed && out.length > 3) {
      changed = false;
      for (var i = 0; i < out.length; i++) {
        var a = out[(i + out.length - 1) % out.length], b = out[i], c = out[(i + 1) % out.length];
        var L = C.dist(a, c) || 1, d = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / L;
        if (d < tol) { out.splice(i, 1); changed = true; break; }
      }
    }
    return out;
  }

  // ---------- linee: creste scure multi-scala ----------
  function findLines(R, sens, card) {
    var W = R.W, H = R.H, n = W * H, i, x, y;
    var v = R.v;
    var resp = new Float32Array(n), ndx = new Float32Array(n), ndy = new Float32Array(n), scl = new Uint8Array(n);
    var s0 = Math.max(0.8, 0.45 / R.mmpp), scales = [s0, s0 * 1.8, s0 * 3.2];
    scales.forEach(function (sg, si) {
      var b = blur(v, W, H, sg), norm = Math.pow(sg, 1.5);
      for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) {
        var p = y * W + x, c = b[p];
        var ixx = b[p - 1] - 2 * c + b[p + 1], iyy = b[p - W] - 2 * c + b[p + W];
        var ixy = (b[p + W + 1] - b[p + W - 1] - b[p - W + 1] + b[p - W - 1]) / 4;
        var tr = (ixx + iyy) / 2, d = Math.sqrt((ixx - iyy) * (ixx - iyy) / 4 + ixy * ixy), l1 = tr + d, l2 = tr - d;
        if (l1 <= 0) continue;
        var r = norm * (l1 - Math.max(l2, 0));   // linea scura: forte curvatura in una sola direzione
        if (r > resp[p]) {
          resp[p] = r; scl[p] = si;
          var ex = ixy, ey = l1 - ixx, el = Math.hypot(ex, ey);
          if (el < 1e-9) { ex = 1; ey = 0; el = 1; }
          ndx[p] = ex / el; ndy[p] = ey / el;
        }
      }
    });
    // zone escluse: fogli dei marker, fuori dal cartone (con margine)
    var excl = new Uint8Array(n);
    for (i = 0; i < n; i++) excl[i] = (!R.valid[i] || R.sheet[i]) ? 1 : 0;
    if (card) {
      var outC = new Uint8Array(n);
      for (i = 0; i < n; i++) outC[i] = card.mask[i] ? 0 : 1;
      var din = C.edt(card.mask, W, H), mgn = 8 / R.mmpp;
      for (i = 0; i < n; i++) if (!card.mask[i] || din[i] < mgn) excl[i] = 1;   // il bordo vero lo dà il cartone
    }
    // soglia robusta: rumore stimato dalla mediana
    var sample = [], step = Math.max(1, Math.floor(n / 200000));
    for (i = 0; i < n; i += step) if (!excl[i]) sample.push(resp[i]);
    sample.sort(function (a, b) { return a - b; });
    var med = sample[Math.floor(sample.length * 0.5)] || 0, q75 = sample[Math.floor(sample.length * 0.75)] || 1;
    var noise = Math.max(1e-3, (q75 - med) * 1.48);
    var hi = med + sens * noise, lo = med + 0.45 * sens * noise;
    // soppressione dei non massimi lungo la normale
    var keep = new Uint8Array(n);
    for (y = 2; y < H - 2; y++) for (x = 2; x < W - 2; x++) {
      var p2 = y * W + x, rv = resp[p2];
      if (rv < lo || excl[p2]) continue;
      var ux = ndx[p2], uy = ndy[p2];
      var r1 = bilR(resp, W, x + ux, y + uy), r2 = bilR(resp, W, x - ux, y - uy);
      if (rv >= r1 && rv >= r2) keep[p2] = rv >= hi ? 2 : 1;
    }
    // isteresi
    var st = new Int32Array(n), sp = 0, on = new Uint8Array(n);
    for (i = 0; i < n; i++) if (keep[i] === 2) { on[i] = 1; st[sp++] = i; }
    while (sp) {
      var q = st[--sp], qx = q % W;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var xx2 = qx + dx; if (xx2 < 0 || xx2 >= W) continue;
        var r2 = q + dy * W + dx; if (r2 < 0 || r2 >= n) continue;
        if (keep[r2] && !on[r2]) { on[r2] = 1; st[sp++] = r2; }
      }
    }
    R.resp = resp; R.noise = noise; R.respMed = med;
    if (root.DEBUG_LINES) root.DEBUG_LINES.on = on.slice(), root.DEBUG_LINES.resp = resp, root.DEBUG_LINES.thr = [lo, hi];
    thin(on, W, H);
    prune(on, W, H, Math.max(4, 6 / R.mmpp));
    var chains = traceChains(on, W, H);
    if (root.DEBUG_LINES) root.DEBUG_LINES.raw = chains.slice();
    var mmp = R.mmpp;
    chains = linkChains(chains, Math.max(3, 5 / mmp), Math.max(2, 2.5 / mmp), 0.7, 0.5);
    chains = linkChains(chains, Math.max(4, 12 / mmp), Math.max(2, 2.5 / mmp), 0.8, 0.65);
    chains = linkChains(chains, Math.max(6, 22 / mmp), Math.max(2, 2.5 / mmp), 0.88, 0.8);
    if (root.DEBUG_LINES) root.DEBUG_LINES.linked = chains.slice();
    var minLen = 80 / R.mmpp;
    var out = chains.filter(function (c) { return c.len >= minLen; }).map(function (c) {
      var sw = 0;
      c.pts.forEach(function (p) { sw += scales[scl[Math.round(p.y) * W + Math.round(p.x)]] || s0; });
      var straight = c.closed ? 0 : C.dist(c.pts[0], c.pts[c.pts.length - 1]) / c.len;
      var rs = 0; c.pts.forEach(function (p) { rs += resp[Math.round(p.y) * W + Math.round(p.x)]; });
      return { pts: c.pts, closed: c.closed, lenMm: c.len * R.mmpp, wPx: 2 * sw / c.pts.length, straight: straight, contrast: rs / c.pts.length / noise };
    });
    out.sort(function (a, b) { return b.lenMm - a.lenMm; });
    if (root.DEBUG_LINES) root.DEBUG_LINES.all = out.slice();
    out = out.slice(0, 16);
    out.forEach(function (c, k) { c.id = k + 1; });
    return out;
  }
  function bilR(a, W, x, y) {
    var x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i = y0 * W + x0;
    return (a[i] * (1 - fx) + a[i + 1] * fx) * (1 - fy) + (a[i + W] * (1 - fx) + a[i + W + 1] * fx) * fy;
  }
  // assottigliamento Zhang-Suen sui soli pixel accesi
  function thin(m, W, H) {
    var list = [];
    for (var i = 0; i < W * H; i++) if (m[i]) list.push(i);
    var changed = true, it = 0;
    function nb(p) {
      return [m[p - W], m[p - W + 1], m[p + 1], m[p + W + 1], m[p + W], m[p + W - 1], m[p - 1], m[p - W - 1]];
    }
    while (changed && it++ < 20) {
      changed = false;
      for (var pass = 0; pass < 2; pass++) {
        var del = [];
        for (var k = 0; k < list.length; k++) {
          var p = list[k]; if (!m[p]) continue;
          var x = p % W, y = (p / W) | 0; if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) { m[p] = 0; continue; }
          var P = nb(p), B = 0, A = 0;
          for (var j = 0; j < 8; j++) { B += P[j] ? 1 : 0; if (!P[j] && P[(j + 1) % 8]) A++; }
          if (B < 2 || B > 6 || A !== 1) continue;
          if (pass === 0 ? (P[0] && P[2] && P[4]) || (P[2] && P[4] && P[6]) : (P[0] && P[2] && P[6]) || (P[0] && P[4] && P[6])) continue;
          del.push(p);
        }
        del.forEach(function (p) { m[p] = 0; });
        if (del.length) changed = true;
      }
      list = list.filter(function (p) { return m[p]; });
    }
  }
  // toglie i rametti corti attaccati agli incroci (rumore), così le linee non deviano
  function prune(m, W, H, maxLen) {
    var n = W * H, pix = [];
    for (var i = 0; i < n; i++) if (m[i]) pix.push(i);
    function nb(p) {
      var x = p % W, r = [];
      for (var k = 0; k < 8; k++) { var xx = x + N8[k][0]; if (xx < 0 || xx >= W) continue; var q = p + N8[k][1] * W + N8[k][0]; if (q >= 0 && q < n && m[q]) r.push(q); }
      return r;
    }
    for (var pass = 0; pass < 2; pass++) {
      pix.forEach(function (p) {
        if (!m[p] || nb(p).length !== 1) return;
        var path = [p], prev = -1, cur = p, ok = false;
        while (path.length <= maxLen) {
          var ns = nb(cur).filter(function (q) { return q !== prev && path.indexOf(q) < 0; });
          if (ns.length === 0) break;            // tratto isolato: non è un rametto
          if (ns.length > 1 || nb(ns[0]).length > 2) { ok = true; break; }   // arrivato a un incrocio
          prev = cur; cur = ns[0]; path.push(cur);
        }
        if (ok) path.forEach(function (q) { m[q] = 0; });
      });
    }
  }
  var N8 = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  function traceChains(m, W, H) {
    var n = W * H, deg = new Uint8Array(n), i, k;
    var pix = [];
    for (i = 0; i < n; i++) if (m[i]) pix.push(i);
    // numero di attraversamenti: gli scalini diagonali non sono incroci
    pix.forEach(function (p) {
      var x = p % W, v = [];
      for (k = 0; k < 8; k++) { var xx = x + N8[k][0], q = p + N8[k][1] * W + N8[k][0]; v.push(xx >= 0 && xx < W && q >= 0 && q < n && m[q] ? 1 : 0); }
      var A = 0; for (k = 0; k < 8; k++) if (!v[k] && v[(k + 1) % 8]) A++;
      deg[p] = A;
    });
    // tolgo gli incroci: restano tratti semplici
    pix.forEach(function (p) { if (deg[p] > 2) m[p] = 0; });
    var seen = new Uint8Array(n), chains = [];
    function nbrs(p) {
      var x = p % W, r = [];
      for (var k = 0; k < 8; k++) { var xx = x + N8[k][0]; if (xx < 0 || xx >= W) continue; var q = p + N8[k][1] * W + N8[k][0]; if (q >= 0 && q < n && m[q]) r.push(q); }
      return r;
    }
    function walk(start) {
      var pts = [], cur = start, prev = -1;
      while (cur >= 0 && !seen[cur]) {
        seen[cur] = 1; pts.push({ x: cur % W, y: (cur / W) | 0 });
        var nx = -1, ns = nbrs(cur);
        for (var j = 0; j < ns.length; j++) if (ns[j] !== prev && !seen[ns[j]]) { nx = ns[j]; break; }
        prev = cur; cur = nx;
      }
      return pts;
    }
    function cross(p) {
      var x = p % W, v = [];
      for (var k = 0; k < 8; k++) { var xx = x + N8[k][0], q = p + N8[k][1] * W + N8[k][0]; v.push(xx >= 0 && xx < W && q >= 0 && q < n && m[q] ? 1 : 0); }
      var A = 0; for (k = 0; k < 8; k++) if (!v[k] && v[(k + 1) % 8]) A++;
      return A;
    }
    pix.forEach(function (p) { if (m[p] && !seen[p] && (nbrs(p).length <= 1 || cross(p) <= 1)) { var pts = walk(p); if (pts.length >= 3) chains.push({ pts: pts, closed: false }); } });
    pix.forEach(function (p) {
      if (m[p] && !seen[p]) {
        var pts = walk(p); if (pts.length < 3) return;
        var a = pts[0], b = pts[pts.length - 1];
        chains.push({ pts: pts, closed: pts.length >= 6 && Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 });
      }
    });
    chains.forEach(function (c) { c.len = plen(c.pts, c.closed); });
    return chains;
  }
  function plen(P, closed) {
    var s = 0;
    for (var i = 1; i < P.length; i++) s += C.dist(P[i - 1], P[i]);
    if (closed && P.length > 2) s += C.dist(P[P.length - 1], P[0]);
    return s;
  }
  // collega i tratti attraverso piccole interruzioni, rispettando la direzione
  function linkChains(chains, gap, tiny, minC, minC3) {
    minC = minC || 0.8; minC3 = minC3 || 0.6;
    var ends = [];
    chains.forEach(function (c, ci) {
      if (c.closed || c.pts.length < 2) return;
      [0, 1].forEach(function (e) {
        var P = c.pts, L = P.length, k = Math.min(10, L - 1);
        var a = e ? P[L - 1] : P[0], b = e ? P[L - 1 - k] : P[k];
        var dx = a.x - b.x, dy = a.y - b.y, dl = Math.hypot(dx, dy) || 1;
        ends.push({ c: ci, e: e, p: a, d: { x: dx / dl, y: dy / dl }, used: false });
      });
    });
    // griglia per cercare vicini
    var cell = Math.max(4, gap), grid = new Map();
    ends.forEach(function (E, i) { var k = Math.floor(E.p.x / cell) + ',' + Math.floor(E.p.y / cell); var l = grid.get(k); if (l) l.push(i); else grid.set(k, [i]); });
    var pairs = [];
    ends.forEach(function (A, i) {
      var gx = Math.floor(A.p.x / cell), gy = Math.floor(A.p.y / cell);
      for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
        var l = grid.get((gx + dx) + ',' + (gy + dy)); if (!l) continue;
        l.forEach(function (j) {
          if (j <= i) return; var B = ends[j]; if (B.c === A.c) return;
          var vx = B.p.x - A.p.x, vy = B.p.y - A.p.y, d = Math.hypot(vx, vy);
          if (d > gap) return;
          var c1 = 1, c2 = 1;
          if (d > 0.5) { c1 = (A.d.x * vx + A.d.y * vy) / d; c2 = -(B.d.x * vx + B.d.y * vy) / d; }
          var c3 = -(A.d.x * B.d.x + A.d.y * B.d.y);
          if (d > tiny && (c1 < minC || c2 < minC)) return;
          if (c3 < (d > tiny ? minC3 : 0.5)) return;
          pairs.push({ i: i, j: j, cost: d * (3.2 - c1 - c2 - c3) + 0.1 * d });
        });
      }
    });
    pairs.sort(function (a, b) { return a.cost - b.cost; });
    var link = new Map(); // chiave estremo -> estremo collegato
    var par = chains.map(function (_, i) { return i; });
    function f(a) { while (par[a] !== a) a = par[a] = par[par[a]]; return a; }
    pairs.forEach(function (pr) {
      var A = ends[pr.i], B = ends[pr.j]; if (A.used || B.used) return;
      A.used = B.used = true; link.set(A.c * 2 + A.e, B.c * 2 + B.e); link.set(B.c * 2 + B.e, A.c * 2 + A.e);
      par[f(A.c)] = f(B.c);
    });
    // ricompone le sequenze
    var done = new Uint8Array(chains.length), out = [];
    chains.forEach(function (c, ci) {
      if (done[ci]) return;
      if (c.closed) { done[ci] = 1; out.push(c); return; }
      // trova un capo libero risalendo
      var start = ci, se = 0, guard = 0;
      while (guard++ < chains.length) {
        var other = link.get(start * 2 + se); if (other == null) break;
        var oc = other >> 1, oe = other & 1;
        if (oc === ci && guard > 1) { start = ci; se = 0; break; }
        start = oc; se = 1 - oe;
        if (start === ci) break;
      }
      var pts = [], cur = start, ce = se, closed = false, g2 = 0;
      while (g2++ <= chains.length) {
        if (done[cur]) { closed = cur === start && ce === se; break; }
        done[cur] = 1;
        var P = chains[cur].pts;
        pts = pts.concat(ce === 0 ? P : P.slice().reverse());
        var nxt = link.get(cur * 2 + (1 - ce)); if (nxt == null) break;
        cur = nxt >> 1; ce = nxt & 1;
      }
      out.push({ pts: pts, closed: closed, len: plen(pts, closed) });
    });
    return out;
  }

  // ---------- tracciamento a mano: segue la linea tra i punti toccati ----------
  function snap(R, p, radMm) {
    var r = Math.round(radMm / R.mmpp), best = null, bv = -1, W = R.W;
    for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      var x = Math.round(p.x) + dx, y = Math.round(p.y) + dy;
      if (x < 1 || y < 1 || x >= W - 1 || y >= R.H - 1) continue;
      var v = R.resp[y * W + x] - 0.02 * (dx * dx + dy * dy);
      if (v > bv) { bv = v; best = { x: x, y: y }; }
    }
    return best || { x: Math.round(p.x), y: Math.round(p.y) };
  }
  function tracePath(R, a, b, allow, edge) {
    var W = R.W, H = R.H, pad = Math.round(Math.max(30 / R.mmpp, 0.25 * Math.hypot(b.x - a.x, b.y - a.y)));
    var x0 = Math.max(1, Math.min(a.x, b.x) - pad), x1 = Math.min(W - 2, Math.max(a.x, b.x) + pad);
    var y0 = Math.max(1, Math.min(a.y, b.y) - pad), y1 = Math.min(H - 2, Math.max(a.y, b.y) + pad);
    var bw = x1 - x0 + 1, bh = y1 - y0 + 1, nb = bw * bh;
    var dist = new Float32Array(nb).fill(Infinity), prev = new Int32Array(nb).fill(-1), done = new Uint8Array(nb);
    var T = R.noise * 1.2;
    function cost(x, y) {
      var q = y * W + x;
      if (allow && !allow[q]) return 1e6;
      if (edge && edge[q]) return 0.3;
      var r = R.resp[q] - R.respMed; return Math.max(0.3, Math.exp(-Math.max(0, r) / T));
    }
    var heap = [], hv = [];
    function push(i, v) { heap.push(i); hv.push(v); var k = heap.length - 1; while (k > 0) { var p = (k - 1) >> 1; if (hv[p] <= hv[k]) break; var t = heap[p]; heap[p] = heap[k]; heap[k] = t; t = hv[p]; hv[p] = hv[k]; hv[k] = t; k = p; } }
    function pop() { var top = heap[0], last = heap.pop(), lv = hv.pop(); if (heap.length) { heap[0] = last; hv[0] = lv; var k = 0; for (;;) { var l = 2 * k + 1, r = l + 1, m = k; if (l < heap.length && hv[l] < hv[m]) m = l; if (r < heap.length && hv[r] < hv[m]) m = r; if (m === k) break; var t = heap[m]; heap[m] = heap[k]; heap[k] = t; t = hv[m]; hv[m] = hv[k]; hv[k] = t; k = m; } } return top; }
    var s = (a.y - y0) * bw + (a.x - x0), g = (b.y - y0) * bw + (b.x - x0);
    dist[s] = 0; push(s, 0);
    var D8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
    while (heap.length) {
      var u = pop(); if (done[u]) continue; done[u] = 1; if (u === g) break;
      var ux = u % bw, uy = (u / bw) | 0, cu = cost(ux + x0, uy + y0);
      for (var k = 0; k < 8; k++) {
        var vx = ux + D8[k][0], vy = uy + D8[k][1]; if (vx < 0 || vy < 0 || vx >= bw || vy >= bh) continue;
        var v = vy * bw + vx; if (done[v]) continue;
        var nd = dist[u] + D8[k][2] * (cu + cost(vx + x0, vy + y0)) / 2;
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push(v, nd); }
      }
    }
    var path = [], c = g;
    while (c >= 0) { path.push({ x: c % bw + x0, y: ((c / bw) | 0) + y0 }); if (c === s) break; c = prev[c]; }
    return path.reverse();
  }
  function traceLine(R, taps, closed) {
    if (taps.length < 2) return null;
    var P = taps.map(function (t) { return snap(R, t, 4); }), pts = [];
    for (var i = 1; i < P.length; i++) { var seg = tracePath(R, P[i - 1], P[i]); pts = pts.concat(i > 1 ? seg.slice(1) : seg); }
    if (closed && P.length > 2) { var sg = tracePath(R, P[P.length - 1], P[0]); pts = pts.concat(sg.slice(1, -1)); }
    var len = plen(pts, closed);
    return { pts: pts, closed: !!closed, lenMm: len * R.mmpp, wPx: 2, straight: 0, contrast: 0, traced: true };
  }

  // ---------- disegno col dito: cerca la linea vera vicino al tratto disegnato ----------
  function snapPath(R, rough, card, corrMm) {
    var W = R.W, H = R.H, n = W * H, i;
    if (rough.length < 5) return null;
    // ricampiona e leviga il tratto del dito
    var P = [rough[0]];
    for (i = 1; i < rough.length; i++) {
      var a = P[P.length - 1], b = rough[i], d = C.dist(a, b);
      for (var t = 2; t < d; t += 2) P.push({ x: a.x + (b.x - a.x) * t / d, y: a.y + (b.y - a.y) * t / d });
      P.push(b);
    }
    var closed = C.dist(P[0], P[P.length - 1]) < 80 / R.mmpp && P.length > 40;
    var win = Math.max(2, Math.round(6 / R.mmpp)), S2 = [];
    for (i = 0; i < P.length; i++) {
      var sx = 0, sy = 0, c = 0;
      for (var k = -win; k <= win; k++) { var j = i + k; if (closed) j = (j + P.length) % P.length; else if (j < 0 || j >= P.length) continue; sx += P[j].x; sy += P[j].y; c++; }
      S2.push({ x: sx / c, y: sy / c });
    }
    P = S2;
    var corr = (corrMm || 30) / R.mmpp, path = new Uint8Array(n);
    for (i = 1; i < P.length; i++) line(path, W, H, P[i - 1], P[i], 1);
    if (closed) line(path, W, H, P[P.length - 1], P[0], 1);
    var inv = new Uint8Array(n); for (i = 0; i < n; i++) inv[i] = path[i] ? 0 : 1;
    var dp = C.edt(inv, W, H), allow = new Uint8Array(n);
    for (i = 0; i < n; i++) allow[i] = dp[i] <= corr ? 1 : 0;
    var edge = null;
    if (card) { // il bordo del cartone conta come una linea
      edge = new Uint8Array(n);
      var dc = C.edt(card.mask, W, H);
      for (i = 0; i < n; i++) edge[i] = card.mask[i] && dc[i] <= 1.5 ? 1 : 0;
    }
    // programmazione dinamica: per ogni punto del tratto scelgo lo spostamento lungo la normale
    // che cade sulla linea, con spostamenti che cambiano poco da un punto al successivo
    var N = P.length, T = R.noise * 1.2, st = 0.5, M = Math.round(corr / st), NS = 2 * M + 1;
    var nrm = [];
    for (i = 0; i < N; i++) {
      var w2 = Math.max(3, Math.round(4 / R.mmpp)), ia = closed ? (i - w2 + N) % N : Math.max(0, i - w2), ib = closed ? (i + w2) % N : Math.min(N - 1, i + w2);
      var tx = P[ib].x - P[ia].x, ty = P[ib].y - P[ia].y, tl = Math.hypot(tx, ty) || 1;
      nrm.push({ x: -ty / tl, y: tx / tl });
    }
    var score = new Float32Array(N * NS);
    for (i = 0; i < N; i++) for (var k = 0; k < NS; k++) {
      var o = (k - M) * st, x = P[i].x + nrm[i].x * o, y = P[i].y + nrm[i].y * o, xi = Math.round(x), yi = Math.round(y), v = -0.5;
      if (xi > 0 && yi > 0 && xi < W - 1 && yi < H - 1) {
        var pp = yi * W + xi;
        if (edge && edge[pp]) v = 2.5;
        else v = Math.min(3, Math.max(0, (bilR(R.resp, W, x, y) - R.respMed) / T));
        if (card && !card.mask[pp]) v -= 1;
      }
      score[i * NS + k] = v - 0.15 * Math.abs(o) / corr;   // a parità, resta vicino al dito
    }
    var lam = 0.6 * R.mmpp, J = Math.max(1, Math.round(1 / st));   // al massimo 1 px di spostamento ogni passo
    var acc = new Float32Array(N * NS), from = new Int16Array(N * NS);
    for (k = 0; k < NS; k++) acc[k] = score[k];
    for (i = 1; i < N; i++) for (k = 0; k < NS; k++) {
      var bv = -1e9, bk = k;
      for (var dk = -J; dk <= J; dk++) {
        var k2 = k + dk; if (k2 < 0 || k2 >= NS) continue;
        var cand = acc[(i - 1) * NS + k2] - lam * dk * dk * st * st;
        if (cand > bv) { bv = cand; bk = k2; }
      }
      acc[i * NS + k] = bv + score[i * NS + k]; from[i * NS + k] = bk;
    }
    var kb = 0; for (k = 1; k < NS; k++) if (acc[(N - 1) * NS + k] > acc[(N - 1) * NS + kb]) kb = k;
    var off = new Int16Array(N); off[N - 1] = kb;
    for (i = N - 1; i > 0; i--) off[i - 1] = from[i * NS + off[i]];
    var pts = [];
    for (i = 0; i < N; i++) { var oo = (off[i] - M) * st; pts.push({ x: P[i].x + nrm[i].x * oo, y: P[i].y + nrm[i].y * oo }); }
    return { pts: pts, closed: closed, lenMm: plen(pts, closed) * R.mmpp, wPx: 2, straight: 0, contrast: 0, traced: true, drawn: true };
  }
  function plen2(P, closed) { return plen(P, closed); }

  // ---------- zona chiusa tra linee scelte e bordo del cartone ----------
  function line(m, W, H, a, b, val) {
    var x0 = Math.round(a.x), y0 = Math.round(a.y), x1 = Math.round(b.x), y1 = Math.round(b.y);
    var dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, e = dx + dy;
    for (;;) {
      if (x0 >= 0 && y0 >= 0 && x0 < W && y0 < H) m[y0 * W + x0] = val;
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
  }
  function label4(free, W, H) {
    var n = W * H, lab = new Int32Array(n), st = new Int32Array(n), comps = [null], id = 0;
    for (var s = 0; s < n; s++) {
      if (!free[s] || lab[s]) continue;
      id++; var sp = 0, c = { id: id, area: 0 }; st[sp++] = s; lab[s] = id;
      while (sp) {
        var p = st[--sp], x = p % W; c.area++;
        if (x > 0 && free[p - 1] && !lab[p - 1]) { lab[p - 1] = id; st[sp++] = p - 1; }
        if (x < W - 1 && free[p + 1] && !lab[p + 1]) { lab[p + 1] = id; st[sp++] = p + 1; }
        if (p >= W && free[p - W] && !lab[p - W]) { lab[p - W] = id; st[sp++] = p - W; }
        if (p < n - W && free[p + W] && !lab[p + W]) { lab[p + W] = id; st[sp++] = p + W; }
      }
      comps.push(c);
    }
    return { lab: lab, comps: comps };
  }
  // opts: {lines, sel:[id], card, useCard, tap:{x,y} px, mode, tolMm}
  function region(R, o) {
    var W = R.W, H = R.H, n = W * H, i;
    var sel = o.lines.filter(function (l) { return o.sel.indexOf(l.id) >= 0; });
    if (!sel.length) return { error: 'Scegli almeno una linea.' };
    var bar = new Uint8Array(n), wsum = 0, lsum = 0;
    sel.forEach(function (l) {
      for (var k = 1; k < l.pts.length; k++) line(bar, W, H, l.pts[k - 1], l.pts[k], 1);
      if (l.closed) line(bar, W, H, l.pts[l.pts.length - 1], l.pts[0], 1);
      wsum += l.wPx * l.lenMm; lsum += l.lenMm;
    });
    var w = wsum / lsum, inside = (o.useCard && o.card) ? o.card.mask : null;
    // ponti tra capi vicini delle linee scelte (spigoli e interruzioni), senza arrotondare la forma
    var bridges = [], gapMax = 45 / R.mmpp, E = [];
    var kb = Math.max(3, Math.round(8 / R.mmpp));
    sel.forEach(function (l, li) {
      if (l.closed || l.pts.length < 2) return;
      var P = l.pts, L = P.length, k = Math.min(L - 1, kb);
      [[P[0], P[k]], [P[L - 1], P[L - 1 - k]]].forEach(function (ab) {
        var dx = ab[0].x - ab[1].x, dy = ab[0].y - ab[1].y, dl = Math.hypot(dx, dy) || 1;
        E.push({ l: li, p: ab[0], d: { x: dx / dl, y: dy / dl }, used: false });
      });
    });
    var prs = [];
    for (var a1 = 0; a1 < E.length; a1++) for (var b1 = a1 + 1; b1 < E.length; b1++) {
      if (E[a1].l === E[b1].l && sel[E[a1].l].lenMm < 150) continue;
      var A0 = E[a1], B0 = E[b1], vx = B0.p.x - A0.p.x, vy = B0.p.y - A0.p.y, dd = Math.hypot(vx, vy);
      if (dd > gapMax) continue;
      var c1 = dd > 1 ? (A0.d.x * vx + A0.d.y * vy) / dd : 1, c2 = dd > 1 ? -(B0.d.x * vx + B0.d.y * vy) / dd : 1;
      if (dd > 3 && (c1 < -0.2 || c2 < -0.2)) continue;   // il ponte deve proseguire le due linee
      prs.push([dd * (1 + (1 - c1) + (1 - c2)), a1, b1]);
    }
    prs.sort(function (x, y) { return x[0] - y[0]; });
    prs.forEach(function (q) {
      var A = E[q[1]], B = E[q[2]]; if (A.used || B.used) return;
      A.used = B.used = true; line(bar, W, H, A.p, B.p, 1); bridges.push([A.p, B.p]);
    });
    // capi ancora liberi: ponte al punto più vicino di un'altra linea scelta (giunzione a T)
    E.forEach(function (A) {
      if (A.used) return;
      var best = null, bd = gapMax;
      sel.forEach(function (l, li) {
        if (li === A.l) return;
        for (var k = 0; k < l.pts.length; k += 2) { var d2 = C.dist(A.p, l.pts[k]); if (d2 < bd) { bd = d2; best = l.pts[k]; } }
      });
      if (best) { A.used = true; line(bar, W, H, A.p, best, 1); bridges.push([A.p, best]); }
    });
    // prolunga i capi aperti lungo la tangente fino al bordo del cartone o a un'altra linea
    var ext = [], maxExt = 90 / R.mmpp;
    if (inside) sel.forEach(function (l, li) {
      if (l.closed || l.pts.length < 4) return;
      [0, 1].forEach(function (e) {
        if (E.some(function (A) { return A.used && A.l === li && A.p === (e ? l.pts[l.pts.length - 1] : l.pts[0]); })) return;
        var P = l.pts, Lp = P.length, k = Math.min(Lp - 1, Math.max(3, Math.round(25 / R.mmpp)));
        var A = e ? P[Lp - 1] : P[0], B = e ? P[Lp - 1 - k] : P[k];
        var dx = A.x - B.x, dy = A.y - B.y, dl = Math.hypot(dx, dy); if (!dl) return;
        dx /= dl; dy /= dl;
        var path = [], hit = false;
        for (var t = 1, vis = 0; vis <= maxExt && t < 4 * maxExt; t++) {
          var x = Math.round(A.x + dx * t), y = Math.round(A.y + dy * t);
          if (x < 0 || y < 0 || x >= W || y >= H) break;
          var q = y * W + x;
          if (!R.sheet[q]) vis++;   // sotto un foglio la linea non si vede: quel tratto non conta
          if (!inside[q]) { hit = true; break; }
          if (t > 3 && bar[q]) { hit = true; break; }
          path.push({ x: x, y: y });
        }
        if (!hit) { // la tangente non porta al bordo: collego al punto del bordo più vicino, se è vicino
          path = []; var lim = Math.round(150 / R.mmpp), best = null, bd = Infinity, ax = Math.round(A.x), ay = Math.round(A.y);
          for (var yy = -lim; yy <= lim; yy++) for (var xx = -lim; xx <= lim; xx++) {
            var X = ax + xx, Y = ay + yy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
            if (inside[Y * W + X]) continue;
            var dd2 = xx * xx + yy * yy; if (dd2 < bd) { bd = dd2; best = { x: X, y: Y }; }
          }
          if (best && Math.sqrt(bd) <= lim) {
            var L2 = Math.ceil(Math.sqrt(bd));
            for (var t2 = 1; t2 <= L2 + 1; t2++) path.push({ x: Math.round(A.x + (best.x - A.x) * t2 / L2), y: Math.round(A.y + (best.y - A.y) * t2 / L2) });
            hit = true;
          }
        } else {
          for (var t3 = 1; t3 <= 2; t3++) { var px = path[path.length - 1]; path.push({ x: px.x + Math.round(dx), y: px.y + Math.round(dy) }); }
        }
        if (root.DEBUG_LINES) console.log('prolunga capo', e, 'passi', path.length, 'colpito', hit);
        if (hit && path.length) { ext.push(path); path.forEach(function (p) { if (p.x >= 0 && p.y >= 0 && p.x < W && p.y < H) bar[p.y * W + p.x] = 1; }); }
      });
    });
    var dBar = C.edt((function () { var m = new Uint8Array(n); for (var q = 0; q < n; q++) m[q] = bar[q] ? 0 : 1; return m; })(), W, H);
    var gaps = [0, 1.5, 3, 5].map(function (mm) { return mm / R.mmpp; }), chosen = null, used = 0, L = null;
    for (var gi = 0; gi < gaps.length && !chosen; gi++) {
      var r = gaps[gi], free = new Uint8Array(n);
      for (i = 0; i < n; i++) free[i] = (R.valid[i] && dBar[i] > r + 0.5 && (!inside || inside[i])) ? 1 : 0;
      for (i = 0; i < W; i++) { free[i] = 0; free[n - W + i] = 0; }
      for (i = 0; i < H; i++) { free[i * W] = 0; free[i * W + W - 1] = 0; }
      L = label4(free, W, H);
      var total = 0; L.comps.forEach(function (c) { if (c) total += c.area; });
      var sig = L.comps.filter(function (c) { return c && c.area > 0.01 * total; });
      if (root.DEBUG_LINES) console.log('gap', r.toFixed(1), 'zone significative', sig.length, 'totale', total);
      if (sig.length < 2) continue;
      // contatti con le linee e con il bordo
      sig.forEach(function (c) { c.touchLine = 0; c.touchEdge = 0; });
      var byId = {}; sig.forEach(function (c) { byId[c.id] = c; });
      for (var y = 1; y < H - 1; y++) for (var x = 1; x < W - 1; x++) {
        var p = y * W + x, c0 = byId[L.lab[p]]; if (!c0) continue;
        var nbs = [p - 1, p + 1, p - W, p + W];
        for (var k = 0; k < 4; k++) {
          var q2 = nbs[k]; if (L.lab[q2]) continue;
          if (dBar[q2] <= r + 0.5) c0.touchLine++; else c0.touchEdge++;
        }
      }
      var pick = null;
      if (o.tap) {
        var tp = Math.round(o.tap.y) * W + Math.round(o.tap.x), best = null, bd = 1e9;
        if (L.lab[tp] && byId[L.lab[tp]]) best = byId[L.lab[tp]];
        else { // tocco sulla linea: cerca la zona più vicina
          for (var yy = -12; yy <= 12; yy++) for (var xx = -12; xx <= 12; xx++) {
            var q3 = tp + yy * W + xx; if (q3 < 0 || q3 >= n) continue;
            var cc = byId[L.lab[q3]]; if (cc && xx * xx + yy * yy < bd) { bd = xx * xx + yy * yy; best = cc; }
          }
        }
        pick = best;
      }
      if (!pick) {
        var mt = Math.max.apply(0, sig.map(function (c) { return c.touchLine; }));
        var cand = sig.filter(function (c) { return c.touchLine >= 0.4 * mt; });
        var enclosed = cand.filter(function (c) { return c.touchEdge < 0.05 * (c.touchLine + c.touchEdge); });
        var pool = enclosed.length ? enclosed : cand;
        pool.sort(function (a, b) { return b.area - a.area; });
        pick = pool[0];
      }
      if (pick) { chosen = pick; used = r; }
    }
    if (!chosen) return { error: o.useCard && o.card ? 'Le linee scelte non dividono il cartone in zone chiuse. Aggiungi un\'altra linea o alza la sensibilità.' : 'Le linee scelte non chiudono una zona. Attiva la chiusura sul bordo del cartone o aggiungi una linea.' };
    var reg = new Uint8Array(n);
    for (i = 0; i < n; i++) reg[i] = L.lab[i] === chosen.id ? 1 : 0;
    // chiusura leggera: riempie le fessure lasciate da monconi di linea dentro la zona
    var ro = Math.max(1, 1.5 / R.mmpp), rop = Math.max(1.5, 3 / R.mmpp), nr0 = new Uint8Array(n);
    for (i = 0; i < n; i++) nr0[i] = reg[i] ? 0 : 1;
    var dO = C.edt(nr0, W, H), dil = new Uint8Array(n);
    for (i = 0; i < n; i++) dil[i] = (reg[i] || dO[i] <= ro + 0.5) && (!inside || inside[i]) ? 1 : 0;
    var dE = C.edt(dil, W, H);
    for (i = 0; i < n; i++) reg[i] = dil[i] && (dE[i] > ro + 0.5 || reg[i]) ? 1 : 0;
    // apertura leggera: toglie le punte sottili
    var dIn0 = C.edt(reg, W, H), core = new Uint8Array(n);
    for (i = 0; i < n; i++) core[i] = dIn0[i] > rop ? 0 : 1;   // 0 = nucleo
    var dCore = C.edt(core, W, H);
    for (i = 0; i < n; i++) if (reg[i] && dCore[i] > rop + 0.5) reg[i] = 0;
    var notReg = new Uint8Array(n); for (i = 0; i < n; i++) notReg[i] = reg[i] ? 0 : 1;
    var dOut = C.edt(notReg, W, H), dIn = C.edt(reg, W, H), f = new Float32Array(n);
    var off = o.mode === 'out' ? w / 2 : o.mode === 'in' ? -w / 2 : 0, lev = used + 0.5 + off;
    for (i = 0; i < n; i++) f[i] = (inside && !inside[i]) || !R.valid[i] ? 1e6 : dOut[i] - dIn[i];
    // la zona sta sotto la soglia: inverto per usare la stessa funzione delle isolinee
    for (i = 0; i < n; i++) f[i] = -f[i];
    var loops = isolinesBig(f, W, H, -lev), best2 = null, ba = 0;
    loops.forEach(function (lp) { var a = Math.abs(C.area(lp)); if (a > ba) { ba = a; best2 = lp; } });
    if (!best2) return { error: 'Contorno non trovato.' };
    var mm = best2.map(function (p) { return toMm(R, { x: p.x - 0.5, y: p.y - 0.5 }); });
    for (var pass = 0; pass < 2; pass++) {
      var sm = [], nn = mm.length;
      for (var k2 = 0; k2 < nn; k2++) { var pa = mm[(k2 + nn - 1) % nn], pb = mm[k2], pc = mm[(k2 + 1) % nn]; sm.push({ x: (pa.x + 2 * pb.x + pc.x) / 4, y: (pa.y + 2 * pb.y + pc.y) / 4 }); }
      mm = sm;
    }
    return { mm: mm, strokeMm: w * R.mmpp, gapMm: used * R.mmpp, regionId: chosen.id, lab: L.lab, reg: reg, ext: ext.concat(bridges) };
  }
  // isolinee: riusa marching squares di Core tramite una piccola copia locale
  function isolinesBig(f, W, H, t) { return C.isolines(f, W, H, t); }

  // ---------- altezza della fotocamera e correzione per lo spessore del cartone ----------
  function camera(Hwi, iw, ih, fRatio) {
    var f = (fRatio || 0.75) * Math.max(iw, ih), cx = iw / 2, cy = ih / 2;
    var Ki = [1 / f, 0, -cx / f, 0, 1 / f, -cy / f, 0, 0, 1];
    function mv(M, c) { return [M[0] * Hwi[c] + M[1] * Hwi[3 + c] + M[2] * Hwi[6 + c], M[3] * Hwi[c] + M[4] * Hwi[3 + c] + M[5] * Hwi[6 + c], M[6] * Hwi[c] + M[7] * Hwi[3 + c] + M[8] * Hwi[6 + c]]; }
    var m1 = mv(Ki, 0), m2 = mv(Ki, 1), m3 = mv(Ki, 2);
    var n1 = Math.hypot(m1[0], m1[1], m1[2]), n2 = Math.hypot(m2[0], m2[1], m2[2]), lam = 2 / (n1 + n2);
    var r1 = m1.map(function (v) { return v * lam; }), r2 = m2.map(function (v) { return v * lam; }), t = m3.map(function (v) { return v * lam; });
    if (t[2] < 0) { r1 = r1.map(function (v) { return -v; }); r2 = r2.map(function (v) { return -v; }); t = t.map(function (v) { return -v; }); }
    var r3 = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]];
    // centro della fotocamera: C = -R^T t
    var Cx = -(r1[0] * t[0] + r1[1] * t[1] + r1[2] * t[2]);
    var Cy = -(r2[0] * t[0] + r2[1] * t[1] + r2[2] * t[2]);
    var Cz = -(r3[0] * t[0] + r3[1] * t[1] + r3[2] * t[2]);
    return { N: { x: Cx, y: Cy }, Z: Math.abs(Cz) };
  }
  function liftCorrect(pts, cam, h) {
    if (!h || !cam || !(cam.Z > 100)) return pts;
    var k = (cam.Z - h) / cam.Z;
    return pts.map(function (p) { return { x: cam.N.x + (p.x - cam.N.x) * k, y: cam.N.y + (p.y - cam.N.y) * k }; });
  }

  // scelta iniziale: la linea più promettente più quelle che la proseguono (capi vicini a un'altra linea scelta)
  function autoSelect(lines, mmpp) {
    var best = null, bs = -1;
    lines.forEach(function (l) { var sc = l.lenMm * (l.straight < 0.9 ? 2.5 : 1) * (l.closed ? 3 : 1); if (sc > bs) { bs = sc; best = l; } });
    if (!best) return [];
    var sel = [best], thr = 45 / mmpp, grew = true;
    function ends(l) { return l.closed ? [] : [l.pts[0], l.pts[l.pts.length - 1]]; }
    function near(p, l) { for (var k = 0; k < l.pts.length; k += 3) if (Math.hypot(p.x - l.pts[k].x, p.y - l.pts[k].y) < thr) return true; return false; }
    while (grew && !best.closed) {
      grew = false;
      lines.forEach(function (l) {
        if (sel.indexOf(l) >= 0 || l.lenMm < 40 || l.closed) return;
        var hit = ends(l).some(function (p) { return sel.some(function (q) { return near(p, q); }); }) ||
          sel.some(function (q) { return ends(q).some(function (p) { return near(p, l); }); });
        if (hit) { sel.push(l); grew = true; }
      });
    }
    return sel.map(function (l) { return l.id; });
  }
  // ritaglia tutto sul cartone (con margine): i calcoli dopo sono molto più leggeri
  function crop(R, card, mgMm) {
    var mg = Math.round((mgMm || 40) / R.mmpp), x0 = R.W, y0 = R.H, x1 = 0, y1 = 0;
    card.hull.forEach(function (p) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    x0 = Math.max(0, Math.floor(x0) - mg); y0 = Math.max(0, Math.floor(y0) - mg); x1 = Math.min(R.W - 1, Math.ceil(x1) + mg); y1 = Math.min(R.H - 1, Math.ceil(y1) + mg);
    var W2 = x1 - x0 + 1, H2 = y1 - y0 + 1;
    function cut(a) { if (!a) return a; var o = new a.constructor(W2 * H2); for (var y = 0; y < H2; y++) o.set(a.subarray((y + y0) * R.W + x0, (y + y0) * R.W + x0 + W2), y * W2); return o; }
    var R2 = {};
    for (var k in R) R2[k] = R[k];
    ['v', 's', 'g', 'valid', 'sheet', 'resp'].forEach(function (k) { if (R[k]) R2[k] = cut(R[k]); });
    R2.W = W2; R2.H = H2; R2.x0 = R.x0 + x0 * R.mmpp; R2.y0 = R.y0 + y0 * R.mmpp;
    var card2 = { hull: card.hull.map(function (p) { return { x: p.x - x0, y: p.y - y0 }; }), mask: cut(card.mask), area: card.area, quad: card.quad };
    return { R: R2, card: card2 };
  }
  root.Lines = { crop: crop, snapPath: snapPath, autoSelect: autoSelect, traceLine: traceLine, snap: snap, prepare: prepare2, findCard: findCard, findLines: findLines, region: region, camera: camera, liftCorrect: liftCorrect, toPx: toPx, toMm: toMm };
})(typeof window !== 'undefined' ? window : globalThis);
