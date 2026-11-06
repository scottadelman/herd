import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type * as Leaflet from 'leaflet';
import { distance, formatDistance, roundPoint, routeLength, walkMinutes } from '../lib/geo';
import { PUBLIC_LABEL, loadPublicSpots, type PublicSpot } from '../lib/publicSpots';
import type { LatLng, Place, PlaceInput, PlaceKind } from '../lib/types';
import { Chips, Field, Icons, Sheet, Spinner } from '../ui';

type L = typeof Leaflet;
type MapPlace = Pick<Place, 'id' | 'kind' | 'name' | 'notes' | 'points'>;

const KIND_LABEL: Record<PlaceKind, string> = {
  route: 'Walk route',
  park: 'Park',
  bag_spot: 'Poop bag spot',
  other: 'Other spot',
};

const PIN_ICON: Record<PlaceKind | 'bags' | 'bin' | 'dog_park', string> = {
  route: '',
  park: '<path d="M12 3.5l-5 7h3l-3.5 5h11L14 10.5h3z"/><path d="M12 15.5v5"/>',
  dog_park: '<path d="M12 3.5l-5 7h3l-3.5 5h11L14 10.5h3z"/><path d="M12 15.5v5"/>',
  bag_spot: '<path d="M8 8.5h8l1 11H7z"/><path d="M10 8.5c0-2 .8-3.5 2-3.5s2 1.5 2 3.5"/>',
  bags: '<path d="M8 8.5h8l1 11H7z"/><path d="M10 8.5c0-2 .8-3.5 2-3.5s2 1.5 2 3.5"/>',
  bin: '<path d="M6.5 7.5h11M9.5 7.5V5.5h5v2M8 7.5l1 12h6l1-12"/>',
  other: '<circle cx="12" cy="11" r="3"/>',
};

const pinHtml = (kind: keyof typeof PIN_ICON, cls: string) =>
  `<span class="map-pin ${cls}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PIN_ICON[kind]}</svg></span>`;

type Mode =
  | { kind: 'browse' }
  | { kind: 'draw'; points: LatLng[] }
  | { kind: 'record'; points: LatLng[]; started: number }
  | { kind: 'spot' };

export interface WalkMapProps {
  title: string;
  places: MapPlace[];
  onClose: () => void;
  /** Leave out for a read-only map (the sitter page). */
  onAdd?: (input: PlaceInput) => Promise<boolean>;
  onUpdate?: (id: string, input: Partial<PlaceInput>) => Promise<boolean>;
  onDelete?: (id: string) => Promise<boolean>;
}

/**
 * Saved walk routes, parks and poop bag spots on a map, plus public bag
 * dispensers and dog parks from OpenStreetMap. Draw a route by tapping, or
 * record one while you walk.
 */
export function WalkMap({ title, places, onClose, onAdd, onUpdate, onDelete }: WalkMapProps) {
  const editable = !!onAdd;
  const el = useRef<HTMLDivElement>(null);
  const L = useRef<L | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const layers = useRef<{ places: Leaflet.LayerGroup; pub: Leaflet.LayerGroup; draft: Leaflet.LayerGroup; me: Leaflet.LayerGroup } | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tilesBroken, setTilesBroken] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: 'browse' });
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [selected, setSelected] = useState<string | null>(null);
  const [naming, setNaming] = useState<{ draft: PlaceInput; place?: MapPlace } | null>(null);
  const [showPublic, setShowPublic] = useState(true);
  const [publicState, setPublicState] = useState<{ status: 'idle' | 'zoom' | 'loading' | 'done' | 'error'; spots: PublicSpot[]; message?: string }>({
    status: 'idle',
    spots: [],
  });
  const [pickedPublic, setPickedPublic] = useState<PublicSpot | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);
  const [, tick] = useState(0);

  // Load Leaflet and make the map.
  useEffect(() => {
    let alive = true;
    import('../lib/leaflet')
      .then(({ default: lib }) => {
        if (!alive || !el.current) return;
        L.current = lib;
        const m = lib.map(el.current, { zoomControl: false, attributionControl: true });
        lib.control.zoom({ position: 'topright' }).addTo(m);
        let loaded = 0;
        let failed = 0;
        lib
          .tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
          })
          .on('tileload', () => {
            loaded++;
            setTilesBroken(false);
          })
          .on('tileerror', () => {
            failed++;
            if (failed >= 4 && loaded === 0) setTilesBroken(true);
          })
          .addTo(m);
        layers.current = {
          pub: lib.layerGroup().addTo(m),
          places: lib.layerGroup().addTo(m),
          draft: lib.layerGroup().addTo(m),
          me: lib.layerGroup().addTo(m),
        };
        map.current = m;
        const all = places.flatMap((p) => p.points);
        if (all.length > 1) m.fitBounds(lib.latLngBounds(all), { padding: [36, 36], maxZoom: 16 });
        else if (all.length === 1) m.setView(all[0], 16);
        else {
          m.setView([39.5, -98.35], 4);
          locate(m, lib, true);
        }
        setReady(true);
      })
      .catch(() => alive && setLoadError('The map couldn’t load. Check your connection and try again.'));
    return () => {
      alive = false;
      map.current?.remove();
      map.current = null;
      if (watchId.current != null) navigator.geolocation?.clearWatch(watchId.current);
      wake.current?.release().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const locate = useCallback((m: Leaflet.Map | null = map.current, lib: L | null = L.current, quiet = false) => {
    if (!m || !lib) return;
    if (!navigator.geolocation) {
      if (!quiet) setLocError('This device can’t share its location.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here: LatLng = [pos.coords.latitude, pos.coords.longitude];
        m.setView(here, Math.max(m.getZoom(), 16));
        drawMe(here);
        setLocError(null);
      },
      () => {
        if (!quiet) setLocError('Location is off for Herd. Turn it on in Settings, or move the map by hand.');
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function drawMe(here: LatLng) {
    const lib = L.current;
    const g = layers.current?.me;
    if (!lib || !g) return;
    g.clearLayers();
    lib.circleMarker(here, { radius: 8, className: 'map-me', weight: 3 }).addTo(g);
  }

  /** Tapping a pin or route selects it, except while drawing, when it adds a point there. */
  const onPin = (select: () => void) => (e: Leaflet.LeafletMouseEvent) => {
    const cur = modeRef.current;
    if (cur.kind === 'draw') setMode({ kind: 'draw', points: [...cur.points, roundPoint([e.latlng.lat, e.latlng.lng])] });
    else if (cur.kind === 'spot') {
      setMode({ kind: 'browse' });
      setNaming({ draft: { kind: 'park', name: '', notes: null, points: [roundPoint([e.latlng.lat, e.latlng.lng])] } });
    } else if (cur.kind === 'browse') select();
  };

  // Saved places.
  useEffect(() => {
    const lib = L.current;
    const g = layers.current?.places;
    if (!ready || !lib || !g) return;
    g.clearLayers();
    for (const p of places) {
      const on = p.id === selected;
      if (p.kind === 'route' && p.points.length > 1) {
        lib.polyline(p.points, { className: `map-route${on ? ' map-route-on' : ''}`, weight: on ? 6 : 4 })
          .on('click', onPin(() => setSelected(p.id)))
          .addTo(g);
        lib.marker(p.points[0], {
          icon: lib.divIcon({ className: 'map-pin-wrap', html: `<span class="map-start${on ? ' map-start-on' : ''}"></span>`, iconSize: [16, 16] }),
          keyboard: false,
        })
          .on('click', onPin(() => setSelected(p.id)))
          .addTo(g);
      } else {
        lib.marker(p.points[0], {
          icon: lib.divIcon({ className: 'map-pin-wrap', html: pinHtml(p.kind, `map-pin-${p.kind}${on ? ' map-pin-on' : ''}`), iconSize: [34, 34], iconAnchor: [17, 17] }),
          title: p.name,
        })
          .on('click', onPin(() => setSelected(p.id)))
          .addTo(g);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, places, selected]);

  // Public spots, fetched for whatever the map is showing.
  useEffect(() => {
    const m = map.current;
    const lib = L.current;
    if (!ready || !m || !lib) return;
    let ctrl: AbortController | null = null;
    let timer: number | undefined;
    const refresh = () => {
      ctrl?.abort();
      if (!showPublic) {
        layers.current?.pub.clearLayers();
        setPublicState({ status: 'idle', spots: [] });
        return;
      }
      if (m.getZoom() < 14) {
        setPublicState((s) => ({ ...s, status: 'zoom' }));
        return;
      }
      const b = m.getBounds();
      ctrl = new AbortController();
      setPublicState((s) => ({ ...s, status: 'loading' }));
      loadPublicSpots([b.getSouth(), b.getWest(), b.getNorth(), b.getEast()], ctrl.signal)
        .then((spots) => setPublicState({ status: 'done', spots }))
        .catch((e) => {
          if ((e as Error).name === 'AbortError') return;
          setPublicState({ status: 'error', spots: [], message: (e as Error).message || 'Couldn’t reach the public map.' });
        });
    };
    const onMove = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, 450);
    };
    refresh();
    m.on('moveend', onMove);
    return () => {
      m.off('moveend', onMove);
      window.clearTimeout(timer);
      ctrl?.abort();
    };
  }, [ready, showPublic]);

  useEffect(() => {
    const lib = L.current;
    const g = layers.current?.pub;
    if (!ready || !lib || !g) return;
    g.clearLayers();
    if (!showPublic) return;
    for (const s of publicState.spots) {
      lib.marker(s.at, {
        icon: lib.divIcon({ className: 'map-pin-wrap', html: pinHtml(s.kind, `map-pin-public map-pin-${s.kind}`), iconSize: [28, 28], iconAnchor: [14, 14] }),
        title: s.name ?? PUBLIC_LABEL[s.kind],
      })
        .on(
          'click',
          onPin(() => {
            setSelected(null);
            setPickedPublic(s);
          }),
        )
        .addTo(g);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, publicState.spots, showPublic]);

  // Drawing, recording and dropping a spot.
  useEffect(() => {
    const m = map.current;
    const lib = L.current;
    const g = layers.current?.draft;
    if (!ready || !m || !lib || !g) return;
    g.clearLayers();
    if (mode.kind === 'draw' || mode.kind === 'record') {
      if (mode.points.length > 1) lib.polyline(mode.points, { className: 'map-route map-route-draft', weight: 5 }).addTo(g);
      for (const [i, p] of mode.points.entries()) {
        if (mode.kind === 'record' && i !== 0) continue;
        lib.circleMarker(p, { radius: i === mode.points.length - 1 || i === 0 ? 6 : 4, className: 'map-vertex', weight: 2 }).addTo(g);
      }
    }
    const onClick = (e: Leaflet.LeafletMouseEvent) => {
      const cur = modeRef.current;
      const p = roundPoint([e.latlng.lat, e.latlng.lng]);
      if (cur.kind === 'draw') setMode({ kind: 'draw', points: [...cur.points, p] });
      else if (cur.kind === 'spot') {
        setMode({ kind: 'browse' });
        setNaming({ draft: { kind: 'park', name: '', notes: null, points: [p] } });
      }
    };
    m.on('click', onClick);
    el.current?.classList.toggle('map-drawing', mode.kind === 'draw' || mode.kind === 'spot');
    return () => {
      m.off('click', onClick);
    };
  }, [ready, mode]);

  // Fly to a place when it's picked from the list.
  function focusPlace(p: MapPlace) {
    setSelected(p.id);
    setPickedPublic(null);
    const m = map.current;
    const lib = L.current;
    if (!m || !lib) return;
    if (p.points.length > 1) m.fitBounds(lib.latLngBounds(p.points), { padding: [40, 40], maxZoom: 17 });
    else m.setView(p.points[0], Math.max(m.getZoom(), 16));
  }

  async function startRecording() {
    if (!navigator.geolocation) {
      setLocError('This device can’t share its location.');
      return;
    }
    setSelected(null);
    setMode({ kind: 'record', points: [], started: Date.now() });
    try {
      wake.current = await (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null;
    } catch {
      /* the screen may still sleep; recording pauses if it does */
    }
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (pos.coords.accuracy > 60) return;
        const p = roundPoint([pos.coords.latitude, pos.coords.longitude]);
        drawMe(p);
        const cur = modeRef.current;
        if (cur.kind !== 'record') return;
        const last = cur.points[cur.points.length - 1];
        if (last && distance(last, p) < 8) return;
        if (!last) map.current?.setView(p, 17);
        else map.current?.panTo(p);
        setMode({ ...cur, points: [...cur.points, p] });
      },
      () => {
        setLocError('Location is off for Herd. Turn it on in Settings to record a walk, or draw the route instead.');
        stopRecording();
        setMode({ kind: 'browse' });
      },
      { enableHighAccuracy: true, maximumAge: 0 },
    );
  }

  function stopRecording() {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    wake.current?.release().catch(() => {});
    wake.current = null;
  }

  // Keep the recording timer moving.
  useEffect(() => {
    if (mode.kind !== 'record') return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [mode.kind]);

  const finishRoute = (points: LatLng[]) => {
    stopRecording();
    setMode({ kind: 'browse' });
    if (points.length < 2) return;
    setNaming({ draft: { kind: 'route', name: '', notes: null, points } });
  };

  const sel = places.find((p) => p.id === selected) ?? null;
  const routes = places.filter((p) => p.kind === 'route');
  const spots = places.filter((p) => p.kind !== 'route');
  const bagCount = publicState.spots.filter((s) => s.kind !== 'dog_park').length;
  const parkCount = publicState.spots.filter((s) => s.kind === 'dog_park').length;

  return (
    <div className="map-screen" role="dialog" aria-modal="true" aria-label={title}>
      <div className="map-top">
        <h1>{title}</h1>
        <button className="btn-text" onClick={onClose}>
          Done
        </button>
      </div>
      <div className="map-wrap">
        <div ref={el} className="map-canvas" />
        {!ready && !loadError && (
          <div className="map-overlay">
            <Spinner label="Loading the map" />
          </div>
        )}
        {loadError && (
          <div className="map-overlay">
            <p>{loadError}</p>
          </div>
        )}
        {tilesBroken && (
          <p className="map-note">The map background can’t load right now. Your saved places still show.</p>
        )}
        {ready && (
          <div className="map-tools">
            <button className="map-tool" onClick={() => locate()} aria-label="Show where I am">
              {Icons.locate}
            </button>
          </div>
        )}
        {ready && (mode.kind === 'draw' || mode.kind === 'spot') && (
          <p className="map-hint">{mode.kind === 'draw' ? 'Tap along your usual route' : 'Tap the map where it is'}</p>
        )}
      </div>

      <div className="map-panel">
        {mode.kind === 'draw' && (
          <div className="stack">
            <p>
              <strong>{mode.points.length < 2 ? 'Tap the start of the walk, then each turn.' : formatDistance(routeLength(mode.points))}</strong>
              {mode.points.length >= 2 && <span className="muted">, about {walkMinutes(routeLength(mode.points))} min</span>}
            </p>
            <div className="map-actions">
              <button className="btn btn-quiet btn-small" onClick={() => setMode({ kind: 'draw', points: mode.points.slice(0, -1) })} disabled={!mode.points.length}>
                {Icons.undo}
                Undo
              </button>
              {mode.points.length >= 3 && (
                <button
                  className="btn btn-quiet btn-small"
                  onClick={() => setMode({ kind: 'draw', points: [...mode.points, mode.points[0]] })}
                >
                  Back to start
                </button>
              )}
              <button className="btn btn-quiet btn-small" onClick={() => setMode({ kind: 'browse' })}>
                Cancel
              </button>
              <button className="btn btn-primary btn-small" onClick={() => finishRoute(mode.points)} disabled={mode.points.length < 2}>
                Save route
              </button>
            </div>
          </div>
        )}

        {mode.kind === 'record' && (
          <div className="stack">
            <p>
              <strong>Recording</strong>{' '}
              <span className="muted">
                {formatDistance(routeLength(mode.points))}, {Math.floor((Date.now() - mode.started) / 60000)} min
              </span>
            </p>
            <p className="muted small">Keep Herd open while you walk. If the screen locks, recording pauses.</p>
            <div className="map-actions">
              <button
                className="btn btn-quiet btn-small"
                onClick={() => {
                  stopRecording();
                  setMode({ kind: 'browse' });
                }}
              >
                Cancel
              </button>
              <button className="btn btn-primary btn-small" onClick={() => finishRoute(mode.points)}>
                Stop and save
              </button>
            </div>
          </div>
        )}

        {mode.kind === 'spot' && (
          <div className="map-actions">
            <button
              className="btn btn-quiet btn-small"
              onClick={() =>
                navigator.geolocation?.getCurrentPosition(
                  (pos) => {
                    setMode({ kind: 'browse' });
                    setNaming({ draft: { kind: 'park', name: '', notes: null, points: [roundPoint([pos.coords.latitude, pos.coords.longitude])] } });
                  },
                  () => setLocError('Location is off for Herd. Tap the map instead.'),
                  { enableHighAccuracy: true, timeout: 10_000 },
                )
              }
            >
              {Icons.locate}
              Where I am now
            </button>
            <button className="btn btn-quiet btn-small" onClick={() => setMode({ kind: 'browse' })}>
              Cancel
            </button>
          </div>
        )}

        {mode.kind === 'browse' && (
          <>
            {locError && <p className="form-notice">{locError}</p>}

            {pickedPublic && (
              <div className="map-card">
                <div>
                  <p className="row-title">{pickedPublic.name ?? PUBLIC_LABEL[pickedPublic.kind]}</p>
                  <p className="muted small">
                    {pickedPublic.name ? `${PUBLIC_LABEL[pickedPublic.kind]}. ` : ''}From OpenStreetMap. It may not always be stocked.
                  </p>
                </div>
                <div className="map-actions">
                  {editable && (
                    <button
                      className="btn btn-quiet btn-small"
                      onClick={() => {
                        setNaming({
                          draft: {
                            kind: pickedPublic.kind === 'dog_park' ? 'park' : 'bag_spot',
                            name: pickedPublic.name ?? (pickedPublic.kind === 'dog_park' ? 'Dog park' : 'Bag dispenser'),
                            notes: null,
                            points: [roundPoint(pickedPublic.at)],
                          },
                        });
                        setPickedPublic(null);
                      }}
                    >
                      Save to our map
                    </button>
                  )}
                  <button className="btn btn-quiet btn-small" onClick={() => setPickedPublic(null)}>
                    Close
                  </button>
                </div>
              </div>
            )}

            {sel && (
              <div className="map-card">
                <div>
                  <p className="row-title">{sel.name}</p>
                  <p className="muted small">
                    {KIND_LABEL[sel.kind]}
                    {sel.kind === 'route' && sel.points.length > 1
                      ? `, ${formatDistance(routeLength(sel.points))}, about ${walkMinutes(routeLength(sel.points))} min`
                      : ''}
                  </p>
                  {sel.notes && <p className="small">{sel.notes}</p>}
                </div>
                <div className="map-actions">
                  <a
                    className="btn btn-quiet btn-small"
                    href={`https://maps.apple.com/?daddr=${sel.points[0][0]},${sel.points[0][1]}&dirflg=w`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Directions
                  </a>
                  {editable && (
                    <button className="btn btn-quiet btn-small" onClick={() => setNaming({ draft: { kind: sel.kind, name: sel.name, notes: sel.notes, points: sel.points }, place: sel })}>
                      Edit
                    </button>
                  )}
                  <button className="btn btn-quiet btn-small" onClick={() => setSelected(null)}>
                    Close
                  </button>
                </div>
              </div>
            )}

            {editable && (
              <div className="map-add">
                <button className="btn btn-quiet btn-small" onClick={() => { setSelected(null); setMode({ kind: 'draw', points: [] }); }} disabled={!ready}>
                  Draw a route
                </button>
                <button className="btn btn-quiet btn-small" onClick={startRecording} disabled={!ready}>
                  Record a walk
                </button>
                <button className="btn btn-quiet btn-small" onClick={() => { setSelected(null); setMode({ kind: 'spot' }); }} disabled={!ready}>
                  Add a spot
                </button>
              </div>
            )}

            <PlaceList title="Routes" list={routes} onPick={focusPlace} empty={editable ? 'Draw your usual walk, or record it next time you go out.' : null} />
            <PlaceList title="Parks and spots" list={spots} onPick={focusPlace} empty={editable ? 'Save the dog park, a bag dispenser, the good water fountain.' : null} />

            <section className="group">
              <label className="check-row">
                <input type="checkbox" checked={showPublic} onChange={(e) => setShowPublic(e.target.checked)} />
                <span>
                  Show public poop bag spots and dog parks
                  <span className="muted">
                    {!showPublic
                      ? 'From OpenStreetMap, mapped by volunteers.'
                      : publicState.status === 'zoom'
                        ? 'Zoom in closer to see them.'
                        : publicState.status === 'loading'
                          ? 'Looking nearby…'
                          : publicState.status === 'error'
                            ? publicState.message
                            : publicState.status === 'done'
                              ? bagCount + parkCount === 0
                                ? 'None mapped here yet. Add the ones you know.'
                                : [bagCount ? `${bagCount} bag ${bagCount === 1 ? 'spot' : 'spots'}` : '', parkCount ? `${parkCount} dog ${parkCount === 1 ? 'park' : 'parks'}` : '']
                                    .filter(Boolean)
                                    .join(' and ') + ' on screen, from OpenStreetMap.'
                              : 'From OpenStreetMap, mapped by volunteers.'}
                  </span>
                </span>
              </label>
            </section>
          </>
        )}
      </div>

      {naming && (
        <PlaceSheet
          draft={naming.draft}
          place={naming.place}
          onClose={() => setNaming(null)}
          onSave={async (input) => {
            const ok = naming.place ? await onUpdate?.(naming.place.id, input) : await onAdd?.(input);
            if (ok) setNaming(null);
          }}
          onDelete={
            naming.place && onDelete
              ? async () => {
                  const ok = await onDelete(naming.place!.id);
                  if (ok) {
                    setNaming(null);
                    setSelected(null);
                  }
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function PlaceList({ title, list, onPick, empty }: { title: string; list: MapPlace[]; onPick: (p: MapPlace) => void; empty: string | null }) {
  if (!list.length && !empty) return null;
  return (
    <section className="group">
      <h2 className="group-label">{title}</h2>
      {list.length === 0 ? (
        <div className="empty empty-inline">
          <p>{empty}</p>
        </div>
      ) : (
        <ul className="list">
          {list.map((p) => (
            <li key={p.id}>
              <button className="row row-button" onClick={() => onPick(p)}>
                <span className={`map-list-mark map-pin-${p.kind}`} dangerouslySetInnerHTML={{ __html: p.kind === 'route' ? routeSvg : pinHtml(p.kind, '') }} />
                <span className="row-text">
                  <span className="row-title">{p.name}</span>
                  <span className="row-meta">
                    {p.kind === 'route' && p.points.length > 1
                      ? `${formatDistance(routeLength(p.points))}, about ${walkMinutes(routeLength(p.points))} min`
                      : KIND_LABEL[p.kind]}
                    {p.notes ? `. ${p.notes}` : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const routeSvg =
  '<span class="map-pin map-pin-route"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6"/></svg></span>';

function PlaceSheet({
  draft,
  place,
  onClose,
  onSave,
  onDelete,
}: {
  draft: PlaceInput;
  place?: MapPlace;
  onClose: () => void;
  onSave: (input: PlaceInput) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [kind, setKind] = useState<PlaceKind>(draft.kind);
  const [name, setName] = useState(draft.name);
  const [notes, setNotes] = useState(draft.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const isRoute = draft.kind === 'route';
  const len = isRoute ? routeLength(draft.points) : 0;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    await onSave({ kind, name: name.trim().slice(0, 60), notes: notes.trim() || null, points: draft.points });
    setBusy(false);
  }

  return (
    <Sheet
      title={place ? `Edit ${place.name}` : isRoute ? 'Save this route' : 'Save this spot'}
      onClose={onClose}
      footer={
        <button className="btn btn-primary btn-block" form="place-form" disabled={busy || !name.trim()}>
          {place ? 'Save changes' : 'Save'}
        </button>
      }
    >
      <form id="place-form" className="stack" onSubmit={save}>
        {isRoute ? (
          <p className="muted">
            {formatDistance(len)}, about {walkMinutes(len)} minutes at an easy pace.
          </p>
        ) : (
          <div className="field">
            <span className="field-label">What is it</span>
            <Chips<PlaceKind>
              label="What is it"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'park', label: 'Park' },
                { value: 'bag_spot', label: 'Poop bags' },
                { value: 'other', label: 'Something else' },
              ]}
            />
          </div>
        )}
        <Field label="Name">
          <input
            id="place-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
            autoFocus={!place}
            placeholder={isRoute ? 'Morning loop' : kind === 'bag_spot' ? 'Bags at the 3rd St gate' : kind === 'park' ? 'Long Meadow' : 'Water fountain'}
          />
        </Field>
        <Field label="Notes" hint={isRoute ? 'Anything a walker should know. Sitters see this too.' : undefined}>
          <textarea
            id="place-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder={isRoute ? 'Avoid the corner with the off-leash golden' : 'Off leash before 9 AM'}
          />
        </Field>
        {onDelete &&
          (confirm ? (
            <div className="danger-zone">
              <p>Remove {place?.name} from the map?</p>
              <div className="btn-pair">
                <button type="button" className="btn btn-quiet" onClick={() => setConfirm(false)}>
                  Keep it
                </button>
                <button type="button" className="btn btn-danger" onClick={onDelete}>
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn-text btn-text-danger" onClick={() => setConfirm(true)}>
              Remove from the map
            </button>
          ))}
      </form>
    </Sheet>
  );
}
