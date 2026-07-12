# REGIO Video Verification — Setup Guide

## 1. Prerequisites

- Node.js 20+
- PostgreSQL 14+
- A running Synapse homeserver
- A Coturn TURN server

---

## 2. Database

```bash
createdb regio_verify
```

The schema is created automatically on first start (`db.js` → `initDb()`).

---

## 3. Matrix — Synapse configuration

Add/confirm these lines in `homeserver.yaml` then restart Synapse:

```yaml
# Allow guests to register and join rooms
allow_guest_access: true

# TURN server — Synapse issues time-limited credentials automatically.
# The member page fetches them via /_matrix/client/v3/voip/turnServer.
turn_uris:
  - "turn:turn.regio.is:3478?transport=udp"
  - "turn:turn.regio.is:3478?transport=tcp"
turn_shared_secret: "YOUR_COTURN_STATIC_AUTH_SECRET"
turn_user_lifetime: 86400000   # 24 h in ms
turn_allow_guests: true
```

### Create the bot user

```bash
register_new_matrix_user -c /etc/matrix-synapse/homeserver.yaml \
  -u regio-verify-bot -p STRONG_PASSWORD --no-admin
```

Then log in as the bot in Element to get its access token, or use:

```bash
curl -XPOST 'https://matrix.regio.is/_matrix/client/v3/login' \
  -d '{"type":"m.login.password","user":"regio-verify-bot","password":"STRONG_PASSWORD"}'
```

Copy `access_token` → `MATRIX_BOT_TOKEN` in `.env`.

---

## 4. Coturn configuration (`/etc/turnserver.conf`)

```
use-auth-secret
static-auth-secret=YOUR_COTURN_STATIC_AUTH_SECRET   # must match Synapse's turn_shared_secret
realm=regio.is
listening-port=3478
tls-listening-port=5349
cert=/path/to/cert.pem
pkey=/path/to/key.pem
no-multicast-peers
```

---

## 5. Backend

```bash
cd backend
cp .env.example .env
# Fill in all values in .env
npm install
npm start
```

---

## 6. Frontend

```bash
cd frontend
npm install
npm run build        # outputs frontend/public/bundle.js
```

During development use `npm run watch` to rebuild on every save.

---

## 7. Running in production

The backend serves all frontend static files from `frontend/public/`.
Point your reverse proxy (nginx/caddy) at port 3000.

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

---

## 8. Admin panel

Open `https://regio.is/admin` — the browser will prompt for Basic Auth credentials
(`ADMIN_USER` / `ADMIN_PASS` from `.env`).

Workflow:
1. Fill in the form → click **Termin erstellen**
2. Copy the generated link → send to the member via email or Telegram
3. At call time, the admin joins from their Element client (they were invited to the Matrix room automatically)
4. After the call, click **✓ Verifiziert** or **✗ Abgelehnt** next to the row

---

## 9. Invite link format

```
https://regio.is/verify/[UUID]?lang=en
```

- `lang` accepts `de` (default), `en`, `hu`
- Link is valid for calls scheduled up to 4 days in the future
- Call window is configurable per appointment (default 60 minutes)
