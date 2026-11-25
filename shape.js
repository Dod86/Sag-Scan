/* Scanner di sagome: regolarizzazione del contorno in rette e archi, offset esatto, campionamento.
   Una forma è una polilinea chiusa con "bulge" (come in AutoCAD): [{x, y, b}], b = tan(angolo/4) del tratto che parte dal vertice. */
(function (root) {
  'use strict';

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function area(P) { var s = 0; for (var i = 0, n = P.length; i < n; i++) { var a = P[i], b = P[(i + 1) % n]; s += a.x * b.y - b.x * a.y; } return s / 2; }

  // ---------- adattamenti ----------
  function fitLine(P, i, j) {
    var n = j - i + 1, mx = 0, my = 0, k;
    for (k = i; k <= j; k++) { mx += P[k].x; my += P[k].y; }
    mx /= n; my /= n;
    var sxx = 0, sxy = 0, syy = 0;
    for (k = i; k <= j; k++) { var ax = P[k].x - mx, ay = P[k].y - my; sxx += ax * ax; sxy += ax * ay; syy += ay * ay; }
    var th = 0.5 * Math.atan2(2 * sxy, sxx - syy), dx = Math.cos(th), dy = Math.sin(th), mxd = 0, ss = 0;
    for (k = i; k <= j; k++) { var e = Math.abs((P[k].x - mx) * dy - (P[k].y - my) * dx); mxd = Math.max(mxd, e); ss += e * e; }
    return { type: 'L', px: mx, py: my, dx: dx, dy: dy, err: mxd, rms: Math.sqrt(ss / n) };
  }
  function fitCircle(P, i, j) {
    var n = j - i + 1; if (n < 8) return null;
    var mx = 0, my = 0, k;
    for (k = i; k <= j; k++) { mx += P[k].x; my += P[k].y; }
    mx /= n; my /= n;
    // Kåsa: x²+y² + D x + E y + F = 0 su coordinate centrate
    var Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0, Sz = 0, Sxz = 0, Syz = 0;
    for (k = i; k <= j; k++) {
      var x = P[k].x - mx, y = P[k].y - my, z = x * x + y * y;
      Sxx += x * x; Sxy += x * y; Syy += y * y; Sx += x; Sy += y; Sz += z; Sxz += x * z; Syz += y * z;
    }
    var A = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]], bv = [-Sxz, -Syz, -Sz];
    var s = solve3(A, bv); if (!s) return null;
    var cx = -s[0] / 2, cy = -s[1] / 2, r2 = cx * cx + cy * cy - s[2];
    if (!(r2 > 0)) return null;
    var r = Math.sqrt(r2), mxd = 0, ss = 0;
    for (k = i; k <= j; k++) { var e = Math.abs(Math.hypot(P[k].x - mx - cx, P[k].y - my - cy) - r); mxd = Math.max(mxd, e); ss += e * e; }
    var c = { x: cx + mx, y: cy + my };
    // ampiezza dell'arco coperto e verso
    var a0 = Math.atan2(P[i].y - c.y, P[i].x - c.x), tot = 0, prev = a0;
    for (k = i + 1; k <= j; k++) { var a = Math.atan2(P[k].y - c.y, P[k].x - c.x), d = a - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; tot += d; prev = a; }
    return { type: 'A', cx: c.x, cy: c.y, r: r, err: mxd, rms: Math.sqrt(ss / n), sweep: tot };
  }
  function solve3(A, b) {
    var a = A[0][0], bb = A[0][1], c = A[0][2], d = A[1][0], e = A[1][1], f = A[1][2], g = A[2][0], h = A[2][1], k = A[2][2];
    var det = a * (e * k - f * h) - bb * (d * k - f * g) + c * (d * h - e * g);
    if (Math.abs(det) < 1e-18) return null;
    var inv = [[e * k - f * h, c * h - bb * k, bb * f - c * e], [f * g - d * k, a * k - c * g, c * d - a * f], [d * h - e * g, bb * g - a * h, a * e - bb * d]];
    return [0, 1, 2].map(function (r) { return (inv[r][0] * b[0] + inv[r][1] * b[1] + inv[r][2] * b[2]) / det; });
  }

  // ---------- spigoli: forte cambio di direzione a scala di qualche centimetro ----------
  function corners(P, Lc, minTurn) {
    var n = P.length, cum = [0], i;
    for (i = 1; i < n; i++) cum.push(cum[i - 1] + dist(P[i - 1], P[i]));
    var per = cum[n - 1] + dist(P[n - 1], P[0]);
    function at(i, off) { // indice del punto a distanza off lungo il contorno (anello)
      var target = cum[i] + off; target = ((target % per) + per) % per;
      var lo = 0, hi = n - 1;
      while (lo < hi) { var m = (lo + hi + 1) >> 1; if (cum[m] <= target) lo = m; else hi = m - 1; }
      return lo;
    }
    var turn = new Float64Array(n);
    for (i = 0; i < n; i++) {
      var A = P[at(i, -Lc)], B = P[i], Cq = P[at(i, Lc)];
      var u = { x: B.x - A.x, y: B.y - A.y }, v = { x: Cq.x - B.x, y: Cq.y - B.y };
      var lu = Math.hypot(u.x, u.y), lv = Math.hypot(v.x, v.y);
      if (lu < 1e-9 || lv < 1e-9) continue;
      turn[i] = Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / (lu * lv))));
    }
    var out = [];
    for (i = 0; i < n; i++) {
      if (turn[i] < minTurn) continue;
      var best = true;
      for (var k = 1; best && cum[(i + k) % n] !== undefined && k < n; k++) {
        var j = (i + k) % n, dd = Math.abs(cum[j] - cum[i]); dd = Math.min(dd, per - dd);
        if (dd > Lc) break;
        if (turn[j] > turn[i]) best = false;
      }
      for (k = 1; best && k < n; k++) {
        var j2 = (i - k + n) % n, d2 = Math.abs(cum[j2] - cum[i]); d2 = Math.min(d2, per - d2);
        if (d2 > Lc) break;
        if (turn[j2] >= turn[i]) best = false;
      }
      if (best) out.push(i);
    }
    return out;
  }

  function smooth(P, passes) {
    for (var p = 0; p < passes; p++) {
      var n = P.length, o = [];
      for (var i = 0; i < n; i++) { var a = P[(i + n - 1) % n], b = P[i], c = P[(i + 1) % n]; o.push({ x: (a.x + 2 * b.x + c.x) / 4, y: (a.y + 2 * b.y + c.y) / 4 }); }
      P = o;
    }
    return P;
  }
  // ---------- adattamento più lungo possibile a partire da i ----------
  function longest(P, i, end, ok, minN) {
    var first = Math.min(end, i + (minN || 1)), f = ok(i, first);
    if (!f) return { j: i, fit: null };
    var lo = first, good = f, step = Math.max(1, first - i), hi = lo + step;
    while (hi <= end && (f = ok(i, hi))) { lo = hi; good = f; step *= 2; hi = lo + step; }
    hi = Math.min(hi, end);
    if (hi > lo && (f = ok(i, hi))) return { j: hi, fit: f };
    while (hi - lo > 1) { var m = (lo + hi) >> 1; f = ok(i, m); if (f) { lo = m; good = f; } else hi = m; }
    return { j: lo, fit: good };
  }

  // P: contorno denso chiuso (mm, y in alto), tol: mm, arcs: true/false
  function regularize(P, tol, arcs) {
    var n = P.length; if (n < 6) return null;
    P = smooth(P, 2);
    var cs = corners(P, Math.max(8, 6 * tol), 28 * Math.PI / 180);
    // ruoto l'anello in modo che inizi da uno spigolo (se c'è)
    var start = cs.length ? cs[0] : 0;
    var Q = P.slice(start).concat(P.slice(0, start + 1));   // chiuso: ultimo = primo
    var cut = cs.map(function (c) { return (c - start + n) % n; }).sort(function (a, b) { return a - b; });
    cut.push(n);
    var prims = [];
    // tol = ampiezza delle irregolarità da spianare: media entro tol, nessun punto oltre 2,5 tol
    function okLine(i, j) { var f = fitLine(Q, i, j); return f.rms <= tol && f.err <= 2.5 * tol ? f : null; }
    function okArc(i, j) {
      if (!arcs) return null;
      var f = fitCircle(Q, i, j);
      if (!f || f.rms > tol || f.err > 2.5 * tol || f.r > 20000 || f.r < 15) return null;
      return f;
    }
    for (var s = 0; s < cut.length - 1; s++) {
      var i = cut[s], end = cut[s + 1];
      while (i < end) {
        var L = longest(Q, i, end, okLine, 1), A = arcs ? longest(Q, i, end, okArc, 12) : null;
        if (!L.fit) L = { j: i + 1, fit: fitLine(Q, i, i + 1) };
        // l'arco vince solo se copre di più ed è un arco vero (almeno 8° e una freccia oltre la tolleranza)
        var arcOk = A && A.fit && Math.abs(A.fit.sweep) >= 8 * Math.PI / 180 && A.fit.r * (1 - Math.cos(Math.abs(A.fit.sweep) / 2)) > 2 * tol;
        var pick = (arcOk && A.j > L.j + 3) ? { j: A.j, f: A.fit } : { j: L.j, f: L.fit };
        if (pick.j <= i) pick = { j: i + 1, f: fitLine(Q, i, i + 1) };
        pick.f.i = i; pick.f.j = pick.j; pick.f.mid = Q[(i + pick.j) >> 1];
        prims.push(pick.f);
        i = pick.j;
      }
    }
    // unisco primitive consecutive dello stesso tipo se insieme stanno ancora in tolleranza
    for (var k = 0; k < prims.length - 1; k++) {
      var a = prims[k], b = prims[k + 1];
      if (a.type !== b.type) continue;
      var f2 = a.type === 'L' ? okLine(a.i, b.j) : okArc(a.i, b.j);
      if (f2) { f2.i = a.i; f2.j = b.j; f2.mid = Q[(a.i + b.j) >> 1]; prims.splice(k, 2, f2); k--; }
    }
    return build(prims, Q);
  }

  // ---------- vertici: incrocio tra primitive consecutive ----------
  function interLL(a, b) {
    var den = a.dx * b.dy - a.dy * b.dx;
    if (Math.abs(den) < Math.sin(1.5 * Math.PI / 180)) return null;
    var t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / den;
    return [{ x: a.px + t * a.dx, y: a.py + t * a.dy }];
  }
  function interLC(l, c) {
    var fx = l.px - c.cx, fy = l.py - c.cy, B = fx * l.dx + fy * l.dy, Cc = fx * fx + fy * fy - c.r * c.r, D = B * B - Cc;
    if (D < 0) return null;
    var s = Math.sqrt(D);
    return [-B - s, -B + s].map(function (t) { return { x: l.px + t * l.dx, y: l.py + t * l.dy }; });
  }
  function interCC(a, b) {
    var dx = b.cx - a.cx, dy = b.cy - a.cy, d = Math.hypot(dx, dy);
    if (d < 1e-9 || d > a.r + b.r || d < Math.abs(a.r - b.r)) return null;
    var x = (d * d + a.r * a.r - b.r * b.r) / (2 * d), h = Math.sqrt(Math.max(0, a.r * a.r - x * x));
    var mx = a.cx + dx * x / d, my = a.cy + dy * x / d;
    return [{ x: mx - dy * h / d, y: my + dx * h / d }, { x: mx + dy * h / d, y: my - dx * h / d }];
  }
  function project(p, q) {
    if (p.type === 'L') { var t = (q.x - p.px) * p.dx + (q.y - p.py) * p.dy; return { x: p.px + t * p.dx, y: p.py + t * p.dy }; }
    var vx = q.x - p.cx, vy = q.y - p.cy, l = Math.hypot(vx, vy) || 1; return { x: p.cx + vx / l * p.r, y: p.cy + vy / l * p.r };
  }
  function junction(a, b, q, maxD) {
    var c = a.type === 'L' && b.type === 'L' ? interLL(a, b) : a.type === 'L' ? interLC(a, b) : b.type === 'L' ? interLC(b, a) : interCC(a, b);
    var best = null, bd = Infinity;
    (c || []).forEach(function (p) { var d = dist(p, q); if (d < bd) { bd = d; best = p; } });
    if (best && bd <= maxD) return best;
    var pa = project(a, q), pb = project(b, q);   // quasi tangenti: punto medio delle proiezioni
    return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
  }
  function bulgeOf(p, A, B, mid) {
    if (p.type !== 'A') return 0;
    var c = { x: p.cx, y: p.cy };
    function ang(q) { return Math.atan2(q.y - c.y, q.x - c.x); }
    var a0 = ang(A), a1 = ang(B), am = ang(mid);
    function ccw(from, to) { var d = to - from; while (d < 0) d += 2 * Math.PI; while (d >= 2 * Math.PI) d -= 2 * Math.PI; return d; }
    var sw = ccw(a0, a1);
    if (ccw(a0, am) > sw) sw = sw - 2 * Math.PI;   // il punto di mezzo sta dall'altra parte: verso orario
    return Math.tan(sw / 4);
  }
  function build(prims, Q) {
    var m = prims.length; if (m < 2) return null;
    var V = [];
    for (var k = 0; k < m; k++) {
      var a = prims[(k + m - 1) % m], b = prims[k], q = Q[b.i];
      V.push(junction(a, b, q, 10));
    }
    var shape = V.map(function (v, k) { return { x: v.x, y: v.y, b: bulgeOf(prims[k], v, V[(k + 1) % m], prims[k].mid) }; });
    shape.prims = prims.map(function (p) { return p.type === 'L' ? { type: 'L' } : { type: 'A', cx: p.cx, cy: p.cy, r: p.r }; });
    return shape;
  }

  // ---------- campionamento (anteprima, misure) ----------
  function arcInfo(A, B, b) {
    var th = 4 * Math.atan(b), ch = dist(A, B), r = ch / (2 * Math.sin(Math.abs(th) / 2));
    var mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, ux = (B.x - A.x) / ch, uy = (B.y - A.y) / ch;
    var h = r * Math.cos(th / 2) * Math.sign(th), cx = mx - uy * h, cy = my + ux * h;
    return { cx: cx, cy: cy, r: r, th: th, a0: Math.atan2(A.y - cy, A.x - cx) };
  }
  function sample(shape, stepMm) {
    var out = [], n = shape.length;
    for (var i = 0; i < n; i++) {
      var A = shape[i], B = shape[(i + 1) % n];
      out.push({ x: A.x, y: A.y });
      if (Math.abs(A.b) > 1e-9) {
        var g = arcInfo(A, B, A.b), N = Math.max(4, Math.ceil(Math.abs(g.th) * g.r / (stepMm || 3)));
        for (var k = 1; k < N; k++) { var a = g.a0 + g.th * k / N; out.push({ x: g.cx + g.r * Math.cos(a), y: g.cy + g.r * Math.sin(a) }); }
      }
    }
    return out;
  }

  // ---------- offset esatto: rette parallele, archi concentrici, spigoli vivi ----------
  function offset(shape, d) {
    var n = shape.length, O = area(sample(shape, 5)) > 0 ? 1 : -1, segs = [];
    for (var i = 0; i < n; i++) {
      var A = shape[i], B = shape[(i + 1) % n];
      if (Math.abs(A.b) < 1e-9) {
        var dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1, nx = O * dy / L, ny = -O * dx / L;
        segs.push({ type: 'L', px: A.x + nx * d, py: A.y + ny * d, dx: dx / L, dy: dy / L, nx: nx, ny: ny });
      } else {
        var g = arcInfo(A, B, A.b), r2 = g.r + (Math.sign(g.th) === O ? d : -d);
        if (r2 <= 1) { // arco troppo stretto verso l'interno: lo tratto come corda
          var dx2 = B.x - A.x, dy2 = B.y - A.y, L2 = Math.hypot(dx2, dy2) || 1;
          segs.push({ type: 'L', px: A.x + O * dy2 / L2 * d, py: A.y - O * dx2 / L2 * d, dx: dx2 / L2, dy: dy2 / L2, nx: O * dy2 / L2, ny: -O * dx2 / L2 });
        } else segs.push({ type: 'A', cx: g.cx, cy: g.cy, r: r2, th: g.th });
      }
    }
    function off(i, P) { // posizione di riferimento: vertice spostato lungo la normale media
      var s0 = segs[(i + n - 1) % n], s1 = segs[i];
      function nrm(s, p) { if (s.type === 'L') return { x: s.nx, y: s.ny }; var vx = p.x - s.cx, vy = p.y - s.cy, l = Math.hypot(vx, vy) || 1, sg = Math.sign(s.th) === O ? 1 : -1; return { x: sg * vx / l, y: sg * vy / l }; }
      var a = nrm(s0, P), b = nrm(s1, P), mx = a.x + b.x, my = a.y + b.y, ml = Math.hypot(mx, my) || 1;
      var cosh = (mx / ml) * a.x + (my / ml) * a.y;
      return { x: P.x + mx / ml * d / Math.max(cosh, 0.25), y: P.y + my / ml * d / Math.max(cosh, 0.25) };
    }
    var V = [];
    for (i = 0; i < n; i++) V.push(junction(segs[(i + n - 1) % n], segs[i], off(i, shape[i]), Math.max(4 * d, 30)));
    return V.map(function (v, k) {
      var s = segs[k]; if (s.type !== 'A') return { x: v.x, y: v.y, b: 0 };
      var W = V[(k + 1) % n], a0 = Math.atan2(v.y - s.cy, v.x - s.cx), a1 = Math.atan2(W.y - s.cy, W.x - s.cx), sw = a1 - a0;
      if (s.th > 0) { while (sw <= 0) sw += 2 * Math.PI; } else { while (sw >= 0) sw -= 2 * Math.PI; }
      return { x: v.x, y: v.y, b: Math.tan(sw / 4) };
    });
  }

  root.Shape = { regularize: regularize, sample: sample, offset: offset, area: area };
})(typeof window !== 'undefined' ? window : globalThis);
