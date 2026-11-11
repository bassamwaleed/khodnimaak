import React, { useState, useEffect } from 'react';
import { getVerificationUrl } from '../utils/verification';

// يعرض صورة توثيق: من Storage (path) أو من النسخة القديمة base64 (legacySrc) لحد ما تتنقل
const VerificationImage = ({ path, legacySrc, onOpen, className = '', alt = '' }) => {
  const [url, setUrl] = useState(legacySrc || null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setError(false);
    if (legacySrc) { setUrl(legacySrc); return undefined; }
    if (!path) { setUrl(null); return undefined; }
    setUrl(null);
    getVerificationUrl(path).then(u => { if (alive) setUrl(u); }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [path, legacySrc]);

  if (error) {
    return <div className={`${className} flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-xs font-bold text-rose-600 text-center p-2`}>تعذر تحميل الصورة</div>;
  }
  if (!url) {
    return <div className={`${className} bg-slate-200 dark:bg-slate-800`} aria-label="جاري التحميل" />;
  }
  return <img src={url} className={className} alt={alt} onClick={() => onOpen && onOpen(url)} />;
};

export default VerificationImage;
