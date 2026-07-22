/**
 * End-to-end smoke test against the deployed API.
 *
 *   node backend/scripts/smoke-test.mjs
 *
 * Reads the stack outputs from ../.env.local. Takes the password from
 * $WHISPERX_PASSWORD, or prompts for it with echo off so it never lands in
 * shell history. Handles the first-login NEW_PASSWORD_REQUIRED challenge.
 *
 * Exercises: sign-in -> POST /jobs -> presigned PUT -> GET /jobs -> GET /jobs/{id}
 * -> POST /jobs/{id}/submit (expected 503 until the GPU endpoint is deployed).
 */

import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pkg from 'amazon-cognito-identity-js';

const { AuthenticationDetails, CognitoUser, CognitoUserPool } = pkg;

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, '../../.env.local');

function loadEnv() {
  const out = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function ask(question, { hidden = false } = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((res) => {
    if (hidden) {
      // Suppress echo so the password isn't visible or captured.
      const onData = (char) => {
        if (['\n', '\r', ''].includes(char.toString('utf8'))) process.stdin.pause();
      };
      process.stdin.on('data', onData);
      rl._writeToOutput = function (s) {
        if (s.includes(question)) rl.output.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      res(answer.trim());
    });
  });
}

function signIn(pool, email, password) {
  const user = new CognitoUser({ Username: email, Pool: pool });
  return new Promise((res, rej) => {
    user.authenticateUser(new AuthenticationDetails({ Username: email, Password: password }), {
      onSuccess: (s) => res(s.getIdToken().getJwtToken()),
      onFailure: rej,
      newPasswordRequired: async () => {
        console.log('\n  This account still has its temporary password. Set a permanent one.');
        const next = await ask('  New password (12+ chars, upper+lower+number): ', { hidden: true });
        user.completeNewPasswordChallenge(next, {}, {
          onSuccess: (s) => res(s.getIdToken().getJwtToken()),
          onFailure: rej,
        });
      },
    });
  });
}

/** Minimal valid 1-second 16 kHz mono WAV, built by hand so the test needs no fixture. */
function makeWav() {
  const rate = 16000;
  const samples = rate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` ${detail}` : ''}`);
  if (!ok) failures++;
}

async function main() {
  const env = loadEnv();
  const api = env.VITE_API_URL;
  const pool = new CognitoUserPool({
    UserPoolId: env.VITE_COGNITO_USER_POOL_ID,
    ClientId: env.VITE_COGNITO_CLIENT_ID,
  });

  console.log(`\nAPI: ${api}\n`);
  const email = process.env.WHISPERX_EMAIL || (await ask('Email: '));
  const password = process.env.WHISPERX_PASSWORD || (await ask('Password: ', { hidden: true }));

  console.log('\nauth');
  const token = await signIn(pool, email, password);
  check('signed in, got ID token', token.split('.').length === 3);

  const authed = (path, init = {}) =>
    fetch(`${api}${path}`, {
      ...init,
      headers: { authorization: token, 'content-type': 'application/json', ...init.headers },
    });

  console.log('\nPOST /jobs');
  const wav = makeWav();
  const createRes = await authed('/jobs', {
    method: 'POST',
    body: JSON.stringify({
      fileName: 'smoke-test.wav',
      sizeBytes: wav.length,
      model: 'balanced',
      language: 'en',
      diarize: false,
    }),
  });
  const created = await createRes.json();
  check('201 Created', createRes.status === 201, `(got ${createRes.status})`);
  check('returned jobId', Boolean(created.jobId), created.jobId ?? '');
  check('returned presigned uploadUrl', String(created.uploadUrl ?? '').includes('X-Amz-Signature'));

  console.log('\nvalidation');
  const tooBig = await authed('/jobs', {
    method: 'POST',
    body: JSON.stringify({ fileName: 'x.wav', sizeBytes: 600 * 1024 * 1024, model: 'fast' }),
  });
  check('rejects >500MB', tooBig.status === 400, `(got ${tooBig.status})`);
  const badExt = await authed('/jobs', {
    method: 'POST',
    body: JSON.stringify({ fileName: 'notes.txt', sizeBytes: 10, model: 'fast' }),
  });
  check('rejects bad extension', badExt.status === 400, `(got ${badExt.status})`);

  console.log('\nPUT to S3');
  const put = await fetch(created.uploadUrl, { method: 'PUT', body: wav });
  check('upload succeeded', put.ok, `(${put.status})`);

  console.log('\nGET /jobs');
  const list = await (await authed('/jobs')).json();
  const mine = list.jobs?.find((j) => j.jobId === created.jobId);
  check('job appears in list', Boolean(mine));
  check('status is CREATED', mine?.status === 'CREATED', `(got ${mine?.status})`);
  check('fileName round-tripped', mine?.fileName === 'smoke-test.wav');

  console.log('\nGET /jobs/{id}');
  const one = await (await authed(`/jobs/${created.jobId}`)).json();
  check('returns the job', one.jobId === created.jobId);
  check('no transcriptUrl yet', !one.transcriptUrl);

  console.log('\nPOST /jobs/{id}/submit');
  const submit = await authed(`/jobs/${created.jobId}/submit`, { method: 'POST' });
  const submitBody = await submit.json();
  check('503 while GPU endpoint is absent', submit.status === 503, `(got ${submit.status})`);
  check('explains why', String(submitBody.message ?? '').includes('not deployed'));

  console.log('\nisolation');
  const missing = await authed('/jobs/00000000-0000-0000-0000-000000000000');
  check('unknown job is 404', missing.status === 404, `(got ${missing.status})`);

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nsmoke test failed:', err.message || err);
  process.exit(1);
});
