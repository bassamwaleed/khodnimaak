// منطق شبكة TfC المحدّث — يدعم التعريب الكامل، دمج المكرر، والبحث الموحد لبيسو ومخطط الرحلات
export const DEFAULTS = {
  waitMin: 8,
  walkMaxM: 250,
  walkMPerMin: 80,
  maxRides: 4,
  customKmh: 25,
  dedupeMeters: 65 // مسافة دمج المحطات المكررة تلقائياً
};

// قاموس تعريب أنواع وسائل المواصلات
export const ROUTE_TYPES_AR = {
  microbus: 'ميكروباص',
  minibus: 'ميني باص',
  bus: 'أتوبيس نقل عام',
  cta: 'أتوبيس هيئة النقل',
  mwasalat: 'مواصلات مصر',
  metro: 'مترو الأنفاق',
  lrt: 'القطار الكهربائي الخفيف',
  monorail: 'مونوريل',
  train: 'قطار',
  tuk: 'توكتوك / داخلي'
};

// قاموس تعريب المحطات والمعالم الشائعة في بيانات TfC
const STATION_TRANSLATIONS = [
  [/October University for Modern Sciences & Arts\s*\(MSA University\)/gi, 'جامعة أكتوبر للعلوم الحديثة والآداب (MSA)'],
  [/MSA University/gi, 'جامعة MSA'],
  [/Misr University for Science and Technology|MUST University/gi, 'جامعة مصر للعلوم والتكنولوجيا (MUST)'],
  [/October 6 University|6th of October University|O6U/gi, 'جامعة 6 أكتوبر'],
  [/Zewail City/gi, 'مدينة زويل'],
  [/Nile University/gi, 'جامعة النيل'],
  [/Cairo University/gi, 'جامعة القاهرة'],
  [/Ain Shams University/gi, 'جامعة عين شمس'],
  [/Sphinx International Airport|Sphinx Airport/gi, 'مطار سفنكس الدولي'],
  [/Cairo International Airport|Cairo Airport/gi, 'مطار القاهرة الدولي'],
  [/Dolphin Mall/gi, 'دولفين مول'],
  [/Mall of Arabia/gi, 'مول العرب'],
  [/Mall of Egypt/gi, 'مول مصر'],
  [/Arkan Plaza/gi, 'أركان بلازا'],
  [/Americana Plaza/gi, 'أمريكانا بلازا'],
  [/Dandy Mall/gi, 'داندي مول'],
  [/Hyper One/gi, 'هايبر وان'],
  [/Hosary Square|El Hosary|Al Hosary/gi, 'ميدان الحصري'],
  [/Laylat Al Qadr/gi, 'موقف ليلة القدر'],
  [/Smart Village/gi, 'القرية الذكية'],
  [/Media Production City|EMPC/gi, 'مدينة الإنتاج الإعلامي'],
  [/Dream Park/gi, 'دريم بارك'],
  [/Alexandria Desert Rd\.?|Alex Desert Rd\.?/gi, 'طريق الإسكندرية الصحراوي'],
  [/26th of July Corridor|26th of July Corrdior|26 July Corridor/gi, 'محور 26 يوليو'],
  [/Wahat Rd\.?|El Wahat Road/gi, 'طريق الواحات'],
  [/Ring Rd\.?|Ring Road/gi, 'الطريق الدائري'],
  [/Dahshour Link|Waslet Dahshour/gi, 'وصلة دهشور'],
  [/Mehwar/gi, 'المحور'],
  [/Giza Square/gi, 'ميدان الجيزة'],
  [/Ramses Square|Ramsis/gi, 'ميدان رمسيس'],
  [/Tahrir Square/gi, 'ميدان التحرير'],
  [/Abdel Moneim Riad/gi, 'عبد المنعم رياض'],
  [/Lebanon Square/gi, 'ميدان لبنان'],
  [/Sphinx Square/gi, 'ميدان سفنكس'],
  [/Remaya Square/gi, 'ميدان الرماية'],
  [/Moneeb|El Mounib/gi, 'المنيب'],
  [/Abboud/gi, 'عبود'],
  [/El Salam|Al Salam/gi, 'السلام'],
  [/Sheikh Zayed/gi, 'الشيخ زايد'],
  [/6th of October|6 October/gi, '6 أكتوبر'],
  [/Hadayek Al Ahram|Hadayek El Ahram/gi, 'حدائق الأهرام'],
  [/Hadayek October/gi, 'حدائق أكتوبر'],
  [/Mohandessin/gi, 'المهندسين'],
  [/Dokki/gi, 'الدقي'],
  [/Haram/gi, 'الهرم'],
  [/Faisal/gi, 'فيصل'],
  [/Nasr City/gi, 'مدينة نصر'],
  [/Heliopolis/gi, 'مصر الجديدة'],
  [/Maadi/gi, 'المعادي'],
  [/New Cairo/gi, 'القاهرة الجديدة'],
  [/Fifth Settlement|5th Settlement/gi, 'التجمع الخامس'],
  [/\bStops\b/gi, 'محطات'],
  [/\bStop\b/gi, 'محطة'],
  [/\bSquare\b/gi, 'ميدان'],
  [/\bStation\b/gi, 'محطة'],
  [/\bGate\b/gi, 'بوابة'],
  [/\bDistrict\b/gi, 'الحي'],
  [/\bCity\b/gi, 'مدينة'],
  [/\bMall\b/gi, 'مول'],
  [/\bHospital\b/gi, 'مستشفى'],
  [/\bClub\b/gi, 'نادي'],
  [/\bBridge\b/gi, 'كوبري'],
  [/\bStreet\b|\bSt\.\b/gi, 'شارع'],
  [/\bRoad\b|\bRd\.\b/gi, 'طريق']
];

export const localizeStationLabel = (rawName = '') => {
  let label = String(rawName || '').trim();
  if (!label) return '';
  for (const [pattern, arText] of STATION_TRANSLATIONS) {
    label = label.replace(pattern, arText);
  }
  return label.replace(/\s+/g, ' ').trim();
};

// إحداثيات الـ Seed الأساسية المرجعية لتصحيح المواقف الرئيسية
export const SEED_COORDS = {
  'موقف الحصري': { lat: 29.9725, lng: 30.9438, aliases: ['الحصري', 'ميدان الحصري', 'hosary'] },
  'موقف ليلة القدر': { lat: 29.9632, lng: 30.9285, aliases: ['ليلة القدر', 'موقف السادس', 'laylat al qadr'] },
  'ميدان الرماية': { lat: 29.9885, lng: 31.1278, aliases: ['الرماية', 'الاهرامات', 'remaya'] },
  'ميدان الجيزة': { lat: 30.0131, lng: 31.2089, aliases: ['الجيزة', 'محطة الجيزة', 'giza'] },
  'موقف المنيب': { lat: 29.9814, lng: 31.2121, aliases: ['المنيب', 'moneeb'] },
  'ميدان رمسيس': { lat: 30.0626, lng: 31.2467, aliases: ['رمسيس', 'محطة مصر', 'ramses'] },
  'موقف عبود': { lat: 30.1018, lng: 31.2582, aliases: ['عبود', 'abboud'] },
  'موقف السلام': { lat: 30.1355, lng: 31.3489, aliases: ['السلام', 'النفق', 'salam'] },
  'هايبر وان': { lat: 30.0258, lng: 31.0125, aliases: ['هايبر', 'الشيخ زايد', 'hyper one'] },
  'ميدان لبنان': { lat: 30.0561, lng: 31.1983, aliases: ['لبنان', 'المهندسين', 'lebanon'] }
};

export const distM = (a, b) => {
  if (!a || !b) return Infinity;
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

// تطبيع النصوص العربية للبحث الدقيق (إزالة التشكيل، توحيد الألف والياء والتاء المربوطة)
export const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/[\u064B-\u065F\u0640]/g, '')
  .replace(/[أإآ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/\s+/g, ' ')
  .trim();

// صيغة بحث إضافية بدون "ال" التعريفية
export const normNoAl = (s) => norm(s).replace(/(^|\s)ال/g, '$1').trim();

// تعريب مسمى الخط ونوعه تلقائياً
export const localizeRouteLabel = (name = '', type = '') => {
  const rawType = String(type || '').toLowerCase().trim();
  const arType = ROUTE_TYPES_AR[rawType] || (rawType ? type : 'مواصلات');
  let cleanName = String(name || '').trim();

  cleanName = cleanName
    .replace(/\bCTA\b/gi, 'أتوبيس هيئة النقل')
    .replace(/\bMwasalat Misr\b/gi, 'مواصلات مصر')
    .replace(/\bMicrobus\b/gi, 'ميكروباص')
    .replace(/\bMinibus\b/gi, 'ميني باص')
    .replace(/\bBus\b/gi, 'أتوبيس')
    .replace(/\bMetro\b/gi, 'مترو')
    .replace(/\bLine\b/gi, 'خط')
    .replace(/\bto\b/gi, 'إلى')
    .replace(/\s*-\s*/g, ' - ');

  cleanName = localizeStationLabel(cleanName);

  return { name: cleanName || arType, typeAr: arType };
};

const num = (v) => (v === undefined || v === null || v === '' ? null : (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null));

const mkPattern = (p, stations, kmh) => {
  let hops = p.hopMin
    ? p.hopMin.map(m => Math.max(1, Number(m) || 1))
    : p.stops.slice(1).map((s, i) => Math.max(1, Math.round(distM(stations.get(p.stops[i]), stations.get(s)) / (kmh * 1000 / 60))));
  const sum = hops.reduce((a, b) => a + b, 0) || 1;
  const total = num(p.total);
  const overridden = total !== null && total > 0;
  if (overridden) hops = hops.map(h => (h * total) / sum);
  const cum = [0];
  hops.forEach(h => cum.push(cum[cum.length - 1] + h));
  const loc = localizeRouteLabel(p.name, p.type);
  return {
    id: p.id,
    routeId: p.routeId,
    name: loc.name,
    type: loc.typeAr,
    stops: p.stops,
    cum,
    fare: num(p.fare),
    minutesEstimated: !overridden,
    custom: !!p.custom
  };
};

export const buildNetwork = (raw, ov = {}) => {
  const o = {
    fares: {},
    minutes: {},
    disabled: [],
    names: {},
    routeNames: {},
    coords: {},
    aliases: {},
    customStations: [],
    customRoutes: [],
    ...ov
  };

  const settings = { ...DEFAULTS, waitMin: num(o.waitMin) ?? DEFAULTS.waitMin };
  const rawStations = new Map();

  // 1. تحميل المحطات الأساسية وتطبيق التعريب وتصحيح الإحداثيات
  (raw.stations || []).forEach(([id, name, lat, lng, ar]) => {
    const fixedCoord = o.coords[id];
    const autoAr = localizeStationLabel(ar || name);
    const finalAr = o.names[id] || autoAr;
    const seedMatch = SEED_COORDS[finalAr] || SEED_COORDS[name];
    rawStations.set(id, {
      id,
      name,
      ar: finalAr,
      lat: fixedCoord?.lat ?? lat,
      lng: fixedCoord?.lng ?? lng,
      aliases: [name, ...(o.aliases[id] || []), ...(seedMatch?.aliases || [])],
      custom: false
    });
  });

  // 2. تحميل المحطات المضافة يدوياً من الأدمن أو Firestore
  (o.customStations || []).forEach(c => {
    const fixedCoord = o.coords[c.id];
    const autoAr = localizeStationLabel(c.ar || c.name);
    const finalAr = o.names[c.id] || autoAr;
    rawStations.set(c.id, {
      id: c.id,
      name: c.name || finalAr,
      ar: finalAr,
      lat: fixedCoord?.lat ?? c.lat,
      lng: fixedCoord?.lng ?? c.lng,
      aliases: [c.name, ...(o.aliases[c.id] || []), ...(c.aliases || [])].filter(Boolean),
      custom: true
    });
  });

  // 3. دمج المحطات المكررة بسرعة O(1) بالاسم المطبّع + الشبكة الجغرافية
  const idRedirect = new Map();
  const stations = new Map();
  const byNameMap = new Map();
  const geoBuckets = new Map();
  const bucketKey = (lat, lng) => `${Math.floor(lat / 0.001)}|${Math.floor(lng / 0.001)}`;

  for (const st of rawStations.values()) {
    const stKey = normNoAl(st.ar || st.name);
    let master = stKey ? byNameMap.get(stKey) : null;

    if (!master && Number.isFinite(st.lat) && Number.isFinite(st.lng)) {
      const [bx, by] = [Math.floor(st.lat / 0.001), Math.floor(st.lng / 0.001)];
      outer: for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = geoBuckets.get(`${bx + dx}|${by + dy}`);
          if (!bucket) continue;
          for (const existing of bucket) {
            const exKey = normNoAl(existing.ar || existing.name);
            const sameName = stKey && exKey && stKey === exKey;
            const veryClose = distM(st, existing) <= settings.dedupeMeters && (sameName || !st.ar || !existing.ar);
            if (sameName || veryClose) {
              master = existing;
              break outer;
            }
          }
        }
      }
    }

    if (master) {
      idRedirect.set(st.id, master.id);
      const mergedAliases = new Set([...master.aliases, st.name, st.ar, ...st.aliases].filter(Boolean));
      master.aliases = [...mergedAliases];
      if (!master.ar && st.ar) master.ar = st.ar;
    } else {
      idRedirect.set(st.id, st.id);
      stations.set(st.id, st);
      if (stKey) byNameMap.set(stKey, st);
      if (Number.isFinite(st.lat) && Number.isFinite(st.lng)) {
        const bk = bucketKey(st.lat, st.lng);
        (geoBuckets.get(bk) || geoBuckets.set(bk, []).get(bk)).push(st);
      }
    }
  }

  const resolveStopId = (id) => idRedirect.get(id) || id;
  const cleanStops = (stops) => {
    const mapped = stops.map(resolveStopId).filter(id => stations.has(id));
    return mapped.filter((id, idx) => idx === 0 || id !== mapped[idx - 1]);
  };

  const disabled = new Set(o.disabled || []);
  const patterns = [];

  (raw.routes || []).forEach(r => {
    if (disabled.has(r.r)) return;
    const stops = cleanStops(r.s || []);
    if (stops.length < 2) return;
    const customRouteName = o.routeNames[r.r] || r.ar || r.n;
    patterns.push(mkPattern({
      id: `${r.r}|${r.d}`,
      routeId: r.r,
      name: customRouteName,
      type: r.t || r.n,
      stops,
      hopMin: stops.length === r.s.length ? r.m : null,
      fare: o.fares[r.r],
      total: o.minutes[r.r]
    }, stations, settings.customKmh));
  });

  (o.customRoutes || []).forEach(c => {
    if (disabled.has(c.id)) return;
    const stops = cleanStops(c.stops || []);
    if (stops.length < 2) return;
    const customRouteName = o.routeNames[c.id] || c.name;
    const dirs = c.twoWay === false ? [stops] : [stops, [...stops].reverse()];
    dirs.forEach((st, i) => patterns.push(mkPattern({
      id: `${c.id}|${i}`,
      routeId: c.id,
      name: customRouteName,
      type: c.type || 'ميكروباص',
      stops: st,
      hopMin: null,
      fare: c.fare,
      total: c.totalMinutes,
      custom: true
    }, stations, settings.customKmh)));
  });

  const routesAt = new Map();
  patterns.forEach(p => p.stops.forEach(s => {
    if (!routesAt.has(s)) routesAt.set(s, new Set());
    routesAt.get(s).add(p.routeId);
  }));

  const cell = (lat, lng) => [Math.floor(lat / 0.0025), Math.floor(lng / 0.0025)];
  const grid = new Map();
  [...routesAt.keys()].forEach(id => {
    const s = stations.get(id);
    const [a, b] = cell(s.lat, s.lng);
    const k = `${a}|${b}`;
    (grid.get(k) || grid.set(k, []).get(k)).push(id);
  });

  const walk = new Map();
  [...routesAt.keys()].forEach(id => {
    const s = stations.get(id), [a, b] = cell(s.lat, s.lng), list = [];
    for (let da = -1; da <= 1; da++) {
      for (let db = -1; db <= 1; db++) {
        (grid.get(`${a + da}|${b + db}`) || []).forEach(n => {
          if (n === id) return;
          const m = distM(s, stations.get(n));
          if (m <= settings.walkMaxM) {
            list.push({ to: n, m: Math.round(m), min: Math.max(1, Math.ceil(m / DEFAULTS.walkMPerMin)) });
          }
        });
      }
    }
    if (list.length) walk.set(id, list);
  });

  const search = [...routesAt.keys()].map(id => {
    const s = stations.get(id);
    const fullText = `${s.ar} ${s.name} ${(s.aliases || []).join(' ')}`;
    return {
      id,
      key: norm(fullText),
      keyNoAl: normNoAl(fullText),
      routesCount: routesAt.get(id)?.size || 0
    };
  });

  const uniqueRoutesMap = new Map();
  patterns.forEach(p => {
    if (!uniqueRoutesMap.has(p.routeId)) {
      uniqueRoutesMap.set(p.routeId, {
        routeId: p.routeId,
        name: p.name,
        type: p.type,
        fare: p.fare,
        stops: p.stops,
        key: norm(`${p.name} ${p.type}`),
        keyNoAl: normNoAl(`${p.name} ${p.type}`)
      });
    }
  });

  return {
    stations,
    patterns,
    routesAt,
    walk,
    settings,
    search,
    routesIndex: [...uniqueRoutesMap.values()],
    mergedCount: rawStations.size - stations.size
  };
};

export const stationLabel = (s) => (s ? (s.ar || s.name) : '');

export const searchStations = (net, q, limit = 12) => {
  if (!net?.search) return [];
  const k = norm(q);
  const kNoAl = normNoAl(q);
  if (!k) return [];

  const out = [];
  for (const x of net.search) {
    const i1 = x.key.indexOf(k);
    const i2 = kNoAl ? x.keyNoAl.indexOf(kNoAl) : -1;
    if (i1 >= 0 || i2 >= 0) {
      const startsWith = i1 === 0 || i2 === 0;
      out.push({
        id: x.id,
        rank: startsWith ? 0 : 1,
        routesCount: x.routesCount
      });
    }
  }
  out.sort((a, b) => a.rank - b.rank || b.routesCount - a.routesCount);
  return out.slice(0, limit).map(x => net.stations.get(x.id));
};

export const unifiedSearch = (net, q, limit = 10) => {
  if (!net) return { stations: [], routes: [] };
  const stations = searchStations(net, q, limit);
  const k = norm(q);
  const kNoAl = normNoAl(q);
  if (!k) return { stations: [], routes: [] };

  const routes = (net.routesIndex || [])
    .filter(r => r.key.includes(k) || (kNoAl && r.keyNoAl.includes(kNoAl)))
    .slice(0, limit)
    .map(r => ({
      ...r,
      fromName: stationLabel(net.stations.get(r.stops[0])),
      toName: stationLabel(net.stations.get(r.stops[r.stops.length - 1]))
    }));

  return { stations, routes };
};

export const generateSuggestedLinks = (net, maxMeters = 600, limit = 30) => {
  if (!net) return [];
  const ids = [...net.routesAt.keys()];
  const suggestions = [];
  const seen = new Set();

  for (let i = 0; i < ids.length; i++) {
    const a = net.stations.get(ids[i]);
    for (let j = i + 1; j < ids.length; j++) {
      const b = net.stations.get(ids[j]);
      const m = Math.round(distM(a, b));
      if (m > 65 && m <= maxMeters) {
        const pairKey = [a.id, b.id].sort().join('|');
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        suggestions.push({
          fromId: a.id,
          fromName: stationLabel(a),
          toId: b.id,
          toName: stationLabel(b),
          kind: m <= 300 ? 'walk' : 'ride',
          distanceMeters: m,
          minutes: Math.max(1, Math.ceil(m / 80)),
          fare: m <= 300 ? 0 : 5
        });
      }
    }
  }
  return suggestions.sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, limit);
};

export const nearestStation = (net, lat, lng) => {
  if (!net?.routesAt) return null;
  let best = null, bd = Infinity;
  for (const id of net.routesAt.keys()) {
    const s = net.stations.get(id);
    const d = distM({ lat, lng }, s);
    if (d < bd) { bd = d; best = s; }
  }
  return best ? { station: best, meters: Math.round(bd) } : null;
};

export const planTrips = (net, from, to, opts = {}) => {
  const { waitMin, maxRides } = { ...net.settings, ...opts };
  if (!net.stations.has(from) || !net.stations.has(to) || from === to) return [];
  const best = [new Map([[from, 0]])], par = [new Map()];
  const relaxWalk = (k, seeds) => {
    for (const s of seeds) for (const w of net.walk.get(s) || []) {
      const nt = best[k].get(s) + w.min;
      if (nt < (best[k].get(w.to) ?? Infinity)) {
        best[k].set(w.to, nt);
        par[k].set(w.to, { type: 'walk', from: s, min: w.min, m: w.m });
      }
    }
  };
  relaxWalk(0, [from]);

  const build = (k) => {
    const legs = []; let kk = k, s = to;
    for (;;) {
      while (kk > 0 && !par[kk].has(s)) kk--;
      const pr = par[kk].get(s);
      if (!pr) break;
      if (pr.type === 'walk') {
        legs.push({ type: 'walk', fromId: pr.from, toId: s, minutes: pr.min, meters: pr.m });
        s = pr.from;
        continue;
      }
      const p = pr.p;
      legs.push({
        type: 'ride',
        patternId: p.id,
        routeId: p.routeId,
        name: p.name,
        routeType: p.type,
        custom: p.custom,
        boardId: p.stops[pr.from],
        alightId: s,
        hops: pr.to - pr.from,
        minutes: p.cum[pr.to] - p.cum[pr.from],
        minutesEstimated: p.minutesEstimated,
        fare: p.fare,
        stopIds: p.stops.slice(pr.from, pr.to + 1)
      });
      s = p.stops[pr.from];
      kk--;
    }
    legs.reverse();
    const rides = legs.filter(l => l.type === 'ride');
    return {
      legs,
      rides: rides.length,
      transfers: Math.max(0, rides.length - 1),
      totalMinutes: Math.round(best[k].get(to)),
      rideMinutes: Math.round(rides.reduce((a, l) => a + l.minutes, 0)),
      totalFare: rides.reduce((a, l) => a + (l.fare ?? 0), 0),
      unknownFareLegs: rides.filter(l => l.fare === null).length,
      estimated: rides.some(l => l.minutesEstimated),
      walkMeters: legs.filter(l => l.type === 'walk').reduce((a, l) => a + l.meters, 0)
    };
  };

  const options = []; let last = best[0].get(to) ?? Infinity;
  if (last < Infinity) options.push(build(0));
  for (let k = 1; k <= maxRides; k++) {
    const prev = best[k - 1], cur = new Map(prev); best[k] = cur; par[k] = new Map();
    const improved = new Set();
    for (const p of net.patterns) {
      let bt = Infinity, bi = -1;
      for (let i = 0; i < p.stops.length; i++) {
        const s = p.stops[i];
        const stay = bi >= 0 ? bt + p.cum[i] - p.cum[bi] : Infinity;
        if (bi >= 0 && stay < (cur.get(s) ?? Infinity)) {
          cur.set(s, stay);
          par[k].set(s, { type: 'ride', p, from: bi, to: i });
          improved.add(s);
        }
        const pt = prev.get(s);
        if (pt !== undefined && pt + waitMin < stay) { bt = pt + waitMin; bi = i; }
      }
    }
    if (!improved.size) break;
    relaxWalk(k, improved);
    const t = cur.get(to) ?? Infinity;
    if (t < last - 0.01) { options.push(build(k)); last = t; }
  }
  const minT = Math.min(...options.map(o => o.totalMinutes));
  const minTr = Math.min(...options.map(o => o.transfers));
  const full = options.filter(o => o.unknownFareLegs === 0);
  const minF = full.length ? Math.min(...full.map(o => o.totalFare)) : null;
  options.forEach(o => {
    o.fastest = o.totalMinutes === minT;
    o.fewest = o.transfers === minTr;
    o.cheapest = minF !== null && o.unknownFareLegs === 0 && o.totalFare === minF;
  });
  return options.sort((a, b) => a.totalMinutes - b.totalMinutes);
};