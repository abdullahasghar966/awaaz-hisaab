# Awaaz Hisaab

Voice-driven business automation over WhatsApp. A shopkeeper sends a voice note or text in Urdu, Roman Urdu, Punjabi, Pashto, Sindhi or English ("aaj 5000 ki sale hui"). The backend transcribes it, understands the intent, writes it into a double-entry ledger, and replies in the sender's language. Owners can also assign tasks to staff and ask for daily summaries.

It works with **no API keys at all**: every external service (WhatsApp, speech-to-text, Claude) has a mock, so you can demo and test everything offline. It can also run fully on free, self-hosted open-source tools (whisper.cpp and Ollama) on an 8 GB PC; see [Free / open-source mode](#free--open-source-mode-no-paid-apis). It can also be deployed to Vercel as a public demo; see [Deploy to Vercel](#deploy-to-vercel).

## How it works

```
WhatsApp voice/text -> webhook -> dedupe -> identify user -> speech-to-text -> language detection
  -> intent extraction (Claude or a local Ollama model, with a rules-based fallback) -> validate / permissions / confirmation
  -> ledger, tasks or reports -> reply in the user's language -> WhatsApp
```

More detail (database schema, intents, module contracts) is in `docs/ARCHITECTURE.md`.

## Install and run

Requires Node.js 22.13 or newer (it uses the built-in `node:sqlite`).

```bash
npm install
cp .env.example .env     # optional: the defaults already work
npm start
```

On Windows PowerShell use `Copy-Item .env.example .env`.

Then open:

| What | URL |
|---|---|
| Chat simulator (text and mic recording) | http://localhost:3000/dev/simulator.html |
| Admin dashboard | http://localhost:3000/admin/ (token = `ADMIN_TOKEN`, default `change-me`) |
| Health check | http://localhost:3000/health |

The database is created automatically at `data/app.db` (git-ignored).

Run the tests with `npm test` (no keys, no network, no `.env` needed).

## Demo script (simulator)

Send these one by one, using the default phone number. The first message registers you as the owner of a new business.

1. `aaj 5000 ki sale hui` - sale recorded, cash 5,000.
2. `Ahmed ko 8000 ka maal udhaar par becha` - credit sale to Ahmed.
3. `aaj 60000 ki sale hui` - large amount, the bot asks for confirmation; reply `haan` (or `nahi` to cancel).
4. `Kamran ko staff mein add karo 0300-1234567` - adds a staff member.
5. `Kamran ko kal tak 50 bori cement deliver karne ka kaam do` - assigns a task (the staff member gets a WhatsApp notification).
6. `aaj ki sale batao` - daily summary. Also try `balance batao` and `Ahmed ka hisaab batao`.
7. `aakhri entry hatao` - undo the last entry (asks for confirmation).

Open the dashboard to see transactions, contacts, tasks, the trial balance and the message log.

## Configuration (`.env`)

Everything is optional. Blank values select the mock providers.

| Variable | Meaning |
|---|---|
| `PORT`, `DB_PATH`, `TIMEZONE` | Server port, database file, timezone for "today" (default `Asia/Karachi`). `DB_PATH` defaults to `/tmp/app.db` on Vercel |
| `AUTO_REGISTER` | `true`: an unknown number becomes the owner of a new business |
| `DEV_ROUTES` | Enables `/dev/*` (simulator). On unless `NODE_ENV=production`. Set `true` to show the simulator on a production deployment |
| `ADMIN_TOKEN` | Bearer token for the dashboard and `/api/admin/*`. Empty disables them. In production (`NODE_ENV=production` or Vercel), unset or `change-me` disables them |
| `ANTHROPIC_API_KEY`, `NLP_MODEL` | Use Claude for intent extraction. Without a key, the rules parser is used |
| `OPENAI_API_KEY`, `STT_MODEL` | Real speech-to-text (Whisper). Without a key, a mock reads a `.txt` sidecar or a `TRANSCRIPT:` prefix |
| `STT_PROVIDER` | `openai`, `whisper-local` (self-hosted whisper.cpp, see below) or `mock`. Blank = `openai` if a key is set, else `mock` |
| `STT_LOCAL_URL` | whisper.cpp server URL for `whisper-local` (default `http://127.0.0.1:8080`) |
| `NLP_PROVIDER` | `auto`, `llm`, `ollama` or `rules` (default `auto`) |
| `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_MS` | Local Ollama server (default `http://127.0.0.1:11434`), model (default `qwen2.5:3b`) and timeout (default 60000 ms) |
| `OLLAMA_NUM_CTX` | Ollama context window in tokens (default 2048) |
| `OLLAMA_KEEP_ALIVE` | How long Ollama keeps the model in memory after the last message (default `10m`) |
| `META_*` | WhatsApp Cloud API credentials (see below) |
| `CONFIRM_AMOUNT_THRESHOLD` | Amounts at or above this (default 50,000) need a "haan" first |

See `.env.example` for the full list.

## Free / open-source mode (no paid APIs)

You can run speech-to-text and intent extraction entirely on your own PC. Nothing is sent to OpenAI or Anthropic.

### 8 GB RAM setup (recommended)

This is the setup for a CPU-only PC with 8 GB of RAM (no GPU). It uses a small, quantized whisper model and the 3-billion-parameter Qwen model, which together fit next to Windows and Chrome.

**Memory table (approximate, while the models are loaded)**

| Component | RAM | Notes |
|---|---|---|
| whisper.cpp `ggml-small-q5_1.bin` (recommended) | about 0.5 GB | model file about 190 MB |
| whisper.cpp `ggml-base-q5_1.bin` (lowest memory) | about 0.3 GB | a little less accurate for Urdu |
| Ollama `qwen2.5:3b` (default, about 1.9 GB download) | about 2.5-3 GB | with `OLLAMA_NUM_CTX=2048` |
| Ollama `qwen2.5:1.5b` (very low memory) | about 1.3-1.5 GB | less accurate on mixed-language text |
| Awaaz Hisaab (Node.js, SQLite) | about 0.1-0.2 GB | |
| `NLP_PROVIDER=rules` instead of Ollama | 0 GB extra | no model at all |

Recommended total: about 3.5-4 GB for the app, whisper and Ollama. That leaves room for Windows (about 2-3 GB) and Chrome on an 8 GB PC. Bigger models are listed under "16 GB+ options" below.

**(a) Speech-to-text with whisper.cpp (Windows)**

1. Download a Windows release build of whisper.cpp (a `whisper-bin-x64.zip` or similar) from https://github.com/ggml-org/whisper.cpp/releases and unzip it, for example to `C:\whisper`.
2. Download the quantized small model into the `models` folder of that directory:
   - `ggml-small-q5_1.bin` (about 190 MB) is the recommended model for Urdu on an 8 GB PC.
   - `ggml-base-q5_1.bin` (smaller and faster, lowest memory) if the PC still struggles.

   The model files are at https://huggingface.co/ggerganov/whisper.cpp/tree/main (click a `.bin` file, then "download").
3. WhatsApp voice notes are OGG/Opus, which whisper.cpp reads only through ffmpeg. Install ffmpeg once, then open a new terminal so it is on PATH:

   ```powershell
   winget install Gyan.FFmpeg
   ```

4. Start the server and keep its window open. `-t 4` uses 4 CPU threads, which is a good balance on a typical 4-core laptop:

   ```powershell
   cd C:\whisper
   .\whisper-server.exe -m models\ggml-small-q5_1.bin --host 127.0.0.1 --port 8080 --convert -t 4
   ```

   `--convert` makes the server convert uploaded audio with ffmpeg. Without ffmpeg on PATH, OGG voice notes fail.

**(b) Intent extraction with Ollama (qwen2.5:3b)**

1. Install Ollama from https://ollama.com and start it. The Ollama app keeps its server running on port 11434.
2. Download the model once (about 1.9 GB):

   ```powershell
   ollama pull qwen2.5:3b
   ```

   The app asks Ollama to keep the model loaded for 10 minutes after the last message (`OLLAMA_KEEP_ALIVE`), so consecutive voice notes are faster. After that, Ollama unloads it and the RAM is free again.

**(c) The `.env` lines**

```
STT_PROVIDER=whisper-local
STT_LOCAL_URL=http://127.0.0.1:8080
NLP_PROVIDER=ollama
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:3b
OLLAMA_NUM_CTX=2048
OLLAMA_KEEP_ALIVE=10m
```

Then start the app with `npm start` as usual.

**Tips for an 8 GB PC**

- Close heavy apps (browser tabs, games, video editors) while the models run. Chrome with many tabs can use more RAM than both models together.
- If the PC still struggles, or the answers are slow, set `NLP_PROVIDER=rules`. The rules parser needs no model and uses no extra RAM. It handles most Urdu and Roman Urdu commands well.
- If it is very tight, use `ggml-base-q5_1.bin` for whisper and `OLLAMA_MODEL=qwen2.5:1.5b` for Ollama.
- Set `OLLAMA_KEEP_ALIVE=0` to unload the model right after each message (saves RAM, but each message then waits for the model to load again).

### 16 GB+ options

On a PC with 16 GB of RAM or more, you can use bigger models for better accuracy, especially for Pashto and Sindhi:

- Ollama: `ollama pull qwen2.5:7b` (about 5-6 GB RAM), then `OLLAMA_MODEL=qwen2.5:7b`.
- whisper.cpp: `ggml-large-v3-turbo.bin` (or `ggml-large-v3.bin`, slower on CPU). Start it with `-m models\ggml-large-v3-turbo.bin`.

The large models are slower on a CPU, so expect several seconds more per voice note.

### Trade-offs

- **Speed:** on a CPU-only PC, whisper.cpp and Ollama take several seconds per voice note. Transcription times out after 120 seconds, and the model call after `OLLAMA_TIMEOUT_MS` (default 60000). A GPU helps a lot but is not required.
- **Quality:** Urdu and Roman Urdu work well with the small model and the 3B Qwen model. Pashto and Sindhi are weaker than Claude, so expect more corrections or confirmations for those.
- **Always-free fallback:** the rules parser needs no model at all. Set `NLP_PROVIDER=rules` to use it on its own.
- **WhatsApp** still uses Meta's official Cloud API, which has a free test number. Unofficial libraries such as whatsapp-web.js or Baileys break WhatsApp's terms and risk a ban, so this project does not use them.

## Deploy to Vercel

The app can run as a public demo on Vercel (serverless). `api/index.js` builds the same app as `npm start`, and `vercel.json` sends every request to it.

1. Push the repo to GitHub, then go to https://vercel.com, click **Add New > Project** and import the repo.
2. Set the framework preset to **Other**. No build command or output directory is needed.
3. Add the environment variables (Project Settings > Environment Variables):
   - `ADMIN_TOKEN`: a long random string. **Required to use the dashboard.** Without it (or with `change-me`) `/api/admin` is disabled in production.
   - `DEV_ROUTES=true`: enables the public simulator demo at `/dev/simulator.html`. Leave it off if you do not want a public simulator.
   - Optional, for real WhatsApp and better understanding: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`.
4. Deploy. Then open `https://<project>.vercel.app/health` to check it.
5. For WhatsApp, set the Meta webhook callback URL to `https://<project>.vercel.app/webhook` (verify token = `META_VERIFY_TOKEN`, subscribe to `messages`).

The Vercel deployment sets `NODE_ENV=production`, so `DEV_ROUTES` is off unless you set it, and the webhook waits for processing before it answers (serverless functions are stopped after the response).

**Limitations**

- **Demo only.** The SQLite database lives in `/tmp/app.db`. Only `/tmp` is writable on Vercel, so data is lost on cold starts and different instances can have different data.
- For persistent data, use a hosted database such as Turso (libSQL, which is SQLite-compatible). That is future work and needs a new database adapter.
- **Local Whisper and Ollama cannot run on Vercel.** Use `NLP_PROVIDER=rules` (no key needed) or cloud APIs (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) there.
- Requests run within 60 seconds (`maxDuration` in `vercel.json`).

## Connecting real WhatsApp (Meta Cloud API)

1. Create an app at https://developers.facebook.com (type "Business") and add the **WhatsApp** product.
2. In WhatsApp > API Setup, use the free **test phone number**, add your own phone as a recipient, and note the **Phone number ID**.
3. Create a **permanent access token** (System User in Business Settings, with `whatsapp_business_messaging` permission). The 24-hour token in API Setup works for a quick try.
4. Copy the **App secret** from App settings > Basic.
5. Fill `.env`:
   ```
   META_ACCESS_TOKEN=...
   META_PHONE_NUMBER_ID=...
   META_APP_SECRET=...
   META_VERIFY_TOKEN=any-string-you-choose
   OPENAI_API_KEY=...        # for voice notes
   ANTHROPIC_API_KEY=...     # optional, better understanding
   ```
6. Start the server and expose it with a tunnel, for example `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`. (On Vercel, the URL is already public.)
7. In WhatsApp > Configuration, set the callback URL to `https://<public-host>/webhook` and the verify token to your `META_VERIFY_TOKEN`, click Verify, then **subscribe to the `messages` field**.
8. Send a message from your phone to the test number.

When `META_APP_SECRET` is set, every webhook call must carry a valid `X-Hub-Signature-256` signature, otherwise it is rejected with 401. Duplicate deliveries are ignored.

## Known limitations

- No Twilio path: WhatsApp goes through the Meta Cloud API only.
- Contacts written in Latin and Urdu script are separate (`Ahmed` and `احمد` are two contacts).
- The rules parser covers Urdu and Roman Urdu well. Pashto, Sindhi and Punjabi mainly rely on Claude (set `ANTHROPIC_API_KEY`) or a larger Ollama model.
- Profit is a cash-basis estimate (sales - purchases - expenses), with no inventory costing.
- Single process with SQLite: fine for a demo or a small shop, not for horizontal scaling. On Vercel the database is temporary (see Deploy to Vercel).
