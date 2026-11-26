import React, { useState, useMemo } from 'react';
import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { ShieldCheck, Loader2, Trash2, AlertTriangle } from 'lucide-react';
import { db, USERS_COLLECTION } from '../firebase';
import { uploadVerificationImage, isDataUrl } from '../utils/verification';

const FIELDS = [
  { field: 'idFront', side: 'front', pathField: 'idFrontPath' },
  { field: 'idBack', side: 'back', pathField: 'idBackPath' },
  { field: 'licenseImage', side: 'license', pathField: 'licensePath' }
];

// مهلة زمنية 10 ثوانٍ لمنع تعليق الرفع للأبد إذا كان Storage غير مفعّل
const withTimeout = (promise, ms = 10000) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('انتهت مهلة الاتصال بـ Storage — تأكد من تفعيل Firebase Storage وقواعد الأمان')), ms))
  ]);

const VerificationMigration = ({ usersList = [], isDarkMode, triggerToast }) => {
  const legacy = useMemo(() => usersList.filter(u => FIELDS.some(f => isDataUrl(u[f.field]))), [usersList]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, failed: 0 });
  const [lastError, setLastError] = useState('');

  const run = async () => {
    if (!legacy.length || running) return;
    if (!window.confirm(`نقل صور توثيق ${legacy.length} مستخدم إلى Storage وحذفها من Firestore؟`)) return;
    
    setRunning(true);
    setLastError('');
    setProgress({ done: 0, failed: 0 });
    let done = 0, failed = 0;

    for (const u of legacy) {
      try {
        const updates = {};
        for (const { field, side, pathField } of FIELDS) {
          if (isDataUrl(u[field])) {
            updates[pathField] = await withTimeout(uploadVerificationImage(u.id, side, u[field]), 10000);
            updates[field] = deleteField();
          }
        }
        await updateDoc(doc(db, USERS_COLLECTION, u.id), updates);
        done++;
      } catch (e) {
        console.error('migration failed for', u.id, e);
        setLastError(e?.message || 'فشل الرفع إلى Storage');
        failed++;
      }
      setProgress({ done, failed });
    }

    setRunning(false);
    triggerToast(failed ? `تم نقل ${done} وفشل ${failed}` : `تم نقل صور ${done} مستخدم بأمان ✅`);
  };

  // خيار بديل: حذف الصور القديمة من Firestore مباشرة إذا كنت لا تستخدم Storage
  const purgeLegacyFromFirestore = async () => {
    if (!legacy.length || running) return;
    if (!window.confirm(`سيتم حذف صور البطاقات القديمة لـ ${legacy.length} مستخدم من Firestore نهائياً لتأمين البيانات. هل أنت متأكد؟`)) return;

    setRunning(true);
    setLastError('');
    setProgress({ done: 0, failed: 0 });
    let done = 0, failed = 0;

    for (const u of legacy) {
      try {
        const updates = {};
        for (const { field } of FIELDS) {
          if (isDataUrl(u[field])) updates[field] = deleteField();
        }
        await updateDoc(doc(db, USERS_COLLECTION, u.id), updates);
        done++;
      } catch (e) {
        setLastError(e?.message || 'فشل الحذف من Firestore');
        failed++;
      }
      setProgress({ done, failed });
    }

    setRunning(false);
    triggerToast(`تم تأمين وحذف البيانات القديمة لـ ${done} مستخدم ✅`);
  };

  const ok = legacy.length === 0;
  return (
    <div className={`p-3.5 rounded-2xl border space-y-2.5 ${ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
      <h4 className={`font-black text-sm flex items-center gap-1.5 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
        <ShieldCheck size={16} className={ok ? 'text-emerald-600' : 'text-amber-600'} /> أمان صور التوثيق
      </h4>
      <p className={`text-xs font-bold leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
        {ok ? 'كل صور البطاقات والرخص مؤمّنة ولا توجد بيانات حساسة مكشوفة في Firestore ✅'
          : `${legacy.length} مستخدم لسه صور بطاقاتهم محفوظة داخل Firestore (ممكن تتقري من حسابات تانية حسب القواعد).`}
      </p>

      {lastError && (
        <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs font-bold flex items-start gap-1.5">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{lastError}</span>
        </div>
      )}

      {!ok && (
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="flex-1 h-10 px-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white rounded-xl text-xs font-black flex items-center justify-center gap-1.5"
          >
            {running ? <><Loader2 size={14} className="animate-spin" /> {progress.done + progress.failed} / {legacy.length}</> : 'نقل الصور إلى Storage'}
          </button>

          <button
            type="button"
            onClick={purgeLegacyFromFirestore}
            disabled={running}
            title="حذف الصور القديمة من Firestore دون رفعها لـ Storage"
            className="h-10 px-3 bg-rose-600/10 hover:bg-rose-600 text-rose-600 hover:text-white disabled:opacity-60 border border-rose-500/30 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-colors"
          >
            <Trash2 size={14} /> حذف من Firestore
          </button>
        </div>
      )}
    </div>
  );
};

export default VerificationMigration;