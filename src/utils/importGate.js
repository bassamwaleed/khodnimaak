import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

// مؤشر التفعيل: وثيقة واحدة tareqna_config/gis = { activeBatch, hiddenIds }.
// - من غير مؤشر (أو بدون صلاحية قراءة): الدوك اللي عليها importBatch مخفية، والقديم ظاهر زي الأول.
// - مع مؤشر مفعّل: الظاهر هو دفعة الاستيراد المفعّلة + أي دوك جديد اتضاف بعد التفعيل، والدوك القديمة
//   (اللي ids بتاعتها في hiddenIds) مخفية مش ممسوحة. الرجوع = activeBatch فاضي و hiddenIds فاضي.
export const IMPORT_POINTER = ['tareqna_config', 'gis'];

export { gateDocs } from './gateDocs';

export const useActiveImport = () => {
  const [pointer, setPointer] = useState(null);
  useEffect(() => {
    const unsub = onSnapshot(doc(db, ...IMPORT_POINTER),
      (s) => setPointer(s.exists() ? s.data() : null),
      () => { /* خطأ في الاستماع: نبقي آخر حالة معروفة (لو لسه ما وصلتش حالة = null = القديم ظاهر) */ });
    return unsub;
  }, []);
  return pointer;
};
