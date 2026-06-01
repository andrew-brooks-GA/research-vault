# Refresh Queue

The refresh queue is **derived**, not hand-maintained. It is the set of `type: source`
entries that (a) carry a `source_url` and (b) are stale per `verify --stale`
(see `meta/freshness-policy.md` and the volatility windows in the taxonomy).

## `refresh` — opt-in, double-gated web re-check

`research-vault refresh [--id <id>] [--dry-run]` fetches each target's `source_url`,
recomputes its SHA-256, and reports **per entry**:

- `confirmed` — fetched hash equals the stored `content_hash`.
- `changed` — hash differs; run `verify` to record the outcome (refresh never edits entries).
- `unreachable` — fetch failed, timed out, or returned an error status.

It **never** writes or mutates an entry or the manifest, and never stores fetched bodies.
It only reports.

### Double gate (REQUIRED before any network access)

Both must hold or `refresh` refuses (non-zero exit) **including `--dry-run`**:

1. You invoke the `refresh` subcommand, **and**
2. `RESEARCH_VAULT_ALLOW_NETWORK=1` is set in the environment.

```sh
RESEARCH_VAULT_ALLOW_NETWORK=1 research-vault refresh
```

### Safety

- HTTPS only; plaintext `http://` is refused, and https→http redirect downgrades are refused.
- SSRF guard: the target host is resolved, **every** resolved address must be public/global
  unicast (RFC 6890 private/loopback/link-local/CGNAT/ULA/doc/multicast/reserved ranges are
  rejected, including IPv4-mapped IPv6 and the cloud metadata address `169.254.169.254`), and
  the socket is **pinned** to the validated IP (no re-resolution, no connection pooling).
- Redirects are followed manually and each hop is re-validated through the same guard.
- A body-size cap and request timeout bound each fetch. No cookies or auth headers are sent.
