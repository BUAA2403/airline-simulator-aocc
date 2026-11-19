import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('./popup.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));
const SESSION = { access_token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.fakeSignature', refresh_token: 'refreshToken12345' };
const CODE = 'a'.repeat(32);

function fixture({ tabUrl = 'https://livery.airline-simulator.com/', injectionOrigin = 'https://livery.airline-simulator.com', stored = JSON.stringify(SESSION), status = 200, fetchError = null, chromeAvailable = true } = {}) {
  const reads = [];
  const requests = [];
  const calls = { tabs: 0, injections: 0 };
  let submit;
  const elements = {
    '#connect-form': { addEventListener(type, listener) { assert.equal(type, 'submit'); submit = listener; } },
    '#pairing-code': { value: CODE },
    '#connect-button': { disabled: false },
    '#status': { textContent: '', dataset: {} },
  };
  const context = {
    document: { querySelector: (selector) => elements[selector] },
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async (url, options) => {
      requests.push({ url, ...options, parsedBody: JSON.parse(options.body) });
      if (fetchError) throw fetchError;
      return { ok: status >= 200 && status < 300, status, async text() { throw new Error('Response bodies must not be read'); } };
    },
  };
  if (chromeAvailable) context.chrome = {
    tabs: { async query() { calls.tabs++; return [{ id: 10, url: tabUrl }]; } },
    scripting: { async executeScript(options) {
      calls.injections++;
      assert.deepEqual(JSON.parse(JSON.stringify(options.target)), { tabId: 10 });
      assert.equal(options.world, 'ISOLATED');
      const result = vm.runInNewContext(`(${options.func.toString()})()`, {
        location: { origin: injectionOrigin },
        localStorage: { getItem(key) { reads.push(key); return stored; } },
      });
      return [{ result }];
    } },
  };
  vm.runInNewContext(source, context);
  return { elements, reads, requests, calls, submit: () => submit({ preventDefault() {} }) };
}

test('extension has only scoped host and scripting permissions with no background', () => {
  assert.deepEqual(manifest.permissions, ['scripting']);
  assert.deepEqual(manifest.host_permissions, ['https://livery.airline-simulator.com/*', 'http://127.0.0.1:3010/*']);
  assert.equal(manifest.background, undefined);
  assert.equal(manifest.content_scripts, undefined);
});

test('opening popup does not read the page or send any requests', () => {
  const view = fixture();
  assert.deepEqual(view.calls, { tabs: 0, injections: 0 });
  assert.deepEqual(view.reads, []);
  assert.deepEqual(view.requests, []);
});

test('click reads only exact session key and sends only pairing and necessary tokens', async () => {
  const view = fixture({ stored: JSON.stringify({ ...SESSION, provider_token: 'do-not-send', user: { email: 'private@example.com' } }) });
  await view.submit();
  assert.deepEqual(view.reads, ['sb-auth-auth-token']);
  assert.equal(view.requests.length, 1);
  const request = view.requests[0];
  assert.equal(request.url, 'http://127.0.0.1:3010/api/session-bridge');
  assert.equal(request.method, 'POST');
  assert.deepEqual(request.parsedBody, { pairingCode: CODE, session: SESSION });
  assert.equal(request.credentials, 'omit');
  assert.equal(request.redirect, 'error');
  assert.equal(request.cache, 'no-store');
  assert.equal(request.referrerPolicy, 'no-referrer');
  assert.equal(view.elements['#pairing-code'].value, '');
  assert.equal(view.elements['#status'].dataset.kind, 'success');
});

test('different hosts, ports and protocols are rejected before injection', async () => {
  for (const tabUrl of ['https://evil.example/', 'https://livery.airline-simulator.com.evil.example/', 'http://livery.airline-simulator.com/', 'https://livery.airline-simulator.com:8443/', 'chrome://extensions/', undefined]) {
    const view = fixture({ tabUrl: tabUrl ?? '' });
    await view.submit();
    assert.equal(view.calls.injections, 0, tabUrl);
    assert.equal(view.requests.length, 0, tabUrl);
    assert.deepEqual(view.reads, [], tabUrl);
  }
});

test('navigation between query and injection is rejected inside the target page', async () => {
  const view = fixture({ injectionOrigin: 'https://unrelated.example' });
  await view.submit();
  assert.deepEqual(view.reads, []);
  assert.equal(view.requests.length, 0);
});

test('missing, oversized and malformed sessions are never forwarded', async () => {
  for (const stored of [null, '{broken', 'null', '[]', '{}', JSON.stringify({ ...SESSION, refresh_token: 'short' }), JSON.stringify({ ...SESSION, access_token: 'not-jwt' }), JSON.stringify({ ...SESSION, refresh_token: 'has whitespace' }), 'x'.repeat(100001)]) {
    const view = fixture({ stored });
    await view.submit();
    assert.equal(view.requests.length, 0);
    assert.equal(view.elements['#status'].dataset.kind, 'error');
    assert.equal(view.elements['#connect-button'].disabled, false);
  }
});

test('invalid pairing code prevents any page access', async () => {
  const view = fixture();
  view.elements['#pairing-code'].value = '123456';
  await view.submit();
  assert.deepEqual(view.calls, { tabs: 0, injections: 0 });
  assert.equal(view.requests.length, 0);
});

test('server and transport failures use fixed messages without exposing tokens or response bodies', async () => {
  for (const status of [400, 401, 403, 409, 410, 429, 500]) {
    const view = fixture({ status });
    await view.submit();
    const message = view.elements['#status'].textContent;
    assert.equal(view.elements['#status'].dataset.kind, 'error');
    assert.ok(!message.includes(SESSION.access_token));
    assert.ok(!message.includes(SESSION.refresh_token));
    assert.equal(view.elements['#connect-button'].disabled, false);
  }
  const view = fixture({ fetchError: new Error(SESSION.access_token) });
  await view.submit();
  assert.ok(!view.elements['#status'].textContent.includes(SESSION.access_token));
});

test('opening as a normal web page produces an actionable message without reading data', async () => {
  const view = fixture({ chromeAvailable: false });
  await view.submit();
  assert.equal(view.elements['#status'].dataset.kind, 'error');
  assert.ok(view.elements['#status'].textContent.includes('Chrome'));
  assert.equal(view.requests.length, 0);
});
