import React, { useState } from 'react';
import { collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { db, STATIONS_COLLECTION, LINKS_COLLECTION } from '../firebase';
import { linkDocId } from '../utils/gis';

// استيراد ملف داتا (JSON) للنقاط والروابط. الملف: { "stations": [...], "links": [...] }  (أو "nodes" بدل "stations").
// المصدر: ملف الموقع public/network.json أو أي ملف تختاره من جهازك. من غير تعديل كود.
// ربط = يضيف/يحدّث بنفس الـid ويسيب الباقي. استبدال = يكتب الجديد الأول وبعدين يمسح القديم (ونسخة القديم بتنزل كملف بنفس الصيغة).
const CHUNK = 400;
const inEgypt = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= 22 && lat <= 32 && lng >= 24 && lng <= 37;
const download = (name, obj) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj)], { type: 'application/json' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const commit = async (ops) => {
  for (let i = 0; i < ops.length; i += CHUNK) {
    const b = writeBatch(db); ops.slice(i, i + CHUNK).forEach(f => f(b)); await b.commit();
  }
};

const DataImportPanel = ({ triggerToast, isDarkMode, user }) => {
  const [data, setData] = useState(null);   // { stations, links, skipped, name }
  const [mode, setMode] = useState('merge');
  const [noLinks, setNoLinks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const card = isDarkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-800';
  const btn = 'min-h-11 px-3 rounded-xl text-xs font-black border disabled:opacity-40';

  const load = (raw, name) => {
    setMsg('');
    try {
      const stationsIn = raw.stations || raw.nodes;
      if (!Array.isArray(stationsIn) || !Array.isArray(raw.links)) throw new Error('shape');
      let skipped = 0;
      const stations = [];
      stationsIn.forEach(n => {
        const lat = Number(n.lat), lng = Number(n.lng);
        if (!n || typeof n.name !== 'string' || !n.name.trim() || !inEgypt(lat, lng)) { skipped++; return; }
        stations.push({ ...n, lat, lng, name: n.name.trim() });
      });
      const links = [];
      raw.links.forEach(l => {
        if (!l || typeof l.fromId !== 'string' || typeof l.toId !== 'string' || l.fromId === l.toId) { skipped++; return; }
        links.push(l);
      });
      setData({ stations, links, skipped, name, batch: raw.batch || null });
    } catch (e) { setData(null); setMsg('الملف مش بالصيغة المطلوبة: { "stations": [...], "links": [...] }'); }
  };
  const fromDevice = async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { load(JSON.parse(await f.text()), f.name); } catch { setData(null); setMsg('الملف مش JSON صالح'); }
  };
  const fromSite = async () => {
    try { const r = await fetch('/network.json', { cache: 'no-store' }); if (!r.ok) throw new Error(); load(await r.json(), 'network.json (الموقع)'); }
    catch { setData(null); setMsg('مفيش ملف network.json في الموقع'); }
  };

  const run = async () => {
    if (!data || busy) return;
    const links = noLinks ? [] : data.links;
    if (mode === 'replace') {
      if (window.prompt(`هيتمسح كل النقاط والروابط الحالية وتتحط ${data.stations.length} نقطة و ${links.length} رابط من الملف. نسخة القديم هتنزل كملف الأول. اكتب: مسح`) !== 'مسح') return;
    } else if (!window.confirm(`إضافة/تحديث ${data.stations.length} نقطة و ${links.length} رابط مع الموجود؟`)) return;
    setBusy(true); setMsg('');
    try {
      const now = Date.now(), who = user?.uid || 'admin';
      const stationOps = [], linkOps = [];
      const newStIds = new Set(), newLkIds = new Set();
      data.stations.forEach(n => {
        const ref = n.id ? doc(db, STATIONS_COLLECTION, String(n.id)) : doc(collection(db, STATIONS_COLLECTION));
        newStIds.add(ref.id);
        stationOps.push(b => b.set(ref, {
          name: n.name, nodeType: n.nodeType || 'stop', location: n.location || '', governorate: n.governorate || 'القاهرة الكبرى',
          lat: n.lat, lng: n.lng, mapUrl: `https://www.google.com/maps?q=${n.lat},${n.lng}`,
          status: 'approved', addedBy: who, routes: Array.isArray(n.routes) ? n.routes : [],
          crowdStatus: 'normal', crowdUpdatedAt: now,
          ...(n.source ? { source: String(n.source) } : {}), ...(data.batch ? { importBatch: data.batch } : {})
        }));
      });
      links.forEach(l => {
        const oneWay = !!l.oneWay;
        const id = l.id ? String(l.id) : linkDocId(l.fromId, l.toId, oneWay);
        newLkIds.add(id);
        const fare = l.fare === null || l.fare === undefined || l.fare === '' ? null : Number(l.fare);
        const minutes = l.minutes === null || l.minutes === undefined || l.minutes === '' ? null : Number(l.minutes);
        linkOps.push(b => b.set(doc(db, LINKS_COLLECTION, id), {
          fromId: l.fromId, toId: l.toId, kind: ['walk', 'ride', 'same'].includes(l.kind) ? l.kind : 'ride',
          fare: Number.isFinite(fare) ? fare : null, minutes: Number.isFinite(minutes) ? minutes : null,
          note: typeof l.note === 'string' ? l.note.slice(0, 200) : '', oneWay,
          status: 'approved', approvedBy: who, createdBy: who, createdAt: now, updatedAt: now,
          ...(l.source ? { source: String(l.source) } : {}),
          ...(l.routeId ? { routeId: String(l.routeId) } : {}), ...(l.routeName ? { routeName: String(l.routeName) } : {}),
          ...(Number.isFinite(Number(l.seq)) && l.seq !== undefined ? { seq: Number(l.seq) } : {}),
          ...(data.batch ? { importBatch: data.batch } : {})
        }));
      });
      let removed = 0;
      let oldStale = { stations: [], links: [] };
      if (mode === 'replace') {
        const [s, l] = await Promise.all([getDocs(collection(db, STATIONS_COLLECTION)), getDocs(collection(db, LINKS_COLLECTION))]);
        const plain = (d) => JSON.parse(JSON.stringify({ id: d.id, ...d.data() }));
        download(`gis-backup-${now}.json`, { stations: s.docs.map(plain), links: l.docs.map(plain) });
        oldStale = { stations: s.docs.filter(d => !newStIds.has(d.id)), links: l.docs.filter(d => !newLkIds.has(d.id)) };
      }
      await commit([...stationOps, ...linkOps]);                       // الجديد الأول: لو فشل في النص مفيش حاجة قديمة اتمسحت
      if (mode === 'replace') {
        await commit([...oldStale.links, ...oldStale.stations].map(d => b => b.delete(d.ref)));
        removed = oldStale.links.length + oldStale.stations.length;
      }
      triggerToast(`تم ✅ ${data.stations.length} نقطة • ${links.length} رابط${mode === 'replace' ? ` • اتمسح ${removed} قديم` : ''}`);
      setData(null);
    } catch (e) { console.error(e); setMsg('وقف في النص (صلاحيات أو شبكة). الكتابة بنفس الـids فتقدر تعيد المحاولة، ومفيش قديم اتمسح قبل ما الجديد يتكتب كامل.'); triggerToast('فشل الاستيراد'); }
    setBusy(false);
  };

  return (
    <div dir="rtl" className={`rounded-2xl border p-3 space-y-2 ${card}`}>
      <div className="text-sm font-black">استيراد داتا (نقاط وروابط)</div>
      <div className="flex gap-1.5 flex-wrap">
        <button type="button" className={btn} onClick={fromSite}>ملف الموقع (network.json)</button>
        <label className={`${btn} inline-flex items-center cursor-pointer`}>
          اختار ملف من جهازك
          <input type="file" accept="application/json,.json" className="hidden" onChange={fromDevice} />
        </label>
      </div>
      {data && (
        <div className="space-y-2">
          <div className="text-xs font-bold leading-6">{data.name}: {data.stations.length} نقطة • {data.links.length} رابط{data.skipped ? ` • اتجاهل ${data.skipped} غير صالح` : ''}</div>
          <label className="flex items-center gap-2 text-xs font-bold"><input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} /> ربط مع الموجود</label>
          <label className="flex items-center gap-2 text-xs font-bold"><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> مسح الموجود وإضافة الجديد</label>
          <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={noLinks} onChange={e => setNoLinks(e.target.checked)} /> نقاط بس من غير روابط (قراءات أقل)</label>
          <button type="button" className={`${btn} ${mode === 'replace' ? 'text-rose-600' : ''}`} disabled={busy} onClick={run}>{busy ? 'جاري...' : 'تنفيذ'}</button>
        </div>
      )}
      {msg && <div className="text-xs font-bold text-rose-600">{msg}</div>}
    </div>
  );
};
export default DataImportPanel;
