import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// تفعيل الكاش المحلي السريع لفتح التطبيق فوراً بدون انتظار الشبكة
let firestoreDb;
try {
  firestoreDb = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
} catch (e) {
  firestoreDb = getFirestore(app);
}

export const db = firestoreDb;
export const storage = getStorage(app);

// ==========================================
// THROWABLE CONSTANTS (Collections & Admin)
// ==========================================
export const APP_COLLECTION_NAME = 'khodni_maak_trips';
export const USERS_COLLECTION = 'khodni_maak_users';
export const STATIONS_COLLECTION = 'khodni_maak_stations';
export const LINKS_COLLECTION = 'khodni_maak_links';
export const ADMIN_EMAIL = "bassamwaleed2000@gmail.com".toLowerCase();