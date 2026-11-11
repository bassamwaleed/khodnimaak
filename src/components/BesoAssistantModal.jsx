import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { collection, addDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { X, Send, Bot, Sparkles, BusFront, Compass, ChevronLeft, Edit3, PlusCircle } from 'lucide-react';
import { db, ADMIN_EMAIL, LINKS_COLLECTION } from '../firebase';
import { getPlaceCoords, getDistanceKm } from '../utils/helpers';

// الردود الحوارية الأساسية فقط (أي داتا مواصلات بتيجي من الخريطة الحية)
const BESO_CONVERSATIONAL_INTENTS = [
  {
    id: 'greeting',
    keywords: ['اهلا', 'سلام عليكم', 'السلام عليكم', 'صباح الخير', 'مساء الخير', 'ازيك', 'عامل ايه', 'اخبارك', 'مرحبا', 'هاي', 'الو', 'يا بيسو'],
    replies: [
      `أهلاً بيك يا بطل في "طريقنا"! 👋🤖\nأنا "بيسو"، قولي مكانك فين ورايح فين وهطلعلك أسرع وأرخص طريق من خريطة المواقف الحية!`,
      `وعليكم السلام ورحمة الله! يا مرحب بيك في "طريقنا" 🚀.. اكتبلي (من كذا لـ كذا) وهجبلك المواصلة بالتفصيل.`
    ]
  },
  {
    id: 'app_purpose',
    keywords: ['هدف التطبيق', 'فكره التطبيق', 'فكرة التطبيق', 'يعني ايه طريقنا', 'ابلكيشن ايه ده', 'بيعمل ايه', 'لازمته ايه', 'فكرته ايه', 'شرح التطبيق', 'عن التطبيق'],
    replies: [
      `فكرة "طريقنا" ببساطة 🎯:\n1️⃣ **مشاركة المشاوير:** كباتن وركاب في نفس الطريق بيوفروا مصاريف المشوار.\n2️⃣ **توصيل الأمانات 📦:** شحن سريع مع مسافرين في نفس اليوم.\n3️⃣ **خريطة المواقف والنقاط التبادلية 🚏:** دليل حي للمواقف ونقاط التبديل والتعريفة، وأنا بحسبلك أسرع وأرخص طريق بينها!`
    ]
  },
  {
    id: 'thanks',
    keywords: ['شكرا', 'تسلم', 'ربنا يخليك', 'ممتاز', 'شاطر', 'جدع', 'الله ينور', 'عاش', 'حبيبي'],
    replies: [
      `حبيبي يا بطل، العفو! 🤍🤖 توصل بالسلامة دايماً.`,
      `أقل واجب يا صاحبي! أنا متحدث لحظياً بأي خط جديد بينزل على الخريطة 🚀`
    ]
  }
];

// ==ENGINE_START==
/* ===================================================================
   محرك بيسو: بحث ذكي عن الأماكن + رسم بياني للشبكة + أقصر/أرخص مسار
   (دوال نقية بدون React، بتاخد المواقف والروابط وترجع إجابات)
   =================================================================== */
const toNum = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

const norm = (s) => String(s ?? '')
  .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .toLowerCase()
  .replace(/[،؟؛]/g, ' ')
  .replace(/[^\u0600-\u06FFa-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ').trim();

// كلمات مش بتحدد مكان (بتتشال من اسم المكان المطلوب)
const STOP = new Set(['من', 'الي', 'الى', 'ل', 'لحد', 'عند', 'في', 'ف', 'انا', 'عايز', 'عاوز', 'اروح', 'هروح', 'رايح', 'رايحه',
  'مواصلات', 'خط', 'ازاي', 'اركب', 'ايه', 'ده', 'دي', 'لو', 'ممكن', 'يا', 'بيسو', 'كام', 'بكام', 'اجره', 'سعر', 'تعريفه',
  'اقرب', 'اسرع', 'ارخص', 'اوفر', 'اقصر', 'تبديل', 'مباشر', 'بدون', 'غير', 'وقت', 'اقل', 'طريق', 'ليا', 'لي', 'مني', 'وصلني', 'وديني', 'طيب', 'هل', 'عشان']);
// كلمات عامة وزنها قليل في المطابقة
const GENERIC = new Set(['ميدان', 'موقف', 'محطه', 'مدينه', 'منطقه', 'حي', 'تقاطع', 'بوابه', 'مدخل', 'محور', 'شارع', 'نقطه', 'سلم', 'مواقف']);
const FILL = new Set(['يا', 'بيسو', 'ممكن', 'لو', 'سمحت', 'عايز', 'عاوز', 'انا', 'ازاي', 'هل', 'طيب', 'يعني', 'بقي', 'عشان', 'مواصلات', 'موصلات',
  'اركب', 'اروح', 'هروح', 'رايح', 'رايحه', 'اسافر', 'وصلني', 'وديني', 'روح', 'كام', 'بكام', 'اجره', 'سعر', 'تعريفه', 'مكاني', 'موجود', 'واقف', 'متواجد', 'قاعد', 'خط', 'ايه']);
const MARK = new Set(['الي', 'الى', 'لحد', 'رايح', 'رايحه', 'اروح', 'هروح', 'اسافر', 'اتجاه', 'ل', 'وجهتي']);

// أسماء تانية للأماكن (لهجات/أسماء شائعة) → كلمات بحث إضافية
const ALIASES = [
  ['ابني بيتك', 'حدائق اكتوبر'], ['دهشور', 'حدائق اكتوبر'], ['فيوم', 'حدائق اكتوبر'],
  ['واحات', 'مول مصر'], ['واحات', 'دريم لاند'], ['msa', 'جامعه 6 اكتوبر'], ['ام اس ايه', 'جامعه 6 اكتوبر'],
  ['هايبر', 'هايبر وان'], ['دائري', 'المريوطيه'], ['مريوطيه', 'سلم المريوطيه'], ['نصر', 'مدينه نصر'],
  ['رابعه', 'مدينه نصر'], ['تجمع', 'التجمع الخامس'], ['قاهره جديده', 'التجمع الخامس'], ['عاصمه', 'العاصمه الاداريه'],
  ['مطار', 'مطار القاهره'], ['اهرامات', 'منطقه الاهرام'], ['هرم', 'منطقه الاهرام'], ['جيزه', 'ميدان الجيزه'],
  ['وسط البلد', 'ميدان التحرير'], ['وسط البلد', 'ميدان رمسيس'], ['قاهره', 'ميدان التحرير'], ['قاهره', 'ميدان رمسيس'],
  ['مهندسين', 'ميدان لبنان'], ['روكسي', 'مصر الجديده'], ['مصر الجديده', 'روكسي'], ['سادس', 'ليله القدر'],
  ['october', 'اكتوبر'], ['zayed', 'زايد'], ['cairo', 'القاهره'], ['giza', 'الجيزه'], ['صحراوي', 'محور 26 يوليو'],
  ['كوبري 26', 'محور 26 يوليو'], ['محطه مصر', 'ميدان رمسيس'], ['شبرا', 'شبرا الخيمه'], ['عباسيه', 'ميدان العباسيه'], ['حدائق الاهرام', 'بوابه خوفو']
];

const lev = (a, b) => {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
};

const stem = (t) => {
  if (t.length > 5 && (t.startsWith('بال') || t.startsWith('وال') || t.startsWith('فال'))) return t.slice(3);
  if (t.length > 4 && (t.startsWith('ال') || t.startsWith('لل'))) return t.slice(2);
  return t;
};
const tokenize = (s, dropStops = true) => norm(s).split(' ').filter(Boolean).map(stem)
  .filter(t => (t.length > 1 || /\d/.test(t)) && !(dropStops && STOP.has(t)));

// تطابق كلمتين: تام / بداية-نهاية (يغطي ل و ب الملزوقة) / غلطة إملائية
const tokenMatch = (a, b) => {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (la >= 3 && lb >= 3 && Math.abs(la - lb) <= 3 && (a.endsWith(b) || b.endsWith(a) || a.startsWith(b) || b.startsWith(a))) return 0.9;
  if (la >= 4 && lb >= 4) { const d = lev(a, b); if (d <= 1 || (la >= 7 && lb >= 7 && d <= 2)) return 0.8; }
  return 0;
};
const tokW = (t) => GENERIC.has(t) ? 0.3 : (/^\d+$/.test(t) ? 0.6 : 1);
const coverage = (qT, tT) => {
  if (!qT.length || !tT.length) return 0;
  let tot = 0, hit = 0;
  qT.forEach(q => { const w = tokW(q); tot += w; let best = 0; tT.forEach(t => { const m = tokenMatch(q, t); if (m > best) best = m; }); hit += w * best; });
  return tot ? hit / tot : 0;
};

const coordsOf = (st) => {
  const la = Number(st?.lat), ln = Number(st?.lng);
  if (Number.isFinite(la) && Number.isFinite(ln) && (la || ln)) return [la, ln];
  try { const c = getPlaceCoords(st); if (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])) return c; } catch (e) { /* ignore */ }
  return null;
};
const distKm = (a, b) => (a && b) ? getDistanceKm(a[0], a[1], b[0], b[1]) : null;

const wantsPref = (nq) => {
  if (/(ارخص|اوفر|اقل تكلفه|توفير)/.test(nq)) return 'cheap';
  if (/(بدون تبديل|من غير تبديل|مباشر|بدون تغيير)/.test(nq)) return 'direct';
  if (/(اسرع|اقصر|اقل وقت|بسرعه)/.test(nq)) return 'fast';
  return null;
};

function createEngine(stations, links, isAdmin) {
  const byId = new Map(stations.map(s => [s.id, s]));
  const tok = new Map(stations.map(s => [s.id, { name: tokenize(s.name, false), loc: tokenize(s.location, false), hint: tokenize(s.transferHint, false) }]));
  const coord = new Map(stations.map(s => [s.id, coordsOf(s)]));
  const nameIdx = new Map(stations.map(s => [norm(s.name), s]));
  const okStatus = (st) => !st || st === 'approved' || (isAdmin && st === 'pending');

  // ---------- بناء الرسم البياني ----------
  const adj = new Map(stations.map(s => [s.id, []]));
  const edgeKeys = new Set();
  const estMinutes = (a, b) => { const d = distKm(coord.get(a), coord.get(b)); return d == null ? 20 : Math.max(5, Math.round(d / 22 * 60 + 4)); };
  const addEdge = (from, to, data) => {
    const key = from + '>' + to;
    if (from === to || edgeKeys.has(key) || !adj.has(from)) return;
    edgeKeys.add(key);
    adj.get(from).push({ from, to, ...data });
  };
  (links || []).forEach(l => {
    if (!l || !byId.has(l.fromId) || !byId.has(l.toId) || !okStatus(l.status)) return;
    const fare = toNum(l.fare);
    const base = { fare, minutes: toNum(l.minutes) ?? estMinutes(l.fromId, l.toId), kind: l.kind || 'ride', note: l.note || '' };
    addEdge(l.fromId, l.toId, base);
    if (!l.oneWay) addEdge(l.toId, l.fromId, base);
  });
  // احتياطي: لو الروابط مش متسجلة، نبني الشبكة من خطوط كل موقف (routes)
  stations.forEach(s => (s.routes || []).forEach(r => {
    if (!okStatus(r.status)) return;
    const t = nameIdx.get(norm(r.destinationDetails || ''));
    if (!t) return;
    addEdge(s.id, t.id, { fare: toNum(r.fare), minutes: estMinutes(s.id, t.id), kind: 'ride', note: '' });
  }));

  // ---------- تحليل اسم مكان ----------
  const cache = new Map();
  const resolve = (text) => {
    const key = norm(text);
    if (cache.has(key)) return cache.get(key);
    const qT = tokenize(text);
    let out = null;
    if (qT.length && !qT.every(t => GENERIC.has(t))) {
      const queries = [{ q: qT, f: 1 }];
      ALIASES.forEach(([k, v]) => {
        const kT = tokenize(k, false);
        if (kT.length && kT.every(kt => qT.some(q => tokenMatch(q, kt) >= 0.9))) queries.push({ q: tokenize(v, false), f: 0.85 });
      });
      const scored = stations.map(st => {
        const T = tok.get(st.id); let s = 0;
        queries.forEach(({ q, f }) => { const v = f * Math.max(coverage(q, T.name), 0.92 * coverage(q, T.loc), 0.5 * coverage(q, T.hint)); if (v > s) s = v; });
        return { st, score: s };
      }).sort((a, b) => b.score - a.score);
      const best = scored[0]?.score || 0;
      if (best >= 0.6) {
        out = { text, score: best, candidates: scored.filter(x => x.score >= Math.max(0.6, best * 0.88)).slice(0, 8) };
      } else {
        out = { text, score: best, candidates: [], suggestions: scored.filter(x => x.score >= 0.3).slice(0, 3).map(x => x.st) };
        // محاولة أخيرة: إحداثيات المكان لو الدالة بتعرفه فعلاً (مش قيمة افتراضية)
        try {
          const c = getPlaceCoords(text), probe = getPlaceCoords('zzzxqjw');
          if (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) && !(probe && probe[0] === c[0] && probe[1] === c[1])) {
            const near = stations.map(st => ({ st, d: distKm(c, coord.get(st.id)) })).filter(x => x.d != null && x.d <= 6).sort((a, b) => a.d - b.d).slice(0, 3);
            if (near.length) out = { text, score: 0.6, approx: true, candidates: near.map(x => ({ st: x.st, score: 0.6 })) };
          }
        } catch (e) { /* ignore */ }
      }
    }
    cache.set(key, out);
    return out;
  };

  const labelOf = (res) => {
    if (!res) return '';
    if (res.label) return res.label;
    const c = res.candidates || [];
    if (c.length === 1) return c[0].st.name;
    if (c.length > 1) {
      const freq = {};
      c.forEach(x => { freq[x.st.location] = (freq[x.st.location] || 0) + 1; });
      const [loc, n] = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
      if (n >= 2 && n >= c.length / 2) return loc;
    }
    return c[0]?.st.name || res.text;
  };

  // ---------- تحليل الجملة: (من) و(إلى) ----------
  const isNoise = (t) => {
    const s = stem(t);
    if (MARK.has(s) || FILL.has(s) || STOP.has(s)) return true;
    return t.startsWith('و') && (MARK.has(t.slice(1)) || FILL.has(t.slice(1)));
  };
  const clean = (arr) => { const a = [...arr]; while (a.length && isNoise(a[0])) a.shift(); while (a.length && isNoise(a[a.length - 1])) a.pop(); return a; };
  const mk = (arr) => { const c = clean(arr); return c.length ? resolve(c.join(' ')) : null; };
  const isAttachedL = (t) => !!t && t.startsWith('ل') && !MARK.has(t) && t.length > 3;

  const parse = (text) => {
    const toks = norm(text).split(' ').filter(Boolean);
    let oi = -1;
    for (let i = 0; i < toks.length; i++) {
      if (toks[i] === 'من') { oi = i; break; }
      if ((toks[i] === 'في' || toks[i] === 'ف') && toks[i - 1] === 'انا') { oi = i; break; }
      if (['مكاني', 'موجود', 'واقف', 'متواجد', 'قاعد'].includes(toks[i])) { oi = (toks[i + 1] === 'في' || toks[i + 1] === 'ف') ? i + 1 : i; break; }
    }
    if (oi >= 0) {
      const beforeClean = clean(toks.slice(0, oi));
      const after = toks.slice(oi + 1);
      if (beforeClean.length) return { origin: mk(after), dest: mk(beforeClean) };      // "رايح الحصري من الدقي"
      let best = null;
      for (let k = 1; k <= after.length; k++) {
        const left = clean(after.slice(0, k));
        if (!left.length) continue;
        const L = resolve(left.join(' '));
        if (!L || L.score < 0.6) continue;
        let cand;
        if (k === after.length) cand = { o: L, d: null, sc: L.score - 0.05 };
        else {
          const right = clean(after.slice(k));
          if (!right.length) continue;
          const R = resolve(right.join(' '));
          const bonus = MARK.has(stem(after[k])) || isNoise(after[k]) ? 0.25 : (isAttachedL(after[k]) ? 0.12 : 0);
          cand = { o: L, d: R, sc: L.score + (R ? R.score : 0) + bonus };
        }
        if (!best || cand.sc > best.sc) best = cand;
      }
      if (best) return { origin: best.o, dest: best.d };
      return { origin: mk(after), dest: null };
    }
    // مفيش "من": دور على علامة وجهة
    let mi = -1;
    toks.forEach((t, i) => { if (MARK.has(t) && t !== 'ل') mi = i; });
    if (mi < 0) toks.forEach((t, i) => { if (t === 'ل') mi = i; });
    if (mi >= 0) { const d = mk(toks.slice(mi + 1)); if (d) return { origin: null, dest: d }; }
    const c = clean(toks);
    const full = c.length ? resolve(c.join(' ')) : null;
    if (c.length >= 2 && !(full && full.score >= 0.95)) {
      let best = null;
      for (let k = 1; k < c.length; k++) {
        const L = resolve(c.slice(0, k).join(' ')), R = resolve(c.slice(k).join(' '));
        if (!L || !R || L.score < 0.8 || R.score < 0.8 || !L.candidates.length || !R.candidates.length) continue;
        if (L.candidates[0].st.id === R.candidates[0].st.id) continue;
        const sc = L.score + R.score + (isAttachedL(c[k]) ? 0.12 : 0);
        if (!best || sc > best.sc) best = { o: L, d: R, sc };
      }
      if (best) return { origin: best.o, dest: best.d };
    }
    return { place: full };
  };

  // ---------- أقصر مسار (Dijkstra متعدد المصادر والأهداف) ----------
  const search = (sources, targets, costFn) => {
    const dist = new Map(), prev = new Map(), done = new Set();
    sources.forEach(s => { dist.set(s.id, s.init); prev.set(s.id, null); });
    for (;;) {
      let u = null, best = Infinity;
      for (const [k, v] of dist) if (!done.has(k) && v < best) { best = v; u = k; }
      if (u === null) return null;
      done.add(u);
      if (targets.has(u)) {
        const edges = []; let cur = u;
        while (prev.get(cur)) { const p = prev.get(cur); edges.unshift(p.edge); cur = p.from; }
        return edges;
      }
      for (const e of (adj.get(u) || [])) {
        const nd = best + costFn(e);
        if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, { from: u, edge: e }); }
      }
    }
  };

  const COSTS = {
    fast: (e) => (e.minutes || 15) + 7,
    cheap: (e) => (e.fare ?? 10) + (e.minutes || 15) * 0.04 + 0.5,
    direct: (e) => 100 + (e.minutes || 15)
  };
  const TAG_LABEL = { fast: 'الأسرع ⏱️', cheap: 'الأرخص 💰', direct: 'أقل تبديل 🎯' };

  const plan = (oRes, dRes) => {
    const targets = new Set(dRes.candidates.map(c => c.st.id));
    const sources = oRes.candidates.filter(c => !targets.has(c.st.id))
      .map(c => ({ id: c.st.id, init: (1 - c.score) * 15 + (c.extra || 0) }));
    if (!sources.length) return { same: true, options: [] };
    const seen = new Map();
    ['fast', 'cheap', 'direct'].forEach(tag => {
      const edges = search(sources, targets, COSTS[tag]);
      if (!edges || !edges.length) return;
      const key = edges.map(e => e.from + '>' + e.to).join('|');
      if (seen.has(key)) { seen.get(key).tags.push(tag); return; }
      const legs = edges.length;
      seen.set(key, {
        tags: [tag], edges,
        legs,
        fare: edges.reduce((s, e) => s + (e.fare ?? 0), 0),
        fareMissing: edges.some(e => e.fare == null),
        minutes: edges.reduce((s, e) => s + (e.minutes || 0), 0) + (legs - 1) * 5
      });
    });
    return { same: false, options: [...seen.values()] };
  };

  const boardingFor = (fromId, toId) => {
    const from = byId.get(fromId), to = byId.get(toId);
    const r = (from?.routes || []).find(x => norm(x.destinationDetails || '') === norm(to?.name || '') && x.boardingHint);
    return r ? r.boardingHint : '';
  };

  const nearestTo = (coords, n = 4, maxKm = 15) => stations
    .map(st => ({ st, d: distKm(coords, coord.get(st.id)) }))
    .filter(x => x.d != null && x.d <= maxKm).sort((a, b) => a.d - b.d).slice(0, n);

  const degree = (id) => (adj.get(id) || []).length;

  return { byId, adj, coord, resolve, labelOf, parse, plan, boardingFor, nearestTo, degree, TAG_LABEL };
}
// ==ENGINE_END==

const KIND_ICON = { ride: '🚐', bus: '🚌', metro: '🚇', walk: '🚶', microbus: '🚐', taxi: '🚕' };
const fareTxt = (e) => (e.fare == null ? 'أجرة غير مسجلة' : `${e.fare} ج`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const locate = () => new Promise(resolve => {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
  navigator.geolocation.getCurrentPosition(
    p => resolve([p.coords.latitude, p.coords.longitude]),
    () => resolve(null),
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
  );
});

// يعرض **نص** بخط عريض بدل ما تظهر النجوم
const RichText = ({ text }) => String(text || '').split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
  p.startsWith('**') && p.endsWith('**') && p.length > 4
    ? <strong key={i} className="font-black">{p.slice(2, -2)}</strong>
    : <React.Fragment key={i}>{p}</React.Fragment>
);

const BesoAssistantModal = ({ stations = [], isDarkMode, onClose, onSelectStation, userAreas = [], user, isAdmin }) => {
  const [input, setInput] = useState('');
  const [customGuides, setCustomGuides] = useState([]);
  const [links, setLinks] = useState([]);
  const [isTyping, setIsTyping] = useState(false);

  const [correctingMsgId, setCorrectingMsgId] = useState(null);
  const [correctionPlace, setCorrectionPlace] = useState('');
  const [correctionText, setCorrectionText] = useState('');
  const [isSubmittingCorrection, setIsSubmittingCorrection] = useState(false);
  const [correctionSuccessMsg, setCorrectionSuccessMsg] = useState('');

  // ذاكرة المحادثة (ref عشان نتفادى القيم القديمة داخل الـ async)
  const ctxRef = useRef({ pendingDest: null, pendingOrigin: null, last: null, userCoords: null });

  const approvedStations = useMemo(
    () => (stations || []).filter(s => s && s.id && (isAdmin || s.status !== 'pending')),
    [stations, isAdmin]
  );
  const engine = useMemo(() => createEngine(approvedStations, links, !!isAdmin), [approvedStations, links, isAdmin]);

  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      sender: 'beso',
      text: `أهلاً بيك يا بطل! أنا "بيسو" 🤖 مساعدك الذكي في "طريقنا".\n\nأنا مربوط لحظياً بـ (${approvedStations.length}) موقف ونقطة تبادلية وبحسبلك **أسرع** و**أرخص** طريق بينهم، حتى لو محتاج تبديل أكتر من مرة 🔄\n\n🔹 جرب: **"من الدقي لأكتوبر"** أو **"أنا في المنيب ورايح هايبر وان"**\n🔹 أو اكتب اسم أي مكان وأقولك الخطوط اللي بتطلع منه.\n🔹 وبعد أي إجابة اطلب: **أرخص** / **أسرع** / **اعكس الاتجاه**.`,
      suggestions: ['من الدقي لأكتوبر', 'أقرب موقف ليا 📍', 'النقاط التبادلية 🔄']
    }
  ]);
  const messagesEndRef = useRef(null);

  const quickQuestions = [
    'أقرب موقف أو نقطة تبادلية ليا؟ 📍',
    'إيه النقاط التبادلية المتسجلة؟ 🔄',
    'إيه فكرة التطبيق ده؟ 💡'
  ];

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'beso_knowledge_updates'), (snap) => {
      setCustomGuides(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {});
    return () => unsub();
  }, []);

  // روابط الشبكة (المسارات بين المواقف) — بتتحدث لحظياً
  useEffect(() => {
    const unsub = onSnapshot(collection(db, LINKS_COLLECTION), (snap) => {
      setLinks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => setLinks([]));
    return () => unsub();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, correctingMsgId, isTyping]);

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = originalOverflow; };
  }, []);

  // ------------------------------------------------------------------
  // تنسيق الردود
  // ------------------------------------------------------------------
  const stationLine = (st) => `${st.nodeType === 'hub' ? '🔄' : (st.nodeType === 'stop' ? '📍' : '🚏')} **${st.name}**`;

  const describePlace = (res) => {
    const top = res.candidates.slice(0, 3);
    const lines = top.map(({ st }) => {
      const edges = (engine.adj.get(st.id) || []).slice().sort((a, b) => (a.fare ?? 99) - (b.fare ?? 99)).slice(0, 6);
      const conn = edges.map(e => `${engine.byId.get(e.to)?.name} (${fareTxt(e)}${e.minutes ? ` • ~${e.minutes} د` : ''})`).join('\n   • ');
      return `${stationLine(st)} — ${st.location}` +
        (st.transferHint ? `\n💡 ${st.transferHint}` : '') +
        (conn ? `\n🚐 بيوصلك مباشرة لـ:\n   • ${conn}` : '\n⚠️ مفيش خطوط مربوطة بالنقطة دي لسه.');
    });
    const more = res.candidates.length > 3 ? `\n\n… وفيه ${res.candidates.length - 3} نقطة تانية في المنطقة دي.` : '';
    return { text: `🔍 **${engine.labelOf(res)}**\n\n${lines.join('\n\n')}${more}`, stations: top.map(x => x.st) };
  };

  const formatRoute = (oRes, dRes, planResult, pref) => {
    const oLabel = engine.labelOf(oRes), dLabel = engine.labelOf(dRes);

    if (planResult.same) {
      return { text: `🤔 **(${oLabel})** و **(${dLabel})** هما نفس النقطة أو قريبين جداً من بعض.\nجرب تحدد مكان أبعد شوية، أو قولي رايح فين بالظبط.`, stations: dRes.candidates.slice(0, 2).map(c => c.st) };
    }

    if (!planResult.options.length) {
      const oN = oRes.candidates.slice(0, 2).map(c => `**${c.st.name}**`).join(' أو ');
      const dN = dRes.candidates.slice(0, 2).map(c => `**${c.st.name}**`).join(' أو ');
      return {
        text: `🧩 لقيت النقطتين على الخريطة (${oN} ⬅️ ${dN}) بس **مفيش مسار مربوط بينهم** في الداتا لسه، حتى بالتبديل.\n\n💡 تقدر تضيف الرابط الناقص من (خريطة GIS) في لوحة الأدمن، أو تضغط **✏️ إضافة إرشاد** تحت رسالتي وتكتب الخط وأنا هشتغل بيه فوراً.`,
        stations: [...oRes.candidates.slice(0, 2), ...dRes.candidates.slice(0, 2)].map(c => c.st)
      };
    }

    const main = options => options.find(o => o.tags.includes(pref)) || options[0];
    const opts = planResult.options;
    const m = main(opts);
    const others = opts.filter(o => o !== m);

    const legsText = m.edges.map((e, i) => {
      const from = engine.byId.get(e.from), to = engine.byId.get(e.to);
      const boarding = engine.boardingFor(e.from, e.to);
      const note = e.note && !e.note.includes('⇄') ? e.note : '';
      let t = `${i + 1}️⃣ من **${from.name}** اركب ${KIND_ICON[e.kind] || '🚐'} ⬅️ **${to.name}**\n   💰 ${fareTxt(e)}${e.minutes ? ` • ⏱️ ~${e.minutes} د` : ''}`;
      if (i === 0 && from.transferHint) t += `\n   💡 ${from.transferHint}`;
      if (boarding) t += `\n   📍 تركب من: ${boarding}`;
      if (note) t += `\n   📝 ${note}`;
      if (i < m.edges.length - 1 && to.transferHint) t += `\n🔄 **بدّل في ${to.name}:** ${to.transferHint}`;
      else if (i < m.edges.length - 1) t += `\n🔄 **بدّل هنا** وكمّل للخط اللي بعده.`;
      return t;
    }).join('\n\n');

    const fareStr = m.fareMissing ? `${m.fare}+ ج (في خط أجرته مش مسجلة)` : `${m.fare} ج`;
    const tagStr = m.tags.map(t => engine.TAG_LABEL[t]).join(' + ');
    const header = `🎯 **${tagStr}** من (${oLabel}) إلى (${dLabel})`;
    const summary = `⏱️ ~${m.minutes} دقيقة • 💰 ${fareStr} • 🔄 ${m.legs > 1 ? `${m.legs - 1} تبديل` : 'من غير تبديل'}`;
    const last = engine.byId.get(m.edges[m.edges.length - 1].to);

    const altLines = others.map(o => {
      const names = [engine.byId.get(o.edges[0].from).name, ...o.edges.map(e => engine.byId.get(e.to).name)].join(' ⬅️ ');
      return `• **${o.tags.map(t => engine.TAG_LABEL[t]).join(' + ')}:** ${names}\n   ⏱️ ~${o.minutes} د • 💰 ${o.fare}${o.fareMissing ? '+' : ''} ج`;
    });

    const text = `${header}\n${summary}\n\n${legsText}\n\n🏁 **هتوصل عند:** ${last.name}` +
      (altLines.length ? `\n\n🔀 **بدائل تانية:**\n${altLines.join('\n')}` : '');

    const stationsOnPath = [engine.byId.get(m.edges[0].from), ...m.edges.map(e => engine.byId.get(e.to))].filter(Boolean);
    return { text, stations: stationsOnPath };
  };

  // ------------------------------------------------------------------
  // العقل: بيحلل الرسالة ويرد
  // ------------------------------------------------------------------
  const generateBesoResponse = async (queryText) => {
    const ctx = ctxRef.current;
    const nq = norm(queryText);
    const toks = nq.split(' ').filter(Boolean);
    const reply = (text, extra = {}) => ({ text, queryContext: queryText, ...extra });

    // إرشادات الأدمن المعتمدة (بتتضاف على الإجابة، أو بترد لوحدها لو مفيش حاجة تانية)
    const guideBlock = (() => {
      const qT = toks.map(stem);
      const hits = customGuides.filter(cg => {
        if (cg.status !== 'approved') return false;
        const parts = String(cg.placeKeywords || '').split(/[-،,]/).map(s => s.trim()).filter(Boolean);
        return parts.length > 0 && parts.every(part => {
          const pT = tokenize(part);
          return pT.length > 0 && pT.every(pt => qT.some(q => tokenMatch(q, pt) >= 0.8));
        });
      });
      if (!hits.length) return '';
      return hits.slice(0, 2).map(g => `📌 **إرشاد معتمد من الإدارة (${g.placeKeywords}):**\n${g.correctedInfo}`).join('\n\n');
    })();
    const withGuide = (r) => (guideBlock ? { ...r, text: `${r.text}\n\n${guideBlock}` } : r);

    // 1) أقرب موقف (بالـ GPS أو لمكان معين)
    const nearestWords = ['اقرب', 'حواليا', 'حولي', 'جنبي'];
    if (toks.some(t => nearestWords.includes(t)) || nq.includes('قريب مني')) {
      const stripped = toks.filter(t => !['اقرب', 'موقف', 'نقطه', 'تبادليه', 'ليا', 'لي', 'مني', 'ل', 'من', 'قريب', 'حواليا', 'حولي', 'جنبي', 'او', 'ده', 'يا', 'بيسو'].includes(t)).join(' ');
      const placeRes = stripped ? engine.resolve(stripped) : null;
      let center = null, centerLabel = '';
      if (placeRes && placeRes.candidates.length) {
        center = engine.coord.get(placeRes.candidates[0].st.id);
        centerLabel = engine.labelOf(placeRes);
      } else {
        center = ctx.userCoords || await locate();
        if (center) ctx.userCoords = center;
        centerLabel = 'موقعك';
      }
      if (!center) {
        return reply(`مقدرتش أحدد موقعك 📍 (ممكن إذن الموقع مقفول).\nاكتبلي أنت فين وأنا أطلعلك أقرب نقاط، مثلاً: **"أقرب موقف للدقي"**.`);
      }
      const near = engine.nearestTo(center, 5, 25);
      if (!near.length) return reply(`مفيش مواقف مسجلة قريبة من (${centerLabel}) في الداتا لسه.`);
      const lines = near.map(x => `• ${stationLine(x.st)} — ${x.d < 1 ? `${Math.round(x.d * 1000)} م` : `${x.d.toFixed(1)} كم`} (${x.st.location})`).join('\n');
      return reply(`📍 **أقرب نقاط من (${centerLabel}):**\n\n${lines}`, {
        matchedStations: near.slice(0, 4).map(x => x.st),
        suggestions: near.slice(0, 2).map(x => x.st.name)
      });
    }

    // 2) "استخدم موقعي" (بعد ما بيسو يسأل عن مكانك)
    if (/(استخدم|حدد|خد|خذ)\s*موقعي|موقعي الحالي|مكاني الحالي/.test(nq)) {
      const c = await locate();
      if (!c) return reply(`مقدرتش أوصل لموقعك 😕 اكتبلي مكانك يدوي (مثال: **من الدقي**).`);
      ctx.userCoords = c;
      if (ctx.pendingDest) {
        const dRes = ctx.pendingDest; ctx.pendingDest = null;
        return routeReply(await fromMyLocation(c), dRes, null);
      }
      return reply(`تمام، حددت موقعك ✅ قولي رايح فين.`, { suggestions: ['أقرب موقف ليا 📍'] });
    }

    // 3) النقاط التبادلية
    const hubWord = nq.includes('تبادليه') || nq.includes('نقط التبديل') || nq.includes('نقاط التبديل') || nq.includes('ترانزيت');
    if (hubWord && !toks.includes('من')) {
      const hubs = approvedStations.filter(s => s.nodeType === 'hub')
        .sort((a, b) => engine.degree(b.id) - engine.degree(a.id));
      if (!hubs.length) {
        return reply(`حالياً مفيش نقاط متصنفة كـ "نقطة تبادلية 🔄" في لوحة التحكم.`);
      }
      const txt = hubs.slice(0, 12).map((h, i) => `${i + 1}. **${h.name}** (${h.location}) — 🔗 ${engine.degree(h.id)} اتصال${h.transferHint ? `\n   💡 ${h.transferHint}` : ''}`).join('\n');
      return reply(`🔄 **النقاط التبادلية مرتبة بعدد اتصالاتها (${hubs.length}):**\n\n${txt}${hubs.length > 12 ? `\n\n… و${hubs.length - 12} نقطة تانية.` : ''}`, { matchedStations: hubs.slice(0, 4) });
    }

    // 4) الدردشة (بالمطابقة الكاملة للكلمة عشان "هايبر" ما تتفهمش "هاي")
    const padded = ` ${nq} `;
    const matchedIntent = BESO_CONVERSATIONAL_INTENTS.find(it => it.keywords.some(kw => padded.includes(` ${norm(kw)} `)));
    if (matchedIntent) {
      const transitish = toks.some(t => ['اروح', 'رايح', 'من', 'الي', 'الى', 'لحد', 'موقف', 'مواصلات'].includes(t));
      if (!transitish || matchedIntent.id === 'app_purpose') {
        const r = matchedIntent.replies[Math.floor(Math.random() * matchedIntent.replies.length)];
        return reply(r);
      }
    }

    // 5) متابعات: اعكس الاتجاه / أرخص / أسرع
    const pref = wantsPref(nq);
    const wantsFlip = /(اعكس|العكس|عكس|رجوع|ارجع|راجع)/.test(nq);
    const parsed = engine.parse(queryText);
    const hasNewPlaces = !!(parsed.origin || parsed.dest || (parsed.place && parsed.place.candidates.length));

    if (ctx.last && !hasNewPlaces && (pref || wantsFlip)) {
      const { o, d } = ctx.last;
      const [oo, dd] = wantsFlip ? [d, o] : [o, d];
      return routeReply(oo, dd, pref || ctx.last.pref);
    }

    // 6) تجميع (من) و(إلى) مع الذاكرة
    let origin = parsed.origin, dest = parsed.dest;
    const place = parsed.place && parsed.place.candidates.length ? parsed.place : null;

    if (origin && !origin.candidates.length) {
      return reply(didYouMean(origin.text, origin));
    }
    if (dest && !dest.candidates.length) {
      return reply(didYouMean(dest.text, dest));
    }

    if (ctx.pendingOrigin && !origin) {
      const d = dest || place;
      if (d) { origin = ctx.pendingOrigin; dest = d; }
    } else if (ctx.pendingDest && !dest) {
      const o = origin || place;
      if (o) { dest = ctx.pendingDest; origin = o; }
    }
    if (origin && dest) { ctx.pendingOrigin = null; ctx.pendingDest = null; }

    // وجهة بس: حاول تعرف نقطة البداية (GPS / منطقة المستخدم) وإلا اسأل
    if (dest && !origin) {
      if (ctx.userCoords) {
        return routeReply(await fromMyLocation(ctx.userCoords), dest, pref);
      }
      const areaTxt = Array.isArray(userAreas) && typeof userAreas[0] === 'string' ? userAreas[0] : null;
      const areaRes = areaTxt ? engine.resolve(areaTxt) : null;
      if (areaRes && areaRes.candidates.length) {
        const r = await routeReply(areaRes, dest, pref);
        return { ...r, text: `(افترضت إنك في **${engine.labelOf(areaRes)}** حسب بيانات حسابك)\n\n${r.text}` };
      }
      ctx.pendingDest = dest;
      return reply(`تمام، رايح **(${engine.labelOf(dest)})** 🎯\nقولي هتركب منين؟ (مثال: **من الدقي**) أو اضغط تحت وأنا أستخدم موقعك.`, {
        suggestions: ['استخدم موقعي 📍'],
        matchedStations: dest.candidates.slice(0, 3).map(c => c.st)
      });
    }

    // بداية بس
    if (origin && !dest) {
      ctx.pendingOrigin = origin;
      const info = describePlace(origin);
      return withGuide(reply(`أنت في **(${engine.labelOf(origin)})** 👍\n\n${info.text}\n\nقولي بقى رايح فين عشان أحسبلك أسرع وأرخص طريق؟`, { matchedStations: info.stations }));
    }

    // مسار كامل
    if (origin && dest) return withGuide(await routeReply(origin, dest, pref));

    // اسم مكان واحد فقط → معلومات المكان
    if (place) {
      ctx.pendingOrigin = null;
      const info = describePlace(place);
      return withGuide(reply(info.text, { matchedStations: info.stations }));
    }

    if (guideBlock) return reply(guideBlock);

    return reply(`مفهمتش قصدك 🤔 قولي أنت فين ورايح فين؟ مثلاً: **"من الصحراوي لأكتوبر"** أو **"من الدقي للحصري"**، أو اكتب اسم موقف أعرفك خطوطه.`, {
      suggestions: ['من الدقي لأكتوبر', 'النقاط التبادلية 🔄']
    });

    // ---- دوال مساعدة داخلية ----
    function didYouMean(text, res) {
      const sug = (res && res.suggestions) || [];
      const sugTxt = sug.length ? `\n\nقصدك واحد من دول؟\n${sug.map(s => `• **${s.name}**`).join('\n')}` : '';
      return `مش لاقي مكان اسمه **(${text})** في خريطة المواقف 🧐${sugTxt}\n\nلو المكان ده موجود فعلاً قولي اسمه بشكل تاني، أو ضيفه من (خريطة GIS).`;
    }
  };

  // بيحوّل GPS لنقاط انطلاق (أقرب 3 نقاط + وقت مشي تقديري)
  const fromMyLocation = async (coords) => {
    const near = engine.nearestTo(coords, 3, 12);
    return {
      text: 'موقعك الحالي',
      label: 'موقعك الحالي',
      score: 1,
      candidates: near.map(x => ({ st: x.st, score: 1, extra: Math.round(x.d / 4.5 * 60) }))
    };
  };

  // بيحسب ويصيغ الرد ويحفظ آخر مسار للمتابعة
  const routeReply = async (oRes, dRes, pref) => {
    const ctx = ctxRef.current;
    if (!oRes?.candidates?.length || !dRes?.candidates?.length) {
      return { text: 'مقدرتش أحدد نقطة الانطلاق أو الوصول 🤔 جرب تكتب (من كذا لكذا).', queryContext: '' };
    }
    const planResult = engine.plan(oRes, dRes);
    ctx.last = { o: oRes, d: dRes, pref: pref || (ctx.last && ctx.last.pref) || 'fast' };
    const out = formatRoute(oRes, dRes, planResult, pref || 'fast');
    const sugg = [];
    if (planResult.options.length > 1) {
      if (!planResult.options[0].tags.includes('cheap') || !pref) sugg.push('💰 أرخص طريق');
      sugg.push('⚡ أسرع طريق');
    }
    sugg.push('↔️ اعكس الاتجاه');
    return {
      text: out.text,
      matchedStations: out.stations.slice(0, 5),
      queryContext: `من ${engine.labelOf(oRes)} إلى ${engine.labelOf(dRes)}`,
      suggestions: [...new Set(sugg)].slice(0, 3)
    };
  };

  const handleSend = async (textToProcess) => {
    const cleanText = (textToProcess || input).trim();
    if (!cleanText || isTyping) return;

    setMessages(prev => [...prev, { id: Date.now() + '_u', sender: 'user', text: cleanText }]);
    setInput('');
    setIsTyping(true);
    try {
      const [data] = await Promise.all([generateBesoResponse(cleanText), sleep(350)]);
      setMessages(prev => [...prev, {
        id: Date.now() + '_b', sender: 'beso', text: data.text,
        matchedStations: data.matchedStations, queryContext: data.queryContext, suggestions: data.suggestions
      }]);
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { id: Date.now() + '_b', sender: 'beso', text: 'حصلت مشكلة وأنا بحسب الطريق 😅 جرب تكتب السؤال تاني.' }]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleSubmitCorrection = async (e) => {
    e.preventDefault();
    if (!correctionPlace.trim() || !correctionText.trim()) return;

    setIsSubmittingCorrection(true);
    try {
      const userIsAdmin = Boolean(isAdmin || (user?.email && user.email.toLowerCase() === ADMIN_EMAIL));
      await addDoc(collection(db, 'beso_knowledge_updates'), {
        placeKeywords: correctionPlace.trim(),
        correctedInfo: correctionText.trim(),
        status: userIsAdmin ? 'approved' : 'pending',
        submittedBy: user?.uid || 'guest',
        submittedByName: user?.displayName || 'مستخدم طريقنا',
        createdAt: serverTimestamp()
      });
      setCorrectionSuccessMsg(userIsAdmin ? 'تم الحفظ والاعتماد فوراً في ذاكرة بيسو! ✅' : 'شكراً! تم الإرسال للإدارة للمراجعة ⏳');
    } catch (err) {
      setCorrectionSuccessMsg('تعذر الحفظ دلوقتي، جرب تاني ❌');
    } finally {
      setIsSubmittingCorrection(false);
      setTimeout(() => {
        setCorrectingMsgId(null); setCorrectionPlace(''); setCorrectionText(''); setCorrectionSuccessMsg('');
      }, 1800);
    }
  };

  const bgCard = isDarkMode ? 'bg-slate-900/95 border-slate-700/80' : 'bg-white/95 border-slate-200';
  const bgInput = isDarkMode ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-400' : 'bg-slate-100 border-slate-200 text-slate-900';
  const lastBesoId = [...messages].reverse().find(m => m.sender === 'beso')?.id;

  const modalContent = (
    <>
      <div className="fixed inset-0 bottom-[72px] bg-black/25 backdrop-blur-[1px] z-[190]" onClick={onClose} />

      <div
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
        className={`fixed bottom-[82px] left-3 right-3 sm:left-6 sm:right-auto sm:w-[410px] h-[66dvh] max-h-[550px] min-h-[350px] z-[200] ${bgCard} backdrop-blur-xl rounded-3xl shadow-[0_12px_45px_rgba(0,0,0,0.45)] flex flex-col overflow-hidden border animate-fade-in-up`}
      >
        <div className="px-4 py-3 bg-indigo-600 text-white flex items-center justify-between shadow-sm shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/30 relative shrink-0">
              <Bot size={20} className="text-white" />
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-indigo-700"></span>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="font-black text-sm">المساعد الذكي "بيسو"</h3>
                <span className="text-xs font-black bg-amber-400 text-slate-950 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"><Sparkles size={9}/> Live GIS</span>
              </div>
              <p className="text-xs text-indigo-100 font-bold">أسرع وأرخص طريق بين {approvedStations.length} نقطة 🧠</p>
            </div>
          </div>
          <button aria-label="إغلاق" onClick={onClose} className="p-2.5 bg-white/15 hover:bg-rose-500 rounded-full transition-colors"><X size={18} /></button>
        </div>

        <div className={`flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3 [&::-webkit-scrollbar]:hidden ${isDarkMode ? 'bg-slate-950/50' : 'bg-slate-50/70'}`}>
          {messages.map((msg) => {
            const isBeso = msg.sender === 'beso';
            const isEditingThis = correctingMsgId === msg.id;

            return (
              <div key={msg.id} className={`flex ${isBeso ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[92%] flex flex-col gap-1.5 ${isBeso ? 'items-start' : 'items-end'}`}>
                  <div className={`p-3 rounded-2xl text-[13px] leading-relaxed whitespace-pre-line shadow-sm ${
                    isBeso ? (isDarkMode ? 'bg-slate-800 text-slate-100 border border-slate-700 rounded-tr-sm' : 'bg-white text-slate-800 border border-slate-200 rounded-tr-sm') : 'bg-indigo-600 text-white font-bold rounded-tl-sm'
                  }`}>
                    <RichText text={msg.text} />
                  </div>

                  {isBeso && msg.matchedStations && msg.matchedStations.length > 0 && (
                    <div className="w-full space-y-1.5 mt-0.5">
                      <span className="text-xs font-black text-indigo-400 px-1 flex items-center gap-1"><Compass size={11}/> النقاط المرتبطة بالمسار (اضغط لفتح التفاصيل):</span>
                      {msg.matchedStations.map((st) => (
                        <button key={st.id} onClick={() => { onClose(); onSelectStation && onSelectStation(st); }} className={`w-full p-2 rounded-xl border flex items-center justify-between hover:border-indigo-500 ${isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-indigo-50/70 border-indigo-200 text-slate-900'}`}>
                          <div className="flex items-center gap-2">
                            <div className={`p-1.5 rounded-lg text-white ${st.nodeType === 'hub' ? 'bg-amber-600' : 'bg-indigo-600'}`}><BusFront size={13}/></div>
                            <div className="text-right">
                              <h4 className="text-xs font-black">{st.name}</h4>
                              <p className="text-xs text-slate-400 font-bold">
                                {st.nodeType === 'hub' ? 'نقطة تبادلية 🔄' : (st.nodeType === 'stop' ? 'نقطة 📍' : 'موقف 🚏')} • {st.location}
                              </p>
                            </div>
                          </div>
                          <ChevronLeft size={12} className="text-indigo-500"/>
                        </button>
                      ))}
                    </div>
                  )}

                  {isBeso && msg.id === lastBesoId && msg.suggestions && msg.suggestions.length > 0 && !isTyping && (
                    <div className="flex flex-wrap gap-1.5">
                      {msg.suggestions.map((sg, i) => (
                        <button key={i} onClick={() => handleSend(sg)} className={`text-xs font-black px-2.5 py-1.5 rounded-full border transition-colors ${isDarkMode ? 'bg-indigo-500/15 border-indigo-400/40 text-indigo-200 hover:bg-indigo-600 hover:text-white' : 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-600 hover:text-white'}`}>
                          {sg}
                        </button>
                      ))}
                    </div>
                  )}

                  {isBeso && msg.id !== 'welcome' && (
                    <button
                      onClick={() => {
                        if (isEditingThis) setCorrectingMsgId(null);
                        else {
                          setCorrectingMsgId(msg.id);
                          setCorrectionPlace(msg.queryContext || '');
                          setCorrectionText('');
                        }
                      }}
                      className={`text-xs font-black flex items-center gap-1 px-2 py-1.5 rounded-lg border transition-all ${
                        isEditingThis ? 'bg-amber-500 text-slate-950 border-amber-400' : (isDarkMode ? 'bg-slate-800/80 border-slate-700 text-amber-400' : 'bg-amber-50 border-amber-200 text-amber-700')
                      }`}
                    >
                      <Edit3 size={11} /> {isEditingThis ? 'إغلاق التعديل' : '✏️ إضافة أو تعديل إرشاد مباشر لبيسو'}
                    </button>
                  )}

                  {isBeso && isEditingThis && (
                    <form onSubmit={handleSubmitCorrection} className={`w-full p-3 rounded-2xl border-2 border-amber-500/40 space-y-2 animate-fade-in-up ${isDarkMode ? 'bg-slate-900 text-white' : 'bg-amber-50 text-slate-900'}`}>
                      <span className="text-xs font-black text-amber-500 flex items-center gap-1"><PlusCircle size={13}/> تعليم بيسو خط أو تحويلة جديدة:</span>
                      {correctionSuccessMsg ? (
                        <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 text-xs font-black">{correctionSuccessMsg}</div>
                      ) : (
                        <>
                          <input type="text" required value={correctionPlace} onChange={(e) => setCorrectionPlace(e.target.value)} placeholder="الكلمات المفتاحية (مثال: الصحراوي - أكتوبر)" className={`w-full px-3 py-2 rounded-xl border text-xs font-bold outline-none ${bgInput}`}/>
                          <textarea rows={2} required value={correctionText} onChange={(e) => setCorrectionText(e.target.value)} placeholder="اكتب التحويلة بالتفصيل (مثال: انزل تحت محور 26 يوليو واطلع اركب من فوق للحصري)..." className={`w-full px-3 py-2 rounded-xl border text-xs font-bold outline-none resize-none ${bgInput}`}/>
                          <div className="flex gap-1.5">
                            <button type="submit" disabled={isSubmittingCorrection} className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl text-xs font-black">{isSubmittingCorrection ? 'جاري الحفظ...' : 'حفظ في ذاكرة بيسو'}</button>
                            <button type="button" onClick={() => setCorrectingMsgId(null)} className="px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-xs font-bold">إلغاء</button>
                          </div>
                        </>
                      )}
                    </form>
                  )}
                </div>
              </div>
            );
          })}

          {isTyping && (
            <div className="flex justify-start">
              <div className={`px-3.5 py-2.5 rounded-2xl rounded-tr-sm border flex gap-1 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className={`px-2.5 py-1.5 border-t shrink-0 flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
          {quickQuestions.map((q, idx) => (
            <button key={idx} onClick={() => handleSend(q)} className={`shrink-0 text-xs font-black px-2.5 py-1 rounded-full border ${isDarkMode ? 'bg-slate-800 border-slate-700 text-indigo-300 hover:bg-indigo-600 hover:text-white' : 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-600 hover:text-white'}`}>
              {q}
            </button>
          ))}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className={`p-2.5 shrink-0 flex items-center gap-2 border-t ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'}`}>
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="مثال: من الصحراوي لأكتوبر..." className={`flex-1 px-3.5 py-2.5 rounded-xl border text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500 ${bgInput}`}/>
          <button type="submit" disabled={!input.trim() || isTyping} className="w-10 h-10 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white flex items-center justify-center shadow-md active:scale-95 shrink-0">
            <Send size={16} className="rtl:rotate-180" />
          </button>
        </form>
      </div>
    </>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};

export default BesoAssistantModal;
