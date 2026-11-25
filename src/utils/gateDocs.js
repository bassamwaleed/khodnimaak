// منطق إخفاء/إظهار الدفعات (نقي، من غير Firebase عشان يتختبر في node)
export const gateDocs = (list, pointer) => {
  const active = pointer && pointer.activeBatch ? pointer.activeBatch : null;
  const hidden = new Set(active && Array.isArray(pointer.hiddenIds) ? pointer.hiddenIds : []);
  return list.filter(d => (d.importBatch ? d.importBatch === active : !hidden.has(d.id)));
};
