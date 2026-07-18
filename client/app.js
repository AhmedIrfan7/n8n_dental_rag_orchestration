// De Roode Orthodontics voice client.
// Orchestrates 3 already-verified endpoints directly (no audio passes
// through n8n's binary handling, which keeps this integration low-risk):
//   1. VOICE_BASE  /transcribe  (STT)
//   2. N8N_BASE    /webhook/ask (text orchestrator - grounded reply)
//   3. VOICE_BASE  /speak       (TTS)
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
const params = new URLSearchParams(location.search);
const VOICE_BASE = params.get('voice') || 'http://localhost:8000';
const N8N_BASE = params.get('n8n') || 'http://localhost:5679';
const WEBHOOK_KEY = params.get('key') || '';
const BAR_COUNT = 28;

const el = {
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
  websiteUrlInput: document.getElementById('websiteUrlInput'),
  player: document.getElementById('player'),
  replayBtn: document.getElementById('replayBtn'),
};

let sessionId = null;
let mediaRecorder = null;
let audioChunks = [];
let micStream = null;
let audioCtx = null;
let analyser = null;
let rafId = null;
let barEls = [];

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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

// ---------- state machine ----------
function setState(state, label, word) {
  el.stage.dataset.state = state;
  el.stateLabel.textContent = label;
  el.stateWord.textContent = word;
}
function setIdle(hint) {
  stopArcAnimation();
  setState('idle', 'Ready', 'to listen');
  el.micBtn.disabled = false;
  el.micBtn.dataset.recording = 'false';
  el.micBtnLabel.textContent = 'Start talking';
  if (hint) el.hint.textContent = hint;
}
function setError(message) {
  stopArcAnimation();
  setState('error', 'Something went wrong', 'try again');
  el.hint.textContent = message;
  el.micBtn.disabled = false;
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
  el.micBtn.disabled = true;
  setState('thinking', 'One moment', 'thinking…');
  el.hint.textContent = 'Transcribing your question…';
  animateThinking();

  const blob = new Blob(audioChunks, { type: audioChunks[0]?.type || 'audio/webm' });
  await runPipeline(blob);
}

// ---------- the actual pipeline (also used for programmatic testing) ----------
async function runPipeline(audioBlob) {
  hideReplay();
  let query, reply;

  // Stage 1+2: transcribe, then ask the assistant. A failure here means we
  // genuinely have no answer yet, so the "assistant isn't responding"
  // message is accurate.
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
    addTurn('you', query);

    setState('thinking', 'One moment', 'thinking…');
    el.hint.textContent = 'Checking with the clinic assistant…';

    const askRes = await fetch(N8N_BASE + '/webhook/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Key': WEBHOOK_KEY },
      body: JSON.stringify({
        query,
        session_id: sessionId,
        website_url: el.websiteUrlInput.value.trim(),
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

  // Stage 3: speak the reply out loud. The text answer above is already
  // correct and visible - a failure here (TTS error, or a browser blocking
  // programmatic audio playback because it's several awaits removed from
  // the click that started this) should never overwrite that with a
  // misleading "not responding" message. Fall back to a manual play button
  // instead, which is a real user gesture and always allowed to play.
  try {
    await speakAndPlay(reply);
  } catch (e) {
    console.error(e);
    stopArcAnimation();
    setState('idle', 'Answer ready', 'tap to hear it');
    el.hint.textContent = "Here's the answer above. Playback didn't start automatically - tap below to hear it.";
    el.micBtn.disabled = false;
    el.micBtn.dataset.recording = 'false';
    el.micBtnLabel.textContent = 'Start talking';
    el.replayBtn.hidden = false;
    el.replayBtn.onclick = () => speakAndPlay(reply).catch((err) => console.error(err));
  }
}

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

// Exposed for headless/dev testing (e.g. feeding a prerecorded file through
// the exact same pipeline without needing live microphone hardware).
window.__voiceClientTest = { runPipeline, setState, setIdle };
