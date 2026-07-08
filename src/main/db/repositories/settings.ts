/**
 * Repository for the `app_settings` key/value table.
 *
 * Spec: docs/architecture.md §6.4, §6.5. Stores the global tick-interval
 * default and concurrency cap (with an optional ingress shared secret). Values
 * are JSON-encoded. The repo returns a fully-defaulted AppSettings object even
 * when the table is empty (so first launch gets sane defaults).
 */

import type { DatabaseSync } from 'node:sqlite';
import { AppSettingsSchema } from '@shared/schemas/settings-schema';
import type { AppSettings } from '@shared/types';
import {
  DEFAULT_TICK_INTERVAL_SECONDS,
  DEFAULT_CONCURRENCY,
  DEFAULT_APPEARANCE,
} from '@shared/constants';

const SETTINGS_KEY = 'app';

export class SettingsRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** Read settings, applying defaults for any missing keys. */
  get(): AppSettings {
    const row = this.db
      .prepare(`SELECT value FROM app_settings WHERE key = ?`)
      .get(SETTINGS_KEY) as { value?: string } | undefined;
    const stored = row?.value ? (JSON.parse(row.value) as Record<string, unknown>) : {};
    return AppSettingsSchema.parse({
      tickIntervalSeconds: stored['tickIntervalSeconds'] ?? DEFAULT_TICK_INTERVAL_SECONDS,
      concurrency: stored['concurrency'] ?? DEFAULT_CONCURRENCY,
      appearance: typeof stored['appearance'] === 'string' ? stored['appearance'] : DEFAULT_APPEARANCE,
      ...(typeof stored['ingressSecret'] === 'string'
        ? { ingressSecret: stored['ingressSecret'] }
        : {}),
      ...(typeof stored['codexCliPath'] === 'string' ? { codexCliPath: stored['codexCliPath'] } : {}),
      ...(typeof stored['claudeCliPath'] === 'string'
        ? { claudeCliPath: stored['claudeCliPath'] }
        : {}),
    });
  }

  /** Persist a (partial) settings update, merged with current values. */
  update(patch: Partial<AppSettings>): AppSettings {
    const current = this.get();
    const merged = { ...current, ...patch };
    const validated = AppSettingsSchema.parse(merged);
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(SETTINGS_KEY, JSON.stringify(validated));
    return validated;
  }
}
