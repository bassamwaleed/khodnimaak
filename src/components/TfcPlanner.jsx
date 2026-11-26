import React, { useState, useMemo } from 'react';
import { 
  Route, ArrowLeftRight, Search, X, Loader2, BusFront, MapPin, 
  Navigation, SlidersHorizontal, Plus 
} from 'lucide-react';
import { useTfc } from '../utils/tfcStore';
import { planTrips, searchStations, nearestStation, stationLabel } from '../utils/tfc';

const Picker = ({ net, placeholder, value, onChange, onTextChange, onGps, locating, isDarkMode }) => {
  const [q, setQ] = useState('');
  const res = useMemo(() => (net && q.trim().length >= 2 ? searchStations(net, q, 10) : []), [net, q]);
  const st = value && net ? net.stations.get(value) : null;

  const inputCls = isDarkMode 
    ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-400 focus-within:border-indigo-500' 
    : 'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus-within:border-indigo-500';

  if (st) {
    return (
      <div className={`flex items-center gap-1.5 h-10 px-2.5 rounded-xl border text-xs font-black flex-1 min-w-0 ${inputCls}`}>
        <MapPin size={14} className="text-indigo-500 shrink-0" />
        <span className="flex-1 truncate">{stationLabel(st)}</span>
        <button
          type="button"
          aria-label="مسح"
          onClick={() => {
            onChange('');
            setQ('');
            if (onTextChange) onTextChange('');
          }}
          className="p-0.5 hover:text-rose-500 shrink-0"
        >
          <X size={14} className="text-slate-400" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-w-0">
      <div className={`flex items-center gap-1.5 h-10 px-2.5 rounded-xl border transition-colors ${inputCls}`}>
        <Search size={14} className="text-slate-400 shrink-0" />
        <input
          value={q}
          onChange={e => {
            const val = e.target.value;
            setQ(val);
            if (onTextChange) onTextChange(val);
          }}
          placeholder={placeholder}
          className="w-full bg-transparent outline-none text-xs font-bold min-w-0"
        />
        {q && (
          <button
            type="button"
            onClick={() => {
              setQ('');
              if (onTextChange) onTextChange('');
            }}
            className="text-slate-400 hover:text-rose-500 shrink-0"
          >
            <X size={13} />
          </button>
        )}
        {onGps && !q && (
          <button
            type="button"
            onClick={onGps}
            disabled={locating}
            title="تحديد أقرب محطة لموقعي"
            className="text-[11px] font-black text-indigo-600 dark:text-indigo-400 flex items-center gap-0.5 shrink-0 bg-indigo-500/10 px-1.5 py-1 rounded-lg hover:bg-indigo-500/20"
          >
            {locating ? <Loader2 size={12} className="animate-spin" /> : <Navigation size={11} />}
            <span className="hidden sm:inline">موقعي</span>
          </button>
        )}
      </div>

      {res.length > 0 && (
        <div className="absolute z-40 inset-x-0 mt-1 rounded-xl border shadow-xl max-h-60 overflow-y-auto bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
          {res.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onChange(s.id);
                setQ('');
                if (onTextChange) onTextChange(stationLabel(s));
              }}
              className="w-full text-start px-3 py-2 text-xs font-bold hover:bg-indigo-50 dark:hover:bg-slate-800 border-b last:border-0 border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2"
            >
              <span className="truncate">{stationLabel(s)}</span>
              {s.custom && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 shrink-0">موقف مسجل</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const fareText = (o) => (o.unknownFareLegs === 0 ? `${o.totalFare} ج`
  : o.totalFare > 0 ? `${o.totalFare}+ ج (${o.unknownFareLegs} ركوبة غير مسعرة)` : 'السعر غير محدد');

const TfcPlanner = ({
  stations = [],
  links = [],
  isDarkMode,
  isGuest,
  triggerToast,
  onSearchChange,
  showFilters,
  setShowFilters,
  hasActiveFilters,
  onOpenAddStation
}) => {
  const { net, error } = useTfc(stations, links);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openIdx, setOpenIdx] = useState(0);
  const [locating, setLocating] = useState(false);

  const options = useMemo(() => (net && from && to ? planTrips(net, from, to) : null), [net, from, to]);
  const name = (id) => (net ? stationLabel(net.stations.get(id)) : '');

  const gps = () => {
    if (!navigator.geolocation) return triggerToast && triggerToast('الموقع مش مدعوم في المتصفح');
    if (!net) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const n = nearestStation(net, p.coords.latitude, p.coords.longitude);
        if (n) {
          setFrom(n.station.id);
          if (onSearchChange) onSearchChange(stationLabel(n.station));
          triggerToast && triggerToast(`أقرب محطة: ${stationLabel(n.station)} (${n.meters} م)`);
        }
        setLocating(false);
      },
      () => {
        triggerToast && triggerToast('تعذر تحديد موقعك');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <div dir="rtl" className={`col-span-1 md:col-span-2 lg:col-span-3 rounded-2xl border shadow-sm p-2.5 space-y-2.5 ${isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'}`}>
      
      {/* صف البحث الموحد: من ⇄ إلى + الفلاتر + إضافة موقف */}
      <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
        <Picker
          net={net}
          placeholder="من: محطة أو موقف..."
          value={from}
          onChange={setFrom}
          onTextChange={onSearchChange}
          onGps={gps}
          locating={locating}
          isDarkMode={isDarkMode}
        />

        <button
          type="button"
          aria-label="عكس الاتجاه"
          onClick={() => { setFrom(to); setTo(from); }}
          className={`w-9 h-10 rounded-xl border flex items-center justify-center shrink-0 active:scale-95 transition-transform ${isDarkMode ? 'bg-slate-800 border-slate-700 text-indigo-400' : 'bg-slate-50 border-slate-200 text-indigo-600'}`}
        >
          <ArrowLeftRight size={15} />
        </button>

        <Picker
          net={net}
          placeholder="إلى: وجهتك أو رقم الخط..."
          value={to}
          onChange={setTo}
          onTextChange={onSearchChange}
          isDarkMode={isDarkMode}
        />

        {setShowFilters && (
          <button
            type="button"
            onClick={() => setShowFilters(v => !v)}
            aria-label="فلاتر المواقف"
            className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 transition-colors ${
              showFilters || hasActiveFilters
                ? 'bg-indigo-600 text-white border-indigo-600'
                : (isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-600')
            }`}
          >
            <SlidersHorizontal size={15} />
          </button>
        )}

        {!isGuest && onOpenAddStation && (
          <button
            type="button"
            onClick={onOpenAddStation}
            title="إضافة موقف جديد"
            className="h-10 px-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black flex items-center gap-1 shrink-0 shadow-sm active:scale-95 transition-transform"
          >
            <Plus size={15} />
            <span className="hidden md:inline">موقف</span>
          </button>
        )}
      </div>

      {error && <div className="text-xs font-bold text-rose-600">{error}</div>}
      {!net && !error && (
        <div className="flex items-center gap-2 text-xs font-bold opacity-70 px-1">
          <Loader2 size={14} className="animate-spin text-indigo-500" /> جاري تجهيز شبكة المواقف والخطوط...
        </div>
      )}

      {/* نتائج تخطيط المسار المدمجة (TfC + مواقف Firestore) */}
      {net && options && !options.length && (
        <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs font-bold text-amber-600 dark:text-amber-400">
          لا يوجد مسار مباشر أو بالتبديل بين المحطتين حالياً. جرّب اختيار أقرب محطة رئيسية أو ابحث في المواقف بالأسفل.
        </div>
      )}

      {net && options && options.length > 0 && (
        <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-black text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
              <Route size={14} /> أفضل المسارات المقترحة ({options.length})
            </span>
            <button
              type="button"
              onClick={() => { setFrom(''); setTo(''); if (onSearchChange) onSearchChange(''); }}
              className="text-xs font-bold text-rose-500 hover:underline"
            >
              إغلاق المسارات
            </button>
          </div>

          {options.map((o, i) => (
            <div key={i} className={`rounded-xl border overflow-hidden ${isDarkMode ? 'border-slate-700 bg-slate-800/40' : 'border-slate-200 bg-slate-50/50'}`}>
              <button type="button" onClick={() => setOpenIdx(openIdx === i ? -1 : i)} className="w-full text-start p-2.5">
                <div className="flex items-center gap-1.5 flex-wrap text-xs font-black">
                  <span>⏱ {o.estimated ? '~' : ''}{o.totalMinutes} د</span>
                  <span>•</span>
                  <span className="text-emerald-600 dark:text-emerald-400">💰 {fareText(o)}</span>
                  <span>•</span>
                  <span>{o.transfers === 0 ? 'مباشر بدون تبديل' : `${o.transfers} تبديل`}</span>
                  {o.fastest && <span className="px-1.5 py-0.5 rounded-full bg-indigo-600/15 text-indigo-600 dark:text-indigo-400">أسرع</span>}
                  {o.fewest && <span className="px-1.5 py-0.5 rounded-full bg-sky-600/15 text-sky-600 dark:text-sky-400">أقل تبديلات</span>}
                  {o.cheapest && <span className="px-1.5 py-0.5 rounded-full bg-emerald-600/15 text-emerald-600 dark:text-emerald-400">أرخص</span>}
                </div>
              </button>

              {openIdx === i && (
                <div className="px-2.5 pb-2.5 space-y-2 border-t border-slate-200/70 dark:border-slate-700/70 pt-2">
                  {o.legs.map((l, j) => l.type === 'walk' ? (
                    <div key={j} className="text-xs font-bold text-slate-600 dark:text-slate-300">
                      🚶 امشي ~{l.meters} م ({l.minutes} د) من <strong>{name(l.fromId)}</strong> إلى <strong>{name(l.toId)}</strong>
                    </div>
                  ) : (
                    <div key={j} className="text-xs font-bold leading-6">
                      <div className="flex items-center gap-1">
                        <BusFront size={13} className="inline text-indigo-600 shrink-0" />
                        <span>{l.name}{l.custom ? ' ⭐' : ''}: من <strong>{name(l.boardId)}</strong> إلى <strong>{name(l.alightId)}</strong></span>
                      </div>
                      <div className="opacity-75 font-medium pr-4">
                        {l.hops} محطة • {l.minutesEstimated ? '~' : ''}{Math.round(l.minutes)} د • {l.fare === null ? 'السعر غير محدد' : `${l.fare} ج`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TfcPlanner;