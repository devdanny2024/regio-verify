import { createClient, ClientEvent, CallEvent } from 'matrix-js-sdk';

let client = null;
let activeCall = null;

/**
 * Initialise a Matrix guest client, join the room, then either answer an
 * incoming call from the admin or place one ourselves after a short wait.
 *
 * Requires matrix-js-sdk ^28. TURN credentials are fetched automatically
 * from the homeserver's /_matrix/client/v3/voip/turnServer endpoint —
 * configure `turn_shared_secret` in Synapse's homeserver.yaml.
 */
export async function initMatrix(
  { homeserver, room_id, guest_token, guest_user_id, guest_device_id },
  { onCallConnected, onCallEnded }
) {
  client = createClient({
    baseUrl: homeserver,
    accessToken: guest_token,
    userId: guest_user_id,
    deviceId: guest_device_id,
    useAuthorizationHeader: true,
  });

  await client.startClient({ initialSyncLimit: 20 });

  return new Promise((resolve, reject) => {
    client.once(ClientEvent.Sync, async (state) => {
      if (state === 'ERROR') return reject(new Error('Matrix sync failed'));
      if (state !== 'PREPARED') return;

      try {
        await client.joinRoom(room_id);
      } catch (e) {
        // Ignore "already in room" errors
        if (!e?.message?.includes('already')) throw e;
      }

      // If the admin calls first, answer immediately
      client.on(CallEvent.Incoming, (call) => {
        if (activeCall) return;
        activeCall = call;
        wireCallEvents(call, onCallConnected, onCallEnded);
        call.answer();
        clearTimeout(placeCallTimer);
      });

      // Otherwise, place the call ourselves after 1.5 s
      const placeCallTimer = setTimeout(async () => {
        if (activeCall) return;
        try {
          activeCall = client.createCall(room_id);
          wireCallEvents(activeCall, onCallConnected, onCallEnded);
          await activeCall.placeVideoCall();
        } catch (err) {
          console.error('[matrixCall] place call failed:', err);
        }
      }, 1500);

      resolve(client);
    });
  });
}

function wireCallEvents(call, onCallConnected, onCallEnded) {
  // Attach local/remote streams whenever feeds change
  call.on('feeds_changed', (feeds) => {
    for (const feed of feeds) {
      const el = document.getElementById(feed.isLocal() ? 'local-video' : 'remote-video');
      if (el && el.srcObject !== feed.stream) {
        el.srcObject = feed.stream;
      }
    }
  });

  call.on('state', (state) => {
    if (state === 'connected') onCallConnected();
    if (state === 'ended')    onCallEnded();
  });

  call.on('error', (err) => console.error('[matrixCall] call error:', err));
}

export function hangup() {
  activeCall?.hangup('user_hangup', false);
  activeCall = null;
  client?.stopClient();
  client = null;
}

// Returns the new muted state, or null if there's no active call.
export function toggleMic() {
  if (!activeCall) return null;
  const next = !activeCall.isMicrophoneMuted();
  activeCall.setMicrophoneMuted(next);
  return next;
}

// Returns the new "camera off" state, or null if there's no active call.
export function toggleCamera() {
  if (!activeCall) return null;
  const next = !activeCall.isLocalVideoMuted();
  activeCall.setLocalVideoMuted(next);
  return next;
}

// Mutes/unmutes what we hear locally. Not a Matrix API call — just toggles
// the remote <video> element's muted flag. Returns the new muted state.
export function toggleSound() {
  const remoteVideo = document.getElementById('remote-video');
  if (!remoteVideo) return null;
  remoteVideo.muted = !remoteVideo.muted;
  return remoteVideo.muted;
}
