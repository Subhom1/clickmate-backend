import test from 'node:test';
import assert from 'node:assert/strict';
import { searchAvailability, availabilityOverlaps } from '../../../utils/searchAvailability.js';

const at = (date, time, timeZone, utcOffsetMinutes) => searchAvailability({ date, time, timeZone, utcOffsetMinutes });

test('New York and Singapore local times resolve to the same winter and summer instants', () => {
  assert.deepEqual(at('2028-01-15', '09:00', 'America/New_York', -300), at('2028-01-15', '22:00', 'Asia/Singapore', 480));
  assert.deepEqual(at('2028-07-15', '09:00', 'America/New_York', -240), at('2028-07-15', '21:00', 'Asia/Singapore', 480));
  assert.deepEqual(at('2028-01-15', '09:00', 'America/New_York', -300), {
    startMs: Date.parse('2028-01-15T13:30:00Z'), endMs: Date.parse('2028-01-15T14:30:00Z'),
  });
});

test('conversion handles different calendar days across time zones', () => {
  assert.deepEqual(at('2028-01-15', '20:00', 'America/New_York', -300), at('2028-01-16', '09:00', 'Asia/Singapore', 480));
});

test('rejects a spring DST gap and either incorrect seasonal offset', () => {
  for (const offset of [-300, -240]) assert.throws(() => at('2028-03-12', '02:30', 'America/New_York', offset));
  assert.throws(() => at('2028-07-15', '09:00', 'America/New_York', -300));
  assert.throws(() => at('2028-01-15', '09:00', 'America/New_York', -240));
});

test('explicit offsets distinguish both valid instants in a fall DST fold', () => {
  const first = at('2028-11-05', '01:30', 'America/New_York', -240);
  const second = at('2028-11-05', '01:30', 'America/New_York', -300);
  assert.equal(second.startMs - first.startMs, 60 * 60 * 1000);
  assert.equal(first.startMs, Date.parse('2028-11-05T05:00:00Z'));
});

test('rejects malformed and impossible inputs', () => {
  for (const [date, time, zone, offset] of [
    ['2028-02-30', '10:00', 'UTC', 0], ['2027-02-29', '10:00', 'UTC', 0],
    ['0000-01-01', '10:00', 'UTC', 0], ['2028-1-01', '10:00', 'UTC', 0],
    ['2028-01-01', '24:00', 'UTC', 0], ['2028-01-01', '10:60', 'UTC', 0],
    ['2028-01-01', '10:00', 'Not/A_Zone', 0], ['2028-01-01', '10:00', '+01:00', 60],
    ['2028-01-01', '10:00', 'UTC', 1.5], ['2028-01-01', '10:00', 'UTC', 841],
  ]) assert.throws(() => at(date, time, zone, offset), `${date} ${time} ${zone} ${offset}`);
});

test('overlap is symmetric and includes touching endpoints', () => {
  const first = at('2028-01-15', '12:00', 'UTC', 0);
  const overlaps = at('2028-01-15', '12:59', 'UTC', 0);
  const touches = at('2028-01-15', '13:00', 'UTC', 0);
  assert.equal(availabilityOverlaps(first, overlaps), true);
  assert.equal(availabilityOverlaps(overlaps, first), true);
  assert.equal(availabilityOverlaps(first, touches), true);
  assert.equal(availabilityOverlaps(touches, first), true);
  const apart = at('2028-01-15', '13:01', 'UTC', 0);
  assert.equal(availabilityOverlaps(first, apart), false);
  assert.equal(availabilityOverlaps(apart, first), false);
});
