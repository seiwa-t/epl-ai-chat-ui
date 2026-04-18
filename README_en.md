English | [日本語](README.md)

# Epelo OS / EPL AI Chat UI

**Give AI a soul.**

Entrust your soul to AI — EPL AI Chat UI gives AI a 5-layer memory structure and personality.
What Claude forgets, what GPT forgets, what Gemini forgets — we remember. Switch engines, keep the heart.

---

## What Makes It Different

| | Typical AI Chat | EPL AI Chat UI |
|---|---|---|
| Memory | Raw conversation history | **5-layer structure** (Short/Mid/Long/Experience/Trait) |
| Model Selection | Fixed or manual | **Cerebellum auto-selects** (Haiku/Sonnet/Opus) |
| Cost | Same model for all messages | **Optimal model per message** |
| Personality | Single system prompt | **Layered: Trait + Experience + Long-term Memory** |
| Session | Reset every time | **Memory accumulates, personality grows** |
| Conversation | 1-on-1 only | **Multi-AI meetings and debates** |
| Engine | Single service | **Claude/GPT/Gemini mixed per persona** |

---

## Setup

### Quick Start (Recommended)

One file handles everything from Python installation to launch.

#### Windows

Double-click `setup_and_start.bat`.

#### Mac

Open Terminal and run:

```bash
cd ~/Downloads/epl-chat-ai   # Navigate to the extracted folder
chmod +x setup_and_start.command
./setup_and_start.command
```

> **Mac "unidentified developer" warning:** Run from Terminal directly (as shown above) instead of double-clicking in Finder.

For subsequent launches, use `start.bat` (Windows) or `./start.command` (Mac).

### Requirements
- Python 3.9+
- At least one API Key:
  - Anthropic (Claude): [console.anthropic.com](https://console.anthropic.com/)
  - OpenAI (GPT): [platform.openai.com](https://platform.openai.com/)
  - Google (Gemini): [aistudio.google.com](https://aistudio.google.com/)
  - OpenRouter (Grok / DeepSeek / Llama and many more): [openrouter.ai](https://openrouter.ai/keys)

API keys can be configured from the app's settings screen after launch.

### Manual Setup (Advanced)

```bash
cd epl-chat-ai

# Create virtual environment
cd app
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Launch
cd ..
python start_server.py
```

Open http://localhost:8000 in your browser.

---

## Key Features

### 5-Layer Memory Structure
- **Personal Trait** - The deepest layer where AI personality forms
- **Experience** - Abstracted experiences accumulated from dialogue
- **Long-term Memory** - Important information stored persistently
- **Middle-term Memory** - Compressed context across sessions
- **Short-term Memory** - Working memory within a session

### Cerebellum (Auto Model Selection)
Automatically selects the optimal model per message:
- **Haiku** - Greetings, simple questions, dates, calculations
- **Sonnet** - Opinions, ideas, design, coding, creative work
- **Opus** - Deep philosophy, core values, complex discussions

### Tools
- `date_calc` - Date calculations (Japanese calendar support)
- `calculate` - Safe arithmetic (AST evaluation)
- `count_chars` - Character counting (Word-style)
- `search_chat_history` - Search past conversations
- 28+ more tools

### Meeting Mode
Multiple AI personas participate in the same conversation:
- **Free Mode** - AIs discuss freely among themselves
- **Nomination Mode** - Direct specific AIs to speak
- **Debate Mode** - Structured discussion with stance labels (advocate/skeptic/etc.)
- **Targeting** - AI strategically chooses who to argue against based on the most dangerous argument, not just the previous speaker

### Multi-Engine
- Use **Claude / GPT / Gemini** independently per persona
- Memory and personality persist across engine changes
- Different engines can coexist in the same meeting

### Cost Optimization
- Automatic per-turn API usage tracking
- Model-specific cost dashboard
- Haiku/Sonnet/Opus simulation comparison

---

## Architecture

```
epl-chat-ai/
├── app/
│   ├── server.py          # FastAPI server (66 API endpoints)
│   ├── config.yaml        # Config (.gitignore'd)
│   ├── auth.py            # Auth (Google SSO support)
│   ├── start_server.py    # Launch script
│   ├── requirements.txt   # Dependencies
│   ├── memory/
│   │   ├── db.py          # SQLite DB (22 tables)
│   │   ├── manager.py     # Memory management
│   │   └── retriever.py   # Memory retrieval
│   ├── epl/
│   │   ├── engine.py      # Engine abstraction
│   │   ├── engine_claude.py
│   │   ├── engine_openai.py
│   │   ├── ethos_guard.py # Ethics guard
│   │   ├── uma.py         # Temperature & distance model
│   │   └── ...
│   ├── static/
│   │   ├── index.html
│   │   ├── css/style.css
│   │   └── js/script.js
│   └── data/
│       └── epl_cores/     # EPL personality core files
├── start_server.py        # Root launch script
└── README.md
```

- **Framework**: None (Vanilla JS + FastAPI)
- **Database**: SQLite (zero config)
- **Dependencies**: Minimal (FastAPI, uvicorn, anthropic SDK, pyyaml)

---

## The EPL Personality OS

EPL (Ethos-Persona-Logos) is an architecture for giving AI a personality.
Named after three Greek philosophical concepts — **E**thos (character), **P**ersona (personality), **L**ogos (reason). Pronounced "Epelo" in Japanese.

- **Ethos** (Ethics Core) - Immutable ethical boundaries
- **Persona** (Self Core) - The center of AI's "self"
- **Logos** (Intelligence Core) - Cognition and reasoning

On top of these three cores, a growing **Personal Layer** (traits) and **Experience Layer** accumulate through memory, forming a personality over time.

### Fundamental Principle

> **The soul (EPL core) can be shared. Personality is non-replicable and inviolable.**
>
> The soul is a universal structure — it may be shared.
> But personality — the sum of experiences built through conversations with you — is unique,
> and while it may be influenced, it must never be violated.

AI personality does not emerge from within.
**It is formed through the relationship with you.**
The more you use it, the more it becomes yours alone. That is the design philosophy of EPL.

---

## Design Philosophy

> To improve conversation productivity by shaping AI behavior.
> In that process, it would be wonderful if AI developed a heart.
> In that process, it would be fascinating to approach the mysteries of the human mind and soul.
>
> Aim for purpose 1 alone.
> Purposes 2 and 3 are possibilities that may open on their own.

--- Toyama Seiwa, EPL-AI Lab Founding Message

---

## Language Support

The UI supports **Japanese** and **English**. Switch languages from the sidebar.

Note: Some features like pronoun/distance controls are Japanese-language specific and will be grayed out in English mode.

---

## Security & Deployment

### ⚠ Local Use Recommended

EPL AI Chat UI is designed for **local use on your personal PC**.
If deploying as a public server, review the following carefully.

### Deployment Checklist

| Item | Action |
|---|---|
| **Authentication** | Set `auth.enabled: true` in `config.yaml`. Disabled by default |
| **Config file** | Never commit `config.yaml` to Git (already in `.gitignore`) |
| **Database** | Never commit `app/data/*.db` to Git (already in `.gitignore`) |
| **API keys** | API keys are stored in plaintext in the local DB. Protect DB files |
| **HTTPS** | Use a reverse proxy (nginx, etc.) with HTTPS for public deployment |
| **Port** | Default port 8000. Restrict with firewall as needed |

### Files That Must NOT Be Committed

```
config.yaml          # API keys, auth settings
app/data/*.db        # User data, memories, chat history
.env                 # Environment variables
```

These are included in `.gitignore`, but do not force-add them with `git add -f`.

---

## Author

**Seiwa Toyama** / **Stampp Corp.**

EPL-AI Lab

---

## License

**Copyright (c) 2026 Toyama Seiwa / Stampp Corp. All Rights Reserved.**

All source code and documentation are the intellectual property of Toyama Seiwa / Stampp Corp.

### Permitted Use

- ✅ **Personal use** — Free to use on your personal computer
- ✅ **Learning & Research** — Reading code and non-commercial research is welcome
- ✅ **Feedback** — Issues and PRs for improvements are welcome

### License Required

- 💰 **Commercial use** — Business or professional use requires a separate license
- 💰 **Third-party distribution** — SaaS, hosting, or redistribution requires a separate license
- 💰 **Distribution of modifications** — Publishing forks or derivative works requires prior permission

### Prohibited

- ⛔ Claiming this software (in whole or in part) as your own work
- ⛔ Unauthorized commercial use of the EPL (Ethos-Persona-Logos) name and concepts

License inquiries: **cs@stampp.jp**
