import { useCallback, useEffect, useMemo, useState } from 'react';
import { isPreviewBuild, readConfig } from './lib/config';
import { todayISO } from './lib/dates';
import { createDemoBackend, resetDemo } from './lib/demoBackend';
import { createSupabaseBackend } from './lib/supabaseBackend';
import type { Backend, Household, Session } from './lib/types';
import { AuthScreen } from './screens/Auth';
import { SetupForms, SetupScreen } from './screens/Setup';
import { TodayScreen } from './screens/Today';
import { CalendarScreen } from './screens/Calendar';
import { PetsScreen } from './screens/Pets';
import { ActivityScreen } from './screens/Activity';
import { HouseholdScreen } from './screens/HouseholdScreen';
import { SitterView } from './screens/Sitter';
import { WalkMap } from './screens/WalkMap';
import { AddFlow } from './sheets/AddFlow';
import { AppProvider, useHouseholdData, type AddPreset } from './state';
import { Icons, Sheet, Spinner } from './ui';

type Tab = 'today' | 'calendar' | 'pets' | 'activity' | 'household';
const MODE_KEY = 'herd-mode';
const CURRENT_KEY = 'herd-current-household';

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStored(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** Invite links look like https://…/herd/?join=ABCD2345 */
function captureInviteCode(): string | null {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('join');
  if (code) {
    writeStored('herd-pending-join', code);
    params.delete('join');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
  }
  return readStored('herd-pending-join');
}

/** Sitter links look like https://…/herd/?sit=TOKEN and need no account. */
function sitterToken(): string | null {
  return new URLSearchParams(window.location.search).get('sit');
}

export default function App() {
  const config = useMemo(readConfig, []);
  const sit = useMemo(sitterToken, []);
  if (sit) return <SitterRoute token={sit} hasConfig={!!config} />;
  return <MainApp />;
}

function SitterRoute({ token, hasConfig }: { token: string; hasConfig: boolean }) {
  const config = useMemo(readConfig, []);
  const backend = useMemo<Backend>(
    () => (hasConfig && config ? createSupabaseBackend(config) : createDemoBackend()),
    [hasConfig, config],
  );
  useEffect(() => {
    // Leave the address as-is so "Add to Home Screen" keeps the sitter link,
    // rather than the app's own start page.
    document.querySelector('link[rel="manifest"]')?.remove();
    document.title = 'Herd: pet care for today';
  }, []);
  return <SitterView backend={backend} token={token} />;
}

function MainApp() {
  const config = useMemo(readConfig, []);
  const [pendingJoin] = useState(captureInviteCode);
  const [mode, setMode] = useState<'live' | 'demo' | null>(() =>
    isPreviewBuild ? 'demo' : readStored(MODE_KEY) === 'demo' ? 'demo' : config ? 'live' : null,
  );
  const backend = useMemo<Backend | null>(() => {
    if (mode === 'demo') return createDemoBackend();
    if (mode === 'live' && config) return createSupabaseBackend(config);
    return null;
  }, [mode, config]);

  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [households, setHouseholds] = useState<Household[] | undefined>(undefined);
  const [currentId, setCurrentId] = useState<string | null>(() => readStored(CURRENT_KEY));

  useEffect(() => {
    setSession(undefined);
    setHouseholds(undefined);
    if (!backend) {
      setSession(null);
      return;
    }
    let alive = true;
    backend.getSession().then((s) => alive && setSession(s));
    const off = backend.onAuthChange((s) => alive && setSession(s));
    return () => {
      alive = false;
      off();
    };
  }, [backend]);

  const refreshHouseholds = useCallback(async () => {
    if (!backend) return;
    try {
      setHouseholds(await backend.listMyHouseholds());
    } catch {
      setHouseholds([]);
    }
  }, [backend]);

  useEffect(() => {
    if (!backend || !session) {
      setHouseholds(session === null ? [] : undefined);
      return;
    }
    refreshHouseholds();
  }, [backend, session?.userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = useCallback((id: string | null) => {
    writeStored(CURRENT_KEY, id);
    setCurrentId(id);
  }, []);

  const startDemo = useCallback(() => {
    resetDemo();
    writeStored(MODE_KEY, 'demo');
    setMode('demo');
  }, []);

  const exitDemo = useCallback(() => {
    writeStored(MODE_KEY, null);
    resetDemo();
    setMode(config ? 'live' : null);
  }, [config]);

  const onReady = useCallback(
    (h: Household) => {
      writeStored('herd-pending-join', null);
      setHouseholds((list) => [...(list ?? []).filter((x) => x.id !== h.id), h]);
      choose(h.id);
    },
    [choose],
  );

  if (session === undefined) return <FullScreenLoading />;

  if (!backend || !session) {
    return <AuthScreen backend={mode === 'live' ? backend : null} configured={!!config} onTryDemo={startDemo} />;
  }

  if (households === undefined) return <FullScreenLoading />;

  const current = households.find((h) => h.id === currentId) ?? households[0];
  if (!current) return <SetupScreen backend={backend} pendingJoin={pendingJoin} onReady={onReady} />;

  return (
    <Shell
      key={current.id}
      backend={backend}
      session={session}
      household={current}
      households={households}
      pendingJoin={pendingJoin}
      onSwitch={choose}
      onReady={onReady}
      onLeftHousehold={async () => {
        choose(null);
        await refreshHouseholds();
      }}
      exitDemo={exitDemo}
    />
  );
}

function FullScreenLoading() {
  return (
    <div className="full-center">
      <Spinner />
    </div>
  );
}

function Shell({
  backend,
  session,
  household,
  households,
  pendingJoin,
  onSwitch,
  onReady,
  onLeftHousehold,
  exitDemo,
}: {
  backend: Backend;
  session: Session;
  household: Household;
  households: Household[];
  pendingJoin: string | null;
  onSwitch: (id: string) => void;
  onReady: (h: Household) => void;
  onLeftHousehold: () => void;
  exitDemo: () => void;
}) {
  const [tab, setTab] = useState<Tab>('today');
  const [date, setDate] = useState(todayISO());
  const [adding, setAdding] = useState(false);
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [addPreset, setAddPreset] = useState<AddPreset | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [openPetId, setOpenPetId] = useState<string | null>(null);
  const data = useHouseholdData(backend, session, household);
  const { snapshot } = data;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab, openPetId]);

  if (!snapshot) {
    return data.error ? (
      <div className="full-center stack">
        <p className="muted">Couldn’t load your household. {data.error}</p>
        <button className="btn btn-primary" onClick={data.reload}>
          Try again
        </button>
      </div>
    ) : (
      <FullScreenLoading />
    );
  }

  const me = snapshot.members.find((m) => m.user_id === session.userId);
  if (!me) {
    // We were removed from this household by its owner.
    return (
      <div className="full-center stack">
        <p className="muted">You’re no longer a member of {snapshot.household.name}.</p>
        <button className="btn btn-primary" onClick={onLeftHousehold}>
          Continue
        </button>
      </div>
    );
  }

  // Today sits in the middle, as home.
  const tabs: { key: Tab; label: string; icon: JSX.Element }[] = [
    { key: 'pets', label: 'Pets', icon: Icons.paw },
    { key: 'calendar', label: 'Calendar', icon: Icons.calendar },
    { key: 'today', label: 'Today', icon: Icons.home },
    { key: 'activity', label: 'Activity', icon: Icons.activity },
    { key: 'household', label: 'Household', icon: Icons.people },
  ];
  const run = data.run;

  return (
    <AppProvider
      value={{
        backend,
        session,
        snapshot,
        logs: data.logs,
        historyFrom: data.historyFrom,
        historyLoading: data.historyLoading,
        loadHistory: data.loadHistory,
        me,
        households,
        switchHousehold: onSwitch,
        addHousehold: () => setAdding(true),
        freshLogIds: data.freshLogIds,
        reload: data.reload,
        checkOff: data.checkOff,
        skip: data.skip,
        snooze: data.snooze,
        undo: data.undo,
        editLog: data.editLog,
        logAdhoc: data.logAdhoc,
        run: data.run,
        onLeftHousehold,
        exitDemo,
        date,
        setDate,
        goToDay: (d) => {
          setDate(d);
          setTab('today');
        },
        openSitterPreview: setPreviewToken,
        viewPet: (id) => {
          setOpenPetId(id);
          setTab('pets');
        },
        openAdd: (preset) => setAddPreset(preset ?? { kind: 'menu' }),
        openMap: () => setMapOpen(true),
      }}
    >
      <div className="app">
        {backend.kind === 'demo' && (
          <div className="demo-bar">
            <span>Demo household. Changes stay on this device.</span>
            {!isPreviewBuild && (
              <button className="btn-text" onClick={exitDemo}>
                Exit demo
              </button>
            )}
          </div>
        )}
        <main className="screen">
          {tab === 'today' && <TodayScreen />}
          {tab === 'calendar' && <CalendarScreen />}
          {tab === 'pets' && <PetsScreen openPetId={openPetId} setOpenPetId={setOpenPetId} />}
          {tab === 'activity' && <ActivityScreen />}
          {tab === 'household' && <HouseholdScreen />}
        </main>
        <nav className="tabbar" aria-label="Sections">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={`tab${tab === t.key ? ' tab-on' : ''}${t.key === 'today' ? ' tab-home' : ''}`}
              aria-current={tab === t.key ? 'page' : undefined}
              onClick={() => {
                if (t.key === 'today' && tab === 'today') setDate(todayISO());
                if (t.key === 'pets' && tab === 'pets') setOpenPetId(null);
                setTab(t.key);
              }}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {adding && (
        <Sheet title="Add another household" onClose={() => setAdding(false)}>
          <SetupForms
            backend={backend}
            pendingJoin={pendingJoin}
            onReady={(h) => {
              setAdding(false);
              onReady(h);
            }}
          />
        </Sheet>
      )}

      {addPreset && <AddFlow key={JSON.stringify(addPreset)} preset={addPreset} onClose={() => setAddPreset(null)} />}

      {mapOpen && (
        <WalkMap
          title={`${snapshot.household.name} walk map`}
          places={snapshot.places}
          onClose={() => setMapOpen(false)}
          onAdd={
            snapshot.behind
              ? undefined
              : async (input) => !!(await run(() => backend.addPlace(snapshot.household.id, input).then(() => true), `Saved ${input.name}`))
          }
          onUpdate={async (id, input) => !!(await run(() => backend.updatePlace(id, input).then(() => true), 'Saved'))}
          onDelete={async (id) => !!(await run(() => backend.deletePlace(id).then(() => true), 'Removed from the map'))}
        />
      )}

      {previewToken && (
        <div className="preview-overlay" role="dialog" aria-modal="true" aria-label="Sitter view preview">
          <div className="preview-bar">
            <span>Preview of the sitter’s view. Check-offs are turned off here.</span>
            <button className="btn-text" onClick={() => setPreviewToken(null)}>
              Close
            </button>
          </div>
          <SitterView backend={backend} token={previewToken} preview />
        </div>
      )}
    </AppProvider>
  );
}
