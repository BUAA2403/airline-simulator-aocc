import assert from 'node:assert/strict';
import test from 'node:test';
import { GAME, GameAdapter, GameError } from '../server/adapter.mjs';

const ACCOUNT = 'google-supabase-account-uuid';
const AIRLINE = 'polaris-airline-uid';
const REFRESH = 'mock-refresh-token-not-a-real-session';
const token = (seconds = 3600) => `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: ACCOUNT, exp: Math.floor(Date.now() / 1000) + seconds })).toString('base64url')}.mock-signature`;
const profile = (uid = AIRLINE, name = 'EXAMPLE AIR') => ({ uid, airlineName: name, airlineCode: 'PA', hubAirports: ['HKG'] });
const response = (value, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), async text() { return JSON.stringify(value); } });
const TABLES = ['player_aircraft_data', 'new_player_flight_data', 'player_route_data'];

// The only fetch available to the adapter is this in-memory protocol simulator.
// There is no call to global fetch and no production networking in these tests.
function fixture({ uids = [AIRLINE], profiles = [profile()], data = {}, override = () => undefined } = {}) {
  const calls = [], saved = [], events = [];
  const profileMap = new Map(profiles.map(value => [value.uid, value]));
  const adapter = new GameAdapter({ fetchImpl: async (input, options) => {
    const url = new URL(input);
    const call = { url, options };
    calls.push(call);
    events.push({ type: 'request', call });
    const custom = await override(call, calls);
    if (custom !== undefined) return custom;
    if (url.origin === GAME.auth && url.pathname === '/auth/v1/user') return response({ id: ACCOUNT });
    if (url.pathname === '/rest/v1/potion_usage') return response(data.potion_usage??[]);
    if (url.pathname === '/rest/v1/rpc/get_server_time') return response(new Date().toISOString());
    if (url.pathname === '/rest/v1/rpc/get_master_player_by_master_uid') return response([{ masterUid: ACCOUNT, playerUidList: uids }]);
    if (url.pathname === '/rest/v1/rpc/get_player_by_uid') return response([profileMap.get(url.searchParams.get('p_uid')) ?? null]);
    const table = url.pathname.slice('/rest/v1/'.length);
    if (TABLES.includes(table)) {
      const rows = data[table] ?? [];
      const offset = Number(url.searchParams.get('offset'));
      const limit = Number(url.searchParams.get('limit'));
      return response(rows.slice(offset, offset + limit));
    }
    throw new Error(`Unexpected mocked endpoint: ${url.origin}${url.pathname}`);
  } });
  return {
    adapter, calls, saved, events,
    async read(config = {}) {
      return adapter.read({ accessToken: token(), refreshToken: REFRESH, ...config }, async session => {
        saved.push(structuredClone(session));
        events.push({ type: 'save', session });
      });
    },
  };
}

const tableCalls = calls => calls.filter(({ url }) => TABLES.some(table => url.pathname === `/rest/v1/${table}`));
const isProfile = ({ url }) => url.pathname === '/rest/v1/rpc/get_player_by_uid';

test('a mismatched master identity stops before any airline data reads',async()=>{
  const view=fixture({override({url}){if(url.pathname==='/rest/v1/rpc/get_master_player_by_master_uid')return response({masterUid:'different-account',playerUidList:[AIRLINE]});}});
  await assert.rejects(view.read(),/主账户/);
  assert.equal(view.calls.filter(isProfile).length,0);
  assert.equal(tableCalls(view.calls).length,0);
});

test('auth account resolves through master player and exact selected owned profile with GET-only game calls', async () => {
  const view = fixture();
  const accessToken = token();
  const snapshot = await view.read({ accessToken, airlineId: AIRLINE });
  assert.equal(snapshot.airline.id, AIRLINE);
  assert.equal(snapshot.airline.name, 'EXAMPLE AIR');
  assert.equal(view.calls[0].url.href, `${GAME.auth}/auth/v1/user`);
  assert.equal(view.calls[1].url.origin, GAME.primary);
  assert.equal(view.calls[1].url.pathname, '/rest/v1/rpc/get_master_player_by_master_uid');
  assert.equal(view.calls[1].url.searchParams.get('p_master_uid'), ACCOUNT);
  assert.equal(view.calls[2].url.pathname, '/rest/v1/rpc/get_player_by_uid');
  assert.equal(view.calls[2].url.searchParams.get('p_uid'), AIRLINE);
  assert.equal(view.saved.length, 0);
  for (const { url, options } of view.calls) {
    assert.equal(options.method, 'GET', url.href);
    assert.equal(options.body, undefined);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.apikey, GAME.publishableKey);
    assert.equal(options.headers.Authorization, `Bearer ${accessToken}`);
    assert.ok(options.signal instanceof AbortSignal);
    assert.ok([GAME.auth, GAME.primary, GAME.fallback].includes(url.origin));
  }
  assert.deepEqual(tableCalls(view.calls).map(({ url }) => url.pathname).sort(), TABLES.map(table => `/rest/v1/${table}`).sort());
  for (const { url } of tableCalls(view.calls)) {
    assert.equal(url.searchParams.get('uid'), `eq.${AIRLINE}`);
    assert.equal(url.searchParams.get('select'), '*');
    assert.equal(url.searchParams.get('offset'), '0');
    assert.equal(url.searchParams.get('limit'), '1000');
  }
  assert.ok(!view.calls.some(({ url }) => url.pathname === '/rest/v1/player_flight_data'));
});

test('paging retrieves a fleet beyond the 1000-row PostgREST page limit', async () => {
  const fleet = Array.from({ length: 1001 }, (_, index) => ({ uid: AIRLINE, aircraftId: `aircraft-${index}`, aircraftModel: 'Airbus-A320', registration: `B-${String(index).padStart(4, '0')}`, hubAirport: 'HKG' }));
  const view = fixture({ data: { player_aircraft_data: fleet } });
  const snapshot = await view.read();
  assert.equal(snapshot.aircraft.length, 1001);
  const pages = view.calls.filter(({ url }) => url.pathname === '/rest/v1/player_aircraft_data');
  assert.deepEqual(pages.map(({ url }) => url.searchParams.get('offset')), ['0', '1000']);
  assert.ok(pages.every(({ url }) => url.searchParams.get('order') === 'aircraftId.asc'));
  assert.equal(new Set(snapshot.aircraft.map(aircraft => aircraft.id)).size, 1001);
});

test('an expired access token refreshes once and persists rotation before operational reads', async () => {
  const rotated = token(7200), nextRefresh = 'rotated-mock-refresh-token';
  const view = fixture({ override({ url, options }) {
    if (url.pathname === '/auth/v1/token') {
      assert.equal(url.origin, GAME.auth);
      assert.equal(url.searchParams.get('grant_type'), 'refresh_token');
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { refresh_token: REFRESH });
      assert.equal(options.headers.Authorization, undefined);
      return response({ access_token: rotated, refresh_token: nextRefresh });
    }
  } });
  await view.read({ accessToken: token(-100) });
  assert.equal(view.calls[0].url.pathname, '/auth/v1/token');
  assert.deepEqual(view.saved, [{ accessToken: rotated, refreshToken: nextRefresh }]);
  assert.equal(view.events[1].type, 'save');
  assert.ok(view.calls.slice(1).every(({ options }) => options.headers.Authorization === `Bearer ${rotated}`));
  assert.equal(view.calls.filter(({ options }) => options.method === 'POST').length, 1);
});

test('a user endpoint 401 refreshes once, persists new credentials and retries identity validation', async () => {
  const original = token(), rotated = token(7200);
  let userCalls = 0;
  const view = fixture({ override({ url, options }) {
    if (url.pathname === '/auth/v1/user' && ++userCalls === 1) return response({ private: 'must-not-be-exposed' }, 401);
    if (url.pathname === '/auth/v1/token') return response({ access_token: rotated, refresh_token: 'new-mock-refresh-token' });
    if (url.pathname.startsWith('/rest/v1/')) assert.equal(options.headers.Authorization, `Bearer ${rotated}`);
  } });
  const snapshot = await view.read({ accessToken: original });
  assert.equal(snapshot.airline.id, AIRLINE);
  assert.equal(userCalls, 2);
  assert.equal(view.calls.filter(({ url }) => url.pathname === '/auth/v1/token').length, 1);
  assert.deepEqual(view.saved, [{ accessToken: rotated, refreshToken: 'new-mock-refresh-token' }]);
  assert.deepEqual(view.calls.slice(0, 3).map(({ url }) => url.pathname), ['/auth/v1/user', '/auth/v1/token', '/auth/v1/user']);
});

test('a rejected refresh stops before any game read and requires reconnection', async () => {
  const view = fixture({ override({ url }) {
    if (url.pathname === '/auth/v1/token') return response({ error: 'refresh_token_not_found', access_token: 'private-upstream-text' }, 400);
  } });
  await assert.rejects(view.read({ accessToken: token(-100) }), error => {
    assert.ok(error instanceof GameError);
    assert.equal(error.reconnect, true);
    assert.ok(!error.safeMessage.includes('private-upstream-text'));
    return true;
  });
  assert.equal(view.calls.length, 1);
  assert.equal(view.saved.length, 0);
});

test('429 rate limiting honors Retry-After without bypassing the limit through a fallback host', async () => {
  const view = fixture({ override({ url }) {
    if (url.pathname === '/rest/v1/rpc/get_master_player_by_master_uid') return response({}, 429, { 'Retry-After': '180' });
  } });
  await assert.rejects(view.read(), error => error.status === 429 && error.retryAfterMs === 180000);
  assert.ok(!view.calls.some(({ url }) => url.origin === GAME.fallback));
  assert.equal(tableCalls(view.calls).length, 0);
});

test('primary server failure falls back to the known region and retains scoped GET queries', async () => {
  const view = fixture({ override({ url }) {
    if (url.origin === GAME.primary && url.pathname === '/rest/v1/rpc/get_master_player_by_master_uid') return response({}, 503);
  } });
  await view.read();
  assert.equal(view.calls[1].url.origin, GAME.primary);
  assert.equal(view.calls[2].url.origin, GAME.fallback);
  assert.equal(view.calls[1].url.pathname + view.calls[1].url.search, view.calls[2].url.pathname + view.calls[2].url.search);
  assert.ok(view.calls.slice(2).every(({ url, options }) => url.origin === GAME.fallback && options.method === 'GET'));
  assert.ok(tableCalls(view.calls).every(({ url }) => url.searchParams.get('uid') === `eq.${AIRLINE}`));
});

test('simultaneous primary table failures each retry on the known fallback', async () => {
  const view = fixture({ override({ url }) {
    if (url.origin === GAME.primary && TABLES.some(table => url.pathname === `/rest/v1/${table}`)) return response({}, 503);
  } });
  const snapshot = await view.read();
  assert.equal(snapshot.airline.id, AIRLINE);
  for (const table of TABLES) {
    const calls = view.calls.filter(({ url }) => url.pathname === `/rest/v1/${table}`);
    assert.deepEqual(calls.map(({ url }) => url.origin), [GAME.primary, GAME.fallback]);
  }
});

test('foreign airline selection is rejected before profile or operational table reads', async () => {
  const view = fixture();
  await assert.rejects(view.read({ airlineId: 'somebody-elses-airline' }), error => error.reconnect === true);
  assert.equal(view.calls.length, 2);
  assert.equal(view.calls.filter(isProfile).length, 0);
  assert.equal(tableCalls(view.calls).length, 0);
});

test('a selected profile must match the requested UID even if an unexpected returned UID is also owned', async () => {
  const view = fixture({ uids: [AIRLINE, 'other-owned-airline'], override({ url }) {
    if (url.pathname === '/rest/v1/rpc/get_player_by_uid') return response([profile('other-owned-airline', 'ANOTHER AIR')]);
  } });
  await assert.rejects(view.read({ airlineId: AIRLINE }), error => error.reconnect === true);
  assert.equal(tableCalls(view.calls).length, 0);
});

test('a returned foreign profile is rejected before any operational reads', async () => {
  const view = fixture({ override({ url }) {
    if (url.pathname === '/rest/v1/rpc/get_player_by_uid') return response([profile('foreign-airline')]);
  } });
  await assert.rejects(view.read({ airlineId: AIRLINE }), error => error.reconnect === true);
  assert.equal(tableCalls(view.calls).length, 0);
});

test('selecting a subsidiary reads only that airline within the authenticated account', async () => {
  const other = 'another-owned-airline';
  const view = fixture({ uids: [other, AIRLINE], profiles: [profile(other, 'NORTH AIR'), profile(AIRLINE)] });
  const snapshot = await view.read({airlineId:AIRLINE});
  assert.equal(snapshot.airline.id, AIRLINE);
  assert.deepEqual(view.calls.filter(isProfile).map(({ url }) => url.searchParams.get('p_uid')), [AIRLINE]);
  assert.ok(tableCalls(view.calls).every(({ url }) => url.searchParams.get('uid') === `eq.${AIRLINE}`));
});

test('an account with multiple airlines asks for an explicit selection before reading profiles', async () => {
  const other = 'another-owned-airline';
  const view = fixture({ uids: [other, AIRLINE], profiles: [profile(other), profile(AIRLINE)] });
  await assert.rejects(view.read(), error => error.reconnect === true && error.safeMessage.includes('航空公司 ID'));
  assert.equal(view.calls.filter(isProfile).length, 0);
  assert.equal(tableCalls(view.calls).length, 0);
});

test('operational permission failures are not retried through the fallback server', async () => {
  const view = fixture({ override({ url }) {
    if (url.pathname === '/rest/v1/new_player_flight_data') return response({ private: 'do-not-show' }, 403);
  } });
  await assert.rejects(view.read(), error => error.status === 403 && error.reconnect === true && !error.safeMessage.includes('do-not-show'));
  assert.ok(!view.calls.some(({ url }) => url.origin === GAME.fallback));
});

test('potion reads are GET-only, scoped to the verified airline and retained for native clock phases',async()=>{
 const view=fixture({data:{potion_usage:[{potionStartTime:'2026-10-17T00:00:00Z',potionEndTime:'2026-10-18T00:00:00Z'}]}}),s=await view.read();
 const call=view.calls.find(c=>c.url.pathname==='/rest/v1/potion_usage');assert.equal(call.options.method,'GET');assert.equal(call.url.searchParams.get('uid'),'eq.'+AIRLINE);assert.equal(s.timing.potionState,'known');assert.equal(s.timing.potions.length,1);assert.equal(s.timing.mode,'accelerated');
});
