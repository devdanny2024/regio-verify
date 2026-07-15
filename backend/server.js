import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { initDb, getAppointment, listAppointments, createAppointment, updateStatus, saveAvailability } from './db.js';
import { sendAvailabilityEmail } from './mailer.js';
import { createVerificationRoom, registerVerifyUser, inviteToRoom } from './matrix.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(cors());

// Serve the built frontend
app.use(express.static(path.join(__dirname, '../frontend/public')));

// ── Basic auth for every /api/admin/* route ───────────────
function adminAuth(req, res, next) {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Basic ')) {
    return res.status(401)
      .set('WWW-Authenticate', 'Basic realm="REGIO Admin"')
      .json({ error: 'Unauthorized' });
  }
  const decoded = Buffer.from(auth.slice(6), 'base64').toString();
  const colon = decoded.indexOf(':');
  const user = decoded.slice(0, colon);
  const pass = decoded.slice(colon + 1);
  if (user !== process.env.ADMIN_USER || pass !== process.env.ADMIN_PASS) {
    return res.status(401)
      .set('WWW-Authenticate', 'Basic realm="REGIO Admin"')
      .json({ error: 'Unauthorized' });
  }
  next();
}

// ── Determine appointment status relative to now ──────────
function resolveStatus(appt) {
  const now = Date.now();
  const start = new Date(appt.scheduled_at).getTime();
  const end = start + appt.call_window_minutes * 60_000;
  const maxAhead = 4 * 24 * 60 * 60_000; // 4 days

  if (now < start - maxAhead) return 'too_early';
  if (now < start)            return 'waiting';
  if (now <= end)             return 'active';
  return 'missed';
}

// ── PUBLIC: submit availability ───────────────────────────
// POST /api/schedule
// Body: { user_id, member_email, slots: string[], lang }
// One submission per user_id — subsequent calls are silently ignored.
app.post('/api/schedule', async (req, res) => {
  try {
    const { user_id, member_email, slots, lang } = req.body;
    if (!user_id || !Array.isArray(slots) || slots.length === 0) {
      return res.status(400).json({ error: 'user_id and at least one slot are required' });
    }

    const saved = await saveAvailability({ userId: user_id, memberEmail: member_email, slots, lang });

    if (!saved) {
      // Already submitted — return ok so the frontend shows the confirmation screen
      return res.json({ status: 'already_submitted' });
    }

    await sendAvailabilityEmail({ userId: user_id, memberEmail: member_email, slots, lang });

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('[schedule]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUBLIC: validate invite link ──────────────────────────
// GET /api/verify/:id
// Returns appointment status + Matrix credentials when active.
app.get('/api/verify/:id', async (req, res) => {
  try {
    const appt = await getAppointment(req.params.id);
    if (!appt) return res.status(404).json({ status: 'not_found' });

    const status = resolveStatus(appt);

    const payload = {
      status,
      appointment: {
        id: appt.id,
        partner_name: appt.partner_name,
        scheduled_at: appt.scheduled_at,
        call_window_minutes: appt.call_window_minutes,
        lang: appt.lang,
      },
    };

    // Only hand out Matrix credentials when the call window is open.
    // Register a temporary Matrix user via UIA, then invite them into the room.
    if (status === 'active') {
      const member = await registerVerifyUser();
      await inviteToRoom(appt.matrix_room_id, member.user_id);
      payload.matrix = {
        homeserver: process.env.MATRIX_HOMESERVER,
        room_id: appt.matrix_room_id,
        guest_token: member.access_token,
        guest_user_id: member.user_id,
        guest_device_id: member.device_id,
      };
    }

    res.json(payload);
  } catch (err) {
    console.error('[verify]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── ADMIN: list appointments ──────────────────────────────
app.get('/api/admin/appointments', adminAuth, async (_req, res) => {
  try {
    res.json(await listAppointments());
  } catch (err) {
    console.error('[admin/list]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── ADMIN: create appointment + provision Matrix room ─────
app.post('/api/admin/appointments', adminAuth, async (req, res) => {
  try {
    const { member_name, member_email, partner_name, scheduled_at, call_window_minutes, lang } = req.body;

    if (!member_name || !scheduled_at) {
      return res.status(400).json({ error: 'member_name and scheduled_at are required' });
    }

    const matrix_room_id = await createVerificationRoom(member_name);

    const appt = await createAppointment({
      member_name,
      member_email,
      partner_name: partner_name || process.env.ADMIN_DISPLAY_NAME || 'REGIO Team',
      scheduled_at,
      call_window_minutes: call_window_minutes || 60,
      matrix_room_id,
      lang: lang || 'de',
    });

    // Return the full invite link so the admin can copy it directly
    appt.invite_link = `${process.env.BASE_URL}/verify/${appt.id}?lang=${appt.lang}`;

    res.status(201).json(appt);
  } catch (err) {
    console.error('[admin/create]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── ADMIN: update verification outcome ───────────────────
app.patch('/api/admin/appointments/:id', adminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['pending', 'verified', 'rejected', 'missed'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
    }
    const appt = await updateStatus(req.params.id, status);
    if (!appt) return res.status(404).json({ error: 'Not found' });
    res.json(appt);
  } catch (err) {
    console.error('[admin/patch]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Serve frontend for /verify/:id paths ─────────────────
app.get('/verify/:id', (_req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/public/admin.html'));
});

app.get('/schedule', (_req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/public/schedule.html'));
});

// ── Boot ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
initDb()
  .then(() => app.listen(PORT, () => console.log(`REGIO Verify → http://localhost:${PORT}`)))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });
