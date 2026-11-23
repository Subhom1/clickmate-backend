import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import mongoose from 'mongoose';
import { io } from 'socket.io-client';
import { pathToFileURL } from 'node:url';

const databaseUri = 'mongodb://127.0.0.1:27028/clickmate_load_test?replicaSet=testset';
const authUrl = 'http://127.0.0.1:19099';
const serverUrl = 'http://127.0.0.1:15051';

export function parseCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 2 || count > 1000 || count % 2 !== 0) {
    throw new Error('Searcher count must be an even integer between 2 and 1000');
  }
  return count;
}

async function signUp(email, password) {
  const response = await fetch(`${authUrl}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local-test`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!response.ok) throw new Error(`Emulator sign-up failed (${response.status})`);
  return response.json();
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = io(serverUrl, { auth: { token }, reconnection: false, timeout: 10000, transports: ['websocket'] });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error) => { socket.disconnect(); reject(error); });
  });
}

export async function runLocal(count, markerFile, output) {
  count = parseCount(count);
  const marker = JSON.parse(await readFile(markerFile, 'utf8'));
  if (marker.uri !== databaseUri || typeof marker.marker !== 'string') throw new Error('Expected local test setup marker');
  await mongoose.connect(databaseUri, { serverSelectionTimeoutMS: 3000 });
  const db = mongoose.connection.db;
  const sockets = [];
  const userIds = [];
  const runId = randomUUID();
  try {
    if (!await db.collection('_setup_check').findOne({ marker: marker.marker })) throw new Error('Test database marker missing');
    const health = await fetch(`${serverUrl}/health`);
    if (!health.ok) throw new Error('Local backend is not healthy');
    const users = [];
    // Bound setup concurrency; the measured submission burst starts after every connection is ready.
    for (let first = 0; first < count; first += 20) {
      const batch = await Promise.allSettled(Array.from({ length: Math.min(20, count - first) }, async (_, offset) => {
        const email = `${runId}-${first + offset}@example.test`;
        const auth = await signUp(email, `${randomUUID()}Aa1!`);
        const id = new mongoose.Types.ObjectId();
        userIds.push(id);
        await db.collection('user').insertOne({ _id: id, fullname: 'Load test user', email, firebaseUid: auth.localId });
        const socket = await connect(auth.idToken);
        sockets.push(socket);
        return { id: id.toString(), socket };
      }));
      const failure = batch.find((item) => item.status === 'rejected');
      if (failure) throw failure.reason;
      users.push(...batch.map((item) => item.value));
    }
    if (users.some(({ socket }) => !socket.connected)) throw new Error('A test client disconnected before the burst');
    const results = { runId, connectedSearchers: count, submitted: 0, matches: 0, timeouts: 0, errors: 0, duplicateEvents: 0, decisionLatencyMs: [], durationSeconds: 0 };
    const seen = new Set();
    const started = performance.now();
    for (const user of users) {
      user.socket.on('search_update', (message) => {
        if (seen.has(user.id)) { results.duplicateEvents++; return; }
        seen.add(user.id);
        if (message.matches) { results.matches++; results.decisionLatencyMs.push(performance.now() - started); }
        else if (message.matches === null) results.timeouts++;
      });
      user.socket.on('error', () => { results.errors++; });
    }
    for (const user of users) {
      user.socket.emit('submit_keyword', { userId: user.id, query: 'Play a friendly game of chess' });
      results.submitted++;
    }
    // A fixed observation window retains unresolved searches as unresolved, not zero-latency decisions.
    await new Promise((resolve) => setTimeout(resolve, 45000));
    results.durationSeconds = (performance.now() - started) / 1000;
    results.unresolved = count - seen.size;
    await writeFile(output, `${JSON.stringify(results, null, 2)}\n`, { flag: 'wx' });
    return results;
  } finally {
    for (const socket of sockets) socket.disconnect();
    // Delete only the profiles created by this run. Search cleanup is handled by socket disconnect.
    if (userIds.length) await db.collection('user').deleteMany({ _id: { $in: userIds } });
    await mongoose.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 5) { console.error('Usage: node scripts/load/run-local.js <even-count> <runtime-marker.json> <new-output.json>'); process.exitCode = 1; }
  else runLocal(parseCount(process.argv[2]), process.argv[3], process.argv[4]).then((r) => console.log(JSON.stringify(r, null, 2))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
