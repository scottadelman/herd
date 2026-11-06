import type { LatLng } from './types';

// Public dog things from OpenStreetMap, found with the free Overpass API:
// poop bag dispensers, dog waste bins, dog toilets, and dog parks. Coverage
// depends on what volunteers have mapped, so the app always lets people add
// their own spots too.

export type PublicKind = 'bags' | 'bin' | 'dog_park';

export interface PublicSpot {
  id: string;
  kind: PublicKind;
  name: string | null;
  at: LatLng;
}

export const PUBLIC_LABEL: Record<PublicKind, string> = {
  bags: 'Poop bag dispenser',
  bin: 'Dog waste bin',
  dog_park: 'Dog park',
};

const ENDPOINT = 'https://overpass-api.de/api/interpreter';

/** Bounds as south, west, north, east. */
export type Bounds = [number, number, number, number];

export function overpassQuery([s, w, n, e]: Bounds): string {
  const bbox = `${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}`;
  return `[out:json][timeout:20];
(
  node["vending"="excrement_bags"](${bbox});
  node["amenity"="dog_toilet"](${bbox});
  node["amenity"="waste_basket"]["waste"~"dog_excrement"](${bbox});
  node["amenity"="waste_disposal"]["waste"~"dog_excrement"](${bbox});
  nwr["leisure"="dog_park"](${bbox});
);
out center 300;`;
}

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export function parseOverpass(json: { elements?: OsmElement[] }): PublicSpot[] {
  const out: PublicSpot[] = [];
  for (const el of json.elements ?? []) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const t = el.tags ?? {};
    let kind: PublicKind;
    if (t.leisure === 'dog_park') kind = 'dog_park';
    else if (t.vending === 'excrement_bags') kind = 'bags';
    else kind = 'bin';
    // A bin that also hands out bags counts as a bag spot.
    if (kind === 'bin' && /excrement_bags|yes/.test(t.vending ?? '')) kind = 'bags';
    out.push({ id: `${el.type}/${el.id}`, kind, name: t.name ?? null, at: [lat, lon] });
  }
  return out;
}

const cache = new Map<string, PublicSpot[]>();

/** Spots inside the bounds. Areas are rounded so panning a little reuses the last answer. */
export async function loadPublicSpots(b: Bounds, signal?: AbortSignal): Promise<PublicSpot[]> {
  const r = (x: number, f: 'floor' | 'ceil') => Math[f](x * 50) / 50;
  const rounded: Bounds = [r(b[0], 'floor'), r(b[1], 'floor'), r(b[2], 'ceil'), r(b[3], 'ceil')];
  const key = rounded.join(',');
  const hit = cache.get(key);
  if (hit) return hit;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(overpassQuery(rounded))}`,
    signal,
  });
  if (!res.ok) throw new Error(res.status === 429 ? 'The public map is busy. Try again in a minute.' : 'Couldn’t reach the public map.');
  const spots = parseOverpass(await res.json());
  cache.set(key, spots);
  return spots;
}
