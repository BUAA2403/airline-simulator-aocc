import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createAoccServer } from '../server/index.mjs';
import { SyncEngine } from '../server/sync.mjs';
import { Store } from '../server/store.mjs';

const ACCESS = 'test-access-token-never-include-in-public-output-12345';
const REFRESH = 'test-refresh-token-never-include-in-public-output-67890';
const EXTENSION = `chrome-extension://${'a'.repeat(32)}`;
const snapshot = (id = 'polaris-id') => ({
  schemaVersion: 1,
  capturedAt: '2026-10-17T00:00:00.000Z',
  airline: { id, name: 'EXAMPLE AIR', code: 'PA', hub: '', cash: 1000, currency: 'USD' },
  airports: [], aircraft: [], flights: [], routes: [], metrics: {}, provenance: { source: 'game', notes: [] },
});

class MemoryStore {
  constructor() { this.snapshots = []; this.events = []; this.closed = false; }
  latest() { return this.snapshots.at(-1) ?? null; }
  save(value, source) { this.snapshots.push({ snapshot: structuredClone(value), source }); }
  history() { if (this.closed) throw new Error('Store accessed after close'); return []; }
  logs() { if (this.closed) throw new Error('Store accessed after close'); return this.events; }
  log(level, message) { this.events.push({ level, message, at: '2026-10-17T00:00:00Z' }); }
  close() { this.closed = true; }
}
class MemoryVault {
  constructor(value = {}) { this.value = structuredClone(value); }
  async load() { return structuredClone(this.value); }
  async save(value) { this.value = structuredClone(value); }
}
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
async function fixture(t, adapter = { async read() { return snapshot(); } }) {
  const store = new MemoryStore(), vault = new MemoryVault();
  const app = await createAoccServer({ port: 0, store, vault, adapter });
  const { port } = await app.listen();
  t.after(() => app.close());
  return { app, port, store, vault };
}
function request(port, { method = 'GET', path = '/api/state', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method, path, agent: false, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json() { return JSON.parse(text); } }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Local test request timed out')));
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

test('local API rejects DNS rebinding hostnames and cross-origin state/config requests', async t => {
  const { port } = await fixture(t);
  for (const options of [
    { headers: { Host: `attacker.example:${port}` } },
    { headers: { Origin: 'https://attacker.example' } },
    { path: '/api/bridge-code', headers: { Origin: 'https://attacker.example' } },
    { path: '/api/connection', method: 'POST', headers: { Origin: 'https://attacker.example' }, body: { accessToken: ACCESS } },
    { path: '/api/disconnect', method: 'POST', headers: { Origin: 'null' }, body: {} },
  ]) {
    const response = await request(port, options);
    assert.equal(response.status, 403);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
});

test('bridge preflight is limited to extension origin and bridge path', async t => {
  const { port } = await fixture(t);
  const allowed = await request(port, { method: 'OPTIONS', path: '/api/session-bridge', headers: { Origin: EXTENSION, 'Access-Control-Request-Method': 'POST' } });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers['access-control-allow-origin'], EXTENSION);
  const rejected = await request(port, { method: 'OPTIONS', path: '/api/connection', headers: { Origin: EXTENSION } });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers['access-control-allow-origin'], undefined);
});

test('session bridge needs a local one-time code, persists only locally, and does not leak tokens', async t => {
  const { port, vault } = await fixture(t);
  const missing = await request(port, { method: 'POST', path: '/api/session-bridge', headers: { Origin: EXTENSION }, body: { pairingCode: 'invalid', session: { access_token: ACCESS, refresh_token: REFRESH } } });
  assert.equal(missing.status, 403);
  assert.deepEqual(vault.value, {});

  const codeResponse = await request(port, { path: '/api/bridge-code' });
  const code = codeResponse.json();
  assert.match(code.pairingCode, /^[A-Za-z0-9_-]{32,128}$/);
  assert.ok(Date.parse(code.expiresAt) > Date.now());
  assert.ok(Date.parse(code.expiresAt) <= Date.now() + 600100);
  const input = { pairingCode: code.pairingCode, session: { access_token: ACCESS, refresh_token: REFRESH } };
  const connected = await request(port, { method: 'POST', path: '/api/session-bridge', headers: { Origin: EXTENSION }, body: input });
  assert.equal(connected.status, 200);
  assert.equal(connected.json().ok, true);
  assert.equal(connected.headers['access-control-allow-origin'], EXTENSION);
  assert.equal(vault.value.accessToken, ACCESS);
  assert.equal(vault.value.refreshToken, REFRESH);
  const reused = await request(port, { method: 'POST', path: '/api/session-bridge', headers: { Origin: EXTENSION }, body: input });
  assert.equal(reused.status, 403);
  for (const route of ['/api/state', '/api/export', '/api/health']) {
    const publicResponse = await request(port, { path: route });
    assert.ok(!publicResponse.text.includes(ACCESS), route);
    assert.ok(!publicResponse.text.includes(REFRESH), route);
  }
});

test('a bridge request from an unrelated website cannot consume a valid local code', async t => {
  const { port, vault } = await fixture(t);
  const { pairingCode } = (await request(port, { path: '/api/bridge-code' })).json();
  const input = { pairingCode, session: { access_token: ACCESS, refresh_token: REFRESH } };
  const response = await request(port, { method: 'POST', path: '/api/session-bridge', headers: { Origin: 'https://attacker.example' }, body: input });
  assert.equal(response.status, 403);
  assert.deepEqual(vault.value, {});
  const valid = await request(port, { method: 'POST', path: '/api/session-bridge', headers: { Origin: EXTENSION }, body: input });
  assert.equal(valid.json().ok, true);
});

test('encoded docs traversal cannot expose server source or credential files', async t => {
  const { port } = await fixture(t);
  for (const path of ['/docs/%2e%2e%2fserver/vault.mjs', '/docs/%2e%2e%5cserver%5cvault.mjs', '/docs/%2e%2e%2f.data/session.vault', '/docs/%2e%2e%2f.data/vault.key']) {
    const response = await request(port, { path });
    assert.ok(response.status === 403 || response.status === 404, `${path}: ${response.status}`);
    assert.ok(!response.text.includes('createCipheriv'));
    assert.ok(!response.text.includes('windows-dpapi'));
  }
});

test('disconnect clears the persisted session without deleting the last successful snapshot', async t => {
  const { app, port, vault } = await fixture(t);
  await app.engine.connect({ accessToken: ACCESS, refreshToken: REFRESH });
  const response = await request(port, { method: 'POST', path: '/api/disconnect', body: {} });
  assert.equal(response.json().ok, true);
  assert.deepEqual(vault.value, {});
  const state = (await request(port)).json();
  assert.equal(state.connection.hasCredentials, false);
  assert.equal(state.connection.nextSyncAt, null);
  assert.equal(state.snapshot.airline.id, 'polaris-id');
});

test('a rejected game session cannot be reported to the bridge as HTTP success', async t => {
  const { port } = await fixture(t, { async read() { throw Object.assign(new Error('do-not-expose-private-details'), { safeMessage: '游戏登录会话已失效，请重新配对', reconnect: true }); } });
  const { pairingCode } = (await request(port, { path: '/api/bridge-code' })).json();
  const response = await request(port, { method: 'POST', path: '/api/session-bridge', headers: { Origin: EXTENSION }, body: { pairingCode, session: { access_token: ACCESS, refresh_token: REFRESH } } });
  assert.ok(response.status >= 400);
  assert.equal(response.json().ok, false);
  assert.ok(!response.text.includes('do-not-expose-private-details'));
  assert.ok(!response.text.includes(ACCESS));
  assert.ok(!response.text.includes(REFRESH));
});

test('hourly history is scoped to one airline and one data source', () => {
  const store = new Store(':memory:');
  try {
    const first = snapshot('first-airline');
    first.airline.cash = 10;
    const second = snapshot('second-airline');
    second.airline.cash = 20;
    const imported = snapshot('first-airline');
    imported.airline.cash = 999;
    store.save(first, 'game');
    store.save(second, 'game');
    store.save(imported, 'import');
    assert.deepEqual(store.history('first-airline', 'game').map(row => row.cash), [10]);
    assert.deepEqual(store.history('second-airline', 'game').map(row => row.cash), [20]);
    assert.deepEqual(store.history('first-airline', 'import').map(row => row.cash), [999]);
  } finally { store.close(); }
});

test('a newly paired account never inherits the previous account refresh token or inferred airline ID', async () => {
  const store = new MemoryStore(), vault = new MemoryVault();
  const seen = [];
  const engine = new SyncEngine({ store, vault, adapter: { async read(config) { seen.push(structuredClone(config)); return snapshot(seen.length === 1 ? 'old-airline' : 'new-airline'); } } });
  await engine.initialize();
  try {
    await engine.connect({ accessToken: ACCESS, refreshToken: REFRESH });
    await engine.connect({ accessToken: 'second-account-access-token-valid-length-1234567' });
    assert.equal(seen[1].refreshToken, undefined);
    assert.equal(seen[1].airlineId, undefined);
  } finally { engine.close(); }
});

test('disconnect during snapshot persistence cannot revive an obsolete live connection', async () => {
  const store = new MemoryStore(), vault = new MemoryVault();
  const saveReached = deferred(), releaseSave = deferred();
  let calls = 0;
  vault.save = async function(value) {
    calls++;
    if (calls === 2) { saveReached.resolve(); await releaseSave.promise; }
    this.value = structuredClone(value);
  };
  const engine = new SyncEngine({ store, vault, adapter: { async read() { return snapshot(); } } });
  await engine.initialize();
  const connecting = engine.connect({ accessToken: ACCESS, refreshToken: REFRESH });
  try {
    await saveReached.promise;
    await engine.disconnect();
    releaseSave.resolve();
    await connecting;
    assert.equal(engine.state().connection.hasCredentials, false);
    assert.notEqual(engine.state().connection.status, 'live');
    assert.equal(engine.state().connection.nextSyncAt, null);
  } finally { releaseSave.resolve(); await connecting; engine.close(); }
});

test('closing during a pending adapter read does not access the closed store', async () => {
  const store = new MemoryStore(), vault = new MemoryVault();
  const reached = deferred(), release = deferred();
  const engine = new SyncEngine({ store, vault, adapter: { async read() { reached.resolve(); await release.promise; return snapshot(); } } });
  await engine.initialize();
  const connecting = engine.connect({ accessToken: ACCESS, refreshToken: REFRESH });
  await reached.promise;
  engine.close();
  store.close();
  release.resolve();
  await assert.doesNotReject(connecting);
});
