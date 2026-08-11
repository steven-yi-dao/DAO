import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { BACKEND_DIR, BASE_URL, DATA_DIR, INSTALL_HINT, MAX_UPLOAD_BYTES, PORT, resolvePython } from './config';

let server: ChildProcess | null = null;

async function waitForHealth(timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`The API exited with code ${server.exitCode} before becoming healthy.`);
    }
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`The API did not answer ${BASE_URL}/health within ${timeoutMs}ms.`);
}

export async function setup(): Promise<void> {
  const python = resolvePython();
  if (!python) throw new Error(INSTALL_HINT);

  // A fresh /data every run, so job counts and list ordering are deterministic.
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  server = spawn(python, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(PORT)], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      DATA_DIR,
      MAX_UPLOAD_BYTES: String(MAX_UPLOAD_BYTES),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  server.on('error', (err) => {
    throw new Error(`Could not start the API with ${python}: ${err.message}\n${INSTALL_HINT}`);
  });

  await waitForHealth();
}

export async function teardown(): Promise<void> {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        server?.kill('SIGKILL');
        resolve(null);
      }, 5000);
      server?.once('exit', () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  }
  server = null;
  rmSync(DATA_DIR, { recursive: true, force: true });
}
