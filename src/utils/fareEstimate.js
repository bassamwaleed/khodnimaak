import baseline from '../data/fareBaseline.json';
import { distanceBetween } from './gis';
// تقدير أجرة ركوبة واحدة من أجور مدخلة فعلاً في التطبيق لمسافات (خط مستقيم) مشابهة.
// الرينج = الربيع الأول إلى الثالث لنفس شريحة المسافة. مش تعريفة TfC، ومش محسوب لكل hop.
// لو الشريحة فيها أقل من 9 أجور بيرجع null (غير معروف). مفيش زيادة نسبة مضافة.
export const estimateFareRange = (km, bins = baseline.bins) => {
  if (!Number.isFinite(km) || km < 0) return null;
  const b = bins.find(x => km >= x.fromKm && km < x.toKm);
  if (!b || b.n < 9) return null;
  return { min: b.p25, max: b.p75, estimated: true, n: b.n, basis: 'أجور مدخلة لمسافة مشابهة' };
};
export const legFareRange = (leg, byId, prefix = 'tfc_') => {
  const a = byId[prefix + leg.boardStop], b = byId[prefix + leg.alightStop];
  if (!a || !b) return null;
  const km = distanceBetween(a, b);
  return estimateFareRange(km);
};
export const sumRanges = (rs) => (rs.length && rs.every(Boolean)
  ? { min: rs.reduce((s, r) => s + r.min, 0), max: rs.reduce((s, r) => s + r.max, 0), estimated: true } : null);
