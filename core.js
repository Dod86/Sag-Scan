/* Scanner di sagome: motore geometrico. Nessuna dipendenza dal DOM. */
(function (root) {
  'use strict';

  // ---------- algebra ----------
  function solve(A, b) {
    var n = b.length, M = A.map(function (r, i) { return r.concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var p = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      var t = M[c]; M[c] = M[p]; M[p] = t;
      var d = M[c][c];
      if (Math.abs(d) < 1e-12) return null;
      for (r = 0; r < n; r++) {
        if (r === c) continue;
        var f = M[r][c] / d;
        if (f) for (var k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map(function (row, i) { return row[n] / row[i]; });
  }

  // omografia che porta src[i] -> dst[i] (4 punti)
  function homography(src, dst) {
    var A = [], b = [];
    for (var i = 0; i < 4; i++) {
      var x = src[i].x, y = src[i].y, u = dst[i].x, v = dst[i].y;
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    var h = solve(A, b);
    return h ? h.concat([1]) : null;
  }
  function applyH(h, x, y) {
    var w = h[6] * x + h[7] * y + h[8];
    return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // ---------- coordinate dei 4 riferimenti dalle distanze misurate ----------
  // d = {d12,d23,d34,d41,d13,d24?}; img = i 4 punti nella foto (per il verso)
  function quadFromDistances(d, img) {
    var P1 = { x: 0, y: 0 }, P2 = { x: d.d12, y: 0 };
    var x3 = (d.d12 * d.d12 + d.d13 * d.d13 - d.d23 * d.d23) / (2 * d.d12);
    var y3sq = d.d13 * d.d13 - x3 * x3;
    if (y3sq < -0.02 * d.d13 * d.d13) return { error: 'Le misure 1-2, 2-3 e 1-3 non formano un triangolo. Ricontrollale.' };
    var P3 = { x: x3, y: Math.sqrt(Math.max(0, y3sq)) };
    var a = (d.d41 * d.d41 - d.d34 * d.d34 + d.d13 * d.d13) / (2 * d.d13);
    var hsq = d.d41 * d.d41 - a * a;
    if (hsq < -0.02 * d.d41 * d.d41) return { error: 'Le misure 3-4, 4-1 e 1-3 non formano un triangolo. Ricontrollale.' };
    var hh = Math.sqrt(Math.max(0, hsq));
    var ux = P3.x / d.d13, uy = P3.y / d.d13;
    var c1 = { x: a * ux - hh * uy, y: a * uy + hh * ux };
    var c2 = { x: a * ux + hh * uy, y: a * uy - hh * ux };
    var P4;
    if (d.d24 > 0) P4 = Math.abs(dist(c1, P2) - d.d24) < Math.abs(dist(c2, P2) - d.d24) ? c1 : c2;
    else { // lato opposto a P2 rispetto alla diagonale 1-3
      var s2 = ux * P2.y - uy * P2.x, s1 = ux * c1.y - uy * c1.x;
      P4 = (s1 * s2 < 0) ? c1 : c2;
    }
    var pts = [P1, P2, P3, P4];
    // stesso verso della foto (altrimenti il disegno esce specchiato)
    var cw = (pts[1].x - pts[0].x) * (pts[2].y - pts[0].y) - (pts[1].y - pts[0].y) * (pts[2].x - pts[0].x);
    var ci = (img[1].x - img[0].x) * (img[2].y - img[0].y) - (img[1].y - img[0].y) * (img[2].x - img[0].x);
    if (cw * ci < 0) pts = pts.map(function (p) { return { x: p.x, y: -p.y }; });
    return { pts: pts, d24: dist(pts[1], pts[3]) };
  }

  // ---------- affinamento sub-pixel dei bordi di un marker ----------
  function bil(g, W, H, x, y) {
    if (x < 0) x = 0; if (y < 0) y = 0; if (x > W - 1.001) x = W - 1.001; if (y > H - 1.001) y = H - 1.001;
    var x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * W + x0;
    return (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + W] * (1 - fx) + g[i + W + 1] * fx) * fy;
  }
  function fitLine(P) { // minimi quadrati totali -> {px,py,dx,dy}
    var n = P.length, mx = 0, my = 0, i;
    for (i = 0; i < n; i++) { mx += P[i].x; my += P[i].y; }
    mx /= n; my /= n;
    var sxx = 0, sxy = 0, syy = 0;
    for (i = 0; i < n; i++) { var ax = P[i].x - mx, ay = P[i].y - my; sxx += ax * ax; sxy += ax * ay; syy += ay * ay; }
    var th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { px: mx, py: my, dx: Math.cos(th), dy: Math.sin(th) };
  }
  function lineX(a, b) {
    var den = a.dx * b.dy - a.dy * b.dx;
    if (Math.abs(den) < 1e-9) return null;
    var t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / den;
    return { x: a.px + t * a.dx, y: a.py + t * a.dy };
  }
  function refineQuad(g, W, H, c) {
    var lines = [];
    for (var e = 0; e < 4; e++) {
      var A = c[e], B = c[(e + 1) % 4], L = dist(A, B);
      if (L < 16) return c;
      var dx = (B.x - A.x) / L, dy = (B.y - A.y) / L, nx = -dy, ny = dx;
      var R = Math.max(3, Math.min(7, L * 0.05)), step = Math.max(1, L / 40), pts = [];
      for (var s = 0.12 * L; s <= 0.88 * L; s += step) {
        var bx = A.x + dx * s, by = A.y + dy * s, best = -1, bi = 0, prof = [];
        for (var k = -R; k <= R + 1e-6; k += 0.5) prof.push(bil(g, W, H, bx + nx * k, by + ny * k));
        var gr = [];
        for (var q = 1; q < prof.length - 1; q++) {
          var gv = Math.abs(prof[q + 1] - prof[q - 1]); gr.push(gv);
          if (gv > best) { best = gv; bi = q - 1; }
        }
        if (best < 12 || bi === 0 || bi === gr.length - 1) continue;
        var y0 = gr[bi - 1], y1 = gr[bi], y2 = gr[bi + 1], den = y0 - 2 * y1 + y2;
        var off = den ? 0.5 * (y0 - y2) / den : 0;
        var kk = -R + 0.5 * (bi + 1 + off);
        pts.push({ x: bx + nx * kk, y: by + ny * kk });
      }
      if (pts.length < 6) return c;
      var ln = fitLine(pts);
      var keep = pts.filter(function (p) { return Math.abs((p.x - ln.px) * ln.dy - (p.y - ln.py) * ln.dx) < 1; });
      if (keep.length >= 6) ln = fitLine(keep);
      lines.push(ln);
    }
    var out = [];
    for (e = 0; e < 4; e++) {
      var p = lineX(lines[(e + 3) % 4], lines[e]);
      if (!p || dist(p, c[e]) > 6) return c;
      out.push(p);
    }
    return out;
  }
  function quadCenter(c) { // incrocio delle diagonali: centro vero anche in prospettiva
    var a = { px: c[0].x, py: c[0].y, dx: c[2].x - c[0].x, dy: c[2].y - c[0].y };
    var b = { px: c[1].x, py: c[1].y, dx: c[3].x - c[1].x, dy: c[3].y - c[1].y };
    return lineX(a, b) || { x: (c[0].x + c[2].x) / 2, y: (c[0].y + c[2].y) / 2 };
  }

  // ---------- raddrizzamento ----------
  // Hwi: mondo(mm) -> foto(px). Restituisce il canale "scuro" (min RGB) in scala reale.
  function rectify(rgba, iw, ih, Hwi, x0, y0, mmpp, W, H, lens) {
    var lk = lens && lens.k1 ? lens : null;
    var g = new Uint8Array(W * H);
    for (var j = 0; j < H; j++) {
      var wy = y0 + (j + 0.5) * mmpp;
      for (var i = 0; i < W; i++) {
        var wx = x0 + (i + 0.5) * mmpp;
        var w = Hwi[6] * wx + Hwi[7] * wy + Hwi[8];
        var sx = (Hwi[0] * wx + Hwi[1] * wy + Hwi[2]) / w, sy = (Hwi[3] * wx + Hwi[4] * wy + Hwi[5]) / w;
        if (lk) { var ux = (sx - lk.cx) / lk.sc, uy = (sy - lk.cy) / lk.sc, dd = 1 + lk.k1 * (ux * ux + uy * uy); sx = lk.cx + ux * dd * lk.sc; sy = lk.cy + uy * dd * lk.sc; }
        if (!(sx >= 0 && sy >= 0 && sx < iw - 1 && sy < ih - 1)) { g[j * W + i] = 255; continue; }
        var xi = sx | 0, yi = sy | 0, fx = sx - xi, fy = sy - yi, p = (yi * iw + xi) * 4, q = p + iw * 4;
        var a = Math.min(rgba[p], rgba[p + 1], rgba[p + 2]), b = Math.min(rgba[p + 4], rgba[p + 5], rgba[p + 6]);
        var c = Math.min(rgba[q], rgba[q + 1], rgba[q + 2]), d = Math.min(rgba[q + 4], rgba[q + 5], rgba[q + 6]);
        g[j * W + i] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
      }
    }
    return g;
  }

  // ---------- soglia adattiva ----------
  function threshold(g, W, H, win, sens) {
    var I = new Float64Array((W + 1) * (H + 1)), x, y;
    for (y = 0; y < H; y++) {
      var row = 0;
      for (x = 0; x < W; x++) { row += g[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; }
    }
    var m = new Uint8Array(W * H), r = Math.max(2, win >> 1), k = 1 - sens;
    for (y = 0; y < H; y++) {
      var ya = Math.max(0, y - r), yb = Math.min(H, y + r + 1);
      for (x = 0; x < W; x++) {
        var xa = Math.max(0, x - r), xb = Math.min(W, x + r + 1);
        var s = I[yb * (W + 1) + xb] - I[ya * (W + 1) + xb] - I[yb * (W + 1) + xa] + I[ya * (W + 1) + xa];
        if (g[y * W + x] * (xb - xa) * (yb - ya) < s * k) m[y * W + x] = 1;
      }
    }
    return m;
  }
  function eraseDisk(m, W, H, cx, cy, rad) {
    var x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(W - 1, Math.ceil(cx + rad));
    var y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(H - 1, Math.ceil(cy + rad)), r2 = rad * rad;
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++)
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2) m[y * W + x] = 0;
  }

  function erasePoly(m, W, H, P) {
    var x0 = W, x1 = 0, y0 = H, y1 = 0;
    P.forEach(function (q) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); });
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W - 1, Math.ceil(x1)); y1 = Math.min(H - 1, Math.ceil(y1));
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      var ins = false;
      for (var i = 0, j = P.length - 1; i < P.length; j = i++)
        if ((P[i].y > y) !== (P[j].y > y) && x < (P[j].x - P[i].x) * (y - P[i].y) / (P[j].y - P[i].y) + P[i].x) ins = !ins;
      if (ins) m[y * W + x] = 0;
    }
  }

  // ---------- trasformata di distanza esatta (Felzenszwalb) ----------
  var INF = 1e20;
  function dt1(f, n, d, v, z) {
    var k = 0, q, s; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (q = 1; q < n; q++) {
      for (;;) {
        var p = v[k];
        s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
        if (s <= z[k]) k--; else break;
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (q = 0; q < n; q++) { while (z[k + 1] < q) k++; var dq = q - v[k]; d[q] = dq * dq + f[v[k]]; }
  }
  // per ogni pixel con mask=1: distanza dal pixel con mask=0 più vicino
  function edt(mask, W, H) {
    var n = Math.max(W, H), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    var out = new Float32Array(W * H), x, y;
    for (x = 0; x < W; x++) {
      for (y = 0; y < H; y++) f[y] = mask[y * W + x] ? INF : 0;
      dt1(f, H, d, v, z);
      for (y = 0; y < H; y++) out[y * W + x] = d[y];
    }
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) f[x] = out[y * W + x];
      dt1(f, W, d, v, z);
      for (x = 0; x < W; x++) out[y * W + x] = Math.sqrt(d[x]);
    }
    return out;
  }

  // ---------- componenti connesse (8 vicini) ----------
  function label(m, W, H, dmap) {
    var lab = new Int32Array(W * H), stack = new Int32Array(W * H), comps = [null], n = 0;
    for (var s = 0; s < W * H; s++) {
      if (!m[s] || lab[s]) continue;
      n++; var sp = 0, c = { id: n, count: 0, x0: W, y0: H, x1: 0, y1: 0, sumD: 0 };
      stack[sp++] = s; lab[s] = n;
      while (sp) {
        var p = stack[--sp], x = p % W, y = (p / W) | 0;
        c.count++; if (dmap) c.sumD += dmap[p];
        if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
        for (var dy = -1; dy <= 1; dy++) {
          var yy = y + dy; if (yy < 0 || yy >= H) continue;
          for (var dx = -1; dx <= 1; dx++) {
            var xx = x + dx; if (xx < 0 || xx >= W) continue;
            var q = yy * W + xx;
            if (m[q] && !lab[q]) { lab[q] = n; stack[sp++] = q; }
          }
        }
      }
      c.width = dmap ? Math.max(1, 4 * (c.sumD / c.count - 0.5)) : 0; // spessore medio del tratto, px
      comps.push(c);
    }
    return { lab: lab, comps: comps };
  }

  function fillHoles(m, W, H) { // 1 = tratto oppure zona racchiusa
    var out = new Uint8Array(W * H), stack = new Int32Array(W * H), sp = 0, i;
    function push(p) { if (!m[p] && !out[p]) { out[p] = 1; stack[sp++] = p; } }
    for (i = 0; i < W; i++) { push(i); push((H - 1) * W + i); }
    for (i = 0; i < H; i++) { push(i * W); push(i * W + W - 1); }
    while (sp) {
      var p = stack[--sp], x = p % W;
      if (x > 0) push(p - 1); if (x < W - 1) push(p + 1);
      if (p >= W) push(p - W); if (p < W * (H - 1)) push(p + W);
    }
    for (i = 0; i < W * H; i++) out[i] = out[i] ? 0 : 1;
    return out;
  }

  // ---------- isolinee (marching squares) ----------
  function isolines(f, W, H, t) {
    var adj = new Map();
    function link(a, b) {
      var l = adj.get(a); if (l) l.push(b); else adj.set(a, [b]);
      l = adj.get(b); if (l) l.push(a); else adj.set(b, [a]);
    }
    for (var y = 0; y < H - 1; y++) for (var x = 0; x < W - 1; x++) {
      var i = y * W + x, a = f[i] > t, b = f[i + 1] > t, c = f[i + W + 1] > t, d = f[i + W] > t;
      if (a === b && b === c && c === d) continue;
      var T = 2 * i, Rr = 2 * (i + 1) + 1, B = 2 * (i + W), L = 2 * i + 1, e = [];
      if (a !== b) e.push(T); if (b !== c) e.push(Rr); if (c !== d) e.push(B); if (d !== a) e.push(L);
      if (e.length === 2) link(e[0], e[1]);
      else if (a) { link(T, Rr); link(B, L); } else { link(T, L); link(Rr, B); }
    }
    function pt(id) {
      var i = id >> 1, x = i % W, y = (i / W) | 0, v0 = f[i], v1 = (id & 1) ? f[i + W] : f[i + 1];
      var u = (t - v0) / (v1 - v0);
      return (id & 1) ? { x: x + 0.5, y: y + u + 0.5 } : { x: x + u + 0.5, y: y + 0.5 };
    }
    var seen = new Set(), loops = [];
    adj.forEach(function (_, start) {
      if (seen.has(start)) return;
      var loop = [], prev = -1, cur = start;
      for (;;) {
        seen.add(cur); loop.push(pt(cur));
        var nb = adj.get(cur), nxt = -1;
        for (var k = 0; k < nb.length; k++) if (nb[k] !== prev && !seen.has(nb[k])) { nxt = nb[k]; break; }
        if (nxt < 0) break;
        prev = cur; cur = nxt;
      }
      if (loop.length > 8) loops.push(loop);
    });
    return loops;
  }
  function area(P) {
    var s = 0;
    for (var i = 0, n = P.length; i < n; i++) { var a = P[i], b = P[(i + 1) % n]; s += a.x * b.y - b.x * a.y; }
    return s / 2;
  }
  function perimeter(P) {
    var s = 0;
    for (var i = 0, n = P.length; i < n; i++) s += dist(P[i], P[(i + 1) % n]);
    return s;
  }

  // ---------- semplificazione (Douglas-Peucker su anello chiuso) ----------
  function dpOpen(P, tol) {
    var keep = new Uint8Array(P.length), st = [[0, P.length - 1]];
    keep[0] = keep[P.length - 1] = 1;
    while (st.length) {
      var se = st.pop(), s = se[0], e = se[1], A = P[s], B = P[e], dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1e-9, mx = 0, mi = -1;
      for (var i = s + 1; i < e; i++) {
        var dd = Math.abs((P[i].x - A.x) * dy - (P[i].y - A.y) * dx) / L;
        if (dd > mx) { mx = dd; mi = i; }
      }
      if (mx > tol) { keep[mi] = 1; st.push([s, mi], [mi, e]); }
    }
    return P.filter(function (_, i) { return keep[i]; });
  }
  function simplifyClosed(P, tol) {
    var far = 0, md = 0;
    for (var i = 1; i < P.length; i++) { var d = dist(P[0], P[i]); if (d > md) { md = d; far = i; } }
    var a = dpOpen(P.slice(0, far + 1), tol), b = dpOpen(P.slice(far).concat([P[0]]), tol);
    return a.slice(0, -1).concat(b.slice(0, -1));
  }

  // ---------- spigoli: ricostruisce la punta smussata dal pennarello ----------
  function sharpen(P, w) {
    var n = P.length, longMin = Math.max(12, 4 * w), changed = true, guard = 0;
    function len(i) { return dist(P[i % P.length], P[(i + 1) % P.length]); }
    while (changed && guard++ < 50) {
      changed = false; n = P.length;
      for (var i = 0; i < n && !changed; i++) {
        if (len(i) < longMin) continue;
        var tot = 0, m = i + 1, cnt = 0;
        while (cnt < 7 && len(m) < longMin) { tot += len(m); m++; cnt++; }
        if (cnt === 0 || cnt >= 7 || tot > 5 * w) continue;
        var A = P[i % n], B = P[(i + 1) % n], Cq = P[m % n], D = P[(m + 1) % n];
        var u = { x: B.x - A.x, y: B.y - A.y }, v = { x: D.x - Cq.x, y: D.y - Cq.y };
        var lu = Math.hypot(u.x, u.y), lv = Math.hypot(v.x, v.y);
        var turn = Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / (lu * lv))));
        if (turn < 20 * Math.PI / 180) continue;
        var X = lineX({ px: A.x, py: A.y, dx: u.x / lu, dy: u.y / lu }, { px: Cq.x, py: Cq.y, dx: v.x / lv, dy: v.y / lv });
        if (!X) continue;
        var dmin = Infinity;
        for (var k = i + 1; k <= m; k++) dmin = Math.min(dmin, dist(X, P[k % n]));
        if (dmin > 0.8 * w) continue;
        // sostituisce i vertici della smussatura con lo spigolo
        var keep = [], drop = new Set();
        for (k = i + 1; k <= m; k++) drop.add(k % n);
        for (k = 0; k < n; k++) { if (k === (i + 1) % n) keep.push(X); if (!drop.has(k)) keep.push(P[k]); }
        P = keep; changed = true;
      }
    }
    return P;
  }

  // ---------- dal tratto al contorno ----------
  // S: maschera del tratto scelto (ritagliata, con bordo vuoto), w: spessore px, mode: 'mid'|'out'|'in'
  function traceOutline(S, W, H, w, mode, gaps) {
    var nS = 0, i;
    for (i = 0; i < W * H; i++) nS += S[i];
    for (var gi = 0; gi < gaps.length; gi++) {
      var r = gaps[gi], Sd = S;
      if (r > 0) {
        var inv = new Uint8Array(W * H);
        for (i = 0; i < W * H; i++) inv[i] = S[i] ? 0 : 1;
        var dd = edt(inv, W, H); Sd = new Uint8Array(W * H);
        for (i = 0; i < W * H; i++) Sd[i] = (S[i] || dd[i] <= r) ? 1 : 0;
      }
      var F = fillHoles(Sd, W, H), nF = 0, nD = 0;
      for (i = 0; i < W * H; i++) { nF += F[i]; nD += Sd[i]; }
      if (nF - nD < 0.08 * W * H && nF - nD < 4 * nD) continue; // non racchiude nulla: contorno aperto
      // esterno = fuori dalla zona chiusa; foro = dentro ma non tratto
      var notExt = F, notHole = new Uint8Array(W * H);
      for (i = 0; i < W * H; i++) notHole[i] = (F[i] && !Sd[i]) ? 0 : 1;
      var dExt = edt(notExt, W, H), dHole = edt(notHole, W, H), f, t;
      if (mode === 'out') { f = dExt; t = r + 0.5; }
      else if (mode === 'in') { f = dHole; t = r + 0.5; }
      else { f = new Float32Array(W * H); for (i = 0; i < W * H; i++) f[i] = dExt[i] - dHole[i]; t = 0; } // mezzeria: equidistante dai due bordi
      var loops = isolines(f, W, H, t), best = null, ba = 0;
      for (i = 0; i < loops.length; i++) { var ar = Math.abs(area(loops[i])); if (ar > ba) { ba = ar; best = loops[i]; } }
      if (best) return { loop: best, gap: r };
    }
    return null;
  }

  // ---------- offset di un contorno chiuso (d > 0 verso l'esterno), spigoli vivi ----------
  function offsetPoly(P, d) {
    var n = P.length, sg = area(P) > 0 ? 1 : -1, out = [];
    // y del disegno verso l'alto: con area positiva (antiorario) l'esterno è a destra del lato
    function nrm(a, b) { var dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1; return { x: sg * dy / L, y: -sg * dx / L }; }
    for (var i = 0; i < n; i++) {
      var A = P[(i + n - 1) % n], B = P[i], Cc = P[(i + 1) % n];
      var n1 = nrm(A, B), n2 = nrm(B, Cc), mx = n1.x + n2.x, my = n1.y + n2.y, ml = Math.hypot(mx, my);
      if (ml < 1e-9) { out.push({ x: B.x + n1.x * d, y: B.y + n1.y * d }); continue; }
      mx /= ml; my /= ml;
      var cs = mx * n1.x + my * n1.y, len = d / Math.max(cs, 0.25);   // spigoli molto acuti: limito la punta
      out.push({ x: B.x + mx * len, y: B.y + my * len });
    }
    return out;
  }

  // ---------- DXF (R12 ASCII, unità mm) ----------
  // layers: [{ name, color, polys:[[{x,y}]] }]
  function dxf(layers, refs) {
    if (Array.isArray(layers) && layers.length && Array.isArray(layers[0])) layers = [{ name: 'SAGOMA', color: 7, polys: layers }];
    var o = ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', String(layers.length + 1)];
    layers.concat([{ name: 'RIFERIMENTI', color: 8 }]).forEach(function (L) {
      o.push('0', 'LAYER', '2', L.name, '70', '0', '62', String(L.color || 7), '6', 'CONTINUOUS');
    });
    o.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');
    function n(v) { return (Math.round(v * 1000) / 1000).toString(); }
    layers.forEach(function (L) {
      L.polys.forEach(function (P) {
        o.push('0', 'POLYLINE', '8', L.name, '66', '1', '10', '0', '20', '0', '30', '0', '70', '1');
        P.forEach(function (p) { o.push('0', 'VERTEX', '8', L.name, '10', n(p.x), '20', n(p.y), '30', '0'); if (p.b) o.push('42', (Math.round(p.b * 1e8) / 1e8).toString()); });
        o.push('0', 'SEQEND', '8', L.name);
      });
    });
    (refs || []).forEach(function (p) {
      var s = 15;
      o.push('0', 'LINE', '8', 'RIFERIMENTI', '10', n(p.x - s), '20', n(p.y), '30', '0', '11', n(p.x + s), '21', n(p.y), '31', '0');
      o.push('0', 'LINE', '8', 'RIFERIMENTI', '10', n(p.x), '20', n(p.y - s), '30', '0', '11', n(p.x), '21', n(p.y + s), '31', '0');
    });
    o.push('0', 'ENDSEC', '0', 'EOF');
    return o.join('\r\n') + '\r\n';
  }

  // ---------- ZIP senza compressione (un solo file) ----------
  function zipOne(name, text) {
    var enc = new TextEncoder(), data = enc.encode(text), nm = enc.encode(name), T = zipOne.T;
    if (!T) {
      T = zipOne.T = new Uint32Array(256);
      for (var i = 0; i < 256; i++) { var c = i; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); T[i] = c >>> 0; }
    }
    var crc = 0xFFFFFFFF;
    for (i = 0; i < data.length; i++) crc = T[(crc ^ data[i]) & 255] ^ (crc >>> 8);
    crc = (crc ^ 0xFFFFFFFF) >>> 0;
    var out = new Uint8Array(30 + nm.length + data.length + 46 + nm.length + 22), v = new DataView(out.buffer), p = 0;
    v.setUint32(p, 0x04034b50, true); v.setUint16(p + 4, 20, true); v.setUint16(p + 12, 0x21, true);
    v.setUint32(p + 14, crc, true); v.setUint32(p + 18, data.length, true); v.setUint32(p + 22, data.length, true);
    v.setUint16(p + 26, nm.length, true); out.set(nm, p + 30); out.set(data, p + 30 + nm.length);
    var cd = 30 + nm.length + data.length; p = cd;
    v.setUint32(p, 0x02014b50, true); v.setUint16(p + 4, 20, true); v.setUint16(p + 6, 20, true); v.setUint16(p + 14, 0x21, true);
    v.setUint32(p + 16, crc, true); v.setUint32(p + 20, data.length, true); v.setUint32(p + 24, data.length, true);
    v.setUint16(p + 28, nm.length, true); out.set(nm, p + 46);
    p = cd + 46 + nm.length;
    v.setUint32(p, 0x06054b50, true); v.setUint16(p + 8, 1, true); v.setUint16(p + 10, 1, true);
    v.setUint32(p + 12, 46 + nm.length, true); v.setUint32(p + 16, cd, true);
    return out;
  }

  // ---------- pipeline: foto raddrizzata -> candidati ----------
  // opts: {rgba, iw, ih, imgPts[4], world[4], markerRadiusMm[4]?, sens, maxPx}
  function prepare(o) {
    var Hwi = o.Hwi || homography(o.world, o.imgPts);
    if (!Hwi) return { error: 'I 4 riferimenti sono allineati o coincidenti.' };
    if (!o.imgPts) o.imgPts = o.world.map(function (q) { return applyH(Hwi, q.x, q.y); });
    var xs = o.world.map(function (p) { return p.x; }), ys = o.world.map(function (p) { return p.y; });
    var x0 = Math.min.apply(0, xs), x1 = Math.max.apply(0, xs), y0 = Math.min.apply(0, ys), y1 = Math.max.apply(0, ys);
    var mg = 0.06 * Math.max(x1 - x0, y1 - y0) + (o.extraMargin || 0);
    x0 -= mg; y0 -= mg; x1 += mg; y1 += mg;
    var photoRes = (dist(o.world[0], o.world[2]) / dist(o.imgPts[0], o.imgPts[2]) + dist(o.world[1], o.world[3]) / dist(o.imgPts[1], o.imgPts[3])) / 2;
    var mmpp = Math.max(0.35, photoRes * 0.9, Math.max(x1 - x0, y1 - y0) / (o.maxPx || 2600));
    var W = Math.ceil((x1 - x0) / mmpp), H = Math.ceil((y1 - y0) / mmpp);
    var g = rectify(o.rgba, o.iw, o.ih, Hwi, x0, y0, mmpp, W, H, o.lens);
    return { Hwi: Hwi, x0: x0, y0: y0, mmpp: mmpp, W: W, H: H, g: g, photoRes: photoRes, world: o.world, erase: o.erase || [], erasePolys: o.erasePolys || [] };
  }
  function segment(R, sens) {
    var m = threshold(R.g, R.W, R.H, Math.round(30 / R.mmpp), sens);
    R.erase.forEach(function (e) { eraseDisk(m, R.W, R.H, (e.x - R.x0) / R.mmpp, (e.y - R.y0) / R.mmpp, e.r / R.mmpp); });
    R.erasePolys.forEach(function (P) { erasePoly(m, R.W, R.H, P.map(function (q) { return { x: (q.x - R.x0) / R.mmpp, y: (q.y - R.y0) / R.mmpp }; })); });
    var L = label(m, R.W, R.H, edt(m, R.W, R.H)), best = 0, bs = 0;
    L.comps.forEach(function (c) {
      if (!c) return;
      c.wmm = c.width * R.mmpp;
      c.diag = Math.hypot(c.x1 - c.x0, c.y1 - c.y0) * R.mmpp;
      c.ok = c.diag > 60 && c.wmm < 9 && c.count > 30;
      var score = (c.x1 - c.x0) * (c.y1 - c.y0);
      if (c.ok && score > bs) { bs = score; best = c.id; }
    });
    R.lab = L.lab; R.comps = L.comps; R.best = best;
    return R;
  }
  // contorno in mm (y verso l'alto, origine nell'angolo in basso a sinistra della sagoma)
  function outline(R, ids, mode, tolMm) {
    var x0 = R.W, y0 = R.H, x1 = 0, y1 = 0, wsum = 0, cnt = 0;
    ids.forEach(function (id) {
      var c = R.comps[id]; if (!c) return;
      x0 = Math.min(x0, c.x0); y0 = Math.min(y0, c.y0); x1 = Math.max(x1, c.x1); y1 = Math.max(y1, c.y1);
      wsum += c.width * c.count; cnt += c.count;
    });
    if (!cnt) return { error: 'Nessun tratto selezionato.' };
    var w = wsum / cnt, gaps = [0, 1.5, 3, 6, 10].map(function (mm) { return mm / R.mmpp; });
    var pad = Math.ceil(gaps[gaps.length - 1]) + 4;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(R.W - 1, x1 + pad); y1 = Math.min(R.H - 1, y1 + pad);
    var w2 = x1 - x0 + 3, h2 = y1 - y0 + 3, S = new Uint8Array(w2 * h2), set = new Set(ids);
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++)
      if (set.has(R.lab[y * R.W + x])) S[(y - y0 + 1) * w2 + (x - x0 + 1)] = 1;
    var tr = traceOutline(S, w2, h2, w, mode, gaps);
    if (!tr) return { error: 'Il tratto scelto non si chiude su se stesso. Ripassa il pennarello dove è interrotto, oppure aumenta la sensibilità.' };
    var mm = tr.loop.map(function (p) { return { x: R.x0 + (p.x + x0 - 1) * R.mmpp, y: R.y0 + (p.y + y0 - 1) * R.mmpp }; });
    for (var pass = 0; pass < 2; pass++) { // leviga il tremolio dei pixel
      var sm = [], nn = mm.length;
      for (var k = 0; k < nn; k++) { var pa = mm[(k + nn - 1) % nn], pb = mm[k], pc = mm[(k + 1) % nn]; sm.push({ x: (pa.x + 2 * pb.x + pc.x) / 4, y: (pa.y + 2 * pb.y + pc.y) / 4 }); }
      mm = sm;
    }
    var simp = sharpen(simplifyClosed(mm, tolMm), w * R.mmpp);
    return { world: simp, raw: mm, strokeMm: w * R.mmpp, gapMm: tr.gap * R.mmpp };
  }
  function toDrawing(world, refs) { // lato dritto più lungo in orizzontale, y in alto, origine in basso a sinistra
    // orientamento: rettangolo d'ingombro di area minima (si allinea al lato dritto principale)
    var th = 0, ba = Infinity, i, n = world.length;
    for (var s = -900; s < 900; s++) {
      var t = s * Math.PI / 3600, c = Math.cos(t), si0 = Math.sin(t), ax = Infinity, bx = -Infinity, ay = Infinity, by = -Infinity;
      for (i = 0; i < n; i++) {
        var u = world[i].x * c + world[i].y * si0, v = world[i].y * c - world[i].x * si0;
        if (u < ax) ax = u; if (u > bx) bx = u; if (v < ay) ay = v; if (v > by) by = v;
      }
      var ar = (bx - ax) * (by - ay);
      if (ar < ba - 1e-6 || (Math.abs(ar - ba) <= 1e-6 && Math.abs(t) < Math.abs(th))) { ba = ar; th = t; }
    }
    // orientamento come nella foto: ruoto al massimo di 45° per raddrizzare il lato principale
    while (th > Math.PI / 4) th -= Math.PI / 2;
    while (th <= -Math.PI / 4) th += Math.PI / 2;
    var co = Math.cos(-th), si = Math.sin(-th);
    function rot(p) { return { x: p.x * co - p.y * si, y: p.x * si + p.y * co }; }
    world = world.map(rot); refs = (refs || []).map(rot);
    var minX = Infinity, maxY = -Infinity, maxX = -Infinity, minY = Infinity;
    world.forEach(function (p) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
    function f(p) { return { x: p.x - minX, y: maxY - p.y }; }
    // trasformazione mondo (mm, y in basso) -> disegno (mm, y in alto) e inversa
    function tf(p) { return f(rot(p)); }
    function inv(q) { var x = q.x + minX, y = maxY - q.y; return { x: x * co + y * si, y: -x * si + y * co }; }
    return { poly: world.map(f), refs: (refs || []).map(f), width: maxX - minX, height: maxY - minY, tf: tf, inv: inv };
  }


  // =====================================================================
  //  Risolutore "solo foto": omografia + pose dei marker di lato noto
  // =====================================================================
  var SHEET = { side: 240, w: 297, h: 420, top: 30 }; // layout del foglio A3 (mm)

  function inv3(h) {
    var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7], l = h[8];
    var A = e * l - f * k, B = -(d * l - f * g), Cc = d * k - e * g;
    var r = [A, -(b * l - c * k), b * f - c * e, B, a * l - c * g, -(a * f - c * d), Cc, -(a * k - b * g), a * e - b * d];
    var n = r[8]; return r.map(function (v) { return v / n; });
  }
  function mul3(A, B) {
    var r = [];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) r.push(A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]);
    var n = r[8]; return r.map(function (v) { return v / n; });
  }
  function dltLS(src, dst) { // omografia ai minimi quadrati (>= 4 punti)
    var N = [], v = [], i, j, k;
    for (i = 0; i < 8; i++) { N.push(new Array(8).fill(0)); v.push(0); }
    for (k = 0; k < src.length; k++) {
      var x = src[k].x, y = src[k].y, u = dst[k].x, w = dst[k].y;
      var rows = [[x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -w * x, -w * y, w]];
      rows.forEach(function (r) { for (i = 0; i < 8; i++) { v[i] += r[i] * r[8]; for (j = 0; j < 8; j++) N[i][j] += r[i] * r[j]; } });
    }
    var h = solve(N, v); return h ? h.concat([1]) : null;
  }
  function procrustes(P, Q) { // rotazione+traslazione che porta P su Q
    var n = P.length, px = 0, py = 0, qx = 0, qy = 0, i;
    for (i = 0; i < n; i++) { px += P[i].x; py += P[i].y; qx += Q[i].x; qy += Q[i].y; }
    px /= n; py /= n; qx /= n; qy /= n;
    var sn = 0, cs = 0;
    for (i = 0; i < n; i++) {
      var ax = P[i].x - px, ay = P[i].y - py, bx = Q[i].x - qx, by = Q[i].y - qy;
      sn += ax * by - ay * bx; cs += ax * bx + ay * by;
    }
    var th = Math.atan2(sn, cs), c = Math.cos(th), s = Math.sin(th);
    return { th: th, tx: qx - (c * px - s * py), ty: qy - (s * px + c * py) };
  }
  function cholesky(A) {
    var n = A.length, L = [], i, j, k;
    for (i = 0; i < n; i++) L.push(new Float64Array(n));
    for (i = 0; i < n; i++) for (j = 0; j <= i; j++) {
      var s = A[i][j];
      for (k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) L[i][i] = Math.sqrt(Math.max(s, 1e-30)); else L[i][j] = s / L[j][j];
    }
    return L;
  }
  function invSym(A) {
    var n = A.length, out = [];
    for (var i = 0; i < n; i++) out.push(new Array(n));
    for (var c = 0; c < n; c++) {
      var e = new Array(n).fill(0); e[c] = 1;
      var col = solve(A.map(function (r) { return r.slice(); }), e);
      for (var r = 0; r < n; r++) out[r][c] = col[r];
    }
    for (i = 0; i < n; i++) for (var j = 0; j < i; j++) { var m = (out[i][j] + out[j][i]) / 2; out[i][j] = out[j][i] = m; }
    return out;
  }
  function rng(seed) { return function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
  function gauss(r) { var u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // o: {markers:[{id, img:[4]}], iw, ih, a, b, sigmaRuler(mm), dists:[{i,j,d}] (id, mm), sigmaTape(mm), sigmaFloorPx}
  function solveMarkers(o) {
    var ms = o.markers, K = ms.length, cx = o.iw / 2, cy = o.ih / 2, sc = Math.max(o.iw, o.ih);
    var obs = ms.map(function (m) { return m.img.map(function (p) { return { x: (p.x - cx) / sc, y: (p.y - cy) / sc }; }); });
    var idx = {}; ms.forEach(function (m, k) { idx[m.id] = k; });
    var a0 = o.a / 1000, b0 = o.b / 1000, sr = (o.sigmaRuler || 0.3) / 1000, st = (o.sigmaTape || 0.8) / 1000;
    var dists = (o.dists || []).filter(function (d) { return idx[d.i] != null && idx[d.j] != null && d.d > 0; });
    var NP = 11 + 3 * (K - 1), SK = 0.01; // k1: distorsione radiale residua della lente
    function local(a, b) { return [{ x: -a / 2, y: -b / 2 }, { x: a / 2, y: -b / 2 }, { x: a / 2, y: b / 2 }, { x: -a / 2, y: b / 2 }]; }
    function pose(p, k) { return k === 0 ? { tx: 0, ty: 0, th: 0 } : { tx: p[11 + 3 * (k - 1)], ty: p[12 + 3 * (k - 1)], th: p[13 + 3 * (k - 1)] }; }
    function dis(q, k1) { var d = 1 + k1 * (q.x * q.x + q.y * q.y); return { x: q.x * d, y: q.y * d }; }
    function und(q, k1) { var u = { x: q.x, y: q.y }; for (var i = 0; i < 5; i++) { var d = 1 + k1 * (u.x * u.x + u.y * u.y); u = { x: q.x / d, y: q.y / d }; } return u; }
    function place(ps, pts) { var c = Math.cos(ps.th), s = Math.sin(ps.th); return pts.map(function (q) { return { x: c * q.x - s * q.y + ps.tx, y: s * q.x + c * q.y + ps.ty }; }); }

    // --- inizializzazione: marker 1 come riferimento, poi alternanza pose/omografia ---
    var H = homography(local(a0, b0), obs[0]), poses = [{ tx: 0, ty: 0, th: 0 }], it, k;
    if (!H) return { error: 'Non riesco a leggere la forma del marker ' + ms[0].id + '.' };
    for (it = 0; it < 4; it++) {
      var Hi = inv3(H);
      for (k = 1; k < K; k++) poses[k] = procrustes(local(a0, b0), obs[k].map(function (q) { return applyH(Hi, q.x, q.y); }));
      var src = [], dst = [];
      for (k = 0; k < K; k++) { src = src.concat(place(poses[k], local(a0, b0))); dst = dst.concat(obs[k]); }
      H = dltLS(src, dst) || H;
    }
    var p = H.slice(0, 8).concat([a0, b0, 0]);
    for (k = 1; k < K; k++) p.push(poses[k].tx, poses[k].ty, poses[k].th);

    var sPx = (o.sigmaFloorPx || 0.25) / sc; // sigma angoli, unità normalizzate
    function resid(p, sp) {
      var h = p.slice(0, 8).concat([1]), loc = local(p[8], p[9]), r = [];
      for (var k = 0; k < K; k++) {
        var w = place(pose(p, k), loc);
        for (var j = 0; j < 4; j++) { var q = dis(applyH(h, w[j].x, w[j].y), p[10]); r.push((q.x - obs[k][j].x) / sp, (q.y - obs[k][j].y) / sp); }
      }
      r.push((p[8] - a0) / sr, (p[9] - b0) / sr, p[10] / SK);
      dists.forEach(function (d) {
        var A = pose(p, idx[d.i]), B = pose(p, idx[d.j]);
        r.push((Math.hypot(A.tx - B.tx, A.ty - B.ty) - d.d / 1000) / st);
      });
      return r;
    }
    function jac(p, sp, r0) {
      var J = [], i;
      for (i = 0; i < r0.length; i++) J.push(new Float64Array(NP));
      for (var c = 0; c < NP; c++) {
        var hstep = 1e-7 * Math.max(1, Math.abs(p[c])), q = p.slice(); q[c] += hstep;
        var r1 = resid(q, sp);
        for (i = 0; i < r0.length; i++) J[i][c] = (r1[i] - r0[i]) / hstep;
      }
      return J;
    }
    function normal(J, r) {
      var A = [], g = new Array(NP).fill(0), i, j, n;
      for (i = 0; i < NP; i++) A.push(new Array(NP).fill(0));
      for (n = 0; n < J.length; n++) {
        var row = J[n];
        for (i = 0; i < NP; i++) { if (!row[i]) continue; g[i] += row[i] * r[n]; for (j = 0; j < NP; j++) A[i][j] += row[i] * row[j]; }
      }
      return { A: A, g: g };
    }
    function sq(r) { var s = 0; for (var i = 0; i < r.length; i++) s += r[i] * r[i]; return s; }
    function lm(p, sp) {
      var lam = 1e-3, r = resid(p, sp), E = sq(r);
      for (var it = 0; it < 60; it++) {
        var J = jac(p, sp, r), ne = normal(J, r), improved = false;
        for (var t = 0; t < 10; t++) {
          var A = ne.A.map(function (row, i) { var c = row.slice(); c[i] *= 1 + lam; c[i] += 1e-12; return c; });
          var dp = solve(A, ne.g.map(function (v) { return -v; }));
          if (!dp) { lam *= 10; continue; }
          var q = p.map(function (v, i) { return v + dp[i]; }), r2 = resid(q, sp), E2 = sq(r2);
          if (E2 < E) { var rel = (E - E2) / Math.max(E, 1e-30); p = q; r = r2; E = E2; lam = Math.max(lam / 5, 1e-9); improved = true; if (rel < 1e-10) it = 99; break; }
          lam *= 10;
        }
        if (!improved) break;
      }
      return { p: p, r: r, E: E };
    }
    var fit = lm(p, sPx);
    // stima del rumore sugli angoli dai residui, poi rifinitura
    var nc = 8 * K, rss = 0;
    for (var i2 = 0; i2 < nc; i2++) rss += Math.pow(fit.r[i2] * sPx, 2);
    var dof = Math.max(1, nc - (NP - 1));
    var sigN = Math.max(Math.sqrt(rss / dof), (o.sigmaFloorPx || 0.25) / sc);
    if (Math.abs(sigN - sPx) > 0.05 * sPx) { sPx = sigN; fit = lm(fit.p, sPx); }
    p = fit.p;
    var r = resid(p, sPx), J = jac(p, sPx, r), N = normal(J, r).A, Cov = invSym(N);

    var mmS = [1 / 1000, 0, 0, 0, 1 / 1000, 0, 0, 0, 1], D = [sc, 0, cx, 0, sc, cy, 0, 0, 1];
    function Hwi_of(q) { return mul3(mul3(D, q.slice(0, 8).concat([1])), mmS); } // mm -> px
    // sistema di uscita ruotato: la retta tra i primi due marker è orizzontale
    var P1 = pose(p, 0), P2 = pose(p, 1), phi = Math.atan2(P2.ty - P1.ty, P2.tx - P1.tx), cf = Math.cos(phi), sf = Math.sin(phi);
    var Rot = [cf, -sf, 0, sf, cf, 0, 0, 0, 1];
    var Hwi = mul3(Hwi_of(p), Rot), Hiw = inv3(Hwi), k1 = p[10];
    function toImage(w) { var q = applyH(Hwi, w.x, w.y), d = dis({ x: (q.x - cx) / sc, y: (q.y - cy) / sc }, k1); return { x: d.x * sc + cx, y: d.y * sc + cy }; }
    function toWorld(q) { var u = und({ x: (q.x - cx) / sc, y: (q.y - cy) / sc }, k1); return applyH(Hiw, u.x * sc + cx, u.y * sc + cy); }
    var centers = {}, thetas = {};
    ms.forEach(function (m, k) { var ps = pose(p, k); centers[m.id] = { x: (cf * ps.tx + sf * ps.ty) * 1000, y: (-sf * ps.tx + cf * ps.ty) * 1000 }; thetas[m.id] = ps.th - phi; });

    // errore massimo stimato (95%) su un insieme di punti della foto, dopo allineamento rigido
    function tolerance(imgPts, C) {
      C = C || Cov;
      var L = cholesky(C), R = rng(12345), nom = imgPts.map(toWorld), maxes = [];
      var nimg = imgPts.map(function (q) { return { x: (q.x - cx) / sc, y: (q.y - cy) / sc }; });
      for (var s = 0; s < 160; s++) {
        var z = []; for (var i = 0; i < NP; i++) z.push(gauss(R));
        var q = p.slice();
        for (i = 0; i < NP; i++) { var acc = 0; for (var j = 0; j <= i; j++) acc += L[i][j] * z[j]; q[i] += acc; }
        var Hs = inv3(Hwi_of(q)), w = nimg.map(function (t) { var u = und(t, q[10]); return applyH(Hs, u.x * sc + cx, u.y * sc + cy); });
        var T = procrustes(w, nom), c = Math.cos(T.th), sn = Math.sin(T.th), mx = 0;
        for (i = 0; i < w.length; i++) {
          var x = c * w[i].x - sn * w[i].y + T.tx, y = sn * w[i].x + c * w[i].y + T.ty;
          mx = Math.max(mx, Math.hypot(x - nom[i].x, y - nom[i].y));
        }
        maxes.push(mx);
      }
      maxes.sort(function (a, b) { return a - b; });
      return maxes[Math.floor(0.95 * maxes.length)];
    }
    function distRow(i, j) {
      var row = new Array(NP).fill(0), A = pose(p, idx[i]), B = pose(p, idx[j]), dx = A.tx - B.tx, dy = A.ty - B.ty, L = Math.hypot(dx, dy) || 1e-9;
      if (idx[i] > 0) { row[11 + 3 * (idx[i] - 1)] = dx / L / st; row[12 + 3 * (idx[i] - 1)] = dy / L / st; }
      if (idx[j] > 0) { row[11 + 3 * (idx[j] - 1)] = -dx / L / st; row[12 + 3 * (idx[j] - 1)] = -dy / L / st; }
      return row;
    }
    function covWith(pairs) {
      var A = N.map(function (r) { return r.slice(); });
      pairs.forEach(function (pr) { var row = distRow(pr[0], pr[1]); for (var i = 0; i < NP; i++) for (var j = 0; j < NP; j++) A[i][j] += row[i] * row[j]; });
      return invSym(A);
    }
    // distanza prevista tra due marker e sua incertezza (mm), per controllare le misure del metro
    function predict(i, j) {
      var A = centers[i], B = centers[j], row = distRow(i, j).map(function (v) { return v * st * 1000; }), v = 0;
      for (var a = 0; a < NP; a++) for (var b = 0; b < NP; b++) v += row[a] * Cov[a][b] * row[b];
      return { d: dist(A, B), sd: Math.sqrt(Math.max(v, 0)) };
    }
    // sceglie le distanze più utili da misurare finché l'errore scende sotto il limite
    function suggest(imgPts, limit) {
      var ids = ms.map(function (m) { return m.id; }), cand = [], chosen = [], cur = tolerance(imgPts);
      for (var a = 0; a < ids.length; a++) for (var b = a + 1; b < ids.length; b++) cand.push([ids[a], ids[b]]);
      dists.forEach(function (d) { chosen.push([d.i, d.j]); });
      cand = cand.filter(function (c) { return !chosen.some(function (h) { return (h[0] === c[0] && h[1] === c[1]) || (h[0] === c[1] && h[1] === c[0]); }); });
      var picked = [];
      while (cur > limit && cand.length) {
        var best = -1, bv = Infinity;
        for (var c = 0; c < cand.length; c++) {
          var v = tolerance(imgPts, covWith(chosen.concat(picked, [cand[c]])));
          if (v < bv - 1e-9) { bv = v; best = c; }
        }
        picked.push(cand[best]); cand.splice(best, 1); cur = bv;
      }
      return { pairs: picked, tol: cur };
    }
    return {
      Hwi: Hwi, Hiw: Hiw, centers: centers, thetas: thetas, a: p[8] * 1000, b: p[9] * 1000, k1: k1, lens: { k1: k1, cx: cx, cy: cy, sc: sc },
      toImage: toImage, toWorld: toWorld,
      sigmaPx: sPx * sc, tolerance: tolerance, suggest: suggest, predict: predict, nDists: dists.length
    };
  }
  // poligoni dei fogli da cancellare dalla maschera (mm, sistema mondo)
  function sheetPolys(sol, margin) {
    var out = [], m = margin == null ? 15 : margin, S = SHEET;
    Object.keys(sol.centers).forEach(function (id) {
      var c = sol.centers[id], th = sol.thetas[id], co = Math.cos(th), si = Math.sin(th);
      var y0 = -S.top - S.side / 2 - m, y1 = S.h - S.top - S.side / 2 + m, x0 = -S.w / 2 - m, x1 = S.w / 2 + m;
      out.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(function (q) { return { x: co * q[0] - si * q[1] + c.x, y: si * q[0] + co * q[1] + c.y }; }));
    });
    return out;
  }

  root.Core = {
    homography: homography, applyH: applyH, dist: dist, quadFromDistances: quadFromDistances,
    refineQuad: refineQuad, quadCenter: quadCenter, prepare: prepare, segment: segment, outline: outline,
    toDrawing: toDrawing, dxf: dxf, offsetPoly: offsetPoly, zipOne: zipOne, area: area, perimeter: perimeter, edt: edt,
    solveMarkers: solveMarkers, sheetPolys: sheetPolys, SHEET: SHEET, inv3: inv3,
    isolines: isolines, simplifyClosed: simplifyClosed, sharpen: sharpen, label: label
  };
})(typeof window !== 'undefined' ? window : globalThis);
