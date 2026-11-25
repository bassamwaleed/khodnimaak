import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPatternGraph, planByPattern } from '../src/utils/patternRouting.js';
const d = JSON.parse(readFileSync('src/data/tfcPatterns.json'));
const g = buildPatternGraph(d.patterns);
// أطول pattern: ركوبة واحدة (leg واحدة) مش leg لكل hop
const p = d.patterns.reduce((a, b) => (b.stopIds.length > a.stopIds.length ? b : a));
const r = planByPattern(g, p.stopIds[0], p.stopIds[p.stopIds.length - 1]);
assert.ok(r, 'route found');
assert.ok(r.legs.length <= 2, 'one ride (maybe a faster combo), not per-hop legs: ' + r.legs.length);
assert.ok(r.legs.every(l => l.fare == null || l.fare === undefined || typeof l.fare === 'object'), 'no per-hop fare');
// نقطة غير موجودة => لا مسار
assert.equal(planByPattern(g, 'tfc_nope', p.stopIds[0]) || null, null);
// التحويل بس عند نفس stop_id: كل leg تبدأ من آخر نقطة نزول
for (let i = 1; i < r.legs.length; i++) assert.equal(r.legs[i].fromId ?? r.legs[i].stopIds?.[0], r.legs[i - 1].toId ?? r.legs[i - 1].stopIds?.slice(-1)[0]);
console.log('pattern routing OK legs', r.legs.length, 'hops', r.legs.map(l => l.hops));
