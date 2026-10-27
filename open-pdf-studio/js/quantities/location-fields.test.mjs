// The Location columns of the quantities schedule cost a zone lookup per
// element; it only runs when a location field is shown, filtered or sorted on.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { scheduleUsesLocation } from './categories.js';

test('a schedule needs locations only for a shown, filtered or sorted location field', () => {
  assert.equal(scheduleUsesLocation({ fields: ['type', 'page', 'label'], filters: [], sort: [{ field: 'category' }] }), false);
  assert.equal(scheduleUsesLocation({ fields: ['type', 'location'] }), true);
  assert.equal(scheduleUsesLocation({ fields: ['type'], filters: [{ field: 'locationSource', op: 'eq', value: 'manual' }] }), true);
  assert.equal(scheduleUsesLocation({ fields: ['type'], sort: [{ field: 'location', dir: 'asc' }] }), true);
  assert.equal(scheduleUsesLocation({}), false);
});

test('the quantities store computes locations only when the schedule needs them', () => {
  const store = readFileSync(new URL('../solid/stores/quantitiesStore.js', import.meta.url), 'utf8');
  const body = store.slice(store.indexOf('function collectElements()'), store.indexOf('function computeSchedule()'));
  const gate = body.indexOf('scheduleUsesLocation(');
  assert.ok(gate > 0, 'the store asks whether locations are needed');
  assert.ok(gate < body.indexOf('collectZones('), 'before collecting zones');
  assert.ok(gate < body.indexOf('locationFor('), 'before locating elements');
});
