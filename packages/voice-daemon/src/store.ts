import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import type {
  DefaultVoiceMode,
  ManualVoiceOverride,
  SessionAction,
  SessionRecord,
  SessionSelector,
  SessionSummary,
  SessionVoiceState
} from '@cli2voice/voice-core';

function parseMetadata(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)])
    );
  } catch {
    return {};
  }
}

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function toSessionRecord(row: any): SessionRecord {
  return {
    sessionId: row.session_id,
    provider: row.provider,
    workspacePath: row.workspace_path,
    defaultMode: row.default_mode as DefaultVoiceMode,
    planMode: Boolean(row.plan_mode),
    manualVoiceOverride: (row.manual_voice_override ?? null) as ManualVoiceOverride,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: parseMetadata(row.metadata_json)
  };
}

export class Cli2VoiceStore {
  private readonly db: InstanceType<typeof DatabaseSync>;

  constructor(private readonly dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  async initialize(): Promise<void> {
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        default_mode TEXT NOT NULL,
        plan_mode INTEGER NOT NULL DEFAULT 0,
        manual_voice_override TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS utterances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        source TEXT NOT NULL,
        input_text TEXT NOT NULL,
        spoken_text TEXT NOT NULL,
        decision_reason TEXT NOT NULL,
        spoken INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE SET NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  upsertSession(input: {
    sessionId: string;
    provider: string;
    workspacePath: string;
    defaultMode: DefaultVoiceMode;
    metadata: Record<string, string>;
  }): SessionRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
          INSERT INTO sessions (
            session_id, provider, workspace_path, default_mode, plan_mode, manual_voice_override, created_at, updated_at, metadata_json
          ) VALUES (
            :session_id, :provider, :workspace_path, :default_mode, 0, NULL, :created_at, :updated_at, :metadata_json
          )
          ON CONFLICT(session_id) DO UPDATE SET
            provider = excluded.provider,
            workspace_path = excluded.workspace_path,
            default_mode = excluded.default_mode,
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at
        `
      )
      .run({
        session_id: input.sessionId,
        provider: input.provider,
        workspace_path: input.workspacePath,
        default_mode: input.defaultMode,
        created_at: now,
        updated_at: now,
        metadata_json: JSON.stringify(input.metadata)
      });

    return this.getSession(input.sessionId) as SessionRecord;
  }

  getSession(sessionId: string): SessionRecord | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId);
    return row ? toSessionRecord(row) : null;
  }

  resolveSession(selector: SessionSelector): SessionRecord | null {
    if (selector.sessionId) {
      return this.getSession(selector.sessionId);
    }

    if (selector.provider && selector.workspacePath) {
      const row = this.db
        .prepare(
          'SELECT * FROM sessions WHERE provider = ? AND workspace_path = ? ORDER BY updated_at DESC LIMIT 1'
        )
        .get(selector.provider, selector.workspacePath);
      return row ? toSessionRecord(row) : null;
    }

    if (selector.provider) {
      const row = this.db.prepare('SELECT * FROM sessions WHERE provider = ? ORDER BY updated_at DESC LIMIT 1').get(selector.provider);
      return row ? toSessionRecord(row) : null;
    }

    if (selector.workspacePath) {
      const row = this.db.prepare('SELECT * FROM sessions WHERE workspace_path = ? ORDER BY updated_at DESC LIMIT 1').get(selector.workspacePath);
      return row ? toSessionRecord(row) : null;
    }

    return null;
  }

  listSessions(): SessionSummary[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            s.*,
            (
              SELECT MAX(created_at)
              FROM utterances u
              WHERE u.session_id = s.session_id
            ) AS last_utterance_at,
            (
              SELECT COUNT(*)
              FROM utterances u
              WHERE u.session_id = s.session_id
            ) AS utterance_count
          FROM sessions s
          ORDER BY s.updated_at DESC
        `
      )
      .all() as any[];

    return rows.map((row) => ({
      ...toSessionRecord(row),
      lastUtteranceAt: row.last_utterance_at ?? null,
      utteranceCount: Number(row.utterance_count ?? 0)
    }));
  }

  appendAction(sessionId: string, action: SessionAction): void {
    this.db
      .prepare('INSERT INTO actions (session_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)')
      .run(sessionId, action.kind, JSON.stringify(action), new Date().toISOString());
    this.touchSession(sessionId);
  }

  updateSessionState(sessionId: string, state: SessionVoiceState): SessionRecord {
    this.db
      .prepare(
        'UPDATE sessions SET default_mode = ?, plan_mode = ?, manual_voice_override = ?, updated_at = ? WHERE session_id = ?'
      )
      .run(state.defaultMode, state.planMode ? 1 : 0, state.manualVoiceOverride, new Date().toISOString(), sessionId);

    return this.getSession(sessionId) as SessionRecord;
  }

  recordUtterance(input: {
    sessionId?: string | null;
    source: string;
    inputText: string;
    spokenText: string;
    decisionReason: string;
    spoken: boolean;
  }): void {
    this.db
      .prepare(
        'INSERT INTO utterances (session_id, source, input_text, spoken_text, decision_reason, spoken, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        input.sessionId ?? null,
        input.source,
        input.inputText,
        input.spokenText,
        input.decisionReason,
        input.spoken ? 1 : 0,
        new Date().toISOString()
      );
    if (input.sessionId) {
      this.touchSession(input.sessionId);
    }
  }

  private touchSession(sessionId: string): void {
    this.db.prepare('UPDATE sessions SET updated_at = ? WHERE session_id = ?').run(new Date().toISOString(), sessionId);
  }
}
