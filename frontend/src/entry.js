import { getLang } from './i18n.js';
import { initMatrix, hangup, toggleMic, toggleCamera, toggleSound } from './matrixCall.js';

// ── URL parsing ───────────────────────────────────────────
const pathParts = window.location.pathname.split('/');
const appointmentId = pathParts[pathParts.indexOf('verify') + 1] ?? '';
const langCode = new URLSearchParams(window.location.search).get('lang') ?? 'de';
const lang = getLang(langCode);

// ── DOM refs ──────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const el = {
  errorCard:     $('error-card'),
  errorTitle:    $('t-title'),
  errorMessage:  $('t-message'),
  appCard:       $('app-card'),
  whyTitle:      $('t-why-title'),
  whyText:       $('t-why-text'),
  infoBlock:     $('info-block'),
  countdown:     $('countdown-display'),
  statusMessage: $('t-status-message'),
  joinBtn:       $('btn-join'),
  joinBtnText:   $('t-button'),
  partnerLabel:  $('t-partner-label'),
  partnerName:   $('partner-name'),
  callControls:  $('call-controls'),
  btnSound:      $('btn-sound'),
  btnCamera:     $('btn-camera'),
  btnMic:        $('btn-mic'),
  btnHangup:     $('btn-hangup'),
  iconSound:     $('icon-sound'),
  iconCamera:    $('icon-camera'),
  iconMic:       $('icon-mic'),
  langSelect:    $('lang-select'),
};

// ── Apply static i18n ─────────────────────────────────────
document.documentElement.lang = langCode;
el.whyTitle.textContent     = lang.why_title;
el.whyText.textContent      = lang.why_text;
el.joinBtnText.textContent  = lang.btn_waiting;
el.partnerLabel.textContent = lang.partner_label;
el.langSelect.value         = langCode;

// Switching language reloads the page with the new ?lang= — simplest way
// to cleanly re-render every dynamic state (countdown, errors, etc.)
// without a call in progress being disrupted by a partial re-render.
el.langSelect.addEventListener('change', (e) => {
  const params = new URLSearchParams(window.location.search);
  params.set('lang', e.target.value);
  window.location.search = params.toString();
});

// ── State ─────────────────────────────────────────────────
let appt = null;       // appointment data from API
let matrix = null;     // matrix credentials from API
let countdownTimer = null;
let pollTimer = null;

// ── Terminal error screen ─────────────────────────────────
function showError(type) {
  el.appCard.style.display   = 'none';
  el.errorCard.style.display = '';
  el.errorTitle.textContent   = lang[`status_${type}`] ?? lang.status_not_found;
  el.errorMessage.textContent = lang[`msg_${type}`]    ?? lang.msg_not_found;
}

// ── Activate join button ──────────────────────────────────
function showReady() {
  clearInterval(countdownTimer);
  clearInterval(pollTimer);
  el.countdown.style.display   = 'none';
  el.statusMessage.textContent = lang.msg_active;
  el.joinBtnText.textContent   = lang.btn_active;
  el.joinBtn.disabled          = false;
}

// ── Countdown tick ────────────────────────────────────────
function startCountdown() {
  el.statusMessage.textContent = lang.msg_waiting;
  el.joinBtnText.textContent   = lang.btn_waiting;
  el.countdown.style.display   = '';

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

// ── End the call and return to the pre-call screen ─────────
function endCall() {
  hangup();
  el.callControls.style.display = 'none';
  el.infoBlock.style.display    = '';
  el.langSelect.style.display   = '';
  matrix = null; // force a fresh guest token if they rejoin
  loadAppointment(); // re-check the real status instead of assuming "missed"
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
      onCallConnected: () => {
        el.infoBlock.style.display    = 'none';
        el.callControls.style.display = 'flex';
        el.langSelect.style.display   = 'none';
      },
      onCallEnded: endCall,
    });
  } catch (err) {
    console.error('[entry] Matrix init error:', err);
    el.joinBtn.disabled        = false;
    el.joinBtnText.textContent = lang.btn_active;
  }
});

// ── In-call controls ────────────────────────────────────────
el.btnMic.addEventListener('click', () => {
  const muted = toggleMic();
  if (muted === null) return;
  el.iconMic.src = muted ? '/icons/MicOff.png' : '/icons/MicOn.png';
});

el.btnCamera.addEventListener('click', () => {
  const off = toggleCamera();
  if (off === null) return;
  el.iconCamera.src = off ? '/icons/CamOff.png' : '/icons/CamOn.png';
});

el.btnSound.addEventListener('click', () => {
  const off = toggleSound();
  if (off === null) return;
  el.iconSound.src = off ? '/icons/SoundOff.png' : '/icons/SoundOn.png';
});

el.btnHangup.addEventListener('click', endCall);

// ── Boot ──────────────────────────────────────────────────
loadAppointment();
