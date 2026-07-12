/**
 * App shell — nav between Home / Handoff profiles / Handoffs / Run history /
 * Rules / Sources / Settings.
 *
 * The same renderer entry is reused for the prompt-submit handoff popup: when
 * loaded with `?view=handoff-prompt`, we render <HandoffPrompt/> instead of the
 * tabbed shell (see src/main/index.ts openHandoffPrompt).
 */

import * as React from 'react';
import { Button } from '@renderer/components/ui/button';
import { RuleList } from './views/RuleList';
import { RunHistory } from './views/RunHistory';
import { Handoffs } from './views/Handoffs';
import { HandoffPrompt } from './views/HandoffPrompt';
import { Sources } from './views/Sources';
import { Settings } from './views/Settings';
import { HandoffProfiles } from './views/HandoffProfiles';
import { Home } from './views/Home';
import { useSettingsStore } from './store/settings';

type Tab = 'home' | 'handoffProfiles' | 'rules' | 'runs' | 'handoffs' | 'sources' | 'settings';

interface TabDef {
  id: Tab;
  label: string;
  advanced?: boolean;
}

const TABS: TabDef[] = [
  { id: 'home', label: 'Home' },
  { id: 'handoffProfiles', label: 'Handoff profiles' },
  { id: 'handoffs', label: 'Handoffs' },
  { id: 'runs', label: 'Run history' },
  { id: 'rules', label: 'Rules', advanced: true },
  { id: 'sources', label: 'Sources', advanced: true },
  { id: 'settings', label: 'Settings' },
];

/** What the renderer should show, derived from the launch `?view=` query flag. */
function readView(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('view');
}

export function App() {
  // Popup window: skip the tabbed shell entirely.
  if (readView() === 'handoff-prompt') {
    return <HandoffPrompt />;
  }

  return <Shell />;
}

function Shell() {
  const [tab, setTab] = React.useState<Tab>('home');

  // Load settings on mount so the persisted appearance is applied. (The shell
  // no longer gates on setup being complete — handoff profiles are managed in
  // the Handoff profiles tab and may legitimately be empty on first run.)
  const loadSettings = useSettingsStore((s) => s.load);
  React.useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Apply the effective dark-mode state from Electron's nativeTheme.
  React.useEffect(() => {
    const apply = (dark: boolean): void => {
      document.documentElement.classList.toggle('dark', dark);
    };
    const off = window.api.theme.onApply(apply);
    return off;
  }, []);

  // Separate the primary tabs from the advanced ones.
  const primaryTabs = TABS.filter((t) => !t.advanced);
  const advancedTabs = TABS.filter((t) => t.advanced);

  return (
    <div className="flex h-screen">
      <aside className="w-52 shrink-0 border-r bg-muted/40 p-3">
        <h1 className="mb-4 px-2 text-sm font-semibold tracking-tight">LocalCortex</h1>
        <nav className="flex flex-col gap-1">
          {primaryTabs.map((t) => (
            <TabButton key={t.id} tab={t} active={tab === t.id} onClick={() => setTab(t.id)} />
          ))}
          <div className="my-2 border-t" />
          <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Advanced</p>
          {advancedTabs.map((t) => (
            <TabButton key={t.id} tab={t} active={tab === t.id} onClick={() => setTab(t.id)} />
          ))}
        </nav>
      </aside>

      <main className="flex-1 overflow-auto p-6">
        {tab === 'home' && <Home onGoToHandoffProfiles={() => setTab('handoffProfiles')} />}
        {tab === 'handoffProfiles' && <HandoffProfiles />}
        {tab === 'rules' && <RuleList />}
        {tab === 'runs' && <RunHistory />}
        {tab === 'handoffs' && <Handoffs />}
        {tab === 'sources' && <Sources />}
        {tab === 'settings' && <Settings />}
      </main>
    </div>
  );
}

function TabButton(props: {
  tab: TabDef;
  active: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <Button
      variant={props.active ? 'secondary' : 'ghost'}
      className="justify-start"
      onClick={props.onClick}
    >
      {props.tab.label}
    </Button>
  );
}
