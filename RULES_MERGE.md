# دمج القواعد (اقتراح، مش بديل كامل ومش متجرّب على emulator ولا Firebase حقيقي)

قواعد Firebase الحية مش متاحة لنا (قواعد الـstations مش في الريبو). ماتستبدلش ملف القواعد الحي بملف جاهز: راجع القواعد الحية في الكونسول وادمج الاتنين بس.

1) جنب validLink() الحالية في firestore.rules أضف:

    function validAdminLink() {
      let d = request.resource.data;
      return d.keys().hasOnly(['fromId','toId','kind','fare','minutes','note','oneWay','distanceKm',
                               'status','suggestedBy','suggestedByName','createdBy','createdAt','updatedAt',
                               'approvedBy','approvedAt','source','routeId','routeName','seq','importBatch'])
        && d.fromId is string && d.toId is string && d.fromId != d.toId
        && d.kind in ['walk', 'ride', 'same']
        && (d.fare == null || (d.fare is number && d.fare >= 0 && d.fare <= 500))
        && (!('minutes' in d) || d.minutes == null || (d.minutes is number && d.minutes >= 0))
        && (d.note is string && d.note.size() <= 200);
    }

2) في match khodni_maak_links غيّر سطر الأدمن من
    allow create, update: if isAdmin() && validLink();
إلى
    allow create, update: if isAdmin() && (validLink() || validAdminLink());
(قاعدة اقتراح المستخدم وقراءة signedIn() وحذف الأدمن كما هي.)

3) أضف:
    match /tareqna_config/{id} {
      allow read: if signedIn();
      allow write: if isAdmin();
    }

4) khodni_maak_stations: لازم تتأكد في الكونسول إن قاعدة الأدمن بتسمح بالحقول: source, importBatch, addedBy, crowdStatus, crowdUpdatedAt, lat, lng, mapUrl وغيرها اللي بيكتبها TfcImportPanel (شوف الدالة set(...) في الملف). لو في hasOnly عندك، ضيفهم. ده غير متراجع.
