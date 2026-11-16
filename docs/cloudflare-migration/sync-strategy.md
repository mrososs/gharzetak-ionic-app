# Offline sync strategy

The offline-first design is preserved: IndexedDB (`idb`) persistence, guest/user scopes, a coalesced per-entity **outbox**, dependency-ordered push,
retry with backoff (5 s -> 5 min), pull-merge on sign-in / resume / reconnect, and guest -> account import. Only the **transport** changed
(`core/sync/sync.service.ts`); `AppStore`, `GuestImportService`, the tracker engine and the pages are untouched. The public surface of `SyncService`
(`schedule`, `run`, `state`, `pending`, `active`, `uploadPatternFile`) is unchanged; `signedUrl()` became `mediaUrl()` (one caller).

## Concurrency: server-owned revisions (compare-and-swap)

Supabase relied on a trigger that trusted the **client timestamp** (`new.updated_at < old.updated_at -> skip`). That let a device with a wrong
clock silently overwrite or lose data, and it was invisible to the client. The Worker replaces it:

```
PUT /v1/projects/:id/progress   { baseRevision, clientUpdatedAt, ...fields }
  201/200  { revision, clientUpdatedAt, updatedAt }          accepted; revision incremented by the server
  409      { error:{code:"conflict"}, current:{revision, clientUpdatedAt, deleted?} }
```

* The write is **one SQL statement** `UPDATE ... WHERE id=? AND owner_id=? AND revision=:baseRevision` (inserts use `ON CONFLICT DO NOTHING`).
  Two devices can never both win a revision. Parent+children writes (tools, pattern rounds, tutorial stamps) run in **one D1 batch** guarded by the
  new revision, so a partial replace cannot commit.
* `baseRevision` is the revision the device last saw. It is persisted per scope in a new, additive IndexedDB store `revisions` (**DB v2**; the upgrade
  creates the store and touches no existing data. The database is never deleted or reset).
* `clientUpdatedAt` is only a **merge hint**. The server clamps it to `now + 5 min`, and it is never used for authorisation.

### Resolution rules on a 409 (client)

| Situation | Action |
|---|---|
| `current.deleted` or `current.clientUpdatedAt >= ours` | Our entry is obsolete **or already applied** (idempotent retry). Adopt the server revision, drop the entry, schedule a pull that adopts the server state. |
| ours is newer | Adopt the server revision and retry (up to 3 rebases). Last-write-wins between a user's *own* devices, now race-free. |
| still conflicting after 3 rebases | Error -> normal attempt counter / backoff. |

Outbox entries are removed **only after** a 2xx/confirmed outcome (`db.dequeue` after `push`). Network failures, 5xx, 429 and 401 never consume an
attempt; other 4xx count toward `MAX_ATTEMPTS = 5` as before.

### Verified (e2e against the live local Worker)

stale device cannot overwrite newer progress and adopts it · racing writers: exactly one wins per revision (API test, 4 parallel) · newer local edit
rebases and wins · lost-response retry is recognised, no duplicate write, revision unchanged · offline taps survive and push on reconnect ·
unreachable server keeps the outbox · account switching never leaks records · guest import · session expiry keeps local data.

## Bug found and fixed during migration (pre-existing)

`pull()` snapshotted the store, awaited several IndexedDB writes, then overwrote the signals. A project created while a pull was in flight could vanish
from memory and, because its outbox entry was then pushed against a missing project, be dequeued **without ever syncing**. The integration tests exposed it.
Fix: merge + signal publish are one synchronous turn; entities the server has never confirmed (`revision 0`) are never treated as remotely deleted;
persistence writes the *current* signal values (a project deleted meanwhile is not resurrected); the outbox is re-read after the response.

## Legacy local scopes

Device data stored under `user:<old-supabase-uuid>` is not reachable after the migration because Better Auth ids differ. This only affects developer
devices (no hosted users exist). **Not implemented:** an automatic claim of those scopes (merging another scope's data into a new account is exactly the
account-leak the design forbids, so it must be an explicit, user-confirmed action). A small `LocalDb.moveScope(from, to)` + a Settings action would be the
follow-up if any such device holds data worth keeping. Guest data is unaffected and imports normally.

## Not covered

* Durability across a real app kill is guaranteed by IndexedDB writes being awaited before the UI step resolves (unchanged), but the e2e harness uses
  jsdom's in-memory fallback, so **IndexedDB persistence itself was not exercised in a browser/WebView**.
* Multi-device simultaneous editing was exercised with a second raw API client, not two full app instances.
