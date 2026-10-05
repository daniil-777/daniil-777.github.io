export const WATCH_GEOMETRY = Object.freeze({
  size: 440, center: 220, caseRadius: 214, dialRadius: 194,
  // Flight, indices, and typography each occupy a separate concentric band.
  trackInner: 155, trackOuter: 198, trackMiddle: 176.5,
  indexInner: 139, indexOuter: 148, numeralRadius: 120,
  hourLength: 56.16, minuteLength: 67.08, secondLength: 132,
});

export interface DialPoint { x: number; y: number }

export function pointOnDial(radius: number, clockwiseRadians: number): DialPoint {
  return {
    x: WATCH_GEOMETRY.center + radius * Math.sin(clockwiseRadians),
    y: WATCH_GEOMETRY.center - radius * Math.cos(clockwiseRadians),
  };
}

export function minuteIndex(index: number): { start: DialPoint; end: DialPoint; major: boolean } {
  if (!Number.isInteger(index) || index < 0 || index > 59) throw new RangeError('Minute index must be 0–59');
  const major = index % 5 === 0;
  const angle = index * Math.PI / 30;
  return {
    start: pointOnDial(major ? WATCH_GEOMETRY.indexInner : 143, angle),
    end: pointOnDial(WATCH_GEOMETRY.indexOuter, angle), major,
  };
}

/** Normalized lane centres map to the narrow physical flight annulus. */
export function planePoint(radialPosition: number, phase: number): DialPoint {
  const fraction = Math.max(0, Math.min(1, radialPosition));
  const radius = WATCH_GEOMETRY.trackInner + fraction * (WATCH_GEOMETRY.trackOuter - WATCH_GEOMETRY.trackInner);
  return pointOnDial(radius, phase);
}

export function planeTransform(radialPosition: number, phase: number, bankDegrees = 0): string {
  const point = planePoint(radialPosition, phase);
  return `translate(${point.x} ${point.y}) rotate(${phase * 180 / Math.PI + 90 + bankDegrees})`;
}
