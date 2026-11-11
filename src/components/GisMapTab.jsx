import React, { useState, useEffect, useRef, useMemo } from 'react';
import { collection, onSnapshot, doc, updateDoc, setDoc, deleteDoc, addDoc, writeBatch } from 'firebase/firestore';
import {
  X, MapPin, Plus, Loader2, Route, Navigation, Link2, Trash2, Check,
  Search, AlertTriangle, Sparkles
} from 'lucide-react';
import { db, STATIONS_COLLECTION, LINKS_COLLECTION } from '../firebase';
import { getPlaceCoords, EGYPT_CITIES, escapeHtml as esc } from '../utils/helpers';
import { NODE_TYPES, LINK_KINDS, SUGGEST_WALK_KM } from '../utils/gisConstants';
import {
  hasExactCoords, coordsOf, linkDocId, isApprovedLink, distanceBetween, estimateMinutes, validLinks,
  findBestPath, suggestLinks, analyzeNetwork, bearingDeg
} from '../utils/gis';

// ───────────── تحميل Leaflet (مرة واحدة، ويتحمّل لو التاج موجود بس لسه بيحمّل) ─────────────
const useLeaflet = () => {
  const [ready, setReady] = useState(typeof window !== 'undefined' && Boolean(window.L));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (window.L) { setReady(true); return undefined; }

    if (!document.getElementById('leaflet-css-cdn')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css-cdn';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    let script = document.getElementById('leaflet-js-cdn');
    if (!script) {
      script = document.createElement('script');
      script.id = 'leaflet-js-cdn';
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.async = true;
      document.body.appendChild(script);
    }
    const onLoad = () => setReady(true);
    const onError = () => setFailed(true);
    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
    const poll = setInterval(() => { if (window.L) { setReady(true); clearInterval(poll); } }, 300);
    const timeout = setTimeout(() => { clearInterval(poll); if (!window.L) setFailed(true); }, 15000);
    return () => {
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
      clearInterval(poll);
      clearTimeout(timeout);
    };
  }, []);

  return { ready, failed };
};

const seedFromId = (id) => ([...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % 97) + 1;
const nodePos = (st) => coordsOf(st) || getPlaceCoords(st, seedFromId(st.id));
const typeOf = (st) => NODE_TYPES.find(t => t.id === (st?.nodeType || 'station')) || NODE_TYPES[0];
const kindOf = (id) => LINK_KINDS.find(k => k.id === id) || LINK_KINDS[1];
const emptyStationForm = { name: '', location: '', governorate: '', nodeType: 'station' };

const newDraft = (fromId = null) => ({
  fromId, toId: null, kind: 'ride', fare: '', minutes: '', note: '', oneWay: false, minutesTouched: false, existing: false
});

const GisMapTab = ({ isDarkMode, triggerToast, user, stationsList = [], onSeed, isSeeding, supportedAreas = [] }) => {
  const { ready, failed } = useLeaflet();

  // ── خريطة ──
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({});
  const tempPinRef = useRef(null);
  const fittedRef = useRef(false);
  const onNodeClickRef = useRef(() => {});
  const onLinkClickRef = useRef(() => {});
  const onMapClickRef = useRef(() => {});
  const [mapReady, setMapReady] = useState(false);

  // ── بيانات ──
  const [links, setLinks] = useState([]);
  const [linksError, setLinksError] = useState(false);

  // ── واجهة ──
  const [mode, setMode] = useState('view'); // view | add | move | link | plan
  const [selectedId, setSelectedId] = useState(null);
  const [selectedLinkId, setSelectedLinkId] = useState(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [showLinks, setShowLinks] = useState(true);
  const [showDestLines, setShowDestLines] = useState(false);
  const [search, setSearch] = useState('');
  const [healthFilter, setHealthFilter] = useState(null);
  const [clickedCoords, setClickedCoords] = useState(null);
  const [newStation, setNewStation] = useState(emptyStationForm);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(null);
  const [editLink, setEditLink] = useState(null);
  const [plan, setPlan] = useState({ fromId: null, toId: null, criterion: 'fast' });

  const bgInput = isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-900';
  const textPrimary = isDarkMode ? 'text-white' : 'text-slate-900';
  const textSecondary = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const cardBg = isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200';
  const inputCls = `w-full h-11 px-3 rounded-xl border text-xs font-bold outline-none ${bgInput}`;

  // ───────────── اشتراك الروابط (الـ stations جاية من AdminPanel) ─────────────
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, LINKS_COLLECTION),
      (snap) => { setLinks(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLinksError(false); },
      (err) => { console.error('links snapshot error:', err); setLinksError(true); }
    );
    return unsub;
  }, []);

  // ───────────── قيم مشتقة ─────────────
  const nodesById = useMemo(() => Object.fromEntries(stationsList.map(s => [s.id, s])), [stationsList]);
  const selected = selectedId ? nodesById[selectedId] : null;
  const selectedLink = selectedLinkId ? links.find(l => l.id === selectedLinkId) : null;
  const goodLinks = useMemo(() => validLinks(links, nodesById), [links, nodesById]);
  const approvedCount = useMemo(() => goodLinks.filter(isApprovedLink).length, [goodLinks]);
  const pendingLinks = useMemo(() => goodLinks.filter(l => !isApprovedLink(l)), [goodLinks]);
  const analysis = useMemo(() => analyzeNetwork(stationsList, links), [stationsList, links]);
  const planResult = useMemo(
    () => (plan.fromId && plan.toId ? findBestPath(links, nodesById, plan.fromId, plan.toId, plan.criterion) : null),
    [plan, links, nodesById]
  );
  const suggestions = useMemo(
    () => (mode === 'link' ? suggestLinks(stationsList.filter(hasExactCoords), links, SUGGEST_WALK_KM, 8) : []),
    [mode, stationsList, links]
  );
  const sortedNodes = useMemo(
    () => [...stationsList].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar')),
    [stationsList]
  );

  const flyTo = (st) => { if (mapRef.current && st) mapRef.current.flyTo(nodePos(st), 14, { duration: 0.6 }); };

  const resetTransient = () => {
    setDraft(null);
    setClickedCoords(null);
    setPlan(p => ({ ...p, fromId: null, toId: null }));
  };
  const switchMode = (m) => {
    resetTransient();
    setSelectedLinkId(null);
    setMode(m);
    if (m === 'link') setDraft(newDraft(selectedId));
  };

  // Esc = إلغاء الوضع الحالي
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { setMode('view'); resetTransient(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ───────────── التعامل مع الضغط على نقطة / رابط / الخريطة ─────────────
  onNodeClickRef.current = (st) => {
    if (mode === 'link') {
      if (!draft || !draft.fromId || draft.toId) { setDraft(newDraft(st.id)); setSelectedId(st.id); return; }
      if (st.id === draft.fromId) return triggerToast('اختار نقطة تانية غير نقطة البداية');
      const from = nodesById[draft.fromId];
      const dist = distanceBetween(from, st);
      const existing = links.find(l => l.id === linkDocId(draft.fromId, st.id, false))
        || links.find(l => l.id === linkDocId(draft.fromId, st.id, true))
        || links.find(l => l.id === linkDocId(st.id, draft.fromId, true));
      if (existing) {
        setDraft({
          fromId: existing.fromId, toId: existing.toId, kind: existing.kind || 'ride',
          fare: String(existing.fare ?? ''), minutes: String(existing.minutes ?? ''),
          note: existing.note || '', oneWay: !!existing.oneWay, minutesTouched: true, existing: true
        });
      } else {
        const kind = dist != null && dist <= SUGGEST_WALK_KM ? 'walk' : 'ride';
        setDraft({
          ...draft, toId: st.id, kind, fare: kind === 'walk' ? '0' : '',
          minutes: String(estimateMinutes(kind, dist) ?? ''), minutesTouched: false, existing: false
        });
      }
      return;
    }
    if (mode === 'plan') {
      setPlan(p => (!p.fromId || p.toId ? { ...p, fromId: st.id, toId: null } : st.id === p.fromId ? p : { ...p, toId: st.id }));
      return;
    }
    if (mode === 'view') { setSelectedId(st.id); setSelectedLinkId(null); flyTo(st); }
  };

  onLinkClickRef.current = (l) => {
    if (mode === 'plan' || mode === 'add' || mode === 'move') return;
    setMode('view'); setDraft(null);
    setSelectedLinkId(l.id); setSelectedId(null);
  };

  onMapClickRef.current = async (e) => {
    const lat = Number(e.latlng.lat.toFixed(6));
    const lng = Number(e.latlng.lng.toFixed(6));
    const L = window.L;
    if (mode === 'add' || mode === 'move') {
      setClickedCoords({ lat, lng });
      if (tempPinRef.current) tempPinRef.current.setLatLng([lat, lng]);
      else {
        const pinIcon = L.divIcon({
          className: 'custom-gis-pin',
          html: '<div style="width:22px;height:22px;border-radius:50%;background:#e11d48;border:3px solid #fff;box-shadow:0 0 12px rgba(225,29,72,.8)"></div>',
          iconSize: [22, 22], iconAnchor: [11, 11]
        });
        tempPinRef.current = L.marker([lat, lng], { icon: pinIcon }).addTo(mapRef.current);
      }
    }
    if (mode === 'move' && selected) {
      try {
        await updateDoc(doc(db, STATIONS_COLLECTION, selected.id), {
          lat, lng, mapUrl: `https://www.google.com/maps?q=${lat},${lng}`
        });
        triggerToast(`تم نقل (${selected.name}) 📍`);
        setMode('view'); setClickedCoords(null);
      } catch (err) { triggerToast('تعذر حفظ الإحداثيات'); }
    }
  };

  // ───────────── تهيئة الخريطة (مرة واحدة) ─────────────
  useEffect(() => {
    if (!ready || !containerRef.current || mapRef.current) return undefined;
    const L = window.L;
    const map = L.map(containerRef.current, { center: [30.0444, 31.2357], zoom: 11, zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map);
    layersRef.current = {
      links: L.layerGroup().addTo(map),
      dest: L.layerGroup().addTo(map),
      path: L.layerGroup().addTo(map),
      nodes: L.layerGroup().addTo(map)
    };
    map.on('click', (e) => onMapClickRef.current(e));
    mapRef.current = map;
    setMapReady(true);
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; tempPinRef.current = null; fittedRef.current = false; setMapReady(false); };
  }, [ready]);

  // الدبوس المؤقت يختفي لما نطلع من وضع الإضافة/النقل
  useEffect(() => {
    if (mode !== 'add' && mode !== 'move' && tempPinRef.current && mapRef.current) {
      mapRef.current.removeLayer(tempPinRef.current);
      tempPinRef.current = null;
    }
  }, [mode]);

  // ───────────── رسم النقاط والروابط ─────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const L = window.L;
    const { links: linksLayer, dest: destLayer, path: pathLayer, nodes: nodesLayer } = layersRef.current;
    [linksLayer, destLayer, pathLayer, nodesLayer].forEach(l => l.clearLayers());

    const visible = stationsList.filter(st => typeFilter === 'all' || (st.nodeType || 'station') === typeFilter);
    const visibleIds = new Set(visible.map(s => s.id));
    const planning = mode === 'plan' && planResult;
    const pathLinkIds = new Set((planResult?.legs || []).map(l => l.link.id));
    const pathNodeIds = new Set(mode === 'plan' ? (planResult?.nodeIds || [plan.fromId, plan.toId].filter(Boolean)) : []);
    const linkEnds = new Set(mode === 'link' && draft ? [draft.fromId, draft.toId].filter(Boolean) : []);

    // الروابط
    if (showLinks || mode === 'link' || mode === 'plan') {
      goodLinks.forEach(l => {
        if (!visibleIds.has(l.fromId) || !visibleIds.has(l.toId)) return;
        const a = nodePos(nodesById[l.fromId]);
        const b = nodePos(nodesById[l.toId]);
        const pending = !isApprovedLink(l);
        const kind = pending ? { ...kindOf(l.kind), color: '#d97706', dashArray: '6 6' } : kindOf(l.kind);
        const isSel = selectedLinkId === l.id;
        const dim = planning && !pathLinkIds.has(l.id);

        L.polyline([a, b], {
          color: kind.color, weight: isSel ? kind.weight + 2 : kind.weight,
          opacity: dim ? 0.15 : 0.85, dashArray: kind.dashArray, interactive: false
        }).addTo(linksLayer);

        const hit = L.polyline([a, b], { weight: 18, opacity: 0, interactive: true }).addTo(linksLayer);
        hit.on('click', (ev) => { L.DomEvent.stopPropagation(ev); onLinkClickRef.current(l); });
        hit.bindTooltip(
          `<b>${esc(nodesById[l.fromId].name)} ${l.oneWay ? '←' : '⇄'} ${esc(nodesById[l.toId].name)}</b><br/>${pending ? '⏳ اقتراح — ' : ''}${esc(kind.short)} • ${esc(l.minutes ?? '؟')} د • ${esc(l.fare ?? 0)} ج`,
          { sticky: true }
        );

        if (l.oneWay && !dim) {
          const pos = [a[0] + (b[0] - a[0]) * 0.55, a[1] + (b[1] - a[1]) * 0.55];
          const rot = bearingDeg(a, b) - 90;
          L.marker(pos, {
            interactive: false,
            icon: L.divIcon({
              className: 'gis-arrow',
              html: `<div style="transform:rotate(${rot}deg);color:${kind.color};font-size:16px;line-height:1;text-shadow:0 0 3px #fff">➤</div>`,
              iconSize: [16, 16], iconAnchor: [8, 8]
            })
          }).addTo(linksLayer);
        }
      });
    }

    // مسار التخطيط (إطار أبيض + خط أخضر)
    if (planning) {
      planResult.legs.forEach(leg => {
        const pts = [nodePos(nodesById[leg.fromId]), nodePos(nodesById[leg.toId])];
        L.polyline(pts, { color: '#ffffff', weight: 11, opacity: 0.95, interactive: false }).addTo(pathLayer);
        L.polyline(pts, { color: '#059669', weight: 6, opacity: 1, interactive: false }).addTo(pathLayer);
      });
    }

    // خطوط الوجهات القديمة (من الخط إلى مركز المنطقة)
    if (showDestLines) {
      visible.forEach(st => {
        const from = nodePos(st);
        (st.routes || []).forEach(r => {
          const to = getPlaceCoords(r.destination || r.destinationDetails);
          if (to && (to[0] !== from[0] || to[1] !== from[1])) {
            L.polyline([from, to], { color: '#6366f1', weight: 1.5, opacity: 0.35, dashArray: '5, 6', interactive: false }).addTo(destLayer);
          }
        });
      });
    }

    // النقاط
    visible.forEach(st => {
      const pos = nodePos(st);
      const t = typeOf(st);
      const isSel = selectedId === st.id && mode !== 'plan';
      const inUse = linkEnds.has(st.id) || pathNodeIds.has(st.id);
      const dim = planning && !pathNodeIds.has(st.id);
      const routesCount = (st.routes || []).length;
      const deg = analysis.degree[st.id] || 0;

      let bg = t.color;
      if (st.status === 'pending') bg = '#d97706';
      else if (st.crowdStatus === 'crowded') bg = '#e11d48';
      else if (st.crowdStatus === 'empty') bg = '#059669';

      const size = isSel || inUse ? 30 : 24;
      const radius = (st.nodeType || 'station') === 'hub' ? '8px' : '50%';
      const border = hasExactCoords(st) ? '2.5px solid #fff' : '2.5px dashed #fff';
      const ring = inUse ? '0 0 0 4px rgba(5,150,105,.6)' : isSel ? '0 0 0 4px rgba(79,70,229,.55)' : '0 0 0 0 transparent';

      const icon = L.divIcon({
        className: 'station-gis-node',
        html: `<div style="width:${size}px;height:${size}px;border-radius:${radius};background:${bg};border:${border};box-shadow:${ring},0 2px 8px rgba(0,0,0,.45);opacity:${dim ? 0.35 : 1};color:#fff;font:900 12px/1 Tajawal,sans-serif;display:flex;align-items:center;justify-content:center">${routesCount}</div>`,
        iconSize: [size, size], iconAnchor: [size / 2, size / 2]
      });
      const marker = L.marker(pos, { icon }).addTo(nodesLayer);
      marker.bindTooltip(
        `<b>${esc(t.short)} ${esc(st.name)}</b><br/>${esc(st.location || '')} • ${routesCount} خطوط • ${deg} روابط${hasExactCoords(st) ? '' : '<br/>⚠️ إحداثيات تقريبية'}`,
        { direction: 'top', offset: [0, -10] }
      );
      marker.on('click', (ev) => { L.DomEvent.stopPropagation(ev); onNodeClickRef.current(st); });
    });

    // أول مرة: اعرض كل النقاط
    if (!fittedRef.current && visible.length > 1) {
      mapRef.current.fitBounds(L.latLngBounds(visible.map(nodePos)), { padding: [40, 40], maxZoom: 13 });
      fittedRef.current = true;
    }
  }, [mapReady, stationsList, goodLinks, nodesById, analysis, typeFilter, showLinks, showDestLines, mode,
      selectedId, selectedLinkId, draft?.fromId, draft?.toId, plan, planResult]);

  // نسخة قابلة للتعديل من الرابط المختار
  useEffect(() => {
    setEditLink(selectedLink ? {
      kind: selectedLink.kind || 'ride', fare: String(selectedLink.fare ?? ''),
      minutes: String(selectedLink.minutes ?? ''), note: selectedLink.note || ''
    } : null);
  }, [selectedLinkId, selectedLink?.updatedAt]);

  // ───────────── عمليات Firestore ─────────────
  const handleCreateStation = async (e) => {
    e.preventDefault();
    if (!clickedCoords) return triggerToast('اضغط على الخريطة أولاً لتحديد الموقع 📍');
    if (!newStation.name.trim() || !newStation.location.trim()) return triggerToast('أدخل الاسم والمنطقة');
    setSaving(true);
    try {
      await addDoc(collection(db, STATIONS_COLLECTION), {
        name: newStation.name.trim(),
        nodeType: newStation.nodeType || 'station',
        location: newStation.location.trim(),
        governorate: newStation.governorate || newStation.location.trim(),
        lat: clickedCoords.lat, lng: clickedCoords.lng,
        mapUrl: `https://www.google.com/maps?q=${clickedCoords.lat},${clickedCoords.lng}`,
        status: 'approved', addedBy: user?.uid || 'admin', routes: [],
        crowdStatus: 'normal', crowdUpdatedAt: Date.now()
      });
      triggerToast('تم حفظ النقطة على الخريطة ✅');
      setNewStation(emptyStationForm); setClickedCoords(null); setMode('view');
    } catch (err) { triggerToast('حدث خطأ أثناء الحفظ'); } finally { setSaving(false); }
  };

  const handleChangeNodeType = async (id, nodeType) => {
    try { await updateDoc(doc(db, STATIONS_COLLECTION, id), { nodeType }); triggerToast('تم تحديث التصنيف ✅'); }
    catch (e) { triggerToast('تعذر التحديث'); }
  };

  const saveLink = async () => {
    if (!draft?.fromId || !draft?.toId) return;
    const dist = distanceBetween(nodesById[draft.fromId], nodesById[draft.toId]);
    const needsFare = draft.kind === 'ride';
    if (needsFare && draft.fare === '') return triggerToast('أدخل سعر المواصلة (ممكن 0)');
    const id = linkDocId(draft.fromId, draft.toId, draft.oneWay);
    const old = links.find(l => l.id === id);
    const minutes = Number(draft.minutes) > 0 ? Number(draft.minutes) : estimateMinutes(draft.kind, dist);
    setSaving(true);
    try {
      await setDoc(doc(db, LINKS_COLLECTION, id), {
        fromId: draft.fromId, toId: draft.toId, kind: draft.kind,
        fare: draft.kind === 'ride' ? Number(draft.fare) || 0 : 0,
        minutes: minutes ?? null, note: draft.note.trim(), oneWay: !!draft.oneWay,
        distanceKm: dist != null ? Number(dist.toFixed(2)) : null,
        status: 'approved', approvedBy: user?.uid || 'admin',
        createdBy: old?.createdBy || user?.uid || 'admin',
        createdAt: old?.createdAt || Date.now(), updatedAt: Date.now()
      }, { merge: true });
      triggerToast(old ? 'تم تحديث الرابط ✅' : 'تم الربط ✅ — اختار نقطة تانية أو اضغط إنهاء');
      setDraft(newDraft(draft.fromId)); // كمّل ربط من نفس النقطة
    } catch (err) { console.error(err); triggerToast('تعذر الحفظ — راجع قواعد Firestore للروابط'); }
    finally { setSaving(false); }
  };

  const quickWalkLink = async (s) => {
    try {
      await setDoc(doc(db, LINKS_COLLECTION, linkDocId(s.a.id, s.b.id)), {
        fromId: s.a.id, toId: s.b.id, kind: 'walk', fare: 0,
        minutes: estimateMinutes('walk', s.distanceKm), note: '', oneWay: false,
        distanceKm: Number(s.distanceKm.toFixed(2)), createdBy: user?.uid || 'admin',
        status: 'approved', approvedBy: user?.uid || 'admin',
        createdAt: Date.now(), updatedAt: Date.now()
      });
      triggerToast(`تم ربط ${s.a.name} ⇄ ${s.b.name} 🚶`);
    } catch (err) { triggerToast('تعذر الربط'); }
  };

  const saveLinkEdit = async () => {
    if (!selectedLink || !editLink) return;
    try {
      await updateDoc(doc(db, LINKS_COLLECTION, selectedLink.id), {
        kind: editLink.kind,
        fare: editLink.kind === 'ride' ? Number(editLink.fare) || 0 : 0,
        minutes: Number(editLink.minutes) > 0 ? Number(editLink.minutes) : null,
        note: editLink.note.trim(), updatedAt: Date.now()
      });
      triggerToast('تم حفظ تعديل الرابط ✅');
    } catch (e) { triggerToast('تعذر الحفظ'); }
  };

  const approveLink = async (l, edits = null) => {
    try {
      await updateDoc(doc(db, LINKS_COLLECTION, l.id), {
        ...(edits ? {
          kind: edits.kind,
          fare: edits.kind === 'ride' ? Number(edits.fare) || 0 : 0,
          minutes: Number(edits.minutes) > 0 ? Number(edits.minutes) : null,
          note: edits.note.trim()
        } : {}),
        status: 'approved', approvedBy: user?.uid || 'admin', approvedAt: Date.now(), updatedAt: Date.now()
      });
      triggerToast('تم اعتماد الرابط وظهر للمستخدمين ✅');
    } catch (e) { triggerToast('تعذر الاعتماد'); }
  };

  const rejectLink = async (l) => {
    if (!window.confirm('رفض وحذف هذا الاقتراح؟')) return;
    try { await deleteDoc(doc(db, LINKS_COLLECTION, l.id)); setSelectedLinkId(null); triggerToast('تم رفض الاقتراح'); }
    catch (e) { triggerToast('تعذر الرفض'); }
  };

  const deleteLink = async (l) => {
    if (!window.confirm('حذف هذا الرابط؟')) return;
    try { await deleteDoc(doc(db, LINKS_COLLECTION, l.id)); setSelectedLinkId(null); triggerToast('تم حذف الرابط'); }
    catch (e) { triggerToast('تعذر الحذف'); }
  };

  const cleanOrphans = async () => {
    if (!analysis.orphanLinks.length || !window.confirm(`حذف ${analysis.orphanLinks.length} رابط يتيم (نقطته اتمسحت)؟`)) return;
    try {
      const batch = writeBatch(db);
      analysis.orphanLinks.slice(0, 400).forEach(l => batch.delete(doc(db, LINKS_COLLECTION, l.id)));
      await batch.commit();
      triggerToast('تم تنظيف الروابط اليتيمة ✅');
    } catch (e) { triggerToast('تعذر التنظيف'); }
  };

  // ───────────── مكونات صغيرة ─────────────
  const ModeBtn = ({ id, icon, children }) => (
    <button
      type="button"
      onClick={() => switchMode(id)}
      className={`min-h-11 px-3 rounded-xl text-xs font-black flex items-center gap-1.5 border transition-colors ${
        mode === id ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
          : `${isDarkMode ? 'bg-slate-900 border-slate-700 text-slate-300' : 'bg-white border-slate-200 text-slate-600'}`
      }`}
    >
      {icon}{children}
    </button>
  );

  const NodeChip = ({ st, label, onClear }) => (
    <div className={`flex-1 min-w-0 p-2.5 rounded-xl border text-xs font-black ${st ? 'border-emerald-500/50 bg-emerald-500/10' : `border-dashed ${isDarkMode ? 'border-slate-600' : 'border-slate-300'}`}`}>
      <span className={`block ${textSecondary} font-bold`}>{label}</span>
      <div className="flex items-center justify-between gap-1">
        <span className={`truncate ${textPrimary}`}>{st ? st.name : 'اضغط على نقطة في الخريطة'}</span>
        {st && onClear && <button type="button" aria-label="مسح" onClick={onClear} className="w-6 h-6 shrink-0 flex items-center justify-center"><X size={12} /></button>}
      </div>
    </div>
  );

  const KindPicker = ({ value, onChange }) => (
    <div className="grid grid-cols-3 gap-1.5">
      {LINK_KINDS.map(k => (
        <button key={k.id} type="button" onClick={() => onChange(k.id)}
          className={`min-h-11 px-1 rounded-xl text-xs font-black border transition-colors ${value === k.id ? 'bg-indigo-600 text-white border-indigo-600' : bgInput}`}>
          {k.short}
        </button>
      ))}
    </div>
  );

  const LinkRow = ({ l, meId }) => {
    const otherId = l.fromId === meId ? l.toId : l.fromId;
    const other = nodesById[otherId];
    if (!other) return null;
    const k = kindOf(l.kind);
    const dirLabel = l.oneWay ? (l.fromId === meId ? '← إلى' : '→ من') : '⇄';
    return (
      <button type="button" onClick={() => { setSelectedLinkId(l.id); setSelectedId(null); }}
        className={`w-full min-h-11 p-2.5 rounded-xl border text-right flex items-center justify-between gap-2 hover:border-indigo-500 transition-colors ${cardBg}`}>
        <span className={`text-xs font-black truncate ${textPrimary}`}>{dirLabel} {other.name}{!isApprovedLink(l) && <span className="text-amber-700"> (اقتراح)</span>}</span>
        <span className="flex items-center gap-1.5 shrink-0">
          <span className={`text-xs font-black px-2 py-0.5 rounded-lg border ${k.badgeClass}`}>{k.short}</span>
          <span className="text-xs font-black text-emerald-600">{l.fare || 0} ج</span>
          <span className={`text-xs font-bold ${textSecondary}`}>{l.minutes || '؟'} د</span>
        </span>
      </button>
    );
  };

  // ───────────── اللوحة الجانبية ─────────────
  const renderPanel = () => {
    // 1) إضافة نقطة
    if (mode === 'add') {
      return (
        <form onSubmit={handleCreateStation} className="space-y-3">
          <h4 className="font-black text-sm text-indigo-600 flex items-center gap-1.5"><MapPin size={16} /> إضافة نقطة مواصلات</h4>
          <div className={`p-2.5 rounded-xl border text-xs font-bold ${clickedCoords ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600' : 'bg-amber-500/10 border-amber-500/30 text-amber-700'}`}>
            {clickedCoords ? `✅ ${clickedCoords.lat}, ${clickedCoords.lng}` : '👆 اضغط على الخريطة لالتقاط الإحداثيات'}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {NODE_TYPES.map(nt => (
              <button key={nt.id} type="button" onClick={() => setNewStation({ ...newStation, nodeType: nt.id })}
                className={`min-h-11 px-2 rounded-xl text-xs font-black border flex items-center justify-between ${newStation.nodeType === nt.id ? 'bg-indigo-600 text-white border-indigo-600' : bgInput}`}>
                <span className="truncate">{nt.short}</span>{newStation.nodeType === nt.id && <Check size={12} />}
              </button>
            ))}
          </div>
          <input type="text" required placeholder="اسم الموقف / النقطة التبادلية" value={newStation.name}
            onChange={e => setNewStation({ ...newStation, name: e.target.value })} className={inputCls} />
          <select required value={newStation.location}
            onChange={e => { const v = e.target.value; setNewStation({ ...newStation, location: v, governorate: EGYPT_CITIES.includes(v) ? v : newStation.governorate }); }}
            className={inputCls}>
            <option value="" disabled>اختر المنطقة أو المحافظة *</option>
            <optgroup label="📍 المناطق والمدن الحيوية">{supportedAreas.map(a => <option key={a} value={a}>{a}</option>)}</optgroup>
            <optgroup label="🏛️ محافظات مصر">{EGYPT_CITIES.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
          </select>
          <button type="submit" disabled={saving || !clickedCoords}
            className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl font-black text-xs">
            {saving ? 'جاري الحفظ...' : 'حفظ النقطة ✅'}
          </button>
        </form>
      );
    }

    // 2) ربط النقاط
    if (mode === 'link') {
      const from = draft?.fromId ? nodesById[draft.fromId] : null;
      const to = draft?.toId ? nodesById[draft.toId] : null;
      const dist = from && to ? distanceBetween(from, to) : null;
      return (
        <div className="space-y-3">
          <h4 className="font-black text-sm text-indigo-600 flex items-center gap-1.5"><Link2 size={16} /> ربط نقطتين</h4>
          <div className="flex items-stretch gap-2">
            <NodeChip st={from} label="من" onClear={() => setDraft(newDraft())} />
            <NodeChip st={to} label="إلى" onClear={() => setDraft(d => ({ ...d, toId: null }))} />
          </div>

          {from && to ? (
            <div className="space-y-2.5">
              {draft.existing && <p className="text-xs font-bold text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded-xl p-2">⚠️ في رابط موجود بين النقطتين — الحفظ هيحدّثه.</p>}
              {dist != null && <p className={`text-xs font-bold ${textSecondary}`}>المسافة المباشرة: {dist < 1 ? `${Math.round(dist * 1000)} م` : `${dist.toFixed(1)} كم`}</p>}
              <KindPicker value={draft.kind} onChange={(kind) => setDraft(d => ({
                ...d, kind, fare: kind === 'ride' ? d.fare : '0',
                minutes: d.minutesTouched ? d.minutes : String(estimateMinutes(kind, dist) ?? '')
              }))} />
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className={`text-xs font-bold ${textSecondary}`}>السعر (ج)</span>
                  <input type="number" min="0" inputMode="numeric" disabled={draft.kind !== 'ride'} value={draft.fare}
                    onChange={e => setDraft({ ...draft, fare: e.target.value })} className={`${inputCls} disabled:opacity-50`} />
                </label>
                <label className="space-y-1">
                  <span className={`text-xs font-bold ${textSecondary}`}>الوقت (دقيقة)</span>
                  <input type="number" min="0" inputMode="numeric" value={draft.minutes}
                    onChange={e => setDraft({ ...draft, minutes: e.target.value, minutesTouched: true })} className={inputCls} />
                </label>
              </div>
              <input type="text" placeholder="ملاحظة (مثال: اطلع سلم الدائري)" value={draft.note}
                onChange={e => setDraft({ ...draft, note: e.target.value })} className={inputCls} />
              <label className={`min-h-11 flex items-center gap-2 text-xs font-black cursor-pointer ${textPrimary}`}>
                <input type="checkbox" checked={draft.oneWay} disabled={draft.existing}
                  onChange={e => setDraft({ ...draft, oneWay: e.target.checked })} className="w-4 h-4 accent-indigo-600" />
                اتجاه واحد فقط ({from.name} ← {to.name})
              </label>
              <button type="button" onClick={saveLink} disabled={saving}
                className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl font-black text-xs flex items-center justify-center gap-1.5">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <><Check size={14} /> حفظ الرابط</>}
              </button>
            </div>
          ) : (
            <p className={`text-xs font-bold leading-relaxed ${textSecondary}`}>
              {!from ? 'اضغط على النقطة الأولى (مثلاً النقطة التبادلية) ثم النقطة التانية. بعد الحفظ تقدر تكمل ربط نفس النقطة بغيرها.' : 'دلوقتي اضغط على النقطة التانية.'}
            </p>
          )}

          {suggestions.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-700">
              <span className="text-xs font-black text-amber-700 flex items-center gap-1"><Sparkles size={12} /> نقاط قريبة من بعض ولسه متربطتش</span>
              {suggestions.map(s => (
                <div key={`${s.a.id}-${s.b.id}`} className={`p-2 rounded-xl border flex items-center justify-between gap-2 ${cardBg}`}>
                  <span className={`text-xs font-bold truncate ${textPrimary}`}>{s.a.name} ⇄ {s.b.name} <span className={textSecondary}>({Math.round(s.distanceKm * 1000)} م)</span></span>
                  <button type="button" onClick={() => quickWalkLink(s)} className="min-h-11 px-3 shrink-0 bg-indigo-600 text-white rounded-xl text-xs font-black">ربط مشي</button>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    // 3) تخطيط مسار
    if (mode === 'plan') {
      const from = plan.fromId ? nodesById[plan.fromId] : null;
      const to = plan.toId ? nodesById[plan.toId] : null;
      const nodeSelect = (value, onChange, placeholder) => (
        <select value={value || ''} onChange={e => onChange(e.target.value || null)} className={inputCls}>
          <option value="">{placeholder}</option>
          {sortedNodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
      );
      return (
        <div className="space-y-3">
          <h4 className="font-black text-sm text-indigo-600 flex items-center gap-1.5"><Route size={16} /> تخطيط مسار بالروابط</h4>
          {nodeSelect(plan.fromId, (v) => setPlan(p => ({ ...p, fromId: v })), 'من (أو اضغط على الخريطة)')}
          {nodeSelect(plan.toId, (v) => setPlan(p => ({ ...p, toId: v })), 'إلى (أو اضغط على الخريطة)')}
          <div className="grid grid-cols-2 gap-1.5">
            {[['fast', 'الأسرع ⏱'], ['cheap', 'الأرخص 💰']].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setPlan(p => ({ ...p, criterion: id }))}
                className={`min-h-11 rounded-xl text-xs font-black border ${plan.criterion === id ? 'bg-indigo-600 text-white border-indigo-600' : bgInput}`}>{label}</button>
            ))}
          </div>

          {from && to && !planResult && (
            <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs font-bold text-amber-700 leading-relaxed">
              مفيش مسار بين النقطتين بالروابط الحالية. اربط بينهم مباشرة أو عن طريق نقطة تبادلية (وضع «ربط النقاط»).
            </div>
          )}
          {planResult && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-1.5 text-center">
                {[[`${planResult.totalMinutes} د`, 'الوقت'], [`${planResult.totalFare} ج`, 'التكلفة'], [planResult.transfers, 'تحويلات']].map(([v, l]) => (
                  <div key={l} className={`p-2 rounded-xl border ${cardBg}`}>
                    <p className="text-base font-black text-emerald-600">{v}</p>
                    <p className={`text-xs font-bold ${textSecondary}`}>{l}</p>
                  </div>
                ))}
              </div>
              {planResult.legs.map((leg, i) => {
                const k = kindOf(leg.link.kind);
                return (
                  <div key={i} className={`p-2.5 rounded-xl border space-y-1 ${cardBg}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-xs font-black truncate ${textPrimary}`}>{nodesById[leg.fromId].name} ← {nodesById[leg.toId].name}</span>
                      <span className={`text-xs font-black px-2 py-0.5 rounded-lg border shrink-0 ${k.badgeClass}`}>{k.short}</span>
                    </div>
                    <p className={`text-xs font-bold ${textSecondary}`}>{leg.minutes} د • {leg.fare} ج{leg.link.note ? ` • ${leg.link.note}` : ''}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    // 4) تفاصيل رابط مختار
    if (selectedLink && nodesById[selectedLink.fromId] && nodesById[selectedLink.toId] && editLink) {
      const a = nodesById[selectedLink.fromId], b = nodesById[selectedLink.toId];
      return (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className={`font-black text-sm ${textPrimary}`}>{a.name} {selectedLink.oneWay ? '←' : '⇄'} {b.name}</h4>
              <p className={`text-xs font-bold ${textSecondary}`}>{selectedLink.oneWay ? 'اتجاه واحد' : 'اتجاهين'}{selectedLink.distanceKm != null ? ` • ${selectedLink.distanceKm} كم` : ''}</p>
            </div>
            <button type="button" aria-label="إغلاق" onClick={() => setSelectedLinkId(null)} className="w-11 h-11 shrink-0 rounded-xl bg-slate-200 dark:bg-slate-700 flex items-center justify-center"><X size={14} /></button>
          </div>
          {!isApprovedLink(selectedLink) && (
            <div className="p-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 space-y-2">
              <p className="text-xs font-bold text-amber-700 leading-relaxed">
                ⏳ اقتراح من {selectedLink.suggestedByName || 'مستخدم'} — مش ظاهر للمستخدمين لحد ما تعتمده (تقدر تعدّل البيانات الأول).
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => approveLink(selectedLink, editLink)} className="h-11 bg-emerald-600 text-white rounded-xl text-xs font-black">اعتماد ✅</button>
                <button type="button" onClick={() => rejectLink(selectedLink)} className="h-11 bg-rose-600 text-white rounded-xl text-xs font-black">رفض</button>
              </div>
            </div>
          )}
          <KindPicker value={editLink.kind} onChange={(kind) => setEditLink({ ...editLink, kind })} />
          <div className="grid grid-cols-2 gap-2">
            <input type="number" min="0" aria-label="السعر" placeholder="السعر ج" disabled={editLink.kind !== 'ride'} value={editLink.fare}
              onChange={e => setEditLink({ ...editLink, fare: e.target.value })} className={`${inputCls} disabled:opacity-50`} />
            <input type="number" min="0" aria-label="الوقت" placeholder="الوقت د" value={editLink.minutes}
              onChange={e => setEditLink({ ...editLink, minutes: e.target.value })} className={inputCls} />
          </div>
          <input type="text" placeholder="ملاحظة" value={editLink.note} onChange={e => setEditLink({ ...editLink, note: e.target.value })} className={inputCls} />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={saveLinkEdit} className="h-11 bg-indigo-600 text-white rounded-xl text-xs font-black">حفظ التعديل</button>
            <button type="button" onClick={() => deleteLink(selectedLink)} className="h-11 bg-rose-600 text-white rounded-xl text-xs font-black flex items-center justify-center gap-1"><Trash2 size={13} /> حذف</button>
          </div>
        </div>
      );
    }

    // 5) تفاصيل نقطة مختارة
    if (selected) {
      const t = typeOf(selected);
      const myLinks = goodLinks.filter(l => l.fromId === selected.id || l.toId === selected.id);
      return (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2 border-b pb-2.5 dark:border-slate-700">
            <div className="min-w-0">
              <span className={`inline-block text-xs font-black px-2 py-0.5 rounded-lg border mb-1 ${t.badgeClass}`}>{t.label}</span>
              <h4 className={`font-black text-sm ${textPrimary}`}>{selected.name}</h4>
              <p className="text-xs font-bold text-indigo-500">📍 {selected.location}{hasExactCoords(selected) ? '' : ' • ⚠️ إحداثيات تقريبية'}</p>
            </div>
            <button type="button" aria-label="إغلاق" onClick={() => setSelectedId(null)} className="w-11 h-11 shrink-0 rounded-xl bg-slate-200 dark:bg-slate-700 flex items-center justify-center"><X size={14} /></button>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={() => { setMode('link'); setDraft(newDraft(selected.id)); }}
              className="min-h-11 bg-indigo-600 text-white rounded-xl text-xs font-black flex items-center justify-center gap-1"><Link2 size={13} /> ربط بنقطة</button>
            <button type="button" onClick={() => { setMode('move'); triggerToast(`اضغط على المكان الصحيح لنقل (${selected.name})`); }}
              className={`min-h-11 rounded-xl text-xs font-black border flex items-center justify-center gap-1 ${bgInput}`}><MapPin size={13} /> نقل بالدبوس</button>
          </div>

          <div className="space-y-1">
            <span className={`text-xs font-bold ${textSecondary} block`}>نوع النقطة:</span>
            <div className="grid grid-cols-2 gap-1">
              {NODE_TYPES.map(nt => (
                <button key={nt.id} type="button" onClick={() => handleChangeNodeType(selected.id, nt.id)}
                  className={`min-h-11 rounded-xl text-xs font-black border ${(selected.nodeType || 'station') === nt.id ? 'bg-indigo-600 text-white border-indigo-600' : bgInput}`}>{nt.short}</button>
              ))}
            </div>
          </div>

          {selected.transferHint && <p className={`text-xs font-bold leading-relaxed p-2.5 rounded-xl border ${cardBg} ${textSecondary}`}>🔄 {selected.transferHint}</p>}

          <div className="space-y-1.5">
            <span className={`text-xs font-black ${textSecondary} block`}>روابط التبادل ({myLinks.length}):</span>
            {myLinks.length === 0
              ? <p className={`text-xs font-bold py-2 text-center ${textSecondary}`}>النقطة دي مش متربطة بأي نقطة 🔗</p>
              : myLinks.map(l => <LinkRow key={l.id} l={l} meId={selected.id} />)}
          </div>

          <div className="space-y-1.5">
            <span className={`text-xs font-black ${textSecondary} block`}>الخطوط المارة ({selected.routes?.length || 0}):</span>
            <div className="space-y-1 max-h-32 overflow-y-auto [&::-webkit-scrollbar]:hidden">
              {(selected.routes || []).map((r, i) => (
                <div key={i} className={`p-2 rounded-xl border flex items-center justify-between text-xs font-bold ${cardBg}`}>
                  <span className={`truncate ${textPrimary}`}>← {r.destinationDetails || r.destination}</span>
                  <span className="text-emerald-600 font-black shrink-0">{r.fare} ج</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    // 6) الافتراضي: صحة الشبكة + قائمة النقاط
    const problems = [
      { id: 'isolated', label: 'نقاط بدون أي روابط', list: analysis.isolated, tone: 'amber' },
      { id: 'weakHubs', label: 'تبادلية موصولة بأقل من 2', list: analysis.weakHubs, tone: 'amber' },
      { id: 'missingCoords', label: 'إحداثيات تقريبية / ناقصة', list: analysis.missingCoords, tone: 'amber' },
      { id: 'overlaps', label: 'دبابيس فوق بعض', list: analysis.overlaps.flat(), tone: 'amber' }
    ];
    const filteredByHealth = healthFilter ? (problems.find(p => p.id === healthFilter)?.list || []) : stationsList;
    const q = search.trim().toLowerCase();
    const listNodes = sortedNodes.filter(n => filteredByHealth.some(x => x.id === n.id) &&
      (!q || `${n.name} ${n.location || ''}`.toLowerCase().includes(q)));

    return (
      <div className="space-y-3">
        {pendingLinks.length > 0 && (
          <div className="p-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 space-y-2">
            <h4 className="font-black text-xs text-amber-700 flex items-center gap-1.5"><Sparkles size={14} /> اقتراحات روابط من المستخدمين ({pendingLinks.length})</h4>
            {pendingLinks.map(l => {
              const a = nodesById[l.fromId], b = nodesById[l.toId], k = kindOf(l.kind);
              return (
                <div key={l.id} className={`p-2.5 rounded-xl border space-y-2 ${cardBg}`}>
                  <button type="button" onClick={() => { setSelectedLinkId(l.id); setSelectedId(null); flyTo(a); }} className="w-full text-right space-y-0.5">
                    <p className={`text-xs font-black ${textPrimary}`}>{a.name} ⇄ {b.name}</p>
                    <p className={`text-xs font-bold ${textSecondary}`}>{k.short} • {l.kind === 'ride' ? `${l.fare} ج • ` : ''}{l.minutes || '؟'} د{l.note ? ` • ${l.note}` : ''}</p>
                    <p className={`text-xs font-bold ${textSecondary}`}>من: {l.suggestedByName || 'مستخدم'}</p>
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => approveLink(l)} className="h-11 bg-emerald-600 text-white rounded-xl text-xs font-black">اعتماد ✅</button>
                    <button type="button" onClick={() => rejectLink(l)} className="h-11 bg-rose-600 text-white rounded-xl text-xs font-black">رفض</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className={`p-3 rounded-2xl border space-y-1.5 ${cardBg}`}>
          <h4 className={`font-black text-xs flex items-center gap-1.5 ${textPrimary}`}><AlertTriangle size={14} className="text-amber-600" /> صحة الشبكة</h4>
          <p className={`text-xs font-bold ${textSecondary}`}>
            {analysis.components.length === 0 ? 'لسه مفيش نقاط متصلة' : `${analysis.components.length} مجموعة متصلة (الأكبر ${analysis.components[0].length} نقطة)`}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {problems.filter(p => p.list.length > 0).map(p => (
              <button key={p.id} type="button" onClick={() => setHealthFilter(healthFilter === p.id ? null : p.id)}
                className={`min-h-11 px-3 rounded-xl text-xs font-black border ${healthFilter === p.id ? 'bg-amber-600 text-white border-amber-600' : 'bg-amber-500/10 text-amber-700 border-amber-500/30'}`}>
                {p.label} ({p.list.length})
              </button>
            ))}
            {analysis.orphanLinks.length > 0 && (
              <button type="button" onClick={cleanOrphans} className="min-h-11 px-3 rounded-xl text-xs font-black border bg-rose-500/10 text-rose-600 border-rose-500/30">
                روابط يتيمة ({analysis.orphanLinks.length}) — تنظيف
              </button>
            )}
            {problems.every(p => p.list.length === 0) && analysis.orphanLinks.length === 0 && <span className="text-xs font-black text-emerald-600">✅ مفيش مشاكل ظاهرة</span>}
          </div>
        </div>

        <div className={`flex items-center gap-2 px-3 h-11 rounded-xl border ${bgInput}`}>
          <Search size={14} className="text-slate-400 shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ابحث عن نقطة..." aria-label="بحث"
            className="flex-1 bg-transparent outline-none text-xs font-bold" />
        </div>

        <div className="space-y-1.5">
          {listNodes.map(st => {
            const t = typeOf(st);
            return (
              <button key={st.id} type="button" onClick={() => { setSelectedId(st.id); setSelectedLinkId(null); flyTo(st); }}
                className={`w-full min-h-11 p-2.5 rounded-xl border text-right flex items-center justify-between gap-2 hover:border-indigo-500 transition-colors ${cardBg}`}>
                <div className="min-w-0">
                  <p className={`text-xs font-black truncate ${textPrimary}`}>{st.name}</p>
                  <p className={`text-xs font-bold ${textSecondary}`}>{st.location} • {(st.routes || []).length} خطوط • {analysis.degree[st.id] || 0} روابط</p>
                </div>
                <span className={`text-xs font-black px-2 py-0.5 rounded-lg border shrink-0 ${t.badgeClass}`}>{t.short}</span>
              </button>
            );
          })}
          {listNodes.length === 0 && <p className={`text-xs font-bold py-4 text-center ${textSecondary}`}>مفيش نتائج</p>}
        </div>
      </div>
    );
  };

  const bannerText = {
    add: '📍 اضغط على الخريطة لتحديد مكان النقطة الجديدة',
    move: `📍 اضغط على المكان الصحيح لنقل (${selected?.name || ''})`,
    link: !draft?.fromId ? '🔗 اختار النقطة الأولى' : !draft.toId ? `🔗 من: ${nodesById[draft.fromId]?.name} — اختار النقطة التانية` : '🔗 راجع بيانات الرابط واحفظه',
    plan: !plan.fromId ? '🧭 اختار نقطة البداية' : !plan.toId ? '🧭 اختار نقطة الوصول' : '🧭 المسار على الخريطة'
  }[mode];

  // ───────────── الواجهة ─────────────
  return (
    <div className="space-y-3">
      {/* الأدوات */}
      <div className={`p-3 rounded-2xl border space-y-2.5 ${isDarkMode ? 'bg-slate-800/70 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
        <div className="flex items-center gap-1.5 flex-wrap">
          <ModeBtn id="view" icon={<Navigation size={14} />}>استعراض</ModeBtn>
          <ModeBtn id="add" icon={<MapPin size={14} />}>إضافة نقطة</ModeBtn>
          <ModeBtn id="link" icon={<Link2 size={14} />}>ربط النقاط</ModeBtn>
          <ModeBtn id="plan" icon={<Route size={14} />}>تخطيط مسار</ModeBtn>
          <button type="button" disabled={isSeeding} onClick={onSeed}
            className="min-h-11 px-3 rounded-xl text-xs font-black flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
            {isSeeding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} داتا أكتوبر وزايد
          </button>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden">
          {[['links', showLinks, () => setShowLinks(!showLinks), `الروابط (${approvedCount})`],
            ['dest', showDestLines, () => setShowDestLines(!showDestLines), 'خطوط الوجهات']].map(([id, on, fn, label]) => (
            <button key={id} type="button" onClick={fn}
              className={`min-h-11 px-3 shrink-0 rounded-xl text-xs font-black border ${on ? 'bg-indigo-600/10 border-indigo-600/40 text-indigo-600' : `${bgInput} opacity-70`}`}>{label}</button>
          ))}
          <span className="w-px h-6 bg-slate-300 dark:bg-slate-700 shrink-0" />
          {[{ id: 'all', short: `الكل (${stationsList.length})` }, ...NODE_TYPES].map(nt => (
            <button key={nt.id} type="button" onClick={() => setTypeFilter(nt.id)}
              className={`min-h-11 px-3 shrink-0 rounded-xl text-xs font-black border ${typeFilter === nt.id ? 'bg-slate-800 text-white border-slate-800 dark:bg-white dark:text-slate-900 dark:border-white' : bgInput}`}>{nt.short}</button>
          ))}
        </div>
      </div>

      {linksError && (
        <div className="p-3 rounded-xl border border-rose-500/40 bg-rose-500/10 text-xs font-bold text-rose-600 leading-relaxed">
          تعذر تحميل الروابط. غالباً قواعد Firestore لسه مفيهاش collection الروابط ({LINKS_COLLECTION}) — راجع ملف firestore.rules المرفق.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-8 relative rounded-2xl overflow-hidden border-2 border-indigo-500/30 h-[420px] lg:h-[580px] bg-slate-900">
          {!ready && !failed && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white z-20 bg-slate-900/80">
              <Loader2 size={30} className="animate-spin text-indigo-400" />
              <span className="text-xs font-bold">جاري تحميل محرك الخرائط...</span>
            </div>
          )}
          {failed && (
            <div className="absolute inset-0 flex items-center justify-center text-white z-20 bg-slate-900/90 p-6 text-center text-xs font-bold leading-relaxed">
              تعذر تحميل مكتبة الخرائط (Leaflet). تأكد من الاتصال بالإنترنت وأعد فتح التبويب.
            </div>
          )}
          <div ref={containerRef} className="absolute inset-0 z-10" dir="ltr" />

          {bannerText && (
            <div className="absolute top-3 right-3 left-14 z-[500] bg-slate-900/90 text-white ps-3.5 pe-1.5 py-1.5 rounded-xl border border-indigo-500/60 text-xs font-black flex items-center justify-between gap-2 shadow-lg">
              <span className="truncate">{bannerText}</span>
              <button type="button" onClick={() => switchMode('view')} className="min-h-11 px-3 shrink-0 text-indigo-300 hover:text-white text-xs font-black">إنهاء</button>
            </div>
          )}

          {/* مفتاح الخريطة */}
          <div className="absolute bottom-3 right-3 z-[500] bg-white/95 dark:bg-slate-900/95 rounded-xl border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 space-y-0.5 pointer-events-none">
            {LINK_KINDS.map(k => (
              <div key={k.id} className="flex items-center gap-1.5">
                <span className="inline-block w-5 h-0 border-t-[3px]" style={{ borderColor: k.color, borderTopStyle: k.dashArray ? 'dotted' : 'solid' }} />
                {k.short}
              </div>
            ))}
          </div>
        </div>

        <div className={`lg:col-span-4 p-3.5 rounded-2xl border overflow-y-auto max-h-[520px] lg:max-h-[580px] [&::-webkit-scrollbar]:hidden ${isDarkMode ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
          {renderPanel()}
        </div>
      </div>
    </div>
  );
};

export default GisMapTab;
