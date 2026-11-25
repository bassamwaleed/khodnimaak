import { Timestamp, GeoPoint } from 'firebase/firestore';
// تسلسل يحافظ على أنواع Firestore (Timestamp / GeoPoint) عشان النسخة الاحتياطية تتسترجع بنفس الأنواع.
export const toTyped = (v) => {
  if (v instanceof Timestamp) return { __t: 'ts', s: v.seconds, n: v.nanoseconds };
  if (v instanceof GeoPoint) return { __t: 'geo', lat: v.latitude, lng: v.longitude };
  if (Array.isArray(v)) return v.map(toTyped);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toTyped(x)]));
  return v === undefined ? null : v;
};
export const fromTyped = (v) => {
  if (Array.isArray(v)) return v.map(fromTyped);
  if (v && typeof v === 'object') {
    if (v.__t === 'ts') return new Timestamp(v.s, v.n);
    if (v.__t === 'geo') return new GeoPoint(v.lat, v.lng);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromTyped(x)]));
  }
  return v;
};
