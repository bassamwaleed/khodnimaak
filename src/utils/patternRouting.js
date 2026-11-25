// تخطيط مسار واعي بالخط (pattern): كل ركوب = خط واحد بترتيب محطاته الفعلي.
// التبديل بس في نفس النقطة (نفس stop_id). مفيش مشي مخترع. الأجرة/الوقت مجهولين لحد ما يتسجلوا.
export const buildPatternGraph = (patterns) => {
  const byStop = new Map(); // stopId -> [{pi, idx}]
  patterns.forEach((p, pi) => p.stopIds.forEach((s, idx) => {
    if (!byStop.has(s)) byStop.set(s, []);
    byStop.get(s).push({ pi, idx });
  }));
  return { patterns, byStop };
};

// Dijkstra على حالة (محطة، خط راكبه). تكلفة الترتيب فقط: 1 لكل محطة، 25 لكل ركوبة جديدة.
// الناتج: legs مدمجة (ركوب واحد لكل خط متصل) بدون أي أجرة/وقت مخترع.
export const planByPattern = (graph, fromStop, toStop, { boardPenalty = 25, maxBoardings = 4 } = {}) => {
  const { patterns, byStop } = graph;
  if (!byStop.has(fromStop) || !byStop.has(toStop)) return null;
  const key = (s, pi, b) => `${s}|${pi}|${b}`;
  const dist = new Map(), prev = new Map();
  const heap = [[0, fromStop, -1, 0]];
  dist.set(key(fromStop, -1, 0), 0);
  const pop = () => { let m = 0; for (let i = 1; i < heap.length; i++) if (heap[i][0] < heap[m][0]) m = i; return heap.splice(m, 1)[0]; };
  let best = null;
  while (heap.length) {
    const [d, s, pi, b] = pop();
    if (d > (dist.get(key(s, pi, b)) ?? Infinity)) continue;
    if (s === toStop) { best = { s, pi, b, d }; break; }
    const push = (ns, npi, nb, nd, step) => {
      const k = key(ns, npi, nb);
      if (nd < (dist.get(k) ?? Infinity)) { dist.set(k, nd); prev.set(k, { from: key(s, pi, b), step }); heap.push([nd, ns, npi, nb]); }
    };
    // كمّل على نفس الخط للمحطة اللي بعدها
    if (pi >= 0) {
      const p = patterns[pi]; const idx = p.stopIds.indexOf(s, 0);
      // idx صحيح لأن المحطة ممكن تتكرر نادرًا؛ نستخدم أول ظهور بعد آخر موضع محفوظ
      const pos = (prev.get(key(s, pi, b))?.step?.idx ?? idx);
      if (pos + 1 < p.stopIds.length) push(p.stopIds[pos + 1], pi, b, d + 1, { type: 'ride', pi, idx: pos + 1 });
    }
    // اركب خط جديد من نفس المحطة (ده الوحيد "التبديل": نفس النقطة)
    if (b < maxBoardings) for (const { pi: npi, idx } of byStop.get(s)) {
      if (npi === pi) continue;
      const k = key(s, npi, b + 1);
      const nd = d + boardPenalty;
      if (nd < (dist.get(k) ?? Infinity)) { dist.set(k, nd); prev.set(k, { from: key(s, pi, b), step: { type: 'board', pi: npi, idx } }); heap.push([nd, s, npi, b + 1]); }
    }
  }
  if (!best) return null;
  // استرجاع المسار
  const steps = []; let k = key(best.s, best.pi, best.b);
  while (prev.has(k)) { const r = prev.get(k); steps.push({ k, ...r.step, stop: k.split('|')[0] }); k = r.from; }
  steps.reverse();
  const legs = [];
  for (const st of steps) {
    if (st.type === 'board') legs.push({ pi: st.pi, stops: [st.stop] });
    else legs[legs.length - 1].stops.push(st.stop);
  }
  return {
    legs: legs.filter(l => l.stops.length > 1).map(l => {
      const p = patterns[l.pi];
      return { routeId: p.routeId, routeName: p.name, headsign: p.headsign, direction: p.direction, boardStop: l.stops[0], alightStop: l.stops[l.stops.length - 1], stopIds: l.stops, hops: l.stops.length - 1, fare: null, minutes: null };
    }),
    transfers: Math.max(0, legs.length - 1)
  };
};
