import React, { useState, useMemo } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { X, Link2, Loader2 } from 'lucide-react';
import { db, LINKS_COLLECTION } from '../firebase';
import { LINK_KINDS, SUGGEST_WALK_KM } from '../utils/gisConstants';
import { linkDocId, distanceBetween, estimateMinutes } from '../utils/gis';

// اقتراح رابط تبادل بين نقطتين من المستخدم — بيتسجل pending لحد ما الأدمن يوافق
const SuggestLinkModal = ({ user, stations = [], links = [], initialFromId = '', initialToId = '', isDarkMode, onClose, triggerToast }) => {
  const [fromId, setFromId] = useState(initialFromId || '');
  const [toId, setToId] = useState(initialToId || '');
  const [kind, setKind] = useState('ride');
  const [fare, setFare] = useState('');
  const [minutes, setMinutes] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const nodes = useMemo(
    () => stations.filter(s => s.status !== 'pending').sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar')),
    [stations]
  );
  const byId = useMemo(() => Object.fromEntries(nodes.map(n => [n.id, n])), [nodes]);
  const dist = fromId && toId ? distanceBetween(byId[fromId], byId[toId]) : null;

  const bgCard = isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900';
  const bgInput = isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-900';
  const textSecondary = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const inputCls = `w-full h-11 px-3 rounded-xl border text-sm font-bold outline-none ${bgInput}`;

  const pickKind = (k) => {
    setKind(k);
    if (k !== 'ride') setFare('');
    if (!minutes) { const est = estimateMinutes(k, dist); if (est) setMinutes(String(est)); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!fromId || !toId || fromId === toId) return triggerToast('اختار نقطتين مختلفتين');
    if (kind === 'ride' && fare === '') return triggerToast('اكتب سعر المواصلة');
    const id = linkDocId(fromId, toId, false);
    if (links.some(l => l.id === id)) return triggerToast('في رابط (أو اقتراح مستني المراجعة) بين النقطتين دول بالفعل');
    setSaving(true);
    try {
      const mins = Number(minutes) > 0 ? Math.min(Number(minutes), 600) : estimateMinutes(kind, dist);
      await setDoc(doc(db, LINKS_COLLECTION, id), {
        fromId, toId, kind,
        fare: kind === 'ride' ? Math.min(Math.max(Number(fare) || 0, 0), 500) : 0,
        minutes: mins ?? null,
        note: note.trim().slice(0, 200),
        oneWay: false,
        distanceKm: dist != null ? Number(dist.toFixed(2)) : null,
        status: 'pending',
        suggestedBy: user.uid,
        suggestedByName: (user.displayName || '').slice(0, 60),
        createdBy: user.uid,
        createdAt: Date.now(), updatedAt: Date.now()
      });
      triggerToast('شكراً! اقتراحك وصل للإدارة وهيظهر بعد المراجعة 🙏');
      onClose();
    } catch (err) {
      console.error(err);
      triggerToast('تعذر إرسال الاقتراح، حاول تاني');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-sm z-[1300] flex justify-center items-end sm:items-center p-0 sm:p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()}
        className={`${bgCard} w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl shadow-2xl border p-5 space-y-3.5 animate-fade-in-up`}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-black flex items-center gap-2 text-indigo-600 dark:text-indigo-400"><Link2 size={20} /> اقترح رابط تبادل</h2>
          <button type="button" aria-label="إغلاق" onClick={onClose} className="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center"><X size={18} /></button>
        </div>
        <p className={`text-xs font-bold leading-relaxed ${textSecondary}`}>
          عارف إزاي تروح من موقف لموقف تاني (مشي أو مواصلة مباشرة)؟ اقترحه وبعد ما الإدارة تراجعه هيظهر للكل في «وصلني من أ لـ ب».
        </p>

        <select required value={fromId} onChange={e => setFromId(e.target.value)} className={inputCls} aria-label="من">
          <option value="" disabled>من نقطة...</option>
          {nodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
        <select required value={toId} onChange={e => setToId(e.target.value)} className={inputCls} aria-label="إلى">
          <option value="" disabled>إلى نقطة...</option>
          {nodes.filter(n => n.id !== fromId).map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>

        {dist != null && (
          <p className={`text-xs font-bold ${textSecondary}`}>
            المسافة المباشرة: {dist < 1 ? `${Math.round(dist * 1000)} م` : `${dist.toFixed(1)} كم`}
            {dist <= SUGGEST_WALK_KM ? ' — قريبة، غالباً مشي' : ''}
          </p>
        )}

        <div className="grid grid-cols-3 gap-1.5">
          {LINK_KINDS.map(k => (
            <button key={k.id} type="button" onClick={() => pickKind(k.id)}
              className={`min-h-11 px-1 rounded-xl text-xs font-black border ${kind === k.id ? 'bg-indigo-600 text-white border-indigo-600' : bgInput}`}>{k.short}</button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <input type="number" min="0" max="500" inputMode="numeric" placeholder="السعر (ج)" aria-label="السعر"
            disabled={kind !== 'ride'} value={fare} onChange={e => setFare(e.target.value)} className={`${inputCls} disabled:opacity-50`} />
          <input type="number" min="0" max="600" inputMode="numeric" placeholder="الوقت (دقيقة)" aria-label="الوقت"
            value={minutes} onChange={e => setMinutes(e.target.value)} className={inputCls} />
        </div>
        <input type="text" maxLength={200} placeholder="ملاحظة (مثال: اطلع سلم الدائري واركب...)" value={note}
          onChange={e => setNote(e.target.value)} className={inputCls} />

        <button type="submit" disabled={saving}
          className="w-full h-12 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-xl font-black text-sm flex items-center justify-center gap-2">
          {saving ? <Loader2 size={18} className="animate-spin" /> : 'إرسال الاقتراح للمراجعة'}
        </button>
      </form>
    </div>
  );
};

export default SuggestLinkModal;
