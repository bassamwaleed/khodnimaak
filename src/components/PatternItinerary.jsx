import React from 'react';
import { aliasOf } from '../utils/displayAlias';
// الأجرة/الوقت: "غير معروف" لحد ما تتسجل. مفيش مشي مضاف. الاسم الأصلي (LTR) هو المرجع، والعربي ترجمة عرض.
// قيمة رقم = مسجلة. كائن {min,max,estimated} = رينج تقديري (مش تعريفة مؤكدة). null = غير معروف.
const fmt = (v, unit) => {
  if (v == null) return 'غير معروف';
  if (typeof v === 'object') return <>من <bdi dir="ltr">{v.min}</bdi> إلى <bdi dir="ltr">{v.max}</bdi> {unit}{v.estimated ? ' (تقدير تجريبي)' : ''}</>;
  return `${v} ${unit}`;
};
const clean = (s = '') => s.replace(/\s+/g, ' ').trim();
const Stop = ({ name, bold }) => {
  const ar = aliasOf(name);
  return (
    <div className="min-w-0">
      {ar && <div className={`text-sm ${bold ? 'font-black' : 'font-bold'}`}>{ar}</div>}
      <bdi dir="ltr" className={`block text-xs opacity-70 text-right ${ar ? '' : 'text-sm font-bold opacity-100'}`}>{clean(name)}</bdi>
    </div>
  );
};
const PatternItinerary = ({ plan, nameOf, fareOf = () => null, source = 'Transport for Cairo (TfC) GTFS، 2025، CC BY 4.0', isDarkMode }) => {
  const card = isDarkMode ? 'bg-slate-900 text-slate-100 border-slate-700' : 'bg-white text-slate-800 border-slate-200';
  if (!plan) return <div dir="rtl" className="text-sm font-bold p-3">مفيش مسار بالبيانات الحالية</div>;
  return (
    <div dir="rtl" className="space-y-3">
      <div className="flex flex-wrap gap-2 text-[11px] font-black">
        <span className="px-2 py-1 rounded-lg bg-indigo-100 text-indigo-800">{plan.legs.length} ركوبة</span>
        <span className="px-2 py-1 rounded-lg bg-indigo-100 text-indigo-800">{plan.transfers} تبديل</span>
        <span className="px-2 py-1 rounded-lg bg-amber-100 text-amber-800">{(() => { const rs = plan.legs.map(fareOf); return rs.length && rs.every(Boolean) ? <>الأجرة (تقدير تجريبي): من <bdi dir="ltr">{rs.reduce((s, r) => s + r.min, 0)}</bdi> إلى <bdi dir="ltr">{rs.reduce((s, r) => s + r.max, 0)}</bdi> ج</> : 'الأجرة: غير معروفة'; })()}</span>
        <span className="px-2 py-1 rounded-lg bg-amber-100 text-amber-800">الوقت: غير معروف</span>
      </div>
      {plan.legs.map((l, i) => (
        <div key={i} className={`rounded-2xl border p-3 shadow-sm ${card}`}>
          <div className="flex items-center justify-between">
            <div className="text-[15px] font-black">{i === 0 ? '١. اركب' : `${i + 1}. بدّل واركب`} <bdi dir="ltr" className="px-1.5 py-0.5 rounded-md bg-indigo-600 text-white text-xs">{l.routeName}</bdi></div>
            <div className="text-xs font-black">{l.hops} محطة</div>
          </div>
          <div className="text-[11px] opacity-70 mt-0.5">اتجاه الخط: <bdi dir="ltr">{clean(l.headsign)}</bdi></div>
          <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-2 text-xs">
            <span className="font-black text-emerald-600">من</span><Stop name={nameOf(l.boardStop)} bold />
            <span className="font-black text-rose-600">انزل</span><Stop name={nameOf(l.alightStop)} bold />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold">
            <span className="px-2 py-0.5 rounded-lg bg-amber-100 text-amber-800">أجرة الركوب: {fmt(l.fare ?? fareOf(l), 'ج')}</span>
            <span className="px-2 py-0.5 rounded-lg bg-amber-100 text-amber-800">المدة: {fmt(l.minutes, 'د')}</span>
          </div>
        </div>
      ))}
      <div className="text-[11px] opacity-70 leading-5">
        المصدر: {source}. التبديل بيحصل في نفس الموقف بس، ومفيش مشي مضاف. {plan.legs.some(fareOf) ? 'الأجرة التقديرية تجريبية: من أجور اتسجلت في التطبيق لمسافات مشابهة (خط مستقيم، وسائل مختلطة)، مش تعريفة TfC ومش نصيحة أجرة مؤكدة. ' : ''}الأسماء العربية ترجمة عرض مش من المصدر، والاسم الإنجليزي هو الاسم الأصلي في الملف.
      </div>
    </div>
  );
};
export default PatternItinerary;
