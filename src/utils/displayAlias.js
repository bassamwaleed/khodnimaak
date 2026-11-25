// أسماء عرض مترجمة (مش من المصدر). الاسم الأصلي بيفضل هو المرجع ويظهر جنبها.
const ALIASES = [
  [/6th of October/gi, 'السادس من أكتوبر'], [/Sheikh Zayed/gi, 'الشيخ زايد'], [/Hyper One/gi, 'هايبر وان'],
  [/Hossary|Hosary/gi, 'الحصري'], [/Ring Rd\./gi, 'الدائري'], [/Station/gi, 'موقف'], [/Center/gi, 'سنتر'],
  [/District/gi, 'الحي'], [/Steps/gi, 'سلالم'], [/Corridor/gi, 'المحور'], [/Giza/gi, 'الجيزة'],
];
export const aliasOf = (name = '') => {
  let out = name, hit = false;
  for (const [re, ar] of ALIASES) if (re.test(out)) { out = out.replace(re, ar); hit = true; }
  out = out.replace(/\s+/g, ' ').trim(); return hit && !/[A-Za-z]/.test(out) ? out : null; // null = مفيش ترجمة معروفة، يتعرض الأصلي بس
};
