import React, { useState, useMemo, useEffect } from 'react';
import { Route, ChevronDown, ArrowLeftRight, Link2, MapPin, Loader2, Compass, BusFront, Search, X, Sparkles } from 'lucide-react';
import { findBestPath, approvedLinks, coordsOf } from '../utils/gis';
import { LINK_KINDS } from '../utils/gisConstants';
import { getDistanceKm, getPlaceCoords } from '../utils/helpers';
import { normalizeArabic } from '../App';
import SuggestLinkModal from './SuggestLinkModal';

const kindOf = (id) => LINK_KINDS.find(k => k.id === id) || LINK_KINDS[1];

const JourneyPlanner = ({
  stations = [], links = [], user, isGuest, isAdmin, isDarkMode,
  triggerToast, onSelectStation, userAreas = []
}) => {
  const [open, setOpen] = useState(true);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [destQuery, setDestQuery] = useState('');
  const [showOriginPicker, setShowOriginPicker] = useState(false);
  const [criterion, setCriterion] = useState('fast');
  const [showSuggest, setShowSuggest] = useState(false);

  const [isLocatingGps, setIsLocatingGps] = useState(false);
  const [gpsDistText, setGpsDistText] = useState('');

  const nodes = useMemo(
    () => stations.filter(s => isAdmin || s.status !== 'pending').sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar')),
    [stations, isAdmin]
  );
  const byId = useMemo(() => Object.fromEntries(nodes.map(n => [n.id, n])), [nodes]);
  const approvedCount = useMemo(() => approvedLinks(links, byId).length, [links, byId]);

  // 1) التقاط أقرب موقف تلقائياً من منطقة المستخدم لو ماحددش GPS لسه
  useEffect(() => {
    if (fromId || nodes.length === 0) return;
    if (Array.isArray(userAreas) && userAreas.length > 0) {
      const myArea = userAreas[0];
      const matchByArea = nodes.find(n => normalizeArabic(n.location) === normalizeArabic(myArea));
      if (matchByArea) {
        setFromId(matchByArea.id);
        return;
      }
      const areaCoords = getPlaceCoords(myArea);
      const ranked = nodes
        .map((st, i) => ({ st, d: getDistanceKm(areaCoords[0], areaCoords[1], ...(coordsOf(st) || getPlaceCoords(st, i + 1))) }))
        .sort((a, b) => a.d - b.d);
      if (ranked[0]) setFromId(ranked[0].st.id);
    }
  }, [nodes, userAreas, fromId]);

  // 2) تحديد الموقع التلقائي بالـ GPS
  const detectNearestByGps = () => {
    if (!navigator.geolocation) {
      if (triggerToast) triggerToast('متصفحك لا يدعم تحديد الموقع');
      return;
    }
    if (nodes.length === 0) return;
    setIsLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const ranked = nodes
          .map((st, idx) => {
            const c = coordsOf(st) || getPlaceCoords(st, idx + 1);
            return { st, distKm: getDistanceKm(latitude, longitude, c[0], c[1]) };
          })
          .filter(x => Number.isFinite(x.distKm))
          .sort((a, b) => a.distKm - b.distKm);

        setIsLocatingGps(false);
        if (ranked.length > 0) {
          const best = ranked[0];
          setFromId(best.st.id);
          setShowOriginPicker(false);
          const dStr = best.distKm < 1 ? `${Math.round(best.distKm * 1000)} م` : `${best.distKm.toFixed(1)} كم`;
          setGpsDistText(`يبعد عنك ${dStr}`);
          if (triggerToast) triggerToast(`تم تحديد أقرب موقف ليك: ${best.st.name} 📍`);
        }
      },
      () => {
        setIsLocatingGps(false);
        if (triggerToast) triggerToast('فعل الـ GPS من المتصفح لتحديد أقرب موقف تلقائياً');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  // 3) دمج روابط الأدمن على الخريطة مع خطوط السير المسجلة داخل المواقف
  const combinedLinks = useMemo(() => {
    const baseLinks = [...links];
    const existingPairs = new Set(baseLinks.map(l => `${l.fromId}|${l.toId}`));

    nodes.forEach(stA => {
      (stA.routes || []).forEach(r => {
        if (!isAdmin && r.status === 'pending') return;
        const targetText = normalizeArabic(r.destinationDetails || r.destination || '');
        const destGeneral = normalizeArabic(r.destination || '');
        if (!targetText && !destGeneral) return;

        nodes.forEach(stB => {
          if (stA.id === stB.id) return;
          const bName = normalizeArabic(stB.name || '');
          const bLoc = normalizeArabic(stB.location || '');

          const isMatch =
            (targetText && (bName.includes(targetText) || targetText.includes(bName))) ||
            (destGeneral && bLoc === destGeneral && (bName.includes(targetText) || !r.destinationDetails));

          if (isMatch && !existingPairs.has(`${stA.id}|${stB.id}`)) {
            existingPairs.add(`${stA.id}|${stB.id}`);
            const cA = getPlaceCoords(stA);
            const cB = getPlaceCoords(stB);
            const dist = getDistanceKm(cA[0], cA[1], cB[0], cB[1]);
            baseLinks.push({
              id: `auto_${stA.id}_${stB.id}`,
              fromId: stA.id,
              toId: stB.id,
              kind: 'ride',
              fare: Number(r.fare) || 0,
              minutes: Number.isFinite(dist) ? Math.max(5, Math.round(dist * 2)) : 20,
              note: r.boardingHint || r.destinationDetails || `خط ${r.destination}`,
              oneWay: true,
              status: 'approved'
            });
          }
        });
      });
    });

    return baseLinks;
  }, [links, nodes, isAdmin]);

  // 4) مطابقة ذكية لما يكتبه المستخدم في "رايح فين؟" مع أقرب موقف أو خط سير
  const smartMatches = useMemo(() => {
    const q = normalizeArabic(destQuery);
    if (!q) return { targetNode: toId ? byId[toId] : null, suggestions: [], directRoutes: [] };

    // أ) مواقف تطابق النص بالاسم أو المنطقة أو الإرشاد
    const nodeMatches = nodes.filter(n =>
      n.id !== fromId && (
        normalizeArabic(n.name).includes(q) ||
        normalizeArabic(n.location).includes(q) ||
        normalizeArabic(n.governorate).includes(q) ||
        normalizeArabic(n.transferHint).includes(q) ||
        (n.routes || []).some(r => normalizeArabic(r.destination).includes(q) || normalizeArabic(r.destinationDetails).includes(q))
      )
    );

    // ب) خطوط سير تخرج من موقف الانطلاق (أو أقرب موقف) وتذهب مباشرة لما كتبه المستخدم (مثل: رمسيس، الإسعاف، الدقي)
    const fromSt = byId[fromId];
    const directFromCurrent = [];
    if (fromSt) {
      (fromSt.routes || []).forEach(r => {
        if (!isAdmin && r.status === 'pending') return;
        if (normalizeArabic(r.destination).includes(q) || normalizeArabic(r.destinationDetails).includes(q)) {
          directFromCurrent.push({ station: fromSt, route: r });
        }
      });
    }

    // ج) لو الخط المباشر موجود في موقف تاني متوصل بموقفنا، نرشح الموقف التاني كمحطة وصول أو تبديل
    const stationsReachingQuery = nodes.filter(n =>
      (n.routes || []).some(r => (isAdmin || r.status !== 'pending') && (normalizeArabic(r.destination).includes(q) || normalizeArabic(r.destinationDetails).includes(q)))
    );

    const bestTargetNode = (toId && byId[toId]) || nodeMatches[0] || stationsReachingQuery.find(s => s.id !== fromId) || null;

    return {
      targetNode: bestTargetNode,
      suggestions: nodeMatches.slice(0, 5),
      directRoutes: directFromCurrent,
      stationsReachingQuery
    };
  }, [destQuery, toId, nodes, byId, fromId, isAdmin]);

  const effectiveToId = toId || smartMatches.targetNode?.id || '';

  // 5) حساب المسار الأفضل عبر الشبكة (Dijkstra)
  const pathResult = useMemo(
    () => (fromId && effectiveToId && fromId !== effectiveToId ? findBestPath(combinedLinks, byId, fromId, effectiveToId, criterion) : null),
    [combinedLinks, byId, fromId, effectiveToId, criterion]
  );

  // لو المستخدم كتب وجهة زي "رمسيس" وموقف التبديل في آخر المسار فيه خط يودي "رمسيس"، نعرضهوله كملاحظة ختامية
  const finalHopRoute = useMemo(() => {
    const q = normalizeArabic(destQuery);
    if (!q || !effectiveToId) return null;
    const endNode = byId[effectiveToId];
    if (!endNode) return null;
    return (endNode.routes || []).find(r =>
      (isAdmin || r.status !== 'pending') &&
      (normalizeArabic(r.destination).includes(q) || normalizeArabic(r.destinationDetails).includes(q))
    ) || null;
  }, [destQuery, effectiveToId, byId, isAdmin]);

  const quickDestinations = ['الحصري', 'رمسيس', 'هايبر وان', 'القرية الذكية', 'ميدان لبنان', 'الرماية', 'المعادي'];

  const canSuggest = Boolean(user) && !isGuest;
  const card = isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200';
  const bgInput = isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-900';
  const textPrimary = isDarkMode ? 'text-white' : 'text-slate-900';
  const textSecondary = isDarkMode ? 'text-slate-400' : 'text-slate-500';

  const currentOriginNode = byId[fromId];
  const openStation = (id) => { if (byId[id] && onSelectStation) onSelectStation(byId[id]); };

  return (
    <div className={`col-span-1 md:col-span-2 lg:col-span-3 rounded-2xl border shadow-sm overflow-hidden ${card}`}>
      {/* شريط العنوان المدمج */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full min-h-11 px-3.5 py-2.5 flex items-center justify-between gap-2 bg-indigo-600 text-white"
      >
        <span className="flex items-center gap-2 text-xs sm:text-sm font-black">
          <Compass size={17} className="shrink-0" />
          <span>خطط مشوارك الذكي (اكتب رايح فين بس!)</span>
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {approvedCount > 0 && (
            <span className="text-xs font-black bg-emerald-600 text-white px-2 py-0.5 rounded-full">
              {approvedCount} مسار
            </span>
          )}
          <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {open && (
        <div className="p-3 space-y-2.5">
          {/* 1) شريط نقطة الانطلاق التلقائية (مدمج في سطر واحد أنيق) */}
          <div className={`px-3 py-2 rounded-xl border flex items-center justify-between gap-2 ${isDarkMode ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-50 border-slate-200/80'}`}>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <span className={`text-xs font-bold block ${textSecondary}`}>
                  نقطة ركوبك الحالية {gpsDistText ? `(${gpsDistText})` : '(تلقائي)'}:
                </span>
                <button
                  type="button"
                  onClick={() => setShowOriginPicker(!showOriginPicker)}
                  className={`text-xs sm:text-sm font-black truncate block text-right hover:text-indigo-500 ${textPrimary}`}
                >
                  {currentOriginNode ? `🚏 ${currentOriginNode.name} (${currentOriginNode.location})` : 'اختر أقرب موقف لك...'} ✎
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={detectNearestByGps}
              disabled={isLocatingGps}
              title="تحديد أقرب موقف بالـ GPS"
              className="h-9 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-black flex items-center gap-1 shrink-0 shadow-sm active:scale-95 transition-transform"
            >
              {isLocatingGps ? <Loader2 size={13} className="animate-spin" /> : <MapPin size={13} />}
              <span>موقعي GPS</span>
            </button>
          </div>

          {/* قائمة تغيير موقف الانطلاق يدوياً (تظهر فقط لو ضغط على اسم الموقف لتغييره) */}
          {showOriginPicker && (
            <select
              value={fromId}
              onChange={e => { setFromId(e.target.value); setShowOriginPicker(false); setGpsDistText(''); }}
              className={`w-full h-10 px-3 rounded-xl border text-xs font-bold outline-none ${bgInput}`}
            >
              <option value="">اختر موقف الانطلاق يدوياً...</option>
              {nodes.map(n => (
                <option key={n.id} value={n.id}>{n.name} — {n.location}</option>
              ))}
            </select>
          )}

          {/* 2) مربع البحث الذكي الموحد للوجهة (اكتب المكان أو الموقف مباشرة) */}
          <div className="relative">
            <div className={`flex items-center gap-2 px-3 h-11 rounded-xl border focus-within:border-indigo-500 ${bgInput}`}>
              <Search size={16} className="text-indigo-500 shrink-0" />
              <input
                type="text"
                value={destQuery}
                onChange={e => { setDestQuery(e.target.value); setToId(''); }}
                placeholder="رايح فين؟ اكتب اسم المكان أو الموقف (مثال: رمسيس، الحصري، القرية الذكية)..."
                className="w-full bg-transparent outline-none text-xs sm:text-sm font-bold"
              />
              {(destQuery || toId) && (
                <button
                  type="button"
                  onClick={() => { setDestQuery(''); setToId(''); }}
                  className="text-slate-400 hover:text-rose-500"
                >
                  <X size={15} />
                </button>
              )}
            </div>

            {/* شيبس الوجهات السريعة لو لسه مكتبش حاجة */}
            {!destQuery && !toId && (
              <div className="flex items-center gap-1.5 overflow-x-auto pt-2 pb-0.5 [&::-webkit-scrollbar]:hidden">
                <span className={`text-xs font-bold shrink-0 ${textSecondary}`}>وجهات سريعة:</span>
                {quickDestinations.map(place => (
                  <button
                    key={place}
                    type="button"
                    onClick={() => setDestQuery(place)}
                    className={`px-2.5 py-1 rounded-full text-xs font-black border shrink-0 transition-colors hover:border-indigo-500 ${bgInput}`}
                  >
                    {place}
                  </button>
                ))}
              </div>
            )}

            {/* اقتراحات مطابقة لو فيه أكتر من موقف بنفس الاسم */}
            {destQuery && smartMatches.suggestions.length > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pt-2 pb-0.5 [&::-webkit-scrollbar]:hidden">
                <span className={`text-xs font-bold shrink-0 ${textSecondary}`}>اختر الموقف الأدق:</span>
                {smartMatches.suggestions.map(st => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setToId(st.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-black border shrink-0 transition-colors ${
                      effectiveToId === st.id ? 'bg-indigo-600 text-white border-indigo-600' : bgInput
                    }`}
                  >
                    {st.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 3) عرض النتيجة لو فيه خط مباشر من نفس الموقف اللي واقف فيه */}
          {smartMatches.directRoutes.length > 0 && (
            <div className="p-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 space-y-2 animate-fade-in-up">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <Sparkles size={14} /> مواصلة مباشرة من موقفك الحالي ({currentOriginNode?.name}):
                </span>
              </div>
              {smartMatches.directRoutes.map((item, idx) => (
                <div key={idx} className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 ${card}`}>
                  <div className="min-w-0">
                    <p className={`text-xs sm:text-sm font-black ${textPrimary}`}>
                      🚐 اركب خط: {item.route.destinationDetails || item.route.destination}
                    </p>
                    {item.route.boardingHint && (
                      <p className={`text-xs font-bold mt-0.5 ${textSecondary}`}>📍 مكان الركوب: {item.route.boardingHint}</p>
                    )}
                  </div>
                  <span className="text-sm font-black text-emerald-600 bg-emerald-500/15 px-2.5 py-1 rounded-lg shrink-0">
                    {item.route.fare} ج
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 4) عرض مسار الشبكة والتحويلات من روابط الأدمن (لو محتاج يركب لموقف تاني أو يبدل) */}
          {pathResult && smartMatches.directRoutes.length === 0 && (
            <div className="space-y-2 pt-1 animate-fade-in-up">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-black text-indigo-600 dark:text-indigo-400">
                    🧭 خط السير المقترح ({pathResult.transfers === 0 ? 'مباشر' : `${pathResult.transfers} تبديل`}):
                  </span>
                  <span className="text-xs font-black text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-lg">
                    ⏱ {pathResult.totalMinutes} د • 💰 {pathResult.totalFare + (finalHopRoute ? Number(finalHopRoute.fare) || 0 : 0)} ج
                  </span>
                </div>

                <div className="flex gap-1">
                  {[['fast', 'الأسرع'], ['cheap', 'الأوفر']].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setCriterion(id)}
                      className={`px-2 py-1 rounded-lg text-xs font-black border ${
                        criterion === id ? 'bg-indigo-600 text-white border-indigo-600' : bgInput
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <ol className="space-y-1.5">
                {pathResult.legs.map((leg, i) => {
                  const k = kindOf(leg.link.kind);
                  const fromNode = byId[leg.fromId];
                  const toNode = byId[leg.toId];
                  return (
                    <li key={i} className={`p-2.5 rounded-xl border space-y-1 ${card}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-xs font-black ${textPrimary}`}>
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-indigo-600 text-white text-xs me-1">
                            {i + 1}
                          </span>
                          <button type="button" onClick={() => openStation(leg.fromId)} className="hover:underline text-indigo-600 dark:text-indigo-400">
                            {fromNode?.name}
                          </button>
                          {' ⬅️ '}
                          <button type="button" onClick={() => openStation(leg.toId)} className="hover:underline">
                            {toNode?.name}
                          </button>
                        </span>
                        <span className={`text-xs font-black px-2 py-0.5 rounded-md border shrink-0 ${k.badgeClass}`}>
                          {leg.fare ? `${leg.fare} ج` : k.short}
                        </span>
                      </div>
                      {(leg.link.note || leg.minutes) && (
                        <p className={`text-xs font-bold ${textSecondary}`}>
                          {leg.minutes ? `⏱ ${leg.minutes} د` : ''}{leg.link.note ? ` • 📍 ${leg.link.note}` : ''}
                        </p>
                      )}
                    </li>
                  );
                })}

                {/* لو الوجهة النهائية خط جوة آخر موقف وصلناله (زي رمسيس من الحصري) */}
                {finalHopRoute && !normalizeArabic(byId[effectiveToId]?.name).includes(normalizeArabic(destQuery)) && (
                  <li className={`p-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/5 space-y-1`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-xs font-black ${textPrimary}`}>
                        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-600 text-white text-xs me-1">
                          {pathResult.legs.length + 1}
                        </span>
                        من {byId[effectiveToId]?.name} ⬅️ اركب خط ({finalHopRoute.destinationDetails || finalHopRoute.destination})
                      </span>
                      <span className="text-xs font-black text-emerald-600 bg-emerald-500/15 px-2 py-0.5 rounded-md">
                        {finalHopRoute.fare} ج
                      </span>
                    </div>
                    {finalHopRoute.boardingHint && (
                      <p className={`text-xs font-bold ${textSecondary}`}>📍 {finalHopRoute.boardingHint}</p>
                    )}
                  </li>
                )}
              </ol>
            </div>
          )}

          {(destQuery || toId) && smartMatches.directRoutes.length === 0 && !pathResult && (
            <div className="p-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs font-bold text-amber-700 dark:text-amber-400 flex items-center justify-between gap-2">
              <span>لسه مفيش خط مباشر متسجل لـ "{destQuery}".</span>
              {canSuggest && (
                <button
                  type="button"
                  onClick={() => setShowSuggest(true)}
                  className="px-2.5 py-1 rounded-lg bg-amber-600 text-white text-xs font-black shrink-0"
                >
                  + اقترح الطريق
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {showSuggest && (
        <SuggestLinkModal
          user={user}
          stations={stations}
          links={links}
          initialFromId={fromId}
          initialToId={effectiveToId}
          isDarkMode={isDarkMode}
          triggerToast={triggerToast}
          onClose={() => setShowSuggest(false)}
        />
      )}
    </div>
  );
};

export default JourneyPlanner;
