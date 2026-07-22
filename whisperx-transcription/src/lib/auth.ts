/** Cognito user-pool auth. Invite-only, so there's no sign-up path here —
 *  accounts are created by an admin and land on a NEW_PASSWORD_REQUIRED
 *  challenge the first time they sign in. */

import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  type CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { backendConfig } from './config';

export class NewPasswordRequired extends Error {
  readonly complete: (password: string) => Promise<string>;

  constructor(complete: (password: string) => Promise<string>) {
    super('A new password is required for this account.');
    this.name = 'NewPasswordRequired';
    this.complete = complete;
  }
}

let pool: CognitoUserPool | null = null;

function userPool(): CognitoUserPool {
  if (!pool) {
    const { userPoolId, clientId } = backendConfig();
    pool = new CognitoUserPool({ UserPoolId: userPoolId, ClientId: clientId });
  }
  return pool;
}

function idTokenOf(session: CognitoUserSession): string {
  return session.getIdToken().getJwtToken();
}

export function signIn(email: string, password: string): Promise<string> {
  const user = new CognitoUser({ Username: email, Pool: userPool() });
  return new Promise((resolve, reject) => {
    user.authenticateUser(new AuthenticationDetails({ Username: email, Password: password }), {
      onSuccess: (session) => resolve(idTokenOf(session)),
      onFailure: (err) => reject(err),
      newPasswordRequired: () => {
        reject(
          new NewPasswordRequired(
            (next) =>
              new Promise<string>((res, rej) => {
                user.completeNewPasswordChallenge(next, {}, {
                  onSuccess: (session) => res(idTokenOf(session)),
                  onFailure: (err) => rej(err),
                });
              }),
          ),
        );
      },
    });
  });
}

export function signOut(): void {
  userPool().getCurrentUser()?.signOut();
}

export function currentUserEmail(): string | null {
  return userPool().getCurrentUser()?.getUsername() ?? null;
}

/** Resolves a currently-valid ID token, refreshing it if the cached one has
 *  expired. Returns null when nobody is signed in. Every API call goes through
 *  this rather than holding a token, so a 60-minute session never 401s mid-poll. */
export function idToken(): Promise<string | null> {
  const user = userPool().getCurrentUser();
  if (!user) return Promise.resolve(null);
  return new Promise((resolve) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session?.isValid()) {
        resolve(null);
        return;
      }
      resolve(idTokenOf(session));
    });
  });
}
