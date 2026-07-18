# Demo — Voice Client & Live Sharing

## What it is
A single-screen browser voice client (`client/`) for talking to the clinic assistant out loud: press the mic, ask a question, hear the grounded answer read back, see the conversation transcript build up turn by turn.

It talks directly to two already-verified backends (not through n8n's binary handling, keeping the integration low-risk):
1. `voice/fallback` service — `POST /transcribe` (speech → text)
2. `10_orchestrator`'s `/webhook/ask` — the text pipeline (already proven: 14/14 eval cases, real grounded answers, no hallucination)
3. `voice/fallback` service — `POST /speak` (text → speech)

## Run it locally
```bash
# 1. Make sure the stack is up (n8n on :5679, voice-fallback on :8000)
# 2. Serve the client
python -m http.server 8080 --directory client
# 3. Open http://localhost:8080 in a browser and allow microphone access
```
Note: the mic requires a "secure context" — `http://localhost` is fine, opening `index.html` directly via `file://` is not (the browser blocks `getUserMedia`).

## Share it live with the team (cloudflared tunnel)
`cloudflared` (Cloudflare's free quick-tunnel tool, no signup) is installed at `~/bin/cloudflared.exe`.

One command starts everything and prints the link to share:
```powershell
./scripts/start_demo.ps1
```
This starts the client's static server plus 3 separate tunnels (client, voice service, n8n) and prints one URL like:
```
https://<random>.trycloudflare.com/?voice=https://<random>.trycloudflare.com&n8n=https://<random>.trycloudflare.com
```
**Why 3 tunnels and query params, not just one link:** the client's JavaScript would otherwise call `http://localhost:8000` and `http://localhost:5679` — but on a teammate's own device, "localhost" means *their* machine, not yours. The `?voice=...&n8n=...` query params override those defaults with the real tunnel addresses, so the link works correctly from any device. `client/app.js` reads them at load time; omit them (just open `client/index.html` locally) and it falls back to `localhost` for local development.

Quick tunnels are ephemeral — every time you re-run `start_demo.ps1` (or restart cloudflared), the hostnames change. Re-share the newly printed URL each time.

## Verified working (not just built)
Tested with a real spoken question end-to-end, both locally and through the actual public tunnels (simulating a remote teammate opening the shared link):
- Spoken: *"How much does Invisalign cost?"*
- Transcribed (Whisper `base`): *"How much does invisaline cost?"* (imperfect but close enough)
- Orchestrator understood it anyway and replied: *"The cost of Invisalign varies depending on the severity of your case and the treatment duration. For an exact quote, please contact the clinic directly."*
- Played back correctly as audio, transcript displayed correctly, session id tracked correctly across the round trip.

## Known limitations
- STT accuracy on brand-specific terms ("Invisalign") isn't perfect with the `base` Whisper model — the LLM classifier downstream is robust enough to compensate in the cases tested, but this isn't guaranteed for every phrasing.
- Booking-via-voice and multi-turn voice conversations haven't been separately tested (the text orchestrator's booking flow and session memory are separately verified in Phase 8; only the voice *transport* layer was added here).
- Quick tunnels have no authentication — anyone with the link can use it. Fine for a short team demo; not for anything longer-lived.
