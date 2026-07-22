/** Backend wiring, injected at build time. See backend/README.md for where the
 *  values come from (they're the CloudFormation stack outputs). */

interface BackendConfig {
  apiUrl: string;
  userPoolId: string;
  clientId: string;
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name} — copy .env.example to .env.local and fill in the stack outputs.`);
  }
  return value;
}

export function backendConfig(): BackendConfig {
  return {
    apiUrl: required('VITE_API_URL', import.meta.env.VITE_API_URL),
    userPoolId: required('VITE_COGNITO_USER_POOL_ID', import.meta.env.VITE_COGNITO_USER_POOL_ID),
    clientId: required('VITE_COGNITO_CLIENT_ID', import.meta.env.VITE_COGNITO_CLIENT_ID),
  };
}

/** True when the app has been built with real backend credentials. Lets the SPA
 *  keep running against its mocks until the stack is actually deployed. */
export const backendConfigured = Boolean(
  import.meta.env.VITE_API_URL &&
    import.meta.env.VITE_COGNITO_USER_POOL_ID &&
    import.meta.env.VITE_COGNITO_CLIENT_ID,
);

export const POLL_INTERVAL_MS = 3000;
