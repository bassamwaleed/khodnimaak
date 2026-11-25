import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gateDocs } from '../src/utils/gateDocs.js';
const old = [{ id: 'o1' }, { id: 'o2' }];
const neu = [{ id: 'tfc_1', importBatch: 'B1' }, { id: 'tfc_2', importBatch: 'B1' }];
const user = { id: 'u_new' }; // دوك أضافها مستخدم بعد التفعيل
const all = [...old, ...neu, user];
const ids = l => l.map(d => d.id).sort().join(',');
// 1) من غير مؤشر / مؤشر غير قابل للقراءة: القديم ظاهر والمستورد مخفي
assert.equal(ids(gateDocs(all, null)), 'o1,o2,u_new');
// 2) بعد التفعيل: المستورد ظاهر، القديم (hiddenIds) مخفي، الجديد من المستخدمين ظاهر
const on = { activeBatch: 'B1', hiddenIds: ['o1', 'o2'] };
assert.equal(ids(gateDocs(all, on)), 'tfc_1,tfc_2,u_new');
// 3) رجوع: activeBatch null => القديم يرجع والمستورد يختفي
assert.equal(ids(gateDocs(all, { activeBatch: null, hiddenIds: [] })), 'o1,o2,u_new');
// 4) سباق المستمعين: المؤشر وصل قبل الدوك المستوردة => القديم مخفي والمستورد لسه ما وصلش (ثانية فاضية مؤقتة، مفيش خلط)
assert.equal(ids(gateDocs([...old, user], on)), 'u_new');
//    الدوك وصلت قبل المؤشر => مخفية والقديم ظاهر (مفيش خلط)
assert.equal(ids(gateDocs([...old, ...neu], null)), 'o1,o2');
// 5) دفعة قديمة غير مفعّلة مش بتظهر
assert.equal(ids(gateDocs([{ id: 'x', importBatch: 'B0' }, ...neu], on)), 'tfc_1,tfc_2');
// 6) إعادة الاستيراد: نفس الـids (idempotent) من ملف البيانات
const net = JSON.parse(readFileSync('src/data/tfcNetwork.json'));
assert.equal(new Set(net.nodes.map(n => n.id)).size, net.nodes.length);
assert.equal(new Set(net.links.map(l => l.id)).size, net.links.length);
assert.ok(net.nodes.every(n => n.id.startsWith('tfc_')) && net.links.every(l => l.id.startsWith('tfc_')));
assert.ok(net.links.every(l => l.fare == null && l.minutes == null));
console.log('gate tests OK; nodes', net.nodes.length, 'links', net.links.length);
