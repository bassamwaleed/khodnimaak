import React, { useState, useMemo } from 'react';
import { Route, ChevronDown, ArrowLeftRight, Link2, MapPin, Loader2, Navigation, Compass, BusFront } from 'lucide-react';
import { findBestPath, approvedLinks, coordsOf } from '../utils/gis';
import { LINK_KINDS, SUPPORTED_AREAS } from '../utils/gisConstants';
import { getDistanceKm, getPlaceCoords, EGYPT_CITIES } from '../utils/helpers';
import { normalizeArabic } from '../App';
import SuggestLinkModal from './SuggestLinkModal';

const kindOf = (id) => LINK_KINDS.find(k => k.id === id) || LINK_KINDS[1];

const JourneyPlanner = ({ stations = [], links = [], user, isGuest, isAdmin, isDarkMode, triggerToast, onSelectStation }) => {
  // مفتوح افتراضياً في صفحة مواقف مصر ليكون جاهزاً أمام المستخدم
  const [open, setOpen] = useState(true);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [criterion, setCriterion] = useState('fast');
  const [showSuggest, setShowSuggest] = useState(false);

  // حالات تحديد الموقع التلقائي (GPS) وأقرب المواقف
  const [isLocatingGps, setIsLocatingGps] = useState(false);
  const [nearbyStations, setNearbyStations] = useState([]);
  const [gpsStatusText, setGpsStatusText] = useState('');

  // فلتر سريع بالمنطقة لتسهيل الاختيار
  const [originAreaFilter, setOriginAreaFilter] = useState('');
  const [destAreaFilter, setDestAreaFilter] = useState('');

  const nodes = useMemo(
    () => stations.filter(s => isAdmin || s.status !== 'pending').sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar')),
    [stations, isAdmin]
  );
  const byId = useMemo(() => Object.fromEntries(nodes.map(n => [n.id, n])), [nodes]);
  const approvedCount = useMemo(() => approvedLinks(links, byId).length, [links, byId]);

  // دمج الروابط المرسومة على خريطة الأدمن + استنتاج روابط ذكية من خطوط المواقف (routes) لو مش مرسومة كـ Link
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

  // حساب أفضل مسار عبر شبكة الخريطة (Dijkstra)
  const result = useMemo(
    () => (fromId && toId ? findBestPath(combinedLinks, byId, fromId, toId, criterion) : null),
    [combinedLinks, byId, fromId, toId, criterion]
  );

  // البحث الاحتياطي في الخطوط الداخلية لو المستخدم اختار موقفين والوجهة مذكورة نصياً داخل خط السير
  const directRouteFallback = useMemo(() => {
    if (result || !fromId || !toId || fromId === toId) return null;
    const fromSt = byId[fromId];
    const toSt = byId[toId];
    if (!fromSt || !toSt) return null;

    const toNameNorm = normalizeArabic(toSt.name);
    const toLocNorm = normalizeArabic(toSt.location);

    const matchedRoutes = (fromSt.routes || []).filter(r => {
      if (!isAdmin && r.status === 'pending') return false;
      const rDest = normalizeArabic(r.destination);
      const rDet = normalizeArabic(r.destinationDetails);
      return (
        rDest.includes(toLocNorm) ||
        toLocNorm.includes(rDest) ||
        (rDet && (rDet.includes(toNameNorm) || toNameNorm.includes(rDet) || rDet.includes(toLocNorm)))
      );
    });

    return matchedRoutes.length > 0 ? { fromSt, toSt, routes: matchedRoutes } : null;
  }, [result, fromId, toId, byId, isAdmin]);

  // تحديد أقرب موقف للمستخدم بالـ GPS التلقائي
  const handleDetectMyNearestStation = () => {
    if (!navigator.geolocation) {
      if (triggerToast) triggerToast('متصفحك لا يدعم تحديد الموقع الجغرافي');
      return;
    }
    if (nodes.length === 0) {
      if (triggerToast) triggerToast('لا توجد مواقف مسجلة في قاعدة البيانات حالياً');
      return;
    }

    setIsLocatingGps(true);
    setGpsStatusText('جاري تحديد موقعك وأقرب موقف إليك...');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const ranked = nodes
          .map((st, idx) => {
            const c = coordsOf(st) || getPlaceCoords(st, idx + 1);
            const distKm = getDistanceKm(latitude, longitude, c[0], c[1]);
            return { station: st, distKm };
          })
          .filter(x => Number.isFinite(x.distKm))
          .sort((a, b) => a.distKm - b.distKm);

        setIsLocatingGps(false);

        if (ranked.length > 0) {
          const best = ranked[0];
          setFromId(best.station.id);
          setOriginAreaFilter('');
          setNearbyStations(ranked.slice(0, 3));
          const distText = best.distKm < 1 ? `${Math.round(best.distKm * 1000)} متر` : `${best.distKm.toFixed(1)} كم`;
          setGpsStatusText(`تم تحديد أقرب نقطة لموقعك: ${best.station.name} (على بُعد ${distText})`);
          if (triggerToast) triggerToast(`أقرب موقف ليك: ${best.station.name} 📍`);
        } else {
          setGpsStatusText('تعذر حساب المسافة للمواقف الحالية.');
        }
      },
      (err) => {
        setIsLocatingGps(false);
        setGpsStatusText('');
        if (triggerToast) {
          triggerToast(err.code === 1 ? 'يرجى السماح بصلاحية الموقع (Location) من المتصفح 📍' : 'تعذر تحديد موقعك الحالي');
        }
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const filteredOriginNodes = useMemo(() => {
    if (!originAreaFilter) return nodes;
    return nodes.filter(n => n.location === originAreaFilter || n.governorate === originAreaFilter);
  }, [nodes, originAreaFilter]);

  const filteredDestNodes = useMemo(() => {
    if (!destAreaFilter) return nodes;
    return nodes.filter(n => n.location === destAreaFilter || n.governorate === destAreaFilter);
  }, [nodes, destAreaFilter]);

  const allAreasList = useMemo(() => {
    const set = new Set();
    nodes.forEach(n => {
      if (n.location) set.add(n.location);
      if (n.governorate) set.add(n.governorate);
    });
    return Array.from(set);
  }, [nodes]);

  const canSuggest = Boolean(user) && !isGuest;
  const card = isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200';
  const bgInput = isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-900';
  const textPrimary = isDarkMode ? 'text-white' : 'text-slate-900';
  const textSecondary = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const inputCls = `w-full h-11 px-3 rounded-xl border text-xs sm:text-sm font-bold outline-none focus:border-indigo-500 ${bgInput}`;

  const openStation = (id) => { if (byId[id] && onSelectStation) onSelectStation(byId[id]); };

  return (
    <div className={`col-span-1 md:col-span-2 lg:col-span-3 rounded-2xl border shadow-sm overflow-hidden ${card}`}>
      {/* الهيدر الرئيسي للأداة */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full min-h-12 px-4 py-3 flex items-center justify-between gap-2 bg-indigo-600 text-white"
      >
        <span className="flex items-center gap-2 text-sm sm:text-base font-black">
          <Compass size={20} className="shrink-0" />
          <span>أنت فين وعايز تروح فين؟ (دليل المسارات والتحويلات)</span>
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {approvedCount > 0 && (
            <span className="text-xs font-black bg-emerald-600 text-white px-2.5 py-0.5 rounded-full">
              {approvedCount} رابط نشط
            </span>
          )}
          <ChevronDown size={18} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {open && (
        <div className="p-3.5 sm:p-4 space-y-3.5">
          {/* زر تحديد الموقع التلقائي بالـ GPS */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleDetectMyNearestStation}
              disabled={isLocatingGps}
              className="h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs sm:text-sm font-black flex items-center justify-center gap-2 shadow-sm active:scale-[0.98] transition-transform"
            >
              {isLocatingGps ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>جاري تحديد مكانك بالـ GPS...</span>
                </>
              ) : (
                <>
                  <MapPin size={16} />
                  <span>📍 حدد مكاني تلقائياً (أقرب موقف ليا)</span>
                </>
              )}
            </button>

            {gpsStatusText && (
              <p className="text-xs font-black text-emerald-600 dark:text-emerald-400 px-1">
                ✅ {gpsStatusText}
              </p>
            )}
          </div>

          {/* عرض أقرب 3 مواقف مقترحة بعد تشغيل الـ GPS */}
          {nearbyStations.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-xs font-bold ${textSecondary}`}>أقرب النقاط لموقعك:</span>
              {nearbyStations.map(({ station, distKm }) => (
                <button
                  key={station.id}
                  type="button"
                  onClick={() => setFromId(station.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-black border transition-colors ${
                    fromId === station.id
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : `${bgInput}`
                  }`}
                >
                  {station.name} ({distKm < 1 ? `${Math.round(distKm * 1000)}م` : `${distKm.toFixed(1)}كم`})
                </button>
              ))}
            </div>
          )}

          {/* اختيار نقطة الانطلاق والوصول */}
          <div className="flex items-center gap-2">
            <div className="flex-1 space-y-2.5">
              {/* 1. أنت فين / هتركب منين */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <select
                  value={originAreaFilter}
                  onChange={e => { setOriginAreaFilter(e.target.value); setFromId(''); }}
                  className={inputCls}
                  aria-label="فلتر منطقة الركوب"
                >
                  <option value="">📍 كل مناطق الانطلاق ({nodes.length})</option>
                  {allAreasList.map(a => <option key={`orig_${a}`} value={a}>{a}</option>)}
                </select>

                <select
                  value={fromId}
                  onChange={e => setFromId(e.target.value)}
                  className={`${inputCls} sm:col-span-2`}
                  aria-label="عايز تركب منين"
                >
                  <option value="">🚏 أنت فين / عايز تركب منين؟ (اختر الموقف أو النقطة)...</option>
                  {filteredOriginNodes.map(n => (
                    <option key={n.id} value={n.id}>
                      {n.name} ({n.location})
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. عايز تروح فين */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <select
                  value={destAreaFilter}
                  onChange={e => { setDestAreaFilter(e.target.value); setToId(''); }}
                  className={inputCls}
                  aria-label="فلتر منطقة الوصول"
                >
                  <option value="">🏁 كل مناطق الوصول</option>
                  {allAreasList.map(a => <option key={`dest_${a}`} value={a}>{a}</option>)}
                </select>

                <select
                  value={toId}
                  onChange={e => setToId(e.target.value)}
                  className={`${inputCls} sm:col-span-2`}
                  aria-label="عايز تروح فين"
                >
                  <option value="">🎯 عايز تروح فين؟ (اختر موقف أو نقطة الوصول)...</option>
                  {filteredDestNodes.filter(n => n.id !== fromId).map(n => (
                    <option key={n.id} value={n.id}>
                      {n.name} ({n.location})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              type="button"
              aria-label="عكس الاتجاه"
              onClick={() => {
                const tempId = fromId;
                const tempArea = originAreaFilter;
                setFromId(toId);
                setOriginAreaFilter(destAreaFilter);
                setToId(tempId);
                setDestAreaFilter(tempArea);
              }}
              className={`w-11 h-11 shrink-0 rounded-xl border flex items-center justify-center active:scale-95 transition-transform ${bgInput}`}
            >
              <ArrowLeftRight size={17} className="rotate-90 text-indigo-500" />
            </button>
          </div>

          {/* معيار الأفضلية: الأسرع أم الأرخص */}
          <div className="grid grid-cols-2 gap-2">
            {[['fast', 'الأسرع في الوقت ⏱'], ['cheap', 'الأوفر في الأجرة 💰']].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setCriterion(id)}
                className={`min-h-11 rounded-xl text-xs font-black border transition-colors ${
                  criterion === id ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : bgInput
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* عرض النتيجة من شبكة روابط الخريطة (GIS Graph) */}
          {result && (
            <div className="space-y-2.5 pt-1 animate-fade-in-up">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  [`${result.totalMinutes} د`, 'الوقت التقريبي'],
                  [`${result.totalFare} ج`, 'إجمالي الأجرة'],
                  [result.transfers === 0 ? 'مباشر' : `${result.transfers} تبديل`, 'التحويلات']
                ].map(([v, l]) => (
                  <div key={l} className={`p-2.5 rounded-xl border ${card}`}>
                    <p className="text-base font-black text-emerald-600 dark:text-emerald-400">{v}</p>
                    <p className={`text-xs font-bold ${textSecondary}`}>{l}</p>
                  </div>
                ))}
              </div>

              <ol className="space-y-2">
                {result.legs.map((leg, i) => {
                  const k = kindOf(leg.link.kind);
                  const fromNode = byId[leg.fromId];
                  const toNode = byId[leg.toId];
                  return (
                    <li key={i} className={`p-3 rounded-xl border space-y-1.5 ${card}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-xs sm:text-sm font-black ${textPrimary}`}>
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-600 text-white text-xs me-1.5">
                            {i + 1}
                          </span>
                          <button type="button" onClick={() => openStation(leg.fromId)} className="underline-offset-2 hover:underline text-indigo-600 dark:text-indigo-400">
                            {fromNode?.name}
                          </button>
                          {' ⬅️ '}
                          <button type="button" onClick={() => openStation(leg.toId)} className="underline-offset-2 hover:underline">
                            {toNode?.name}
                          </button>
                        </span>
                        <span className={`text-xs font-black px-2 py-0.5 rounded-lg border shrink-0 ${k.badgeClass}`}>{k.short}</span>
                      </div>

                      <p className={`text-xs font-bold ${textSecondary}`}>
                        ⏱ {leg.minutes} دقيقة
                        {leg.fare ? ` • 💰 الأجرة: ${leg.fare} ج` : ' • مجاناً (مشي)'}
                        {leg.link.note ? ` • 📍 ${leg.link.note}` : ''}
                      </p>

                      {toNode?.transferHint && i < result.legs.length - 1 && (
                        <p className="text-xs font-bold text-amber-700 dark:text-amber-400 bg-amber-500/10 px-2.5 py-1.5 rounded-lg border border-amber-500/20">
                          🔄 إرشاد التبديل في {toNode.name}: {toNode.transferHint}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {/* عرض النتيجة الاحتياطية من خطوط الموقف الداخلية إن وجدت */}
          {!result && directRouteFallback && (
            <div className="space-y-2 pt-1 animate-fade-in-up">
              <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 space-y-2">
                <p className="text-xs font-black text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                  <BusFront size={15} /> خطوط متاحة من ({directRouteFallback.fromSt.name}) تذهب باتجاه ({directRouteFallback.toSt.location}):
                </p>
                {directRouteFallback.routes.map((r, idx) => (
                  <div key={idx} className={`p-2.5 rounded-xl border flex items-center justify-between ${card}`}>
                    <div>
                      <p className={`text-xs font-black ${textPrimary}`}>
                        خط: {r.destinationDetails || r.destination}
                      </p>
                      {r.boardingHint && (
                        <p className={`text-xs font-bold ${textSecondary}`}>📍 تركب من: {r.boardingHint}</p>
                      )}
                    </div>
                    <span className="text-sm font-black text-emerald-600 bg-emerald-500/10 px-2.5 py-1 rounded-lg">
                      {r.fare} ج
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {fromId && toId && fromId !== toId && !result && !directRouteFallback && (
            <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs font-bold text-amber-700 dark:text-amber-400 leading-relaxed">
              مفيش مسار مربوط بين الموقفين دول لسه. {isAdmin ? 'افتح (خريطة GIS) من لوحة الأدمن واضغط (داتا أكتوبر وزايد) أو اربط النقطتين ببعض.' : canSuggest ? 'لو عارف الطريق اقترحه وهنراجعه.' : 'سجّل دخول بحساب عادي علشان تقدر تقترح رابط.'}
            </div>
          )}

          {canSuggest && (
            <button
              type="button"
              onClick={() => setShowSuggest(true)}
              className="w-full min-h-11 rounded-xl text-xs font-black border border-indigo-500/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center gap-1.5 hover:bg-indigo-500/10 transition-colors"
            >
              <Link2 size={14} /> اقترح رابط تبادل بين موقفين
            </button>
          )}
        </div>
      )}

      {showSuggest && (
        <SuggestLinkModal
          user={user}
          stations={stations}
          links={links}
          initialFromId={fromId}
          initialToId={toId}
          isDarkMode={isDarkMode}
          triggerToast={triggerToast}
          onClose={() => setShowSuggest(false)}
        />
      )}
    </div>
  );
};

export default JourneyPlanner;