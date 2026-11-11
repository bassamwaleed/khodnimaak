// صور التوثيق على Firebase Storage بدل base64 جوه وثيقة المستخدم
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';
import { dataUrlToBlob } from './helpers';

export const verificationPath = (uid, side) => `verification/${uid}/${side}.jpg`; // side: front | back | license

export const uploadVerificationImage = async (uid, side, dataUrl) => {
  const blob = await dataUrlToBlob(dataUrl);
  const path = verificationPath(uid, side);
  await uploadBytes(ref(storage, path), blob, { contentType: 'image/jpeg' });
  return path;
};

export const getVerificationUrl = (path) => getDownloadURL(ref(storage, path));

export const isDataUrl = (v) => typeof v === 'string' && v.startsWith('data:');
export const hasVerificationDocs = (u) =>
  Boolean(u?.idFront || u?.idBack || u?.licenseImage || u?.idFrontPath || u?.idBackPath || u?.licensePath);
