import { getLang } from './i18n.js';
import { initMatrix, sendMessage, hangup } from './matrixCall.js';

// ── URL parsing ───────────────────────────────────────────
const pathParts = window.location.pathname.split('/');
const appointmentId = pathParts[pathParts.indexOf('verify') + 1] ?? '';
const langCode = new URLSearchParams(window.location.search).get('lang') ?? 'de';
const lang = getLang(langCode);

// ── DOM refs ──────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const el = {
  card:          $('ui-card'),
  callInterface: $('call-interface'),
  title:         $('t-title'),
  subtitle:      $('t-subtitle'),
  countdown:     $('countdown-display'),
  message:       $('t-message'),
  joinBtn:       $('btn-join'),
  joinBtnText:   $('t-button'),
  partnerLabel:  $('t-partner-label'),
  partnerName:   $('partner-name'),
  chatTitle:     $('t-chat-title'),
  chatHistory:   $('chat-history'),
  chatInput:     $('chat-input-field'),
  chatSend:      $('chat-send-btn'),
};

// ── Apply static i18n ─────────────────────────────────────
document.documentElement.lang = langCode;
el.title.textContent         = lang.title;
el.subtitle.textContent      = lang.subtitle;
el.joinBtnText.textContent   = lang.btn_waiting;
el.partnerLabel.textContent  = lang.partner_label;
el.chatTitle.textContent     = lang.chat_title;
el.chatInput.placeholder     = lang.chat_placeholder;
el.chatSend.textContent      = lang.chat_send;

// ── State ─────────────────────────────────────────────────
let appt = null;       // appointment data from API
let matrix = null;     // matrix credentials from API
let countdownTimer = null;
let pollTimer = null;

// ── Terminal error screen ─────────────────────────────────
function showError(type) {
  el.title.textContent    = lang[`status_${type}`] ?? lang.status_not_found;
  el.subtitle.textContent = lang[`msg_${type}`]    ?? lang.msg_not_found;
  el.countdown.style.display = 'none';
  el.message.style.display   = 'none';
  el.joinBtn.style.display    = 'none';
}

// ── Activate join button ──────────────────────────────────
function showReady() {
  clearInterval(countdownTimer);
  clearInterval(pollTimer);
  el.countdown.style.display = 'none';
  el.title.textContent       = lang.status_active;
  el.message.textContent     = lang.msg_active;
  el.joinBtnText.textContent = lang.btn_active;
  el.joinBtn.disabled        = false;
}

// ── Countdown tick ────────────────────────────────────────
function startCountdown() {
  el.title.textContent       = lang.status_waiting;
  el.message.textContent     = lang.msg_waiting;
  el.joinBtnText.textContent = lang.btn_waiting;
  el.countdown.style.display = '';

  function tick() {
    const diff = new Date(appt.scheduled_at).getTime() - Date.now();
    if (diff <= 0) { loadAppointment(); return; }
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    const s = Math.floor((diff % 60_000) / 1_000);
    el.countdown.textContent = h > 0
      ? `${pad(h)}:${pad(m)}:${pad(s)}`
      : `${pad(m)}:${pad(s)}`;
  }
  tick();
  countdownTimer = setInterval(tick, 1000);
}

const pad = (n) => String(n).padStart(2, '0');

// ── Fetch appointment from API ────────────────────────────
async function loadAppointment() {
  if (!appointmentId) return showError('not_found');

  let data;
  try {
    const res = await fetch(`/api/verify/${appointmentId}`);
    data = await res.json();
  } catch {
    return showError('not_found');
  }

  if (data.status === 'not_found') return showError('not_found');
  if (data.status === 'too_early') return showError('too_early');
  if (data.status === 'missed')    return showError('missed');

  appt   = data.appointment;
  matrix = data.matrix ?? null;
  el.partnerName.textContent = appt.partner_name;

  if (data.status === 'waiting') {
    startCountdown();
    // Re-poll every 15 s so the button activates without a page reload
    clearInterval(pollTimer);
    pollTimer = setInterval(loadAppointment, 15_000);
  } else if (data.status === 'active') {
    showReady();
  }
}

// ── Join call ─────────────────────────────────────────────
el.joinBtn.addEventListener('click', async () => {
  // Re-fetch credentials if we arrived at active state via polling
  if (!matrix) {
    let data;
    try {
      const res = await fetch(`/api/verify/${appointmentId}`);
      data = await res.json();
    } catch { return; }
    if (data.status !== 'active') return;
    matrix = data.matrix;
    appt   = data.appointment;
  }

  el.joinBtn.disabled      = true;
  el.joinBtnText.textContent = lang.btn_connecting;

  try {
    await initMatrix(matrix, {
      onMessage: ({ text }) => appendBubble(text, 'other'),
      onCallConnected: () => {
        el.card.style.display          = 'none';
        el.callInterface.style.display = 'flex';
      },
      onCallEnded: () => {
        hangup();
        el.callInterface.style.display = 'none';
        el.card.style.display          = '';
        showError('missed'); // reuse "missed" copy for a cleanly ended call
      },
    });
  } catch (err) {
    console.error('[entry] Matrix init error:', err);
    el.joinBtn.disabled        = false;
    el.joinBtnText.textContent = lang.btn_active;
  }
});

// ── Chat ──────────────────────────────────────────────────
function appendBubble(text, side) {
  const div = document.createElement('div');
  div.className = `chat-bubble ${side}`;
  div.textContent = text;
  el.chatHistory.appendChild(div);
  el.chatHistory.scrollTop = el.chatHistory.scrollHeight;
}

async function handleSend() {
  const text = el.chatInput.value.trim();
  if (!text || !matrix) return;
  el.chatInput.value = '';
  appendBubble(text, 'self');
  await sendMessage(matrix.room_id, text);
}

el.chatSend.addEventListener('click', handleSend);
el.chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSend(); });

// ── Boot ──────────────────────────────────────────────────
loadAppointment();
