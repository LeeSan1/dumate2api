#!/usr/bin/env node
'use strict';

const http = require('http');
const https = require('https');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze({
  proxyHost: '127.0.0.1',
  proxyPort: 3066,
  backendHost: '127.0.0.1',
  upstreamPrefix: '/api/qianfanproxy/v1',
  processName: 'dumate-main-server',
  maxBodyBytes: 200 * 1024 * 1024,
});

const MODEL_ALIASES = Object.freeze({
  'glm-5': 'model-text',
  'model-text': 'model-text',
  'deepseek-v4-flash-0731': 'deepseek-v4-flash-0731',
  'deepseek-v4-pro': 'deepseek-v4-pro',
  'deepseek-v41-flash': 'deepseek-v41-flash',
  'deepseek-v4.1-flash': 'deepseek-v41-flash',
  'deepseek-v4-1-flash': 'deepseek-v41-flash',
});

const PUBLIC_MODELS = Object.freeze([
  { id: 'dumate-glm-5', object: 'model', owned_by: 'baidu-dumate' },
  { id: 'dumate-deepseek-v4-flash-0731', object: 'model', owned_by: 'baidu-dumate' },
  { id: 'dumate-deepseek-v4-pro', object: 'model', owned_by: 'baidu-dumate' },
  { id: 'dumate-deepseek-v41-flash', object: 'model', owned_by: 'baidu-dumate' },
]);

function loadDotEnv(filePath = path.join(__dirname, '.env')) {
  let contents;
  try {
    contents = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return;
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function configFromEnv() {
  return {
    proxyHost: process.env.DUMATE_PROXY_HOST || DEFAULTS.proxyHost,
    proxyPort: numberEnv('DUMATE_PROXY_PORT', DEFAULTS.proxyPort),
    backendHost: process.env.DUMATE_BACKEND_HOST || DEFAULTS.backendHost,
    backendPort: numberEnv('DUMATE_BACKEND_PORT', 0),
    inappKey: process.env.DUMATE_INAPP_KEY || '',
    upstreamPrefix: normalizePrefix(
      process.env.DUMATE_UPSTREAM_PREFIX || DEFAULTS.upstreamPrefix,
    ),
    processName: process.env.DUMATE_PROCESS_NAME || DEFAULTS.processName,
    maxBodyBytes: numberEnv('DUMATE_MAX_BODY_BYTES', DEFAULTS.maxBodyBytes),
    routeBareModels: process.env.DUMATE_ROUTE_BARE_MODELS === '1',
    allowUnknownModels: process.env.DUMATE_ALLOW_UNKNOWN_MODELS === '1',
  };
}

function parseArgs(args = []) {
  const options = {};
  const valueOptions = new Map([
    ['--host', 'proxyHost'],
    ['--port', 'proxyPort'],
    ['--backend-host', 'backendHost'],
    ['--backend-port', 'backendPort'],
    ['--key', 'inappKey'],
    ['--upstream-prefix', 'upstreamPrefix'],
    ['--process-name', 'processName'],
    ['--max-body-bytes', 'maxBodyBytes'],
  ]);

  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i]);
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--route-bare-models') {
      options.routeBareModels = true;
      continue;
    }
    if (arg === '--allow-unknown-models') {
      options.allowUnknownModels = true;
      continue;
    }
    const equals = arg.indexOf('=');
    const flag = equals >= 0 ? arg.slice(0, equals) : arg;
    if (!valueOptions.has(flag)) {
      throw new Error(`Unknown option: ${arg}`);
    }
    const raw = equals >= 0 ? arg.slice(equals + 1) : args[++i];
    if (raw === undefined || String(raw).startsWith('--')) {
      throw new Error(`Option ${flag} needs a value`);
    }
    const key = valueOptions.get(flag);
    options[key] = ['proxyPort', 'backendPort', 'maxBodyBytes'].includes(key)
      ? Number(raw)
      : String(raw);
    if (['proxyPort', 'backendPort', 'maxBodyBytes'].includes(key)
      && (!Number.isFinite(options[key]) || options[key] < 0)) {
      throw new Error(`Option ${flag} must be a non-negative number`);
    }
  }
  return options;
}

function usage() {
  return `DuMate OpenAI Proxy\n\nUsage:\n  ./run.sh [options]\n  node server.js [options]\n\nOptions:\n  --host HOST                    Proxy bind address (default: 127.0.0.1)\n  --port PORT                    Proxy port (default: 3066)\n  --backend-host HOST            DuMate backend host (default: 127.0.0.1)\n  --backend-port PORT            Explicit DuMate backend port\n  --key KEY                      Explicit DuMate in-app key (prefer env var)\n  --upstream-prefix PATH         DuMate API prefix\n  --process-name NAME            DuMate process name to discover\n  --route-bare-models            Also route bare known model names\n  --allow-unknown-models         Pass unknown aliases through to DuMate\n  --max-body-bytes BYTES        Maximum request body size\n  -h, --help                     Show this help\n\nThe normal path is to start DuMate first, then run ./run.sh.\n`;
}

function normalizePrefix(prefix) {
  const value = String(prefix || '').trim();
  if (!value) return '';
  return `/${value.replace(/^\/+|\/+$/g, '')}`;
}

function normalizeModel(model) {
  let value = String(model || '').trim().toLowerCase();
  // OpenClaw/Magpie may send provider/model or provider:model.
  if (value.includes('/')) value = value.slice(value.lastIndexOf('/') + 1);
  if (value.includes(':')) value = value.slice(value.lastIndexOf(':') + 1);
  value = value.replace(/^(?:dumate|baidu|qianfan)[-_:]/, '');
  return value;
}

function isDumateModel(model, config = configFromEnv()) {
  const original = String(model || '').trim().toLowerCase();
  const hasDumatePrefix = /(^|\/)(?:dumate|baidu|qianfan)(?:[-_:]|$)/i.test(original);
  return hasDumatePrefix || (config.routeBareModels && Boolean(MODEL_ALIASES[normalizeModel(original)]));
}

function wireModel(model, config = configFromEnv()) {
  const alias = normalizeModel(model);
  if (MODEL_ALIASES[alias]) return MODEL_ALIASES[alias];
  if (config.allowUnknownModels && alias) return alias;
  return null;
}

let authCache = null;
let authCacheAt = 0;

function clearAuthCache() {
  authCache = null;
  authCacheAt = 0;
}

function findDumateAuth(config = configFromEnv()) {
  const now = Date.now();
  if (authCache && now - authCacheAt < 1000) return authCache;

  // Explicit values are useful for tests, containers, and future DuMate builds
  // that expose a stable local port. Never put these values in source control.
  if (config.backendPort && config.inappKey) {
    authCache = { host: config.backendHost, port: config.backendPort, key: config.inappKey };
    authCacheAt = now;
    return authCache;
  }

  try {
    const processList = execFileSync('/bin/ps', ['-axo', 'pid=,command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const pattern = new RegExp(`${escapeRegExp(config.processName)}(?:\\s|$)`);
    const backendLine = processList.split('\n').find((line) => pattern.test(line));
    if (!backendLine) return null;

    const pid = (backendLine.match(/^\s*(\d+)/) || [])[1];
    const port = Number(
      (backendLine.match(/(?:--port|-p)(?:=|\s+)(\d+)/) || [])[1],
    );
    if (!pid || !port) return null;

    // DuMate regenerates this key when it starts. Reading the environment of
    // the local child process avoids persisting or embedding a credential.
    const envOutput = execFileSync('/bin/ps', ['eww', '-p', pid], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const envLine = envOutput.trim().split('\n').pop() || '';
    const key = (envLine.match(/(?:^|\s)DUMATE_INAPP_KEY=([^\s]+)/) || [])[1];
    if (!key) return null;

    authCache = { host: config.backendHost, port, key: config.inappKey || key };
    authCacheAt = now;
    return authCache;
  } catch (_) {
    return null;
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function jsonResponse(res, statusCode, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    ...extraHeaders,
  });
  res.end(body);
}

function errorResponse(res, statusCode, message, type) {
  jsonResponse(res, statusCode, { error: { message, type } });
}

function pathAfterV1(url) {
  const value = String(url || '/');
  return value.replace(/^\/v1(?=\/|\?|$)/, '');
}

function modelFromBody(body) {
  try {
    const payload = JSON.parse(body.toString('utf8'));
    return { payload, model: payload && payload.model ? String(payload.model) : '' };
  } catch (_) {
    return { payload: null, model: '' };
  }
}

function makeUpstreamRequest(target, req, body, auth) {
  const isHttps = target.protocol === 'https:';
  const headers = { ...req.headers };
  for (const header of ['host', 'content-length', 'authorization', 'cookie', 'x-dumate-inapp-key']) {
    delete headers[header];
  }
  headers.authorization = 'Bearer nokey';
  headers['x-dumate-inapp-key'] = auth.key;
  headers['content-length'] = Buffer.byteLength(body);

  return {
    client: isHttps ? https : http,
    options: {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: target.pathname + target.search,
      method: req.method,
      headers,
      // Some local proxy installations terminate remote certificates upstream.
      // This is only used if an HTTPS upstream is configured explicitly.
      ...(isHttps ? { rejectUnauthorized: false } : {}),
    },
  };
}

function proxyRequest(req, res, body, config) {
  const { payload, model } = modelFromBody(body);
  if (!model) {
    errorResponse(res, 400, 'Request body must contain a model', 'invalid_request_error');
    return;
  }
  if (!isDumateModel(model, config)) {
    errorResponse(res, 400, `Unsupported model for DuMate proxy: ${model}`, 'unsupported_model');
    return;
  }

  const wire = wireModel(model, config);
  if (!wire) {
    errorResponse(res, 400, `Unknown DuMate model alias: ${model}`, 'unsupported_model');
    return;
  }

  const auth = findDumateAuth(config);
  if (!auth) {
    errorResponse(
      res,
      503,
      'DuMate is not running or its local backend credentials are unavailable',
      'dumate_unavailable',
    );
    return;
  }

  let outgoingBody = body;
  if (payload && typeof payload === 'object') {
    payload.model = wire;
    outgoingBody = Buffer.from(JSON.stringify(payload));
  }

  const target = new URL(
    `http://${auth.host}:${auth.port}${config.upstreamPrefix}${pathAfterV1(req.url)}`,
  );
  const { client, options } = makeUpstreamRequest(target, req, outgoingBody, auth);
  const upstream = client.request(options, (upstreamResponse) => {
    res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(res);
  });

  upstream.on('error', (error) => {
    clearAuthCache();
    if (!res.headersSent) {
      errorResponse(res, 502, `DuMate upstream error: ${error.message}`, 'upstream_error');
    } else {
      res.destroy(error);
    }
  });
  upstream.end(outgoingBody);

  console.error(
    `[dumate-proxy] ${req.method} ${req.url} model=${model} -> ${target.host}${target.pathname}`,
  );
}

function startServer(options = {}) {
  const envConfig = configFromEnv();
  const config = {
    ...envConfig,
    ...options,
    upstreamPrefix: normalizePrefix(options.upstreamPrefix ?? envConfig.upstreamPrefix),
  };
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && /^\/healthz(?:\?|$)/.test(req.url || '')) {
      jsonResponse(res, 200, { ok: true, service: 'dumate-openai-proxy' });
      return;
    }

    if (req.method === 'GET' && /^\/v1\/models(?:\?|$)/.test(req.url || '')) {
      jsonResponse(res, 200, { object: 'list', data: PUBLIC_MODELS });
      return;
    }

    if (!/^\/v1(?:\/|\?|$)/.test(req.url || '')) {
      errorResponse(res, 404, 'Use an OpenAI-compatible /v1 endpoint', 'not_found');
      return;
    }

    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > config.maxBodyBytes) {
        tooLarge = true;
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (tooLarge) {
        errorResponse(res, 413, 'Request body is too large', 'payload_too_large');
        return;
      }
      proxyRequest(req, res, Buffer.concat(chunks), config);
    });
  });

  server.listen(config.proxyPort, config.proxyHost, () => {
    const address = server.address();
    const port = address && typeof address === 'object' ? address.port : config.proxyPort;
    console.error(`[dumate-proxy] listening on http://${config.proxyHost}:${port}`);
  });
  return server;
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage());
      process.exit(0);
    }
    startServer(options);
  } catch (error) {
    console.error(`[dumate-proxy] ${error.message}`);
    console.error('Use --help for usage.');
    process.exit(2);
  }
}

module.exports = {
  MODEL_ALIASES,
  PUBLIC_MODELS,
  configFromEnv,
  findDumateAuth,
  isDumateModel,
  normalizeModel,
  parseArgs,
  pathAfterV1,
  startServer,
  usage,
  wireModel,
};
