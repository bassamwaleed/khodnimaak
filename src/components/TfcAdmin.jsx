import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, X, Plus, Trash2, Check, Loader2, Download, Link2, MapPin } from 'lucide-react';
import { useTfc } from '../utils/tfcStore';
import { stationLabel, searchStations, norm, localizeRouteLabel, generateSuggestedLinks } from '../utils/tfc';

const useLeaflet = () => {
  const [ready, setReady] = useState(typeof window !== 'undefined' && Boolean(window.L));
  useEffect(() => {
    if (window.L) { setReady(true); return undefined; }
    if (!document.getElementById('leaflet-css-cdn')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css-cdn'; link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    let script = document.getElementById('leaflet-js-cdn');
    if (!script) {
      script = document.createElement('script');
      script.id = 'leaflet-js-cdn'; script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; script.async = true;
      document.body.appendChild(script);
    }
    const onLoad = () => setReady(true);
    script.addEventListener('load', onLoad);
    const poll = setInterval(() => { if (window.L) { setReady(true); clearInterval(poll); } }, 300);
    return () => { script.removeEventListener('load', onLoad); clearInterval(poll); };
  }, []);
  return ready;
};

const TYPES = ['ميكروباص', 'ميني باص', 'أتوبيس نقل عام', 'مترو الأنفاق', 'مواصلات مصر', 'تمناية / داخلي', 'قطار'];
const emptyDraft = { id: null, name: '', type: 'ميكروباص', fare: '', totalMinutes: '', twoWay: true, stops: [] };
const inp = 'w-full min-h-11 px-3 rounded-xl border text-xs font-bold outline-none bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white';
const btn = 'min-h-11 px-3 rounded-xl text-xs font-black border border-slate-200 dark:border-slate-700 disabled:opacity-40';
const card = 'rounded-2xl border p-3 space-y-2 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100';

const download = (name, content) => {
  const str = typeof content === 'string' ? content : JSON.stringify(content, null, 1);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([str], { type: 'application/json' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

const TfcAdmin = ({ triggerToast }) => {
  const { net, raw, ov, error, save, exportMergedJson } = useTfc();
  const ready = useLeaflet();
  const [q, setQ] = useState('');
  const [onlyNoFare, setOnlyNoFare] = useState(false);
  const [shown, setShown] = useState(30);
  const [selRoute, setSelRoute] = useState('');
  const [selStation, setSelStation] = useState('');
  const [draft, setDraft] = useState(null);
  const [newPoint, setNewPoint] = useState(false);
  const [addQ, setAddQ] = useState('');

  // مدخلات تعديل الخط
  const [routeNameIn, setRouteNameIn] = useState('');
  const [fareIn, setFareIn] = useState('');
  const [minIn, setMinIn] = useState('');

  // مدخلات تعديل المحطة والإحداثيات
  const [arIn, setArIn] = useState('');
  const [latIn, setLatIn] = useState('');
  const [lngIn, setLngIn] = useState('');

  const [waitIn, setWaitIn] = useState('');
  const [suggestedLinks, setSuggestedLinks] = useState([]);
  const [busy, setBusy] = useState(false);

  const mapEl = useRef(null), mapRef = useRef(null), stLayer = useRef(null), rtLayer = useRef(null), dfLayer = useRef(null);
  const stClick = useRef(null), mapClick = useRef(null), fitted = useRef('');

  const label = (id) => (net && net.stations.get(id) ? stationLabel(net.stations.get(id)) : '؟');

  const commit = async (patch, okMsg) => {
    setBusy(true);
    try {
      await save({ ...ov, ...patch });
      if (okMsg) triggerToast(okMsg);
      return true;
    } catch (e) {
      console.error(e);
      triggerToast(e.message || 'تعذر الحفظ — تأكد من نشر قواعد Firestore وتسجيل الدخول بحساب الأدمن');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const routeList = useMemo(() => {
    if (!raw || !net) return [];
    const map = new Map();
    raw.routes.forEach(r => {
      const e = map.get(r.r) || map.set(r.r, { routeId: r.r, rawName: r.n, type: r.t, custom: false, dirs: [] }).get(r.r);
      e.dirs.push(r);
    });
    const dis = new Set(ov.disabled || []);
    const list = [...map.values()].map(e => {
      const f = e.dirs[0];
      const customAr = ov.routeNames?.[e.routeId];
      const loc = localizeRouteLabel(customAr || e.rawName, e.type);
      return {
        routeId: e.routeId,
        name: loc.name,
        type: loc.typeAr,
        custom: false,
        from: f.s[0],
        to: f.s[f.s.length - 1],
        stopsCount: f.s.length,
        tmpl: Array.isArray(f.m) ? Math.round(f.m.reduce((a, b) => a + b, 0)) : null,
        fare: ov.fares?.[e.routeId],
        minutes: ov.minutes?.[e.routeId],
        disabled: dis.has(e.routeId)
      };
    });
    (ov.customRoutes || []).forEach(c => {
      const loc = localizeRouteLabel(ov.routeNames?.[c.id] || c.name, c.type);
      list.push({
        routeId: c.id,
        name: loc.name,
        type: loc.typeAr,
        custom: true,
        c,
        from: c.stops[0],
        to: c.stops[c.stops.length - 1],
        stopsCount: c.stops.length,
        tmpl: null,
        fare: c.fare,
        minutes: c.totalMinutes,
        disabled: dis.has(c.id)
      });
    });
    list.forEach(x => { x.key = norm(`${x.name} ${x.type} ${x.routeId} ${label(x.from)} ${label(x.to)}`); });
    return list.sort((a, b) => (b.custom - a.custom) || String(a.name).localeCompare(String(b.name), 'ar') || a.key.localeCompare(b.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, net, ov]);

  const filtered = useMemo(() => {
    const k = norm(q);
    return routeList.filter(x => (!k || x.key.includes(k)) && (!onlyNoFare || x.fare === undefined || x.fare === null));
  }, [routeList, q, onlyNoFare]);

  const withFare = routeList.filter(x => x.fare !== undefined && x.fare !== null && x.fare !== '').length;
  const sel = routeList.find(x => x.routeId === selRoute);

  useEffect(() => {
    setRouteNameIn(sel ? sel.name : '');
    setFareIn(sel && sel.fare != null ? String(sel.fare) : '');
    setMinIn(sel && sel.minutes != null ? String(sel.minutes) : '');
  }, [selRoute, ov]); // eslint-disable-line

  useEffect(() => {
    const st = selStation && net ? net.stations.get(selStation) : null;
    setArIn(st ? stationLabel(st) : '');
    setLatIn(st ? String(st.lat) : '');
    setLngIn(st ? String(st.lng) : '');
  }, [selStation, ov, net]);

  useEffect(() => { setWaitIn(ov.waitMin != null ? String(ov.waitMin) : ''); }, [ov]);

  const routeStops = (id) => {
    const c = (ov.customRoutes || []).find(x => x.id === id);
    return c ? [c.stops] : (raw?.routes || []).filter(r => r.r === id).map(r => r.s);
  };

  // ───── الخريطة ─────
  useEffect(() => {
    if (!ready || !mapEl.current || mapRef.current) return undefined;
    const L = window.L;
    const map = L.map(mapEl.current, { preferCanvas: true, zoomControl: true }).setView([30.01, 31.05], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map);
    stLayer.current = L.layerGroup().addTo(map); rtLayer.current = L.layerGroup().addTo(map); dfLayer.current = L.layerGroup().addTo(map);
    map.on('click', (e) => mapClick.current && mapClick.current(e.latlng));
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [ready]);

  useEffect(() => {
    if (!mapRef.current || !net) return;
    const L = window.L; stLayer.current.clearLayers();
    const ids = new Set([...net.routesAt.keys()]); net.stations.forEach(s => { if (s.custom) ids.add(s.id); });
    ids.forEach(id => {
      const s = net.stations.get(id);
      if (!s) return;
      L.circleMarker([s.lat, s.lng], { radius: s.custom ? 6 : 3.5, weight: 1, color: s.custom ? '#d97706' : '#4f46e5', fillOpacity: 0.6 })
        .on('click', (e) => { L.DomEvent.stopPropagation(e); stClick.current(id); }).addTo(stLayer.current);
    });
  }, [net, ready]);

  useEffect(() => {
    if (!mapRef.current || !net) return;
    const L = window.L; rtLayer.current.clearLayers();
    if (!selRoute) return;
    const groups = routeStops(selRoute); const all = [];
    groups.forEach((ids, i) => {
      const pts = ids.map(id => net.stations.get(id)).filter(Boolean).map(s => [s.lat, s.lng]);
      if (pts.length < 2) return; all.push(...pts);
      L.polyline(pts, { color: i ? '#e11d48' : '#059669', weight: 4, opacity: 0.85 }).addTo(rtLayer.current);
      L.circleMarker(pts[0], { radius: 7, color: '#fff', weight: 2, fillColor: '#059669', fillOpacity: 1 }).addTo(rtLayer.current);
      L.circleMarker(pts[pts.length - 1], { radius: 7, color: '#fff', weight: 2, fillColor: '#e11d48', fillOpacity: 1 }).addTo(rtLayer.current);
    });
    if (all.length && fitted.current !== selRoute) { mapRef.current.fitBounds(all, { padding: [30, 30] }); fitted.current = selRoute; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selRoute, net, ov, ready]);

  useEffect(() => {
    if (!mapRef.current || !net) return;
    const L = window.L; dfLayer.current.clearLayers();
    if (!draft) return;
    const pts = draft.stops.map(id => net.stations.get(id)).filter(Boolean);
    if (pts.length > 1) L.polyline(pts.map(s => [s.lat, s.lng]), { color: '#f59e0b', weight: 4, dashArray: '8 6' }).addTo(dfLayer.current);
    pts.forEach((s, i) => L.marker([s.lat, s.lng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:#f59e0b;color:#fff;border-radius:999px;width:20px;height:20px;display:grid;place-items:center;font:700 11px sans-serif">${i + 1}</div>`,
        iconSize: [20, 20]
      })
    }).addTo(dfLayer.current));
  }, [draft, net, ready]);

  // ───── أفعال ─────
  const addStop = (id) => setDraft(d => (d && d.stops[d.stops.length - 1] !== id ? { ...d, stops: [...d.stops, id] } : d));
  stClick.current = (id) => { if (draft) addStop(id); else { setSelStation(id); } };
  mapClick.current = async (ll) => {
    if (!newPoint) return;
    const name = window.prompt('اسم النقطة الجديدة بالعربي');
    if (!name || !name.trim()) return;
    const id = `c_s_${Date.now().toString(36)}`;
    if (await commit({ customStations: [...(ov.customStations || []), { id, name: name.trim(), ar: name.trim(), lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6) }] }, 'اتضافت النقطة ✅')) {
      setNewPoint(false); addStop(id);
    }
  };

  const saveRouteEdit = async () => {
    if (!sel) return;
    const fare = fareIn === '' ? null : Number(fareIn);
    const mins = minIn === '' ? null : Number(minIn);
    const cleanName = routeNameIn.trim();
    if (fare !== null && !(fare >= 0 && fare <= 1000)) return triggerToast('الأجرة لازم رقم من 0 لـ 1000');
    if (mins !== null && !(mins > 0 && mins <= 600)) return triggerToast('الوقت لازم رقم بالدقايق (أكبر من صفر)');

    const routeNames = { ...(ov.routeNames || {}) };
    if (cleanName) routeNames[sel.routeId] = cleanName; else delete routeNames[sel.routeId];

    if (sel.custom) {
      const list = (ov.customRoutes || []).map(c => (c.id === sel.routeId ? { ...c, name: cleanName || c.name, fare, totalMinutes: mins } : c));
      return commit({ customRoutes: list, routeNames }, 'اتحفظ تعديل الخط ✅');
    }
    const fares = { ...(ov.fares || {}) }, minutes = { ...(ov.minutes || {}) };
    if (fare === null) delete fares[sel.routeId]; else fares[sel.routeId] = fare;
    if (mins === null) delete minutes[sel.routeId]; else minutes[sel.routeId] = mins;
    return commit({ fares, minutes, routeNames }, 'اتحفظ تعديل الخط ✅');
  };

  const toggleDisabled = () => {
    const dis = new Set(ov.disabled || []); dis.has(sel.routeId) ? dis.delete(sel.routeId) : dis.add(sel.routeId);
    return commit({ disabled: [...dis] }, dis.has(sel.routeId) ? 'الخط اتخفى من التخطيط' : 'الخط رجع ✅');
  };

  const deleteCustom = async () => {
    if (!sel?.custom || !window.confirm(`حذف الخط (${sel.name}) نهائياً؟`)) return;
    if (await commit({ customRoutes: (ov.customRoutes || []).filter(c => c.id !== sel.routeId) }, 'اتحذف ✅')) setSelRoute('');
  };

  const saveDraft = async () => {
    const stops = draft.stops.filter(id => net.stations.has(id));
    const fare = draft.fare === '' ? null : Number(draft.fare);
    const mins = draft.totalMinutes === '' ? null : Number(draft.totalMinutes);
    if (!draft.name.trim()) return triggerToast('اكتب اسم الخط');
    if (stops.length < 2) return triggerToast('الخط محتاج نقطتين على الأقل');
    if (fare !== null && !(fare >= 0 && fare <= 1000)) return triggerToast('الأجرة غير صالحة');
    if (mins !== null && !(mins > 0 && mins <= 600)) return triggerToast('الوقت غير صالح');
    const entry = { id: draft.id || `c_r_${Date.now().toString(36)}`, name: draft.name.trim(), type: draft.type, fare, totalMinutes: mins, twoWay: !!draft.twoWay, stops };
    const old = ov.customRoutes || [];
    const list = old.some(c => c.id === entry.id) ? old.map(c => (c.id === entry.id ? entry : c)) : [...old, entry];
    if (await commit({ customRoutes: list }, 'اتحفظ الخط ✅')) { setDraft(null); setNewPoint(false); setSelRoute(entry.id); }
  };

  const saveStationEdit = async () => {
    if (!selStation) return;
    const names = { ...(ov.names || {}) };
    if (arIn.trim()) names[selStation] = arIn.trim(); else delete names[selStation];

    const coords = { ...(ov.coords || {}) };
    const la = Number(latIn), ln = Number(lngIn);
    if (Number.isFinite(la) && Number.isFinite(ln) && la !== 0 && ln !== 0) {
      coords[selStation] = { lat: +la.toFixed(6), lng: +ln.toFixed(6) };
    }
    return commit({ names, coords }, 'اتحفظت بيانات وإحداثيات المحطة ✅');
  };

  const approveSuggestedLink = async (link) => {
    const entry = {
      id: `c_r_${Date.now().toString(36)}`,
      name: `${link.kind === 'walk' ? 'مشي' : 'توصيلة'}: ${link.fromName} - ${link.toName}`,
      type: link.kind === 'walk' ? 'مشي' : 'تمناية / داخلي',
      fare: link.fare,
      totalMinutes: link.minutes,
      twoWay: true,
      stops: [link.fromId, link.toId]
    };
    const ok = await commit({ customRoutes: [...(ov.customRoutes || []), entry] }, 'تم اعتماد الرابط وإضافته للشبكة ✅');
    if (ok) setSuggestedLinks(prev => prev.filter(x => !(x.fromId === link.fromId && x.toId === link.toId)));
  };

  const saveWait = () => {
    const w = waitIn === '' ? null : Number(waitIn);
    if (w !== null && !(w >= 0 && w <= 60)) return triggerToast('الانتظار من 0 لـ 60 دقيقة');
    const next = { ...ov }; if (w === null) delete next.waitMin; else next.waitMin = w;
    return commit(next, 'اتحفظ ✅');
  };

  const importEdits = async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const o = JSON.parse(await f.text()); const keep = {};
      ['fares', 'minutes', 'names', 'routeNames', 'coords', 'aliases'].forEach(k => {
        if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) keep[k] = o[k];
      });
      ['disabled', 'customStations', 'customRoutes'].forEach(k => { if (Array.isArray(o[k])) keep[k] = o[k]; });
      if (Number.isFinite(Number(o.waitMin))) keep.waitMin = Number(o.waitMin);
      if (!Object.keys(keep).length) throw new Error('empty');
      if (!window.confirm('استبدال كل التعديلات الحالية بالتعديلات اللي في الملف؟')) return;
      await save(keep); triggerToast('اتستورد ✅');
    } catch (err) { triggerToast('الملف مش نسخة تعديلات صالحة'); }
  };

  const dRoutesCount = useMemo(() => {
    if (!draft || !net) return 0;
    const s = new Set(); draft.stops.forEach(id => (net.routesAt.get(id) || []).forEach(r => s.add(r))); return s.size;
  }, [draft, net]);

  const addRes = useMemo(() => (net && addQ.trim().length >= 2 ? searchStations(net, addQ, 8) : []), [net, addQ]);
  const selSt = selStation && net ? net.stations.get(selStation) : null;
  const stRoutes = useMemo(() => (selSt && net ? [...(net.routesAt.get(selSt.id) || [])].map(id => routeList.find(r => r.routeId === id)).filter(Boolean) : []), [selSt, net, routeList]);

  return (
    <div dir="rtl" className="space-y-3">
      {error && <div className="text-xs font-bold text-rose-600">{error}</div>}
      {!net && !error && <div className="flex items-center gap-2 text-xs font-bold opacity-70"><Loader2 size={14} className="animate-spin" /> جاري تحميل الشبكة...</div>}
      {net && (
        <>
          <div className="text-xs font-bold opacity-80 leading-6">
            {net.stations.size} محطة {net.mergedCount > 0 && <span className="text-emerald-600">(تم دمج {net.mergedCount} مكرر)</span>} • {routeList.length} خط ({net.patterns.length} اتجاه) • أجرة معرّفة لـ {withFare} خط
            {newPoint && <span className="text-amber-600"> • اضغط على الخريطة لتحديد مكان النقطة الجديدة</span>}
            {draft && <span className="text-amber-600"> • اضغط على نقاط الخريطة بالترتيب لإضافتها للخط</span>}
          </div>
          <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800">
            {ready ? <div ref={mapEl} style={{ height: 340 }} /> : <div className="h-40 grid place-items-center text-xs font-bold opacity-60">جاري تحميل الخريطة...</div>}
          </div>

          {selSt && !draft && (
            <div className={card}>
              <div className="flex items-center gap-2">
                <MapPin size={15} className="text-indigo-500" />
                <div className="text-sm font-black flex-1">{stationLabel(selSt)}</div>
                <button type="button" aria-label="إغلاق" onClick={() => setSelStation('')}><X size={15} /></button>
              </div>
              {selSt.name !== stationLabel(selSt) && <div className="text-[11px] opacity-60">الاسم الأصلي: {selSt.name}</div>}
              <input className={inp} placeholder="الاسم بالعربي" value={arIn} onChange={e => setArIn(e.target.value)} />
              <div className="grid grid-cols-2 gap-1.5">
                <input className={inp} type="number" step="any" placeholder="خط العرض (Lat)" value={latIn} onChange={e => setLatIn(e.target.value)} />
                <input className={inp} type="number" step="any" placeholder="خط الطول (Lng)" value={lngIn} onChange={e => setLngIn(e.target.value)} />
              </div>
              <button type="button" className={`${btn} w-full bg-indigo-600 text-white border-indigo-600`} disabled={busy} onClick={saveStationEdit}>حفظ الاسم والإحداثيات</button>
              <div className="text-xs font-bold pt-1">الخطوط اللي بتعدّي هنا ({stRoutes.length}):</div>
              <div className="flex flex-wrap gap-1.5">
                {stRoutes.slice(0, 20).map(r => (
                  <button key={r.routeId} type="button" onClick={() => setSelRoute(r.routeId)} className="px-2 py-1 rounded-lg text-[11px] font-black bg-indigo-600/10 text-indigo-600">
                    {r.name}
                  </button>
                ))}
                {stRoutes.length > 20 && <span className="text-[11px] opacity-60">+{stRoutes.length - 20}</span>}
              </div>
            </div>
          )}

          {draft ? (
            <div className={card}>
              <div className="text-sm font-black">{draft.id ? 'تعديل خط' : 'خط جديد'}</div>
              <input className={inp} placeholder="اسم الخط (مثال: ميكروباص الحصري - رمسيس)" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
              <div className="grid grid-cols-3 gap-1.5">
                <select className={inp} value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })}>{TYPES.map(t => <option key={t}>{t}</option>)}</select>
                <input className={inp} type="number" inputMode="decimal" placeholder="الأجرة (ج)" value={draft.fare} onChange={e => setDraft({ ...draft, fare: e.target.value })} />
                <input className={inp} type="number" inputMode="decimal" placeholder="المدة (د)" value={draft.totalMinutes} onChange={e => setDraft({ ...draft, totalMinutes: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={draft.twoWay} onChange={e => setDraft({ ...draft, twoWay: e.target.checked })} /> ذهاب وعودة (نفس المحطات بالعكس)</label>
              <div className="relative">
                <div className="flex items-center gap-1.5 min-h-11 px-3 rounded-xl border bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                  <Search size={14} className="text-slate-400" /><input value={addQ} onChange={e => setAddQ(e.target.value)} placeholder="ضيف محطة بالاسم (أو اضغط عليها في الخريطة)" className="flex-1 bg-transparent outline-none text-xs font-bold" />
                </div>
                {addRes.length > 0 && <div className="absolute z-30 inset-x-0 mt-1 rounded-xl border shadow-lg max-h-56 overflow-y-auto bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
                  {addRes.map(s => <button key={s.id} type="button" onClick={() => { addStop(s.id); setAddQ(''); }} className="w-full text-start px-3 py-2 text-xs font-bold border-b last:border-0 border-slate-100 dark:border-slate-800">{stationLabel(s)} <span className="opacity-50 font-medium">• {s.lat.toFixed(3)}, {s.lng.toFixed(3)}</span></button>)}
                </div>}
              </div>
              <button type="button" className={`${btn} ${newPoint ? 'bg-amber-500/10 text-amber-600' : ''}`} onClick={() => setNewPoint(v => !v)}><Plus size={13} className="inline" /> نقطة جديدة على الخريطة</button>
              <div className="space-y-1">
                {draft.stops.map((id, i) => (
                  <div key={`${id}-${i}`} className="flex items-center gap-1.5 text-xs font-bold">
                    <span className="w-5 h-5 grid place-items-center rounded-full bg-amber-500 text-white text-[10px] shrink-0">{i + 1}</span>
                    <span className="flex-1 truncate">{label(id)}</span>
                    <button type="button" aria-label="لفوق" disabled={i === 0} onClick={() => setDraft(d => { const s = [...d.stops]; [s[i - 1], s[i]] = [s[i], s[i - 1]]; return { ...d, stops: s }; })} className="px-1.5 disabled:opacity-30">▲</button>
                    <button type="button" aria-label="لتحت" disabled={i === draft.stops.length - 1} onClick={() => setDraft(d => { const s = [...d.stops]; [s[i + 1], s[i]] = [s[i], s[i + 1]]; return { ...d, stops: s }; })} className="px-1.5 disabled:opacity-30">▼</button>
                    <button type="button" aria-label="حذف" onClick={() => setDraft(d => ({ ...d, stops: d.stops.filter((_, j) => j !== i) }))}><X size={14} className="text-rose-500" /></button>
                  </div>
                ))}
              </div>
              <div className="text-[11px] opacity-70 leading-5">الخط بيتربط تلقائياً بكل خط بيعدّي على أي محطة فيه ({dRoutesCount} خط حالياً) وبالمشي لأي محطة قريبة (لحد {net.settings.walkMaxM} م).</div>
              <div className="flex gap-1.5"><button type="button" className={`${btn} bg-indigo-600 text-white border-indigo-600 flex-1`} disabled={busy} onClick={saveDraft}><Check size={13} className="inline" /> حفظ الخط</button><button type="button" className={btn} onClick={() => { setDraft(null); setNewPoint(false); }}>إلغاء</button></div>
            </div>
          ) : (
            <button type="button" className={`${btn} w-full bg-indigo-600 text-white border-indigo-600`} onClick={() => { setDraft({ ...emptyDraft }); setSelStation(''); }}><Plus size={14} className="inline" /> إضافة خط جديد</button>
          )}

          <div className={card}>
            <div className="flex gap-1.5">
              <div className="flex-1 flex items-center gap-1.5 min-h-11 px-3 rounded-xl border bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                <Search size={14} className="text-slate-400" /><input value={q} onChange={e => { setQ(e.target.value); setShown(30); }} placeholder="دوّر على خط (اسم أو محطة بداية/نهاية)" className="flex-1 bg-transparent outline-none text-xs font-bold" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={onlyNoFare} onChange={e => { setOnlyNoFare(e.target.checked); setShown(30); }} /> الخطوط اللي من غير أجرة بس ({routeList.length - withFare})</label>
            <div className="space-y-1.5">
              {filtered.slice(0, shown).map(r => (
                <div key={r.routeId} className={`rounded-xl border ${selRoute === r.routeId ? 'border-indigo-600' : 'border-slate-200 dark:border-slate-700'} ${r.disabled ? 'opacity-50' : ''}`}>
                  <button type="button" onClick={() => setSelRoute(selRoute === r.routeId ? '' : r.routeId)} className="w-full text-start p-2 space-y-0.5">
                    <div className="text-xs font-black">{r.custom ? '✨ ' : ''}{r.name} <span className="text-[10px] opacity-60">({r.type})</span> {r.disabled ? '(مخفي)' : ''}</div>
                    <div className="text-[11px] opacity-70 font-medium">{label(r.from)} ← {label(r.to)} • {r.stopsCount} محطة</div>
                    <div className="text-[11px] font-bold">{r.fare != null && r.fare !== '' ? `💰 ${r.fare} ج` : '💰 بدون أجرة'} • ⏱ {r.minutes ? `${r.minutes} د` : r.tmpl ? `~${r.tmpl} د (تقديري)` : 'تقدير من المسافة'}</div>
                  </button>
                  {selRoute === r.routeId && (
                    <div className="p-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                      <input className={inp} placeholder="اسم الخط بالعربي" value={routeNameIn} onChange={e => setRouteNameIn(e.target.value)} />
                      <div className="grid grid-cols-2 gap-1.5">
                        <input className={inp} type="number" inputMode="decimal" placeholder="الأجرة (ج)" value={fareIn} onChange={e => setFareIn(e.target.value)} />
                        <input className={inp} type="number" inputMode="decimal" placeholder="مدة الرحلة كلها (د)" value={minIn} onChange={e => setMinIn(e.target.value)} />
                      </div>
                      <div className="flex gap-1.5 flex-wrap">
                        <button type="button" className={`${btn} bg-indigo-600 text-white border-indigo-600`} disabled={busy} onClick={saveRouteEdit}>حفظ</button>
                        <button type="button" className={btn} disabled={busy} onClick={toggleDisabled}>{r.disabled ? 'إرجاع الخط' : 'إخفاء من التخطيط'}</button>
                        {r.custom && <button type="button" className={btn} onClick={() => { const c = r.c; setDraft({ id: c.id, name: c.name, type: c.type || 'ميكروباص', fare: c.fare ?? '', totalMinutes: c.totalMinutes ?? '', twoWay: c.twoWay !== false, stops: [...c.stops] }); }}>تعديل المحطات</button>}
                        {r.custom && <button type="button" className={`${btn} text-rose-600`} disabled={busy} onClick={deleteCustom}><Trash2 size={13} className="inline" /> حذف</button>}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {filtered.length > shown && <button type="button" className={`${btn} w-full`} onClick={() => setShown(s => s + 40)}>عرض المزيد ({filtered.length - shown})</button>}
              {!filtered.length && <div className="text-xs font-bold opacity-60">مفيش نتايج</div>}
            </div>
          </div>

          <details className={card}>
            <summary className="text-sm font-black cursor-pointer">أدوات التحديث المستقبلي والروابط المقترحة</summary>
            <div className="space-y-2.5 pt-2">
              <div className="flex gap-1.5 items-center">
                <span className="text-xs font-bold shrink-0">الانتظار لكل ركوبة (د):</span>
                <input className={inp} type="number" inputMode="decimal" placeholder={String(net.settings.waitMin)} value={waitIn} onChange={e => setWaitIn(e.target.value)} />
                <button type="button" className={btn} disabled={busy} onClick={saveWait}>حفظ</button>
              </div>

              <div className="flex gap-1.5 flex-wrap">
                <button type="button" className={`${btn} bg-emerald-600 text-white border-emerald-600`} onClick={() => {
                  const json = exportMergedJson();
                  if (json) { download('tfc.json', json); triggerToast('تم تصدير ملف tfc.json المحدّث والمعرّب ✅'); }
                }}>
                  <Download size={13} className="inline ml-1" /> تصدير tfc.json كامل (معرّب ومحدّث)
                </button>
                <button type="button" className={btn} onClick={() => download(`tfc-edits-${Date.now()}.json`, ov)}>نسخة احتياطية للتعديلات</button>
                <label className={`${btn} inline-flex items-center cursor-pointer`}>استرداد تعديلات<input type="file" accept="application/json,.json" className="hidden" onChange={importEdits} /></label>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                <button type="button" className={btn} onClick={() => setSuggestedLinks(generateSuggestedLinks(net, 600, 15))}>
                  <Link2 size={13} className="inline ml-1" /> توليد روابط مقترحة بين المحطات القريبة
                </button>
                {suggestedLinks.length > 0 && (
                  <div className="space-y-1.5">
                    {suggestedLinks.map((lk, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-xs font-bold">
                        <div>
                          <div>{lk.fromName} ↔ {lk.toName}</div>
                          <div className="text-[11px] opacity-60">المسافة: {lk.distanceMeters} م • {lk.kind === 'walk' ? 'مشي' : `توصيلة (~${lk.fare} ج)`}</div>
                        </div>
                        <button type="button" disabled={busy} onClick={() => approveSuggestedLink(lk)} className="px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-black">اعتماد</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </details>
        </>
      )}
    </div>
  );
};
export default TfcAdmin;