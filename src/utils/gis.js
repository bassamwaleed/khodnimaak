// منطق شبكة النقاط والروابط (بدون React ولا Firebase — قابل للاختبار)
import { getDistanceKm } from './helpers';

// دقائق لكل كم لو الأدمن ما كتبش وقت
const MIN_PER_KM = { walk: 12, ride: 2, same: 0 };
// غرامة انتظار/ركوب لكل مواصلة عند البحث عن "الأسرع"
const BOARDING_PENALTY_MIN = 5;

export const hasExactCoords = (n) =>
  Number.isFinite(Number(n?.lat)) && Number.isFinite(Number(n?.lng)) && n?.lat !== null && n?.lng !== null && n?.lat !== '' && n?.lng !== '';

export const coordsOf = (n) => (hasExactCoords(n) ? [Number(n.lat), Number(n.lng)] : null);

// معرّف ثابت للرابط: منع التكرار + يسمح بالـ upsert
export const linkDocId = (a, b, oneWay = false) =>
  oneWay ? `d_${a}__${b}` : [a, b].sort().join('__');

export const distanceBetween = (a, b) => {
  const ca = coordsOf(a), cb = coordsOf(b);
  if (!ca || !cb) return null;
  const d = getDistanceKm(ca[0], ca[1], cb[0], cb[1]);
  return Number.isFinite(d) ? d : null;
};

export const estimateMinutes = (kind, distKm) => {
  if (distKm == null) return null;
  return Math.max(1, Math.round(distKm * (MIN_PER_KM[kind] ?? 2)));
};

// السعر: null/فاضي = غير معروف (مش صفر). المشي والتبديل سعرهم 0 فعلاً.
export const parseFare = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// الوقت: { minutes, estimated }. minutes = null لو مفيش وقت مسجل ولا مسافة نقدّر منها.
export const linkMinutesInfo = (link, nodesById) => {
  const m = Number(link.minutes);
  if (link.minutes !== null && link.minutes !== undefined && link.minutes !== '' && Number.isFinite(m) && m > 0) {
    return { minutes: m, estimated: false };
  }
  // المسافة الحالية من الإحداثيات (لو اتنقلت نقطة) وإلا المسافة المخزّنة
  const d = distanceBetween(nodesById[link.fromId], nodesById[link.toId])
    ?? (Number.isFinite(Number(link.distanceKm)) ? Number(link.distanceKm) : null);
  const est = estimateMinutes(link.kind, d);
  return est == null ? { minutes: null, estimated: false } : { minutes: est, estimated: true };
};

export const linkMinutes = (link, nodesById) => linkMinutesInfo(link, nodesById).minutes;

// الروابط القديمة (من غير status) تعتبر معتمدة. اقتراحات المستخدمين بتبدأ pending.
export const isApprovedLink = (l) => !l.status || l.status === 'approved';

// الروابط الصالحة فقط (الطرفين موجودين) — معتمدة أو مقترحة
export const validLinks = (links, nodesById) =>
  links.filter(l => nodesById[l.fromId] && nodesById[l.toId] && l.fromId !== l.toId);

// الروابط اللي بتدخل في حساب المسارات (معتمدة فقط)
export const approvedLinks = (links, nodesById) => validLinks(links, nodesById).filter(isApprovedLink);

export function buildAdjacency(links, nodesById) {
  const adj = {};
  const push = (from, to, link) => {
    const info = linkMinutesInfo(link, nodesById);
    (adj[from] = adj[from] || []).push({
      to, link,
      minutes: info.minutes,            // null = غير معروف
      minutesEstimated: info.estimated, // تقدير من المسافة مش وقت مسجل
      fare: link.kind === 'ride' ? parseFare(link.fare) : 0 // null = غير معروف
    });
  };
  // وصلات TfC (routeId) بتتحسب بالـpatterns بس: الـhop الواحد مش ركوبة ومفيهوش سعر
  approvedLinks(links, nodesById).filter(l => !l.routeId).forEach(l => {
    push(l.fromId, l.toId, l);
    if (!l.oneWay) push(l.toId, l.fromId, l);
  });
  return adj;
}

/**
 * أفضل مسار بين نقطتين (Dijkstra).
 * criterion: 'fast' = أقل وقت (مع غرامة ركوب) | 'cheap' = أقل تكلفة
 */
export function findBestPath(links, nodesById, fromId, toId, criterion = 'fast') {
  if (!fromId || !toId || fromId === toId) return null;
  if (!nodesById[fromId] || !nodesById[toId]) return null;
  const adj = buildAdjacency(links, nodesById);

  // القيم دي للترتيب بين المسارات فقط — مش بتتجمع في الأسعار والأوقات المعروضة
  const ORDER_FARE_IF_UNKNOWN = 10;
  const ORDER_MINUTES_IF_UNKNOWN = 15;
  const cost = (e) => {
    const f = e.fare ?? ORDER_FARE_IF_UNKNOWN;
    const m = e.minutes ?? ORDER_MINUTES_IF_UNKNOWN;
    return criterion === 'cheap'
      ? f + m * 0.02
      : m + (e.link.kind === 'ride' ? BOARDING_PENALTY_MIN : 0);
  };

  const dist = { [fromId]: 0 };
  const prev = {};
  const done = new Set();
  const queue = [[0, fromId]];

  while (queue.length) {
    queue.sort((a, b) => a[0] - b[0]);
    const [d, u] = queue.shift();
    if (done.has(u)) continue;
    done.add(u);
    if (u === toId) break;
    (adj[u] || []).forEach(e => {
      const nd = d + cost(e);
      if (nd < (dist[e.to] ?? Infinity)) {
        dist[e.to] = nd;
        prev[e.to] = { from: u, edge: e };
        queue.push([nd, e.to]);
      }
    });
  }

  if (!(toId in prev)) return null;

  const legs = [];
  for (let cur = toId; cur !== fromId; cur = prev[cur].from) {
    const { from, edge } = prev[cur];
    legs.unshift({ fromId: from, toId: cur, link: edge.link, minutes: edge.minutes, minutesEstimated: edge.minutesEstimated, fare: edge.fare });
  }
  const rides = legs.filter(l => l.link.kind === 'ride').length;
  return {
    nodeIds: [fromId, ...legs.map(l => l.toId)],
    legs,
    // المجموع للقيم المعروفة فقط. العدّادات بتقول كام جزء ناقص أو تقديري.
    totalMinutes: legs.reduce((s, l) => s + (l.minutes ?? 0), 0),
    totalFare: legs.reduce((s, l) => s + (l.fare ?? 0), 0),
    unknownFareLegs: legs.filter(l => l.fare == null).length,
    unknownMinutesLegs: legs.filter(l => l.minutes == null).length,
    estimatedMinutesLegs: legs.filter(l => l.minutesEstimated).length,
    rides,
    transfers: Math.max(0, rides - 1)
  };
}

// اقتراحات ربط تلقائي: نقاط قريبة من بعض (مشي) ولسه متربطتش
export function suggestLinks(nodes, links, maxKm = 0.4, limit = 12) {
  const linked = new Set();
  links.forEach(l => { linked.add(`${l.fromId}|${l.toId}`); linked.add(`${l.toId}|${l.fromId}`); });
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      if (linked.has(`${a.id}|${b.id}`)) continue;
      const d = distanceBetween(a, b);
      if (d != null && d <= maxKm) out.push({ a, b, distanceKm: d });
    }
  }
  return out.sort((x, y) => x.distanceKm - y.distanceKm).slice(0, limit);
}

// تحليل صحة الشبكة
export function analyzeNetwork(nodes, links) {
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const good = approvedLinks(links, byId);
  const orphanLinks = links.filter(l => !(byId[l.fromId] && byId[l.toId]));

  // مكوّنات متصلة (Union-Find)
  const parent = {};
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  nodes.forEach(n => { parent[n.id] = n.id; });
  good.forEach(l => { parent[find(l.fromId)] = find(l.toId); });
  const groups = {};
  nodes.forEach(n => { (groups[find(n.id)] = groups[find(n.id)] || []).push(n); });

  const degree = {};
  good.forEach(l => {
    degree[l.fromId] = (degree[l.fromId] || 0) + 1;
    degree[l.toId] = (degree[l.toId] || 0) + 1;
  });

  const isolated = nodes.filter(n => !degree[n.id]);
  const weakHubs = nodes.filter(n => n.nodeType === 'hub' && (degree[n.id] || 0) < 2);
  const missingCoords = nodes.filter(n => !hasExactCoords(n));

  // نقاط على نفس الإحداثي بالظبط (دبابيس فوق بعض)
  const coordGroups = {};
  nodes.filter(hasExactCoords).forEach(n => {
    const k = `${Number(n.lat).toFixed(5)},${Number(n.lng).toFixed(5)}`;
    (coordGroups[k] = coordGroups[k] || []).push(n);
  });
  const overlaps = Object.values(coordGroups).filter(g => g.length > 1);

  const components = Object.values(groups).filter(g => g.length > 1).sort((a, b) => b.length - a.length);

  return { orphanLinks, isolated, weakHubs, missingCoords, overlaps, components, degree };
}

// اتجاه السهم (بالدرجات) من نقطة لنقطة — للروابط أحادية الاتجاه
export const bearingDeg = ([lat1, lon1], [lat2, lon2]) => {
  const toRad = d => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};
