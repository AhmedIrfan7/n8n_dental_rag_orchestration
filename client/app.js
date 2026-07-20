// Recall - voice front desk for any clinic.
// Orchestrates endpoints directly (no audio passes through n8n's binary
// handling, which keeps this integration low-risk):
//   1. VOICE_BASE  /transcribe  (STT)
//   2. N8N_BASE    /webhook/ask (text orchestrator - grounded reply)
//   3. VOICE_BASE  /speak       (TTS)
//   4. N8N_BASE    /webhook/ingest (crawl + extract + index a new clinic)
// Defaults to localhost for local testing. When sharing this client over a
// tunnel, the shared link carries ?voice=<tunnel>&n8n=<tunnel> so a remote
// device's "localhost" (which would otherwise mean ITS OWN machine) is
// overridden with the actual reachable tunnel URLs.
//
// ?key=... carries the shared webhook secret (see docs/N8N_CONTROL.md) -
// every /webhook/* call now requires the X-Webhook-Key header. This is a
// browser page, so the key is visible to whoever has the link regardless of
// how it's passed (query param or otherwise) - it stops casual/automated
// abuse of a found URL, not a determined person actively using the shared
// link. scripts/start_demo.ps1 prints the full URL with this included.
//
// ?clinic=<website_url>&clinic_name=<name> lets a shared link open straight
// into a Talk conversation with a specific, already-ingested clinic instead
// of landing on Add-a-clinic - a stranger's first-ever open of this page has
// no recall.activeClinic in localStorage yet, so without this param a shared
// demo link would show the Add screen, not the intended clinic.
const params = new URLSearchParams(location.search);
const VOICE_BASE = params.get('voice') || 'http://localhost:8000';
const N8N_BASE = params.get('n8n') || 'http://localhost:5679';
const WEBHOOK_KEY = params.get('key') || '';
const CLINIC_PARAM = params.get('clinic') || '';
const CLINIC_NAME_PARAM = params.get('clinic_name') || '';
const BAR_COUNT = 28;
const RECENT_KEY = 'recall.recentClinics';
const ACTIVE_KEY = 'recall.activeClinic';
const MAX_RECENT = 6;

const el = {
  app: document.getElementById('app'),
  tabAdd: document.getElementById('tabAdd'),
  tabTalk: document.getElementById('tabTalk'),
  tagline: document.getElementById('tagline'),

  ingestForm: document.getElementById('ingestForm'),
  ingestUrlInput: document.getElementById('ingestUrlInput'),
  ingestSubmit: document.getElementById('ingestSubmit'),
  scanBlock: document.getElementById('scanBlock'),
  scanSteps: document.getElementById('scanSteps'),
  resultCard: document.getElementById('resultCard'),
  resultName: document.getElementById('resultName'),
  resultStats: document.getElementById('resultStats'),
  resultTalkBtn: document.getElementById('resultTalkBtn'),
  ingestError: document.getElementById('ingestError'),
  recentBlock: document.getElementById('recentBlock'),
  recentChips: document.getElementById('recentChips'),

  stage: document.getElementById('stage'),
  stateLabel: document.getElementById('stateLabel'),
  stateWord: document.getElementById('stateWord'),
  hint: document.getElementById('hint'),
  micBtn: document.getElementById('micBtn'),
  micBtnLabel: document.getElementById('micBtnLabel'),
  bars: document.getElementById('bars'),
  transcript: document.getElementById('transcript'),
  transcriptEmpty: document.getElementById('transcriptEmpty'),
  resetBtn: document.getElementById('resetBtn'),
  connDot: document.getElementById('connDot'),
  connLabel: document.getElementById('connLabel'),
  sessionShort: document.getElementById('sessionShort'),
  activeClinicName: document.getElementById('activeClinicName'),
  switchClinicBtn: document.getElementById('switchClinicBtn'),
  player: document.getElementById('player'),
  replayBtn: document.getElementById('replayBtn'),
  textForm: document.getElementById('textForm'),
  textInput: document.getElementById('textInput'),
  textSend: document.getElementById('textSend'),
};

let sessionId = null;
let mediaRecorder = null;
let audioChunks = [];
let micStream = null;
let audioCtx = null;
let analyser = null;
let rafId = null;
let barEls = [];
let activeClinic = null; // { url, name }
let scanTimer = null;

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
function fallbackName(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const first = host.split('.')[0];
    return first.charAt(0).toUpperCase() + first.slice(1);
  } catch (e) {
    return url;
  }
}

// ---------- smile-arc bars ----------
function buildBars() {
  el.bars.innerHTML = '';
  barEls = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const bar = document.createElement('div');
    bar.className = 'bar';
    el.bars.appendChild(bar);
    barEls.push(bar);
  }
  renderRestArc();
}
function arcBase(i) {
  // cosine curve, tall in the middle, short at the edges - the smile shape
  const t = i / (BAR_COUNT - 1);
  return 6 + 34 * Math.sin(Math.PI * t);
}
function renderRestArc() {
  barEls.forEach((bar, i) => { bar.style.height = arcBase(i) + 'px'; });
}
function renderReactiveArc(amps) {
  barEls.forEach((bar, i) => {
    const extra = amps ? amps[i] * 26 : 0;
    bar.style.height = Math.min(70, arcBase(i) + extra) + 'px';
  });
}
function stopArcAnimation() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  renderRestArc();
}
function animateFromAnalyser(node, ctx) {
  const data = new Uint8Array(node.frequencyBinCount);
  const step = Math.floor(data.length / BAR_COUNT) || 1;
  function loop() {
    node.getByteFrequencyData(data);
    const amps = [];
    for (let i = 0; i < BAR_COUNT; i++) amps.push(data[i * step] / 255);
    renderReactiveArc(amps);
    rafId = requestAnimationFrame(loop);
  }
  loop();
}
function animateThinking() {
  let t = 0;
  function loop() {
    t += 0.06;
    const amps = [];
    for (let i = 0; i < BAR_COUNT; i++) amps.push(0.15 + 0.1 * Math.sin(t + i * 0.4));
    renderReactiveArc(amps);
    rafId = requestAnimationFrame(loop);
  }
  loop();
}

// ---------- state machine (talk view) ----------
function setState(state, label, word) {
  el.stage.dataset.state = state;
  el.stateLabel.textContent = label;
  el.stateWord.textContent = word;
}
function setControlsBusy(busy) {
  el.micBtn.disabled = busy;
  el.textInput.disabled = busy;
  el.textSend.disabled = busy;
}
function setIdle(hint) {
  stopArcAnimation();
  setState('idle', 'Ready', 'to listen');
  setControlsBusy(false);
  el.micBtn.dataset.recording = 'false';
  el.micBtnLabel.textContent = 'Start talking';
  if (hint) el.hint.textContent = hint;
}
function setError(message) {
  stopArcAnimation();
  setState('error', 'Something went wrong', 'try again');
  el.hint.textContent = message;
  setControlsBusy(false);
  el.micBtn.dataset.recording = 'false';
  el.micBtnLabel.textContent = 'Start talking';
}
function hideReplay() {
  el.replayBtn.hidden = true;
  el.replayBtn.onclick = null;
}

// ---------- transcript ----------
function addTurn(who, message) {
  el.transcriptEmpty.style.display = 'none';
  const turn = document.createElement('div');
  turn.className = 'turn ' + (who === 'you' ? 'you' : 'clinic');
  const label = document.createElement('div');
  label.className = 'turn-label';
  label.textContent = who === 'you' ? 'You' : 'Clinic';
  const body = document.createElement('p');
  body.className = 'turn-text';
  body.textContent = message;
  turn.appendChild(label);
  turn.appendChild(body);
  el.transcript.appendChild(turn);
  el.transcript.scrollTop = el.transcript.scrollHeight;
}

// ---------- session ----------
function updateSessionDisplay() {
  el.sessionShort.textContent = sessionId ? sessionId.slice(0, 8) : '—';
}
function resetConversation() {
  sessionId = null;
  updateSessionDisplay();
  hideReplay();
  el.textInput.value = '';
  el.transcript.innerHTML = '';
  const empty = document.createElement('p');
  empty.className = 'transcript-empty';
  empty.id = 'transcriptEmpty';
  empty.textContent = 'Nothing yet — press the mic to start.';
  el.transcript.appendChild(empty);
  el.transcriptEmpty = empty;
  setIdle('Ask about services, pricing, hours, or book a visit.');
}

// ---------- connection check ----------
async function checkConnection() {
  try {
    const r = await fetch(VOICE_BASE + '/health', { method: 'GET' });
    if (r.ok) {
      el.connDot.dataset.ok = 'true';
      el.connLabel.textContent = 'voice service connected';
      return;
    }
  } catch (e) { /* fall through */ }
  el.connDot.dataset.ok = 'false';
  el.connLabel.textContent = 'voice service unreachable';
}

// ---------- clinics: recent list + active clinic (localStorage only - no
// backend "list clinics" endpoint exists, and adding one isn't needed for
// this: the ingest response already tells us everything worth remembering) ----------
function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (e) { return []; }
}
function saveRecent(list) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
}
function rememberClinic(clinic) {
  const list = loadRecent().filter((c) => c.url !== clinic.url);
  list.unshift(clinic);
  saveRecent(list);
  renderRecent();
}
function renderRecent() {
  const list = loadRecent();
  el.recentChips.innerHTML = '';
  el.recentBlock.hidden = list.length === 0;
  list.forEach((clinic) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = clinic.name;
    chip.addEventListener('click', () => {
      setActiveClinic(clinic);
      setView('talk');
    });
    el.recentChips.appendChild(chip);
  });
}
function setActiveClinic(clinic) {
  activeClinic = clinic;
  localStorage.setItem(ACTIVE_KEY, JSON.stringify(clinic));
  el.activeClinicName.textContent = clinic.name;
  el.tabTalk.disabled = false;
  rememberClinic(clinic);
}
function loadActiveClinic() {
  try {
    const c = JSON.parse(localStorage.getItem(ACTIVE_KEY));
    if (c && c.url) return c;
  } catch (e) { /* ignore */ }
  return null;
}

// ---------- view switching ----------
function setView(view) {
  el.app.dataset.view = view;
  el.tabAdd.setAttribute('aria-selected', String(view === 'add'));
  el.tabTalk.setAttribute('aria-selected', String(view === 'talk'));
  el.tagline.textContent = view === 'talk' && activeClinic
    ? `Ask ${activeClinic.name} anything, out loud.`
    : 'Bring any clinic online in about a minute.';
}

// ---------- ingest (add a clinic) ----------
function startScanAnimation() {
  const steps = Array.from(el.scanSteps.querySelectorAll('.scan-step'));
  let i = 0;
  const advance = () => {
    steps.forEach((s, idx) => {
      s.dataset.state = idx < i ? 'done' : idx === i ? 'active' : '';
    });
    i = (i + 1) % (steps.length + 1);
  };
  advance();
  scanTimer = setInterval(advance, 2400);
}
function stopScanAnimation() {
  if (scanTimer) clearInterval(scanTimer);
  scanTimer = null;
  el.scanSteps.querySelectorAll('.scan-step').forEach((s) => { s.dataset.state = ''; });
}

el.ingestForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const url = el.ingestUrlInput.value.trim();
  if (!url) return;

  el.ingestSubmit.disabled = true;
  el.ingestUrlInput.disabled = true;
  el.resultCard.hidden = true;
  el.ingestError.hidden = true;
  el.scanBlock.hidden = false;
  startScanAnimation();

  try {
    const res = await fetch(N8N_BASE + '/webhook/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Key': WEBHOOK_KEY },
      body: JSON.stringify({ website_url: url }),
    });
    if (!res.ok) throw new Error('ingest_failed_' + res.status);
    let body = await res.json();
    if (Array.isArray(body)) body = body[0] || {};
    if (!body.ok) throw new Error('ingest_failed');

    const name = body.clinic_name || fallbackName(url);
    const c = body.extracted || {};
    const chunks = body.indexed && body.indexed.chunks_indexed;
    const parts = [];
    if (c.services) parts.push(`${c.services} service${c.services === 1 ? '' : 's'}`);
    if (c.doctors) parts.push(`${c.doctors} doctor${c.doctors === 1 ? '' : 's'}`);
    if (c.pricing) parts.push(`${c.pricing} price entr${c.pricing === 1 ? 'y' : 'ies'}`);
    if (c.faqs) parts.push(`${c.faqs} FAQ${c.faqs === 1 ? '' : 's'}`);
    if (c.policies) parts.push(`${c.policies} polic${c.policies === 1 ? 'y' : 'ies'}`);
    let stats = parts.length ? parts.join(' · ') : 'Indexed';
    if (chunks) stats += ` · ${chunks} knowledge chunks`;

    el.resultName.textContent = name;
    el.resultStats.textContent = stats;
    el.resultCard.hidden = false;

    const clinic = { url, name };
    el.resultTalkBtn.onclick = () => {
      setActiveClinic(clinic);
      setView('talk');
      resetConversation();
    };
    rememberClinic(clinic);
  } catch (e) {
    console.error(e);
    el.ingestError.textContent = "Couldn't add that clinic right now. Check the URL and try again in a moment.";
    el.ingestError.hidden = false;
  } finally {
    stopScanAnimation();
    el.scanBlock.hidden = true;
    el.ingestSubmit.disabled = false;
    el.ingestUrlInput.disabled = false;
  }
});

el.tabAdd.addEventListener('click', () => setView('add'));
el.tabTalk.addEventListener('click', () => { if (!el.tabTalk.disabled) setView('talk'); });
el.switchClinicBtn.addEventListener('click', () => setView('add'));

// ---------- recording ----------
async function startRecording() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    setError('We need your microphone to hear your question. Allow access in your browser and try again.');
    return;
  }
  hideReplay();

  audioChunks = [];
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
  mediaRecorder = mimeType ? new MediaRecorder(micStream, { mimeType }) : new MediaRecorder(micStream);
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
  mediaRecorder.onstop = handleRecordingStopped;
  mediaRecorder.start();

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(micStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 128;
  source.connect(analyser);

  setState('listening', 'Listening', 'go ahead');
  el.hint.textContent = 'Speak your question, then press stop.';
  el.micBtn.dataset.recording = 'true';
  el.micBtnLabel.textContent = 'Stop and send';
  animateFromAnalyser(analyser, audioCtx);
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  if (audioCtx) audioCtx.close();
  stopArcAnimation();
}

async function handleRecordingStopped() {
  setControlsBusy(true);
  setState('thinking', 'One moment', 'thinking…');
  el.hint.textContent = 'Transcribing your question…';
  animateThinking();

  const blob = new Blob(audioChunks, { type: audioChunks[0]?.type || 'audio/webm' });
  await runPipeline(blob);
}

// ---------- shared tail: ask the assistant, then speak the reply ----------
// Used by both the voice pipeline (after transcribing) and typed input
// (directly). A failure asking the assistant means there's genuinely no
// answer yet, so the "isn't responding" message is accurate there. A
// failure only in speaking it back must NOT overwrite an already-correct,
// already-displayed text reply with that same message - see speakAndPlay's
// caller below for why (TTS error, or a browser blocking programmatic
// audio playback because it's several awaits removed from the click that
// started this).
async function askAndSpeak(query) {
  addTurn('you', query);
  setState('thinking', 'One moment', 'thinking…');
  el.hint.textContent = 'Checking with the clinic assistant…';

  let reply;
  try {
    const askRes = await fetch(N8N_BASE + '/webhook/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Key': WEBHOOK_KEY },
      body: JSON.stringify({
        query,
        session_id: sessionId,
        website_url: activeClinic ? activeClinic.url : '',
      }),
    });
    if (!askRes.ok) throw new Error('ask_failed');
    let askBody = await askRes.json();
    if (Array.isArray(askBody)) askBody = askBody[0] || {};
    reply = askBody.reply || "I'm not sure - please contact the clinic directly.";
    sessionId = askBody.session_id || sessionId;
    updateSessionDisplay();
    addTurn('clinic', reply);
  } catch (e) {
    console.error(e);
    setError("The clinic assistant isn't responding right now. Try again in a moment.");
    return;
  }

  try {
    await speakAndPlay(reply);
  } catch (e) {
    console.error(e);
    stopArcAnimation();
    setState('idle', 'Answer ready', 'tap to hear it');
    el.hint.textContent = "Here's the answer above. Playback didn't start automatically - tap below to hear it.";
    setControlsBusy(false);
    el.micBtn.dataset.recording = 'false';
    el.micBtnLabel.textContent = 'Start talking';
    el.replayBtn.hidden = false;
    el.replayBtn.onclick = () => speakAndPlay(reply).catch((err) => console.error(err));
  }
}

// ---------- voice pipeline (also used for programmatic testing) ----------
async function runPipeline(audioBlob) {
  hideReplay();
  let query;
  try {
    const form = new FormData();
    form.append('file', audioBlob, 'question.webm');
    const transcribeRes = await fetch(VOICE_BASE + '/transcribe', { method: 'POST', body: form });
    if (!transcribeRes.ok) throw new Error('transcribe_failed');
    const transcribed = await transcribeRes.json();
    query = transcribed.text;
    if (!query || !query.trim()) {
      setError("We couldn't make out what you said. Try speaking a little closer to the mic.");
      return;
    }
  } catch (e) {
    console.error(e);
    setError("The clinic assistant isn't responding right now. Try again in a moment.");
    return;
  }
  await askAndSpeak(query);
}

// ---------- typed input ----------
el.textForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const query = el.textInput.value.trim();
  if (!query) return;
  hideReplay();
  el.textInput.value = '';
  setControlsBusy(true);
  animateThinking();
  await askAndSpeak(query);
});

// A media element can only ever be wired into ONE MediaElementSourceNode for
// its whole lifetime (a second createMediaElementSource() call throws) - so
// this graph is built lazily once and reused for every turn, including
// replays, instead of created fresh per call.
let playCtx = null;
let outAnalyser = null;
function getPlaybackGraph() {
  if (playCtx) return { playCtx, outAnalyser };
  playCtx = new (window.AudioContext || window.webkitAudioContext)();
  const src = playCtx.createMediaElementSource(el.player);
  outAnalyser = playCtx.createAnalyser();
  outAnalyser.fftSize = 128;
  src.connect(outAnalyser);
  outAnalyser.connect(playCtx.destination);
  return { playCtx, outAnalyser };
}

async function speakAndPlay(reply) {
  setState('speaking', 'Speaking', 'here you go');
  el.hint.textContent = 'Playing the answer…';

  const speakRes = await fetch(VOICE_BASE + '/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: reply }),
  });
  if (!speakRes.ok) throw new Error('speak_failed');
  const audioOut = await speakRes.blob();
  const url = URL.createObjectURL(audioOut);
  el.player.src = url;

  const { playCtx: ctx, outAnalyser: analyserNode } = getPlaybackGraph();
  if (ctx.state === 'suspended') await ctx.resume();
  animateFromAnalyser(analyserNode, ctx);

  await el.player.play();

  el.replayBtn.hidden = false;
  el.replayBtn.onclick = () => speakAndPlay(reply).catch((err) => console.error(err));
  el.player.onended = () => {
    stopArcAnimation();
    setIdle('Ask about services, pricing, hours, or book a visit.');
  };
}

// ---------- wiring ----------
el.micBtn.addEventListener('click', () => {
  if (el.micBtn.dataset.recording === 'true') {
    stopRecording();
  } else {
    startRecording();
  }
});
el.resetBtn.addEventListener('click', resetConversation);

buildBars();
updateSessionDisplay();
checkConnection();
setInterval(checkConnection, 15000);
renderRecent();

if (CLINIC_PARAM) {
  setActiveClinic({ url: CLINIC_PARAM, name: CLINIC_NAME_PARAM || fallbackName(CLINIC_PARAM) });
  setView('talk');
  resetConversation();
} else {
  const savedActive = loadActiveClinic();
  if (savedActive) {
    setActiveClinic(savedActive);
    setView('talk');
  } else {
    setView('add');
  }
}

// Exposed for headless/dev testing (e.g. feeding a prerecorded file through
// the exact same pipeline without needing live microphone hardware).
window.__voiceClientTest = { runPipeline, setState, setIdle, setActiveClinic, setView };
