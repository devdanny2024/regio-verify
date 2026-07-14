import nodemailer from 'nodemailer';
import 'dotenv/config';

const transportConfig = {
  host: process.env.SMTP_HOST || '127.0.0.1',
  port: parseInt(process.env.SMTP_PORT || '25', 10),
  secure: false,
  ignoreTLS: false,
  tls: { rejectUnauthorized: false },
};
if (process.env.SMTP_USER) {
  transportConfig.auth = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
}
const transporter = nodemailer.createTransport(transportConfig);

/**
 * Send the member's availability to team@regio.is.
 * slots: array of ISO datetime strings e.g. ["2026-06-23T09:00", ...]
 */
export async function sendAvailabilityEmail({ userId, memberEmail, slots, lang }) {
  const formatted = slots
    .sort()
    .map((s) => {
      const d = new Date(s);
      const weekday = d.toLocaleDateString('de-DE', { weekday: 'long' });
      const date = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const time = `${String(d.getHours()).padStart(2, '0')}:00 – ${String(d.getHours() + 1).padStart(2, '0')}:00`;
      return `  • ${weekday}, ${date}  ${time}`;
    })
    .join('\n');

  const mailOptions = {
    envelope: process.env.SMTP_ENVELOPE_FROM
      ? { from: process.env.SMTP_ENVELOPE_FROM, to: 'team@regio.is' }
      : undefined,
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: 'team@regio.is',
    subject: `Verfügbarkeit eingereicht – ${memberEmail || userId}`,
    text: `Ein Mitglied hat seine verfügbaren Zeitfenster für den Verifizierungs-Videocall übermittelt.

Mitglieds-E-Mail : ${memberEmail || '(nicht angegeben)'}
Benutzer-ID      : ${userId}
Sprache          : ${lang}

Verfügbare Zeitfenster:
${formatted}

Bitte wähle einen Termin aus, erstelle den Call im Admin-Panel und sende dem Mitglied den Verifizierungslink.
`,
    html: `
<p>Ein Mitglied hat seine verfügbaren Zeitfenster für den Verifizierungs-Videocall übermittelt.</p>
<table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">
  <tr><td style="color:#666">Mitglieds-E-Mail</td><td><strong>${memberEmail || '(nicht angegeben)'}</strong></td></tr>
  <tr><td style="color:#666">Benutzer-ID</td><td>${userId}</td></tr>
  <tr><td style="color:#666">Sprache</td><td>${lang}</td></tr>
</table>
<h3 style="color:#436f4e;margin-top:20px">Verfügbare Zeitfenster</h3>
<ul style="line-height:2">
${slots.sort().map((s) => {
  const d = new Date(s);
  const weekday = d.toLocaleDateString('de-DE', { weekday: 'long' });
  const date = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = `${String(d.getHours()).padStart(2, '0')}:00 – ${String(d.getHours() + 1).padStart(2, '0')}:00`;
  return `<li>${weekday}, ${date} &nbsp;<strong>${time}</strong></li>`;
}).join('')}
</ul>
<p style="margin-top:20px;color:#666">Bitte wähle einen Termin aus, erstelle den Call im <strong>Admin-Panel</strong> und sende dem Mitglied den Verifizierungslink.</p>
`,
  };
  await transporter.sendMail(mailOptions);
}
