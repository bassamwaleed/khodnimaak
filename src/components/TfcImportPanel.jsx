import React, { useState } from 'react';
import { collection, getDocs, doc, writeBatch, setDoc } from 'firebase/firestore';
import { db, STATIONS_COLLECTION, LINKS_COLLECTION } from '../firebase';
import { IMPORT_POINTER } from '../utils/importGate';
import { toTyped, fromTyped } from '../utils/typedJson';

// استيراد TfC: معاينة بدون أي كتابة، نسخة احتياطية مكتوبة الأنواع، كتابة الدفعة مخفية، ثم تفعيل بوثيقة واحدة.
// خطوات ١-٤ ما بتمسحش ولا بتعدّل أي وثيقة قديمة. خطوة ٥ (حذف القديم) اختيارية وبتحتاج نسخة احتياطية اتنزلت
// في نفس الجلسة وتفعيل الدفعة. الاسترداد: ارفع ملف النسخة الاحتياطية فبيرجّع القديم بنفس الـids والأنواع ويوقف TfC.
const download = (name, obj) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj)], { type: 'application/json' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const CHUNK = 400;

const TfcImportPanel = ({ triggerToast, isDarkMode }) => {
  const [net, setNet] = useState(null);
  const [backedUp, setBackedUp] = useState(false);
  const [busy, setBusy] = useState('');
  const [written, setWritten] = useState(null);
  const [oldIds, setOldIds] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [activated, setActivated] = useState(false);
  const [msg, setMsg] = useState('');
  const card = isDarkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-800';
  const btn = 'min-h-11 px-3 rounded-xl text-xs font-black border disabled:opacity-40';

  const preview = async () => {
    const m = await import('../data/tfcNetwork.json'); setNet(m.default || m);
  };
  const backup = async () => {
    setBusy('backup');
    try {
      const [s, l] = await Promise.all([getDocs(collection(db, STATIONS_COLLECTION)), getDocs(collection(db, LINKS_COLLECTION))]);
      const snap = { version: 1, exportedAt: new Date().toISOString(),
        stations: s.docs.map(d => ({ id: d.id, data: toTyped(d.data()) })),
        links: l.docs.map(d => ({ id: d.id, data: toTyped(d.data()) })) };
      if (!snap.stations.length || !snap.links.length) throw new Error('empty');
      download(`tareqna-gis-backup-${Date.now()}.json`, snap);
      setSnapshot(snap);
      setOldIds([...s.docs, ...l.docs].filter(d => !d.data().importBatch).map(d => d.id));
      setBackedUp(true); triggerToast(`نسخة: ${snap.stations.length} نقطة و ${snap.links.length} رابط ✅`);
    } catch (e) { triggerToast('تعذر عمل النسخة الاحتياطية'); }
    setBusy('');
  };
  const writeBatchDocs = async () => {
    if (!net || !backedUp) return;
    if (!window.confirm(`كتابة ${net.nodes.length} نقطة و ${net.links.length} رابط كدفعة مخفية (${net.batch}). مفيش حاجة هتظهر لحد التفعيل.`)) return;
    setBusy('write');
    try {
      const now = Date.now();
      const ops = [
        ...net.nodes.map(n => b => b.set(doc(db, STATIONS_COLLECTION, n.id), {
          name: n.name, nodeType: 'stop', location: '', governorate: 'القاهرة الكبرى', lat: n.lat, lng: n.lng,
          mapUrl: `https://www.google.com/maps?q=${n.lat},${n.lng}`, status: 'approved', addedBy: 'tfc-import',
          routes: [], crowdStatus: 'normal', crowdUpdatedAt: now, source: n.source, importBatch: net.batch })),
        ...net.links.map(l => b => b.set(doc(db, LINKS_COLLECTION, l.id), {
          fromId: l.fromId, toId: l.toId, kind: 'ride', fare: null, minutes: null, note: '', oneWay: true,
          status: 'approved', createdBy: 'tfc-import', createdAt: now, updatedAt: now, source: l.source,
          routeId: l.routeId, routeName: l.routeName, seq: l.seq, importBatch: net.batch }))
      ];
      for (let i = 0; i < ops.length; i += CHUNK) {
        const b = writeBatch(db); ops.slice(i, i + CHUNK).forEach(f => f(b)); await b.commit();
      }
      const manifest = { batch: net.batch, writtenAt: new Date().toISOString(), stationIds: net.nodes.map(n => n.id), linkIds: net.links.map(l => l.id) };
      download(`tareqna-import-manifest-${net.batch}.json`, manifest);
      setWritten(manifest); triggerToast('اتكتبت الدفعة (لسه مخفية) ✅');
    } catch (e) { console.error(e); setMsg('فشلت الكتابة في النص. الدفعة لسه مخفية والمؤشر ما اتكتبش. تقدر تعيد الكتابة (نفس الـ ids بتتكتب فوق نفسها).'); triggerToast('فشلت الكتابة. الدفعة مخفية'); }
    setBusy('');
  };
  const activate = async () => {
    if (!written || !window.confirm('تفعيل الدفعة دلوقتي؟ هتظهر لكل المستخدمين مرة واحدة والشبكة القديمة هتتخفى (مش هتتمسح).')) return;
    setBusy('activate');
    try { await setDoc(doc(db, ...IMPORT_POINTER), { activeBatch: written.batch, hiddenIds: oldIds || [], activatedAt: Date.now() }); setActivated(true); triggerToast('تم التفعيل ✅'); }
    catch (e) { setMsg('تعذر التفعيل (صلاحية أو شبكة). مفيش حاجة ظهرت.'); triggerToast('تعذر التفعيل'); }
    setBusy('');
  };
  const deactivate = async () => {
    if (!window.confirm('إيقاف الدفعة المستوردة؟ الداتا القديمة هترجع لوحدها.')) return;
    try { await setDoc(doc(db, ...IMPORT_POINTER), { activeBatch: null, hiddenIds: [], deactivatedAt: Date.now() }); triggerToast('اتوقفت الدفعة ✅'); }
    catch (e) { setMsg('تعذر الإيقاف.'); triggerToast('تعذر الإيقاف'); }
  };

  const commitChunks = async (ops) => {
    for (let i = 0; i < ops.length; i += CHUNK) {
      const b = writeBatch(db); ops.slice(i, i + CHUNK).forEach(f => f(b)); await b.commit();
    }
  };
  // ٥. حذف الشبكة القديمة نهائياً من Firestore (الوثائق اللي مفيهاش importBatch وكانت في النسخة الاحتياطية بس).
  // الرجوع بعدها بالاسترداد من ملف النسخة.
  const deleteOld = async () => {
    if (!snapshot || !activated || busy) return;
    const isOld = (x) => !(x.data && x.data.importBatch);
    const stIds = snapshot.stations.filter(isOld).map(x => x.id);
    const lkIds = snapshot.links.filter(isOld).map(x => x.id);
    if (!stIds.length && !lkIds.length) return triggerToast('مفيش شبكة قديمة تتحذف');
    const typed = window.prompt(`هيتحذف نهائياً ${stIds.length} نقطة و ${lkIds.length} رابط قديم. ملف النسخة الاحتياطية اللي نزل هو طريقك الوحيد للرجوع، اتأكد إنه محفوظ عندك. اكتب: حذف`);
    if (typed !== 'حذف') return;
    setBusy('delete'); setMsg('');
    try {
      await commitChunks([
        ...lkIds.map(id => b => b.delete(doc(db, LINKS_COLLECTION, id))),
        ...stIds.map(id => b => b.delete(doc(db, STATIONS_COLLECTION, id)))
      ]);
      setOldIds([]); triggerToast('اتحذفت الشبكة القديمة ✅ (الرجوع من ملف النسخة)');
    } catch (e) { console.error(e); setMsg('الحذف وقف في النص (صلاحيات أو شبكة). اللي اتحذف بالفعل ممكن تسترده من ملف النسخة، وتقدر تعيد الحذف.'); triggerToast('فشل الحذف'); }
    setBusy('');
  };
  // استرداد: يقرأ ملف النسخة الاحتياطية، يكتب القديم بنفس الـids والأنواع، ثم يوقف دفعة TfC (القديم يرجع ظاهر).
  const restore = async (e) => {
    const file = e.target.files && e.target.files[0]; e.target.value = '';
    if (!file || busy) return;
    setBusy('restore'); setMsg('');
    try {
      const snap = JSON.parse(await file.text());
      if (snap.version !== 1 || !Array.isArray(snap.stations) || !Array.isArray(snap.links)
        || ![...snap.stations, ...snap.links].every(x => x && typeof x.id === 'string' && x.data && typeof x.data === 'object')) throw new Error('bad file');
      if (!window.confirm(`استرداد ${snap.stations.length} نقطة و ${snap.links.length} رابط من نسخة ${snap.exportedAt || ''}؟ هتتكتب فوق نفس الـids وبعدها دفعة TfC هتتوقف وتتخفى (مش هتتمسح).`)) { setBusy(''); return; }
      await commitChunks([
        ...snap.stations.map(x => b => b.set(doc(db, STATIONS_COLLECTION, x.id), fromTyped(x.data))),
        ...snap.links.map(x => b => b.set(doc(db, LINKS_COLLECTION, x.id), fromTyped(x.data)))
      ]);
      await setDoc(doc(db, ...IMPORT_POINTER), { activeBatch: null, hiddenIds: [], restoredAt: Date.now() });
      setActivated(false); triggerToast('تم الاسترداد ✅');
    } catch (err) { console.error(err); setMsg('تعذر الاسترداد: الملف مش نسخة صالحة أو فشلت الكتابة. تقدر تعيد المحاولة (نفس الـids بتتكتب فوق نفسها).'); triggerToast('تعذر الاسترداد'); }
    setBusy('');
  };
  return (
    <div dir="rtl" className={`rounded-2xl border p-3 space-y-2 ${card}`}>
      <div className="text-sm font-black">استيراد شبكة TfC (2025، CC BY 4.0)</div>
      <button type="button" className={btn} onClick={preview}>١. معاينة (من غير كتابة)</button>
      {net && <div className="text-xs font-bold leading-6">{net.nodes.length} نقطة • {net.links.length} وصلة • {new Set(net.links.map(l => l.routeId)).size} خط. الأجرة والمدة: غير معروفة. الدفعة: {net.batch}</div>}
      <button type="button" className={btn} disabled={!net || busy} onClick={backup}>٢. نسخة احتياطية مكتوبة الأنواع {backedUp ? '✅' : ''}</button>
      <button type="button" className={btn} disabled={!net || !backedUp || busy || !!written} onClick={writeBatchDocs}>٣. كتابة الدفعة (مخفية)</button>
      <button type="button" className={btn} disabled={!written || !oldIds || busy} onClick={activate}>٤. تفعيل</button>
      {msg && <div id="panel-msg" className="text-xs font-bold text-rose-600">{msg}</div>}
      <button type="button" className={`${btn} text-rose-600`} disabled={!snapshot || !activated || !!busy} onClick={deleteOld}>٥. حذف الشبكة القديمة نهائياً (اختياري)</button>
      <label className={`${btn} inline-flex items-center cursor-pointer ${busy ? 'opacity-40 pointer-events-none' : ''}`}>
        استرداد من ملف نسخة احتياطية
        <input type="file" accept="application/json,.json" className="hidden" onChange={restore} />
      </label>
      <div className="text-[11px] opacity-70">التفعيل بيخفي الشبكة القديمة (مش بيمسحها) ويظهر المستوردة. الرجوع بزرار الإيقاف. لو حذفتها (٥) الرجوع بالاسترداد من ملف النسخة.</div>
      <button type="button" className={btn} onClick={deactivate}>إيقاف الدفعة المستوردة (رجوع للقديم)</button>
    </div>
  );
};
export default TfcImportPanel;
