# التحديثات

## الخريطة وروابط التبادل
- `components/GisMapTab.jsx` — خريطة الأدمن: ربط النقاط، تخطيط المسار، صحة الشبكة، مراجعة اقتراحات المستخدمين.
- `utils/gis.js` / `utils/gisConstants.js` — منطق الشبكة (أقصر مسار، اقتراحات، تحليل).
- `components/JourneyPlanner.jsx` — «وصلني من موقف لموقف» لتاب مواقف مصر.
- `components/SuggestLinkModal.jsx` — اقتراح رابط من المستخدم (pending ← يراجعه الأدمن).
- `StationModal` — بيعرض روابط الموقف وزر الاقتراح، وحذف الموقف بيحذف روابطه.

## صور التوثيق على Storage
- `VerifyModal` بيرفع الصور على `verification/{uid}/…` ويحفظ المسارات فقط.
- `VerificationImage` / `VerificationMigration` — عرض الصور للأدمن ونقل القديم (الإعدادات ← أمان صور التوثيق).
- `storage.rules` / `firestore.rules` — القواعد الجديدة (تتنشر من Firebase Console).

## إصلاحات
- تهريب HTML في خرائط Leaflet (XSS)، وإصلاح إعادة الاشتراك في Firestore مع كل اختيار.
