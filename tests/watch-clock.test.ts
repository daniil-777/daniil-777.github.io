import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clockAngles, clockParts, readClock, validateTimeZone } from '../src/lib/watch/clock.ts';
import { minuteIndex, planePoint, WATCH_GEOMETRY } from '../src/lib/watch/geometry.ts';

describe('Chronos actual clock geometry', () => {
  it('preserves hand separation at 6:30 rather than aligning the hour hand to six', () => {
    const angle = clockAngles({ hours: 6, minutes: 30, seconds: 0, milliseconds: 0 });
    assert.equal(angle.hour, 195);
    assert.equal(angle.minute, 180);
    assert.equal(angle.second, 0);
  });
  it('keeps the real 7:25 position without posing hands to protect the aperture', () => {
    const angle = clockAngles({ hours: 19, minutes: 25, seconds: 0, milliseconds: 0 });
    assert.equal(angle.hour, 222.5);
    assert.equal(angle.minute, 150);
  });
  it('includes milliseconds in all hands and phase around a minute wrap', () => {
    const before = readClock(new Date('2026-10-05T23:59:59.500Z'), 'UTC');
    const after = readClock(new Date('2026-10-06T00:00:00.000Z'), 'UTC');
    assert.equal(before.angles.second, 357);
    assert.equal(before.angles.minute, 359.95);
    assert.ok(before.angles.hour > 359.99);
    assert.equal(after.angles.hour, 0);
    assert.equal(after.angles.minute, 0);
    assert.equal(after.phase, 0);
    assert.ok(Math.abs(before.phase - 357 * Math.PI / 180) < 1e-12);
  });
  it('uses Zurich daylight saving and an h23 midnight without losing milliseconds', () => {
    assert.deepEqual(clockParts(new Date('2026-07-01T22:30:12.345Z'), 'Europe/Zurich'), {
      hours: 0, minutes: 30, seconds: 12, milliseconds: 345,
    });
    assert.equal(clockParts(new Date('2026-01-01T22:30:00Z'), 'Europe/Zurich').hours, 23);
  });
  it('rejects malformed dates and time zones', () => {
    assert.throws(() => readClock(new Date(NaN)), RangeError);
    assert.throws(() => validateTimeZone('Zurich'), RangeError);
    assert.equal(validateTimeZone(''), '');
  });
  it('reserves distinct track and minute index annuli', () => {
    assert.equal(Array.from({ length: 60 }, (_, i) => minuteIndex(i)).filter(i => i.major).length, 12);
    assert.ok(WATCH_GEOMETRY.trackInner > WATCH_GEOMETRY.indexOuter);
    assert.throws(() => minuteIndex(60), RangeError);
    const noon = planePoint(0, 0);
    const six = planePoint(1, Math.PI);
    assert.equal(noon.y, WATCH_GEOMETRY.center - WATCH_GEOMETRY.trackInner);
    assert.equal(six.y, WATCH_GEOMETRY.center + WATCH_GEOMETRY.trackOuter);
  });
});
