import { useCallback, useEffect, useMemo, useState } from 'react';
import { isPreviewBuild, readConfig } from './lib/config';
import { createDemoBackend, resetDemo } from './lib/demoBackend';
import { createSupabaseBackend } from './lib/supabaseBackend';
import type { Backend, Household, Session } from './lib/types';
import { AuthScreen } from './screens/Auth';
import { SetupScreen } from './screens/Setup';
import { TodayScreen } from './screens/Today';
import { PetsScreen } from './screens/Pets';
import { ActivityScreen } from './screens/Activity';
import { HouseholdScreen } from './screens/HouseholdScreen';
import { AppProvider, useHouseholdData } from './state';
import { Icons, Spinner } from './ui';

type Tab = 'today' | 'pets' | 'activity' | 'household';
const MODE_KEY = 'herd-mode';

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

export default function App() {
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
  const [household, setHousehold] = useState<Household | null | undefined>(undefined);

  useEffect(() => {
    setSession(undefined);
    setHousehold(undefined);
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

  useEffect(() => {
    if (!backend || !session) {
      setHousehold(session === null ? null : undefined);
      return;
    }
    let alive = true;
    backend
      .getMyHousehold()
      .then((h) => alive && setHousehold(h))
      .catch(() => alive && setHousehold(null));
    return () => {
      alive = false;
    };
  }, [backend, session?.userId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  if (session === undefined) return <FullScreenLoading />;

  if (!backend || !session) {
    return <AuthScreen backend={mode === 'live' ? backend : null} configured={!!config} onTryDemo={startDemo} />;
  }

  if (household === undefined) return <FullScreenLoading />;

  if (!household) {
    return (
      <SetupScreen
        backend={backend}
        pendingJoin={pendingJoin}
        onReady={(h) => {
          writeStored('herd-pending-join', null);
          setHousehold(h);
        }}
      />
    );
  }

  return (
    <Shell
      key={household.id}
      backend={backend}
      session={session}
      household={household}
      onLeftHousehold={() => setHousehold(null)}
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
  onLeftHousehold,
  exitDemo,
}: {
  backend: Backend;
  session: Session;
  household: Household;
  onLeftHousehold: () => void;
  exitDemo: () => void;
}) {
  const [tab, setTab] = useState<Tab>('today');
  const data = useHouseholdData(backend, session, household);
  const { snapshot } = data;

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

  const tabs: { key: Tab; label: string; icon: JSX.Element }[] = [
    { key: 'today', label: 'Today', icon: Icons.today },
    { key: 'pets', label: 'Pets', icon: Icons.paw },
    { key: 'activity', label: 'Activity', icon: Icons.activity },
    { key: 'household', label: 'Household', icon: Icons.home },
  ];

  return (
    <AppProvider
      value={{
        backend,
        session,
        snapshot,
        me,
        freshLogIds: data.freshLogIds,
        reload: data.reload,
        complete: data.complete,
        undo: data.undo,
        run: data.run,
        onLeftHousehold,
        exitDemo,
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
          {tab === 'today' && <TodayScreen onGoToPets={() => setTab('pets')} />}
          {tab === 'pets' && <PetsScreen />}
          {tab === 'activity' && <ActivityScreen />}
          {tab === 'household' && <HouseholdScreen />}
        </main>
        <nav className="tabbar" aria-label="Sections">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={`tab${tab === t.key ? ' tab-on' : ''}`}
              aria-current={tab === t.key ? 'page' : undefined}
              onClick={() => setTab(t.key)}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </AppProvider>
  );
}
