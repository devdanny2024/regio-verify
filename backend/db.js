import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS availability_submissions (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      TEXT        NOT NULL UNIQUE,
      member_email TEXT,
      slots        JSONB       NOT NULL,
      lang         TEXT        NOT NULL DEFAULT 'de',
      submitted_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      member_name         TEXT        NOT NULL,
      member_email        TEXT,
      partner_name        TEXT        NOT NULL DEFAULT 'REGIO Team',
      scheduled_at        TIMESTAMPTZ NOT NULL,
      call_window_minutes INT         NOT NULL DEFAULT 60,
      matrix_room_id      TEXT,
      lang                TEXT        NOT NULL DEFAULT 'de',
      status              TEXT        NOT NULL DEFAULT 'pending',
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      guest_user_id       TEXT,
      guest_access_token  TEXT,
      guest_device_id     TEXT
    )
  `);

  await pool.query(`
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS guest_user_id      TEXT
  `);
  await pool.query(`
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS guest_access_token TEXT
  `);
  await pool.query(`
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS guest_device_id    TEXT
  `);
}

export async function getAppointment(id) {
  const { rows } = await pool.query('SELECT * FROM appointments WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function listAppointments() {
  const { rows } = await pool.query(
    'SELECT * FROM appointments ORDER BY scheduled_at DESC'
  );
  return rows;
}

export async function createAppointment({ member_name, member_email, partner_name, scheduled_at, call_window_minutes, matrix_room_id, lang }) {
  const { rows } = await pool.query(
    `INSERT INTO appointments
       (member_name, member_email, partner_name, scheduled_at, call_window_minutes, matrix_room_id, lang)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [member_name, member_email || null, partner_name || 'REGIO Team', scheduled_at, call_window_minutes || 60, matrix_room_id || null, lang || 'de']
  );
  return rows[0];
}

export async function updateStatus(id, status) {
  const { rows } = await pool.query(
    'UPDATE appointments SET status = $1 WHERE id = $2 RETURNING *',
    [status, id]
  );
  return rows[0] || null;
}

export async function saveAvailability({ userId, memberEmail, slots, lang }) {
  const { rows } = await pool.query(
    `INSERT INTO availability_submissions (user_id, member_email, slots, lang)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING id`,
    [userId, memberEmail || null, JSON.stringify(slots), lang || 'de']
  );
  return rows[0] || null; // null = already submitted
}

export async function setRoomId(id, roomId) {
  await pool.query('UPDATE appointments SET matrix_room_id = $1 WHERE id = $2', [roomId, id]);
}

export async function setGuestCredentials(id, { userId, accessToken, deviceId }) {
  await pool.query(
    'UPDATE appointments SET guest_user_id = $1, guest_access_token = $2, guest_device_id = $3 WHERE id = $4',
    [userId, accessToken, deviceId, id]
  );
}

export default pool;
