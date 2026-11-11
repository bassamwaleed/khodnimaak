import React, { useState, useMemo } from 'react';
import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { db, USERS_COLLECTION } from '../firebase';
import { uploadVerificationImage, isDataUrl } from '../utils/verification';

const FIELDS = [
  { field: 'idFront', side: 'front', pathField: 'idFrontPath' },
  { field: 'idBack', side: 'back', pathField: 'idBackPath' },
  { field: 'licenseImage', side: 'license', pathField: 'licensePath' }
];

// نقل صور التوثيق القديمة (base64 داخل Firestore) إلى Storage الخاص — بيشتغل من حساب الأدمن
const VerificationMigration = ({ usersList = [], isDarkMode, triggerToast }) => {
  const legacy = useMemo(() => usersList.filter(u => FIELDS.some(f => isDataUrl(u[f.field]))), [usersList]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, failed: 0 });

  const run = async () => {
    if (!legacy.length) return;
    if (!window.confirm(`نقل صور توثيق ${legacy.length} مستخدم إلى Storage وحذفها من Firestore؟`)) return;
    setRunning(true);
    setProgress({ done: 0, failed: 0 });
    let done = 0, failed = 0;
    for (const u of legacy) {
      try {
        const updates = {};
        for (const { field, side, pathField } of FIELDS) {
          if (isDataUrl(u[field])) {
            updates[pathField] = await uploadVerificationImage(u.id, side, u[field]);
            updates[field] = deleteField(); // يتحذف من Firestore فقط بعد نجاح الرفع
          }
        }
        await updateDoc(doc(db, USERS_COLLECTION, u.id), updates);
        done++;
      } catch (e) {
        console.error('migration failed for', u.id, e);
        failed++;
      }
      setProgress({ done, failed });
    }
    setRunning(false);
    triggerToast(failed ? `تم نقل ${done} وفشل ${failed} — راجع قواعد Storage` : `تم نقل صور ${done} مستخدم بأمان ✅`);
  };

  const ok = legacy.length === 0;
  return (
    <div className={`p-3.5 rounded-2xl border space-y-2 ${ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
      <h4 className={`font-black text-sm flex items-center gap-1.5 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
        <ShieldCheck size={16} className={ok ? 'text-emerald-600' : 'text-amber-600'} /> أمان صور التوثيق
      </h4>
      <p className={`text-xs font-bold leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
        {ok ? 'كل صور البطاقات والرخص محفوظة في Storage الخاص ✅'
          : `${legacy.length} مستخدم لسه صور بطاقاتهم محفوظة داخل Firestore (ممكن تتقري من حسابات تانية حسب القواعد). انقلها لـ Storage الخاص.`}
      </p>
      {!ok && (
        <button type="button" onClick={run} disabled={running}
          className="w-full h-11 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white rounded-xl text-xs font-black flex items-center justify-center gap-1.5">
          {running ? <><Loader2 size={14} className="animate-spin" /> {progress.done + progress.failed} / {legacy.length}</> : 'نقل الصور إلى Storage الآن'}
        </button>
      )}
    </div>
  );
};

export default VerificationMigration;
