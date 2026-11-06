import type { LatLng } from './types';

/** Meters between two points (haversine). */
export function distance(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length of a route in meters. */
export function routeLength(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
}

/** Miles in the US and UK, kilometers elsewhere. */
export function usesMiles(lang: string = typeof navigator !== 'undefined' ? navigator.language : 'en-US'): boolean {
  return /^en(-US|-GB|-LR|-MM)?$/i.test(lang) || /^en-US/i.test(lang);
}

/** "0.8 mi", "1.4 km", "350 ft". */
export function formatDistance(meters: number, miles: boolean = usesMiles()): string {
  if (miles) {
    const mi = meters / 1609.344;
    if (mi < 0.1) return `${Math.round(meters * 3.28084 / 10) * 10} ft`;
    return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
  }
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/** About how long a dog walk of this length takes, at an easy 2.5 mph with sniffing. */
export function walkMinutes(meters: number): number {
  return Math.max(1, Math.round(meters / 1609.344 / 2.5 * 60));
}

/** Rounds coordinates to about a meter, which keeps saved routes small. */
export const roundPoint = (p: LatLng): LatLng => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];

/** The middle of a set of points, for centering a map. */
export function center(points: LatLng[]): LatLng | null {
  if (!points.length) return null;
  const lat = points.reduce((s, p) => s + p[0], 0) / points.length;
  const lng = points.reduce((s, p) => s + p[1], 0) / points.length;
  return [lat, lng];
}
