import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(directory) {
    if (directory !== ':memory:') mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(directory === ':memory:' ? ':memory:' : path.join(directory, 'aocc.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA journal_size_limit=67108864;
      CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY, captured_at TEXT NOT NULL, source TEXT NOT NULL, body TEXT NOT NULL, byte_size INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, at TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    if(!this.db.prepare('PRAGMA table_info(snapshots)').all().some(c=>c.name==='byte_size')){
      this.db.exec('ALTER TABLE snapshots ADD COLUMN byte_size INTEGER NOT NULL DEFAULT 0; UPDATE snapshots SET byte_size=length(CAST(body AS BLOB))');
    }
  }
  save(snapshot, source) {
    const body=JSON.stringify(snapshot);
    this.db.prepare('INSERT INTO snapshots(captured_at,source,body,byte_size) VALUES (?,?,?,?)').run(snapshot.capturedAt, source, body, Buffer.byteLength(body));
    // Keep at most 30 days at one-minute resolution and 512 MiB of JSON payloads.
    this.db.exec('DELETE FROM snapshots WHERE id < (SELECT max(id)-43200 FROM snapshots)');
    if(this.db.prepare('SELECT sum(byte_size) AS total FROM snapshots').get().total>512*1024*1024){
      this.db.exec('DELETE FROM snapshots WHERE id IN (SELECT id FROM (SELECT id,sum(byte_size) OVER (ORDER BY id DESC) AS running FROM snapshots) WHERE running>536870912) AND id<(SELECT max(id) FROM snapshots)');
    }
  }
  latest() { const row = this.db.prepare('SELECT body,source FROM snapshots ORDER BY id DESC LIMIT 1').get(); return row ? { snapshot: JSON.parse(row.body), source: row.source } : null; }
  *analysisSnapshots(airlineId,source,capturedAt) {
    // Freeze a bounded, airline/source-scoped view while newer syncs may arrive.
    const scope=[airlineId,source,capturedAt];
    const last=this.db.prepare("SELECT max(id) AS id FROM snapshots WHERE json_extract(body,'$.airline.id')=? AND source=? AND captured_at<=?").get(...scope).id;
    if(last===null)return;
    for(const row of this.db.prepare("SELECT body FROM snapshots WHERE json_extract(body,'$.airline.id')=? AND source=? AND captured_at<=? AND id<=? ORDER BY id").iterate(...scope,last))yield JSON.parse(row.body);
  }
  history(airlineId, source) {
    // Hourly observations avoid giving a misleading equal-weight graph to irregular polls.
    const scoped=airlineId!==undefined;
    const rows = this.db.prepare(`SELECT body FROM snapshots WHERE id IN (SELECT max(id) FROM snapshots WHERE source != 'demo' ${scoped?"AND json_extract(body,'$.airline.id')=? AND source=?":''} GROUP BY substr(captured_at,1,13)) ORDER BY id DESC LIMIT 168`).all(...(scoped?[airlineId,source]:[]));
    return rows.reverse().map(({ body }) => { const s = JSON.parse(body); return { capturedAt: s.capturedAt, cash: s.airline.cash ?? null, accountCash:s.metrics?.accountCash ?? null, aircraftCount: s.aircraft.length, flightCount: s.flights.length, routeCount: s.routes.length, revenue: s.metrics?.revenue ?? null }; });
  }
  log(level, message) {
    this.db.prepare('INSERT INTO events(at,level,message) VALUES (?,?,?)').run(new Date().toISOString(), level, message);
    this.db.exec('DELETE FROM events WHERE id < (SELECT max(id)-300 FROM events)');
  }
  logs() { return this.db.prepare('SELECT at,level,message FROM events ORDER BY id DESC LIMIT 40').all(); }
  get(key, fallback = null) { const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? JSON.parse(row.value) : fallback; }
  set(key, value) { this.db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)').run(key, JSON.stringify(value)); }
  close() { this.db.close(); }
}
