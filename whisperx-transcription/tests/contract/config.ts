import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Shared between the vitest config, the global setup, and the tests. A fixed
 * port keeps VITE_API_URL statically configurable, which is what lets the
 * tests drive the real `src/lib/api.ts` instead of a copy of it.
 */
export const PORT = Number(process.env.CONTRACT_PORT ?? 8123);
export const BASE_URL = `http://127.0.0.1:${PORT}/api`;

export const REPO_DIR = fileURLToPath(new URL('../..', import.meta.url));
export const BACKEND_DIR = join(REPO_DIR, 'backend');
/** Scratch /data for the spawned API. Wiped on every run. */
export const DATA_DIR = join(BACKEND_DIR, '.contract-data');
/** Small, so the oversize rejection can be tested in a few hundred kilobytes. */
export const MAX_UPLOAD_BYTES = 256 * 1024;

export const INSTALL_HINT =
  'The contract test needs a Python with the API dependencies. Create one with:\n' +
  '  python3 -m venv backend/.venv\n' +
  '  backend/.venv/bin/pip install fastapi uvicorn python-multipart\n' +
  'or point WHISPERX_PYTHON at an interpreter that already has them.';

/**
 * The API imports only config, db, and storage — never transcribe — so it runs
 * without torch, whisperx, or a GPU.
 */
export function resolvePython(): string | null {
  const candidates = [
    process.env.WHISPERX_PYTHON,
    join(BACKEND_DIR, '.venv', 'bin', 'python'),
    join(REPO_DIR, '.venv', 'bin', 'python'),
  ].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(p)) ?? null;
}
