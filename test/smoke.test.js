'use strict';

const assert = require('assert');
const http = require('http');

async function request(port, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.end(body);
    else req.end();
  });
}

async function main() {
  const seen = {};
  const backend = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      seen.path = req.url;
      seen.auth = req.headers.authorization;
      seen.key = req.headers['x-dumate-inapp-key'];
      seen.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, model: seen.body.model }));
    });
  });
  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));

  process.env.DUMATE_BACKEND_HOST = '127.0.0.1';
  process.env.DUMATE_BACKEND_PORT = String(backend.address().port);
  process.env.DUMATE_INAPP_KEY = 'test-only-key';
  process.env.DUMATE_PROXY_HOST = '127.0.0.1';
  process.env.DUMATE_PROXY_PORT = '0';

  const proxy = require('../server');
  assert.strictEqual(proxy.parseArgs(['--port=3070', '--allow-unknown-models']).proxyPort, 3070);
  assert.strictEqual(proxy.parseArgs(['--port', '3071', '--route-bare-models']).routeBareModels, true);
  assert.strictEqual(proxy.normalizeModel('dumate-local/dumate-deepseek-v41-flash'), 'deepseek-v41-flash');
  assert.strictEqual(proxy.wireModel('dumate-deepseek-v4-pro'), 'deepseek-v4-pro');
  assert.strictEqual(proxy.wireModel('dumate-deepseek-v4.1-flash'), 'deepseek-v41-flash');
  assert.strictEqual(proxy.wireModel('dumate-deepseek-v4-1-flash'), 'deepseek-v41-flash');
  assert.strictEqual(proxy.isDumateModel('dumate-glm-5'), true);
  assert.strictEqual(proxy.isDumateModel('openai/gpt-5'), false);

  const server = proxy.startServer();
  await new Promise((resolve) => server.once('listening', resolve));
  const proxyPort = server.address().port;

  const models = await request(proxyPort, '/v1/models');
  assert.strictEqual(models.status, 200);
  assert.strictEqual(JSON.parse(models.body).data.length, 4);

  const completion = await request(
    proxyPort,
    '/v1/chat/completions',
    JSON.stringify({
      model: 'dumate-local/dumate-deepseek-v41-flash',
      messages: [{ role: 'user', content: 'ping' }],
    }),
  );
  assert.strictEqual(completion.status, 200);
  assert.strictEqual(seen.path, '/api/qianfanproxy/v1/chat/completions');
  assert.strictEqual(seen.auth, 'Bearer nokey');
  assert.strictEqual(seen.key, 'test-only-key');
  assert.strictEqual(seen.body.model, 'deepseek-v41-flash');

  const rejected = await request(
    proxyPort,
    '/v1/chat/completions',
    JSON.stringify({ model: 'openai/gpt-5', messages: [] }),
  );
  assert.strictEqual(rejected.status, 400);
  assert.strictEqual(JSON.parse(rejected.body).error.type, 'unsupported_model');

  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await new Promise((resolve, reject) => backend.close((error) => (error ? reject(error) : resolve())));
  console.log('smoke tests passed');
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
