// ثوابت خريطة الـ GIS — منقولة من AdminPanel.jsx لكسر الاستيراد الدائري
// (AdminPanel ⇄ StationModal ⇄ App). AdminPanel لسه بيعمل re-export لـ NODE_TYPES
// فمفيش ملف تاني محتاج يتغير.

// أنواع النقاط (ألوان التصنيف هي الاستثناء الوحيد المسموح في DESIGN.md)
export const NODE_TYPES = [
  { id: 'station', label: 'موقف رئيسي 🚏', short: 'موقف 🚏', color: '#4f46e5', badgeClass: 'bg-indigo-500/15 text-indigo-500 border-indigo-500/30' },
  { id: 'hub', label: 'نقطة تبادلية / تقاطع 🔄', short: 'تبادلية 🔄', color: '#d97706', badgeClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30' },
  { id: 'metro', label: 'محطة مترو / قطار / BRT 🚇', short: 'محطة 🚇', color: '#334155', badgeClass: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30' },
  { id: 'stop', label: 'محطة فرعية / ناصية ركوب 📍', short: 'فرعية 📍', color: '#059669', badgeClass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30' }
];

// أنواع الروابط بين النقاط
//  walk: تحويلة مشي بين نقطتين قريبتين   | ride: مواصلة مباشرة بسعر
//  same: نفس المكان فعلياً (تبادل داخلي بدون مشي)
export const LINK_KINDS = [
  { id: 'walk', label: 'مشي / تحويلة 🚶', short: 'مشي 🚶', color: '#334155', dashArray: '2 8', weight: 3, badgeClass: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30' },
  { id: 'ride', label: 'مواصلة مباشرة 🚐', short: 'مواصلة 🚐', color: '#4f46e5', dashArray: null, weight: 3, badgeClass: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30' },
  { id: 'same', label: 'نفس المكان (تبادل داخلي) 🔄', short: 'نفس المكان 🔄', color: '#d97706', dashArray: null, weight: 5, badgeClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30' }
];

// نطاق "قريب كفاية للمشي" بالكيلومتر لاقتراحات الربط التلقائي
export const SUGGEST_WALK_KM = 0.4;

// المناطق المدعومة (كانت في App.jsx — App لسه بيعمل re-export فمفيش استيراد بيتكسر)
export const SUPPORTED_AREAS = [
  'حدائق أكتوبر', 'حدائق الأهرام', 'مدينة 6 أكتوبر', 'الشيخ زايد',
  'فيصل', 'الهرم', 'القرية الذكية', 'الدقي', 'المهندسين', 'وسط البلد',
  'المعادي', 'حلوان', 'مدينة نصر', 'مصر الجديدة', 'القاهرة الجديدة',
  'مدينة السادات', 'شبين الكوم'
];
