/**
 * Matrix helpers for the REGIO verification tool.
 *
 * Registration approach mirrors the existing REGIO platform (app/chat/matrix_http.py):
 * 3-step UIA flow with m.login.registration_token — guest access is NOT used
 * because matrix.151.hu does not have allow_guest_access enabled.
 *
 * Each verification call registers one temporary Matrix user, consuming one
 * registration token slot. Ensure the token limit in MatrixRegistrationStats
 * is high enough (currently 300 on the main platform).
 */

import sdk from 'matrix-js-sdk';
import crypto from 'crypto';
import 'dotenv/config';

const { createClient } = sdk;

let _adminClient = null;
let _accessToken = process.env.MATRIX_BOT_TOKEN;

async function loginWithPassword() {
  const username = process.env.MATRIX_BOT_USER_ID.split(':')[0].replace('@', '');
  const res = await fetch(`${process.env.MATRIX_HOMESERVER}/_matrix/client/v3/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: username },
      password: process.env.MATRIX_BOT_PASS,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Matrix login failed: ${JSON.stringify(data)}`);
  _accessToken = data.access_token;
  console.log('[matrix] refreshed bot access token via password login');
  return _accessToken;
}

async function adminClient() {
  if (_adminClient) return _adminClient;
  _adminClient = createClient({
    baseUrl: process.env.MATRIX_HOMESERVER,
    accessToken: _accessToken,
    userId: process.env.MATRIX_BOT_USER_ID,
  });
  return _adminClient;
}

async function withTokenRefresh(fn) {
  try {
    return await fn(await adminClient());
  } catch (err) {
    if (err?.errcode === 'M_UNKNOWN_TOKEN' && process.env.MATRIX_BOT_PASS) {
      await loginWithPassword();
      _adminClient = createClient({
        baseUrl: process.env.MATRIX_HOMESERVER,
        accessToken: _accessToken,
        userId: process.env.MATRIX_BOT_USER_ID,
      });
      return await fn(_adminClient);
    }
    throw err;
  }
}

// ── UIA registration (mirrors register_matrix_user_uia in matrix_http.py) ────

async function matrixPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${process.env.MATRIX_HOMESERVER}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

/**
 * Register a temporary Matrix user for this verification session via the
 * 3-step UIA registration_token flow. Returns { user_id, access_token, device_id }.
 *
 * Username format: regioverify_{16 random hex chars}
 * This keeps verify-tool accounts visually distinct from platform accounts
 * (regio_{uuid}) on the homeserver.
 */
export async function registerVerifyUser() {
  const username = `regioverify_${crypto.randomBytes(8).toString('hex')}`;
  const password = crypto.randomBytes(32).toString('hex');
  const endpoint = '/_matrix/client/v3/register';
  const baseBody = { username, password, kind: 'user' };

  // Step 1 — initiate UIA, get session ID
  const { data: r1 } = await matrixPost(endpoint, baseBody);
  const session = r1.session;
  if (!session) throw new Error(`Matrix UIA step 1: no session returned — ${JSON.stringify(r1)}`);

  // Step 2 — authenticate with registration token
  const { data: r2 } = await matrixPost(endpoint, {
    ...baseBody,
    auth: { type: 'm.login.registration_token', session, token: process.env.MATRIX_REGISTRATION_TOKEN },
  });
  if (r2.access_token) {
    return { user_id: r2.user_id, access_token: r2.access_token, device_id: r2.device_id ?? '' };
  }

  // Step 3 — dummy auth to finalise (some Synapse versions need this)
  const { data: r3 } = await matrixPost(endpoint, {
    ...baseBody,
    auth: { type: 'm.login.dummy', session },
  });
  if (!r3.access_token) throw new Error(`Matrix UIA step 3 failed: ${JSON.stringify(r3)}`);

  return { user_id: r3.user_id, access_token: r3.access_token, device_id: r3.device_id ?? '' };
}

// ── Room creation ─────────────────────────────────────────────────────────────

/**
 * Create a private Matrix room as the bot user.
 * Invites:
 *   - @mm:151.hu (Markus, answers calls in Element)
 *   - the temp verify user (if provided — set after registerVerifyUser)
 *
 * join_rules: invite (private). The temp user is explicitly invited so they
 * can join without guest access.
 */
export async function createVerificationRoom(memberName, extraInvite) {
  const invite = [process.env.MATRIX_ADMIN_USER_ID];
  if (extraInvite) invite.push(extraInvite);

  const { room_id } = await withTokenRefresh((client) =>
    client.createRoom({
      name: `Verifizierung: ${memberName}`,
      preset: 'private_chat',
      visibility: 'private',
      invite,
      power_level_content_override: {
        events_default: 0,
        state_default: 50,
        users_default: 0,
        users: {
          [process.env.MATRIX_BOT_USER_ID]: 100,
          [process.env.MATRIX_ADMIN_USER_ID]: 50,
        },
      },
    })
  );

  return room_id;
}

export async function inviteToRoom(roomId, matrixUserId) {
  await withTokenRefresh((client) => client.invite(roomId, matrixUserId));
}
