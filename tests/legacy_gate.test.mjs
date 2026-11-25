import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findBestPath } from '../src/utils/gis.js';
const net = JSON.parse(readFileSync('src/data/tfcNetwork.json'));
const byId = Object.fromEntries(net.nodes.map(n => [n.id, { ...n, status: 'approved' }]));
const links = net.links.map(l => ({ ...l, kind: 'ride', status: 'approved' }));
const l0 = links[0];
const r = findBestPath(links, byId, l0.fromId, l0.toId);
assert.equal(r, null, 'legacy planner must not route over TfC hop links');
// وصلة قديمة عادية لسه شغالة
const a = { id: 'a', name: 'A', lat: 30, lng: 31, status: 'approved' }, b = { id: 'b', name: 'B', lat: 30.1, lng: 31, status: 'approved' };
const ok = findBestPath([{ id: 'l', fromId: 'a', toId: 'b', kind: 'ride', fare: 7, minutes: 10, status: 'approved' }], { a, b }, 'a', 'b');
assert.equal(ok.legs.length, 1); assert.equal(ok.totalFare, 7);
console.log('legacy gate OK');
