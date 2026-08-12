#!/usr/bin/env node

const workerUrl = process.env.BOOKMARK_READER_WORKER_URL;
if (!workerUrl) {
  console.error('Set BOOKMARK_READER_WORKER_URL to your deployed Worker origin.');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
const concurrencyArg = process.argv.find(arg => arg.startsWith('--concurrency='));

const headers = {
  'Content-Type': 'application/json',
};

if (process.env.CF_ACCESS_JWT) {
  headers['cf-access-jwt-assertion'] = process.env.CF_ACCESS_JWT;
}

if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
  headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID;
  headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET;
}

const body = {
  execute,
};

if (limitArg) {
  body.limit = Number(limitArg.split('=')[1]);
}

if (concurrencyArg) {
  body.concurrency = Number(concurrencyArg.split('=')[1]);
}

const endpoint = new URL('/api/backfill/images', workerUrl);
const response = await fetch(endpoint, {
  method: 'POST',
  headers,
  body: JSON.stringify(body),
});

const text = await response.text();
if (!response.ok) {
  console.error(`Backfill request failed (${response.status}):`);
  console.error(text);
  process.exit(1);
}

try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text);
}
