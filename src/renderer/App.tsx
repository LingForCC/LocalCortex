/**
 * App shell — nav between Rules / Run history / Sources / Settings.
 */

import * as React from 'react';
import { Button } from '@renderer/components/ui/button';
import { RuleList } from './views/RuleList';
import { RunHistory } from './views/RunHistory';
import { Sources } from './views/Sources';
import { Settings } from './views/Settings';

type Tab = 'rules' | 'runs' | 'sources' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'rules', label: 'Rules' },
  { id: 'runs', label: 'Run history' },
  { id: 'sources', label: 'Sources' },
  { id: 'settings', label: 'Settings' },
];

export function App() {
  const [tab, setTab] = React.useState<Tab>('rules');

  return (
    <div className="flex h-screen">
      <aside className="w-52 shrink-0 border-r bg-muted/40 p-3">
        <h1 className="mb-4 px-2 text-sm font-semibold tracking-tight">LocalCortex</h1>
        <nav className="flex flex-col gap-1">
          {TABS.map((t) => (
            <Button
              key={t.id}
              variant={tab === t.id ? 'secondary' : 'ghost'}
              className="justify-start"
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </Button>
          ))}
        </nav>
      </aside>

      <main className="flex-1 overflow-auto p-6">
        {tab === 'rules' && <RuleList />}
        {tab === 'runs' && <RunHistory />}
        {tab === 'sources' && <Sources />}
        {tab === 'settings' && <Settings />}
      </main>
    </div>
  );
}
