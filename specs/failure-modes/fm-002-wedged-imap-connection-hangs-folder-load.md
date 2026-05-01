---
id: FM-002
title: Wedged IMAP connection hangs folder load and silently halts IDLE
fault-injection-test: test/unit/imap/client.test.ts
integrations: [IX-001]
invariants-protected: []
modules: [MOD-0002]
---

## Trigger

The single shared IMAP socket enters a half-open state — TCP-alive from the client's point of view, but no longer responsive to the server (NAT translation timeout, server-side close without FIN, intermediate firewall reset, transient network partition followed by silent recovery). The local `imapflow` instance does not detect the wedge: `flow.usable` may flip to `false`, or the socket may sit in a state where new commands are written but no response ever arrives.

The `ImapClient` is still in the `connected` state at the application level. The IDLE cycler ticks but every IMAP command issued against the wedged socket either:

1. Returns immediately because `flow.usable` is `false`, with no error and no reconnect, **or**
2. Hangs indefinitely because the underlying `await` on the imapflow command never resolves and never rejects.

This was discovered in production after ~four days of container uptime: the `/api/folders` endpoint was awaiting `flow.listTree()` against a wedged socket; the request hung; nothing was logged; restarting the container restored function instantly because a fresh IMAP connection was established.

## Required behavior

The `ImapClient` MUST treat a wedged socket as a fatal connection error and force the reconnect path, regardless of which IMAP operation surfaces the wedge. Specifically:

- The IDLE/poll keepalive MUST detect both `flow.usable === false` and a hung NOOP. On either condition it MUST tear the connection down (calling the same handler that runs on an unexpected close) so exponential-backoff reconnect runs. It MUST NOT silently no-op and reschedule itself.
- Public IMAP operations that are reachable from request handlers (notably `listFolders` for the web settings page) MUST refuse to issue commands when `flow.usable` is `false`, and MUST bound the wait time on the underlying imapflow call so that a wedged socket surfaces as a thrown error within seconds. They MUST NOT block the request indefinitely.
- When a wedge is detected the system MUST transition out of `connected` so that subsequent calls also fail fast rather than queueing behind the wedged socket.
- Caches that have a stale-fallback path (e.g. `FolderCache.refresh`'s catch branch) MUST be reachable: the underlying client error must propagate, not hang.

The system is NOT required to detect a wedge proactively (e.g. a separate watchdog) — the contract is that the next command issued against a wedged socket fails fast.

## Why this exists

The single IMAP connection is shared by both the arrival path (IX-001) and on-demand request handlers (folder picker, batch dry-run, etc.). A wedge that the keepalive ignores is doubly dangerous:

1. **Silent IX-001 loss.** Even though the connection looked healthy at the application level, no new mail was being processed — the socket was dead. INV-001 only protects against IDLE being stranded on the wrong folder; it does not protect against IDLE running on a dead socket.
2. **Silent web hangs.** Any handler that awaits an IMAP operation hangs forever, with no log line, because no IMAP error is ever raised. The hang masquerades as "the page is loading slowly" indefinitely.

The "container restart fixed it" recovery path is unacceptable for a long-running service; the failure must self-heal via the existing exponential-backoff reconnect machinery. The trigger is environmental and difficult to reproduce reliably in a staging environment, so the contract is enforced by unit-level fault injection (forcing `usable=false`, returning a never-resolving promise from `noop` / `listTree`) rather than a network-level integration test.

## Test approach

`test/unit/imap/client.test.ts` (describe: `FM-002 wedged connection detection`) drives the wedge directly through the `ImapFlowLike` mock seam:

1. **`cycleIdle reconnects when flow.usable becomes false`** — connect normally, flip `mockFlow.usable = false`, advance past `idleTimeout`, then advance past the reconnect backoff and assert the factory was called a second time (i.e. reconnect actually ran).
2. **`cycleIdle reconnects when noop hangs past timeout`** — substitute a `noop` that returns a never-resolving promise, advance past `idleTimeout` and then past `NOOP_TIMEOUT_MS`, advance past backoff, and assert the factory was called again.
3. **`listFolders throws when flow.usable is false`** — connect, flip `usable=false`, expect `listFolders()` to reject with an error mentioning "not usable". This is the assertion that on-demand request handlers fail fast instead of hanging.
4. **`listFolders throws when listTree hangs past timeout`** — substitute a `listTree` that returns a never-resolving promise, await `listFolders`, advance past `LIST_TIMEOUT_MS`, and assert the call rejects with a "timed out" error.

The fault-injection seam is `ImapFlowLike` (the existing test double interface), which is sufficient to exercise both the wedge-detection paths and their interaction with `handleClose` / `scheduleReconnect`.

A future integration-level fault test could use a TCP proxy (Toxiproxy or similar) to drop traffic mid-IDLE and assert the same end-to-end recovery; that is intentionally out of scope here because the wedge is per-connection state, not a protocol-level invariant, and the unit-level injection is both faster and more deterministic.
