# Technology Stack Options

The PRD describes a self-hosted IMAP mailbox monitor with these key technical requirements:

- IMAP connection with IDLE support and polling fallback
- Web UI for configuration and management
- Docker deployment
- Config file storage (rules, settings)
- LLM API integration (Tier 2)
- Single process per IMAP account

---

## Option 1: Python (FastAPI + imaplib)

**Stack:** Python 3.12+, FastAPI, imaplib/aioimaplib, Jinja2 or React SPA, SQLite (activity log), YAML/TOML config

**Pros:**
- Python has the strongest IMAP library ecosystem (`imaplib` in stdlib, `aioimaplib` for async IDLE)
- FastAPI gives you async out of the box, which matters for IMAP IDLE
- LLM integration is trivial — every provider has a first-class Python SDK
- Large pool of people who can maintain it
- Straightforward Docker image

**Cons:**
- Async Python has sharp edges — mixing sync IMAP libs with async web frameworks requires care
- Runtime type errors in a long-running daemon are annoying to debug
- Heavier Docker image than Go or Rust alternatives (~150-200MB)
- `imaplib` is functional but clunky; `aioimaplib` is less mature

---

## Option 2: Node.js (Express/Fastify + imapflow)

**Stack:** Node.js 22+, TypeScript, Fastify, imapflow, React/Svelte SPA, SQLite (better-sqlite3), YAML config

**Pros:**
- `imapflow` is the best-maintained IMAP client library across any language — actively developed, clean API, native IDLE support
- Single-threaded event loop is a natural fit for "wait on IMAP IDLE, react to events"
- TypeScript catches config/rule schema errors at build time
- Sharing validation logic between backend and frontend SPA is straightforward
- Lightweight Docker image with Alpine (~80-100MB)

**Cons:**
- LLM SDKs exist but Python's are generally more mature and better documented
- Node IMAP libraries have a history of abandonment (nodemailer's `imapflow` is the exception, not the rule)
- If `imapflow` ever goes unmaintained, there's no good fallback
- Memory usage can creep in long-running Node processes without discipline

---

## Option 3: Go (stdlib net + chi/echo)

**Stack:** Go 1.22+, chi or echo (HTTP), go-imap, html/template or embedded SPA, SQLite (modernc), TOML/YAML config

**Pros:**
- Single static binary — Docker image can be ~15-20MB (scratch/distroless)
- `go-imap` is solid and well-maintained, with IDLE support via extensions
- Goroutines make the "monitor IMAP + serve web UI" concurrency model dead simple
- No runtime, no dependency hell, minimal CVE surface
- Low memory footprint for a long-running daemon

**Cons:**
- LLM SDK support is thinner — you'll likely be writing HTTP calls to provider APIs directly
- Web UI development is more friction — Go templating is bare-bones, or you embed a JS SPA and now you have two build systems
- Config file manipulation (read/write/preserve comments) is less ergonomic than Python/Node
- Smaller ecosystem for email-adjacent utilities (MIME parsing, HTML-to-text extraction)

---

## Option 4: Elixir (Phoenix + gen_smtp/yugo)

**Stack:** Elixir 1.17+, Phoenix + LiveView, yugo (IMAP), SQLite (ecto_sqlite3), TOML/YAML config

**Pros:**
- The OTP supervision tree is purpose-built for this exact problem — a long-running process that monitors a connection, reconnects on failure, and handles concurrent work
- Phoenix LiveView gives you a reactive web UI with zero JavaScript build tooling
- "Let it crash" philosophy handles IMAP connection drops gracefully by design
- Running multiple instances (one per account) maps directly to OTP's process model
- Excellent for the Tier 4 "observe and suggest" pattern — GenServers watching folder state over time

**Cons:**
- Smallest hiring/contributor pool of the four options
- IMAP library options are limited and less battle-tested than Python or Node equivalents
- LLM integration requires more manual work — no first-class Anthropic/OpenAI SDKs
- Deployment tooling is more complex (releases, ERTS bundling) even with Docker
- Overkill concurrency model for what is fundamentally a single-mailbox, low-throughput application

---

## Summary

| Concern | Python | Node.js | Go | Elixir |
|---|---|---|---|---|
| IMAP library quality | Good | Best (`imapflow`) | Good | Weak |
| IDLE support | Needs async lib | Native | Extension | Limited |
| LLM integration | Best | Good | DIY | DIY |
| Docker image size | Large | Medium | Tiny | Medium |
| Web UI ergonomics | Good | Best | Weakest | Good (LiveView) |
| Long-running stability | Fine | Fine | Best | Best |
| Config file read/write | Easy | Easy | Awkward | Moderate |
| Contributor pool | Largest | Large | Medium | Small |

**Node.js** is the most pragmatic choice given the weight of `imapflow` and the web UI requirements. **Python** is the safe default with the best LLM ecosystem. **Go** wins on operational simplicity. **Elixir** is architecturally elegant but solves concurrency problems this application doesn't really have at single-mailbox scale.
