import { useEffect, useMemo, useState, useCallback } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { buildNetwork, stationLabel, normNoAl } from './tfc';
import { getPlaceCoords } from './helpers';

export const TFC_DOC = ['tareqna_config', 'tfc'];
let rawPromise = null;
const loadRaw = () => rawPromise || (rawPromise = fetch('/tfc.json')
  .then(r => { if (!r.ok) throw new Error('tfc.json'); return r.json(); })
  .catch(e => { rawPromise = null; throw e; }));

export const useTfc = (firestoreStations = [], firestoreLinks = []) => {
  const [raw, setRaw] = useState(null);
  const [error, setError] = useState('');
  const [ov, setOv] = useState({});

  useEffect(() => {
    let alive = true;
    loadRaw().then(r => alive && setRaw(r)).catch(() => alive && setError('تعذر تحميل ملف الشبكة (tfc.json)'));
    return () => { alive = false; };
  }, []);

  useEffect(() => onSnapshot(
    doc(db, ...TFC_DOC),
    s => setOv(s.exists() ? s.data() : {}),
    () => { /* وضع القراءة فقط من الملف المحلي */ }
  ), []);

  // دمج مواقف وخطوط وروابط Firestore تلقائياً مع تعديلات الأدمن قبل بناء الشبكة
  const mergedOv = useMemo(() => {
    const baseCustomStations = [...(ov.customStations || [])];
    const baseCustomRoutes = [...(ov.customRoutes || [])];
    const stationIdByName = new Map();

    baseCustomStations.forEach(s => {
      const k = normNoAl(s.ar || s.name);
      if (k) stationIdByName.set(k, s.id);
    });

    const getOrCreateFsStation = (name, loc = '', lat = null, lng = null, explicitId = null) => {
      const cleanName = String(name || '').trim();
      if (!cleanName) return null;
      const k = normNoAl(cleanName);
      if (stationIdByName.has(k)) return stationIdByName.get(k);

      const id = explicitId || `fs_st_${k.replace(/\s+/g, '_')}`;
      const coords = (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Number(lat) !== 0)
        ? [Number(lat), Number(lng)]
        : getPlaceCoords({ name: cleanName, location: loc || cleanName });

      baseCustomStations.push({
        id,
        name: cleanName,
        ar: cleanName,
        lat: coords[0],
        lng: coords[1],
        aliases: loc && loc !== cleanName ? [loc] : []
      });
      stationIdByName.set(k, id);
      return id;
    };

    // 1. إضافة مواقف Firestore وخطوطها المباشرة
    (firestoreStations || []).forEach(st => {
      if (!st || st.status === 'rejected' || st.status === 'pending') return;
      const fromId = getOrCreateFsStation(st.name, st.location, st.lat, st.lng, `fs_${st.id}`);
      if (!fromId) return;

      (st.routes || []).forEach((r, idx) => {
        if (r.status === 'pending' || r.status === 'rejected') return;
        const destName = r.destinationDetails || r.destination;
        if (!destName) return;
        const toId = getOrCreateFsStation(destName, st.location);
        if (!toId || fromId === toId) return;

        baseCustomRoutes.push({
          id: `fs_rt_${st.id}_${idx}`,
          name: `موقف ${st.name} - ${destName}`,
          type: 'ميكروباص',
          stops: [fromId, toId],
          fare: r.fare !== undefined && r.fare !== '' ? Number(r.fare) : null,
          twoWay: true
        });
      });
    });

    // 2. إضافة روابط الخريطة (GIS Links) المرسومة من الأدمن
    (firestoreLinks || []).forEach((lnk, idx) => {
      if (!lnk || lnk.kind === 'walk') return;
      const fromId = `fs_${lnk.fromId}`;
      const toId = `fs_${lnk.toId}`;
      baseCustomRoutes.push({
        id: `fs_lnk_${lnk.id || idx}`,
        name: lnk.note || 'خط مواصلات مباشر',
        type: lnk.mode || 'ميكروباص',
        stops: [fromId, toId],
        fare: lnk.fare !== undefined && lnk.fare !== '' ? Number(lnk.fare) : null,
        totalMinutes: lnk.minutes ? Number(lnk.minutes) : null,
        twoWay: !lnk.oneWay
      });
    });

    return {
      ...ov,
      customStations: baseCustomStations,
      customRoutes: baseCustomRoutes
    };
  }, [ov, firestoreStations, firestoreLinks]);

  const net = useMemo(() => (raw ? buildNetwork(raw, mergedOv) : null), [raw, mergedOv]);

  const save = useCallback(async (next) => {
    const payload = { ...JSON.parse(JSON.stringify(next)), updatedAt: Date.now() };
    const sizeBytes = new Blob([JSON.stringify(payload)]).size;
    if (sizeBytes > 950000) {
      throw new Error('حجم التعديلات اقترب من حد Firestore (1MB). صدّر ملف tfc.json واستبدله في المشروع.');
    }
    return setDoc(doc(db, ...TFC_DOC), payload);
  }, []);

  const exportMergedJson = useCallback(() => {
    if (!net) return null;
    const stations = [...net.stations.values()].map(s => [
      s.id,
      s.name,
      Number(s.lat.toFixed(6)),
      Number(s.lng.toFixed(6)),
      stationLabel(s)
    ]);
    const routes = net.patterns
      .filter(p => p.id.endsWith('|0') || !p.id.includes('|'))
      .map(p => ({
        r: p.routeId,
        d: 0,
        n: p.name,
        t: p.type,
        s: p.stops
      }));
    return JSON.stringify({ stations, routes, exportedAt: new Date().toISOString() });
  }, [net]);

  return { net, raw, ov, error, save, exportMergedJson };
};