import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
const { MongoClient } = mongoose.mongo;
import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = mkdtempSync(path.join(tmpdir(), 'clickmate-load-'));
const project = 'demo-clickmate-local-test';
const host = '127.0.0.1:19099';
const configDir = path.join(dir, 'config');
mkdirSync(configDir, { recursive: true });
const key = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
const account = { type: 'service_account', project_id: project, private_key: key, client_email: `test@${project}.iam.gserviceaccount.com` };
writeFileSync(path.join(dir, 'test-service-account.json'), JSON.stringify(account), { mode: 0o600 });
writeFileSync(path.join(dir, 'firebase.json'), JSON.stringify({ emulators: { auth: { host: '127.0.0.1', port: 19099 }, ui: { enabled: false }, singleProjectMode: true } }));
let replica, emulator;
let stopped = false;
async function stop(code) {
  if (stopped) return;
  stopped = true;
  rmSync(path.join(dir, 'runtime.json'), { force: true });
  if (emulator) emulator.kill('SIGTERM');
  if (replica) await replica.stop();
  rmSync(dir, { recursive: true, force: true });
  process.exit(code);
}
process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));
try {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, ip: '127.0.0.1', storageEngine: 'wiredTiger' }, instanceOpts: [{ port: 27028, ip: '127.0.0.1' }] });
  const uri = replica.getUri('clickmate_load_test');
  const client = new MongoClient(uri);
  await client.connect();
  const marker = randomUUID();
  const session = client.startSession();
  await session.withTransaction(async () => { await client.db('clickmate_load_test').collection('_setup_check').insertOne({ marker }, { session }); });
  await session.endSession();
  await client.close();
  const env = { PATH: process.env.PATH, HOME: dir, XDG_CONFIG_HOME: configDir, CI: 'true' };
  emulator = spawn(process.execPath, [path.join(repo, 'node_modules/firebase-tools/lib/bin/firebase.js'), 'emulators:start', '--only', 'auth', '--project', project, '--config', path.join(dir, 'firebase.json')], { cwd: dir, env, stdio: 'inherit' });
  let exitCode = null;
  emulator.on('exit', (code) => { exitCode = code ?? 1; });
  let response;
  for (let i = 0; i < 90; i++) {
    if (exitCode !== null) throw new Error(`Firebase emulator exited (${exitCode})`);
    try { response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local-test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'setup-check@example.test', password: 'local-test-password', returnSecureToken: true }) }); if (response.ok) break; } catch {}
    await delay(1000);
  }
  if (!response?.ok) throw new Error('Firebase emulator did not become ready');
  const token = (await response.json()).idToken;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = host;
  const require = createRequire(path.join(repo, 'package.json'));
  const { initializeApp, cert } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const decoded = await getAuth(initializeApp({ credential: cert(account) })).verifyIdToken(token);
  if (decoded.email !== 'setup-check@example.test') throw new Error('Emulator token verification failed');
  writeFileSync(path.join(dir, 'runtime.json'), JSON.stringify({ uri, marker }), { mode: 0o600 });
  console.log(`\nREADY: isolated MongoDB replica set at ${uri}`);
  console.log(`READY: Firebase Auth emulator at ${host}; test token verified`);
  console.log(`Keep this terminal open. Backend: node scripts/load/start-backend.js ${JSON.stringify(dir)}`);
  console.log(`Harness marker: ${path.join(dir, 'runtime.json')}`);
  console.log('Test data is temporary and removed when this process stops. Press Ctrl-C to stop.');
} catch (error) { console.error('Local test setup failed:', error.message); await stop(1); }
