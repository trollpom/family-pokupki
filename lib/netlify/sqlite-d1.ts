import { getStore } from "@netlify/blobs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import migrations from "./migrations.json";

type Entry = { data: ArrayBuffer; etag: string };
export interface SnapshotStore {
  getWithMetadata(key: string, options: { type: "arrayBuffer"; consistency: "strong" }): Promise<Entry | null>;
  set(key: string, data: ArrayBuffer, options: { onlyIfMatch?: string; onlyIfNew?: boolean }): Promise<{ modified: boolean }>;
}
type Query = { sql: string; args: SQLInputValue[]; raw?: boolean };
const key = "database-v1";

// A site-wide strongly consistent snapshot survives function restarts and
// deploys. Conditional writes retry SQL only, never the surrounding AI call.
export class NetlifyD1 {
  constructor(private readonly storeFactory: () => SnapshotStore = () => getStore({
    name: "sobrano-database", consistency: "strong",
  }) as SnapshotStore) {}

  prepare(sql: string) { return new Prepared(this, sql); }
  batch(statements: Prepared[]) {
    if (statements.some(s => s.database !== this)) throw new Error("Mixed databases in batch");
    return this.execute(statements.map(s => ({ sql: s.sql, args: s.args })));
  }

  async execute(queries: Query[]) {
    const store = this.storeFactory();
    for (let attempt = 0; attempt < 10; attempt++) {
      const entry = await store.getWithMetadata(key, { type: "arrayBuffer", consistency: "strong" });
      const folder = mkdtempSync(path.join(tmpdir(), "sobrano-"));
      const filename = path.join(folder, "state.sqlite");
      if (entry) writeFileSync(filename, Buffer.from(entry.data));
      const db = new DatabaseSync(filename);
      let closed = false;
      try {
        db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;");
        let dirty = !entry;
        db.exec("CREATE TABLE IF NOT EXISTS _sobrano_migrations (name TEXT PRIMARY KEY)");
        for (const migration of migrations) {
          if (!db.prepare("SELECT 1 FROM _sobrano_migrations WHERE name=?").get(migration.name)) {
            db.exec(migration.sql);
            db.prepare("INSERT INTO _sobrano_migrations(name) VALUES(?)").run(migration.name);
            dirty = true;
          }
        }
        const results = queries.map(q => {
          // Cross-call BEGIN/COMMIT cannot be represented by a blob snapshot.
          // Application transactions already use D1's atomic batch().
          if (/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(q.sql)) {
            throw new Error("Use batch() for atomic transactions");
          }
          const before = Number(db.prepare("SELECT total_changes() AS n").get()!.n);
          const schemaBefore = Number(db.prepare("PRAGMA schema_version").get()!.schema_version);
          const statement = db.prepare(q.sql);
          const hasRows = statement.columns().length > 0;
          if (q.raw) statement.setReturnArrays(true);
          const rows = hasRows ? statement.all(...q.args) : [];
          const run = hasRows ? null : statement.run(...q.args);
          const changes = Number(db.prepare("SELECT total_changes() AS n").get()!.n) - before;
          dirty ||= changes > 0 || Number(db.prepare("PRAGMA schema_version").get()!.schema_version) !== schemaBefore;
          return { results: rows, success: true, meta: {
            changes, last_row_id: Number(run?.lastInsertRowid ?? 0), duration: 0,
          } };
        });
        db.exec("COMMIT");
        db.close(); closed = true;
        if (!dirty) return results;
        const bytes = new Uint8Array(readFileSync(filename)).buffer;
        const saved = await store.set(key, bytes, entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
        if (saved.modified) return results;
      } finally {
        if (!closed) db.close();
        rmSync(folder, { recursive: true, force: true });
      }
      await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 30));
    }
    throw new Error("Database is busy; retry the request");
  }
}

class Prepared {
  constructor(readonly database: NetlifyD1, readonly sql: string, readonly args: SQLInputValue[] = []) {}
  bind(...args: SQLInputValue[]) { return new Prepared(this.database, this.sql, args); }
  async all() { return (await this.database.execute([{ sql: this.sql, args: this.args }]))[0]; }
  run() { return this.all(); }
  async raw() { return (await this.database.execute([{ sql: this.sql, args: this.args, raw: true }]))[0].results; }
  async first(column?: string) {
    const row = (await this.all()).results[0] as Record<string, unknown> | undefined;
    return column ? row?.[column] ?? null : row ?? null;
  }
}
