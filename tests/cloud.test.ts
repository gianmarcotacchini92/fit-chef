import assert from "node:assert/strict";
import test from "node:test";
import {
  CloudConflictError, MAX_CLOUD_BYTES, cloudErrorMessage, getCloudClient, parseCloudRecord, parseCloudWorkspace,
  type CloudSnapshot,
} from "../src/lib/cloud";
import { canonicalJson, mergeCloudWorkspaces, sameWorkspace } from "../src/lib/cloud-merge";
import { backupCloudWorkspace, clearCloudBinding, cloudBackups, loadCloudBaseline, rememberCloudBaseline } from "../src/lib/cloud-storage";
import { CloudSyncSession, type SyncPorts, type SyncStatus, type SyncTransport } from "../src/lib/cloud-sync";
import { DEFAULT_INPUT, DEFAULT_MEAL_INPUT } from "../src/lib/defaults";
import { generateRecipe } from "../src/lib/engine";
import type { LocalState } from "../src/lib/types";

const empty = (): LocalState => ({ version: 1, input: structuredClone(DEFAULT_MEAL_INPUT), recipes: [], favoriteIds: [], cookedIds: [] });
let fixture: Promise<LocalState> | undefined;
async function workspace(): Promise<LocalState> {
  fixture ??= generateRecipe({ ...structuredClone(DEFAULT_INPUT), history: [], nonce: "cloud-fixture" }).then((result) => {
    assert.equal(result.status, "ok");
    return { ...empty(), recipes: [result.recipe], favoriteIds: [result.recipe.id], cookedIds: [result.recipe.id] };
  });
  return structuredClone(await fixture);
}
const cloudSnapshot = (state: LocalState | null): CloudSnapshot => ({ revision: crypto.randomUUID(), state: structuredClone(state) });

test("no browser Firebase client is initialized on the server", () => {
  assert.equal(getCloudClient(), null);
});
test("cloud serialization preserves complete workspace and never mutates snapshots", async () => {
  const state = await workspace();
  const copy = structuredClone(state);
  assert.deepEqual(parseCloudWorkspace(state), copy);
  assert.deepEqual(state, copy);
  const record = { schemaVersion: 1, revision: crypto.randomUUID(), data: JSON.stringify(state), deleted: false };
  assert.deepEqual(parseCloudRecord(record), { revision: record.revision, state });
});
test("all 100 retained recipes, 50 favorites and 100 cooked references fit without trimming", async () => {
  const state = await workspace();
  const first = state.recipes[0];
  state.recipes = Array.from({ length: 100 }, (_, index) => ({ ...structuredClone(first), id: `cloud-${index}` }));
  state.favoriteIds = state.recipes.slice(0, 50).map((recipe) => recipe.id);
  state.cookedIds = state.recipes.map((recipe) => recipe.id);
  assert.deepEqual(parseCloudWorkspace(state), state);
  state.recipes.push({ ...first, id: "cloud-101" });
  assert.throws(() => parseCloudWorkspace(state), /dati non validi/);
});
test("invalid versions, dangling references and unexpected fields are never imported", () => {
  for (const value of [null, undefined, {}, { ...empty(), version: 2 }, { ...empty(), favoriteIds: ["missing"] }, { ...empty(), userId: "attacker" }]) {
    assert.throws(() => parseCloudWorkspace(value), /valid|supportata/i);
  }
});
test("embedded or untrusted image URLs are rejected without stripping saved data", async () => {
  for (const url of ["data:image/png;base64,AAAA", "blob:https://example.test/image", "javascript:alert(1)", "https://other.test/image"]) {
    const state = await workspace();
    state.recipes[0].image = { url, kind: "ai", planHash: state.recipes[0].planHash };
    assert.throws(() => parseCloudWorkspace(state), /base64|blob|dati non validi/);
    assert.equal(state.recipes[0].image.url, url);
  }
});
test("Firestore payload leaves room for metadata and enforces actual UTF-8 bytes", () => {
  assert.ok(MAX_CLOUD_BYTES < 1024 * 1024);
  const payload = { text: "è".repeat(MAX_CLOUD_BYTES / 2 + 1) };
  assert.ok(JSON.stringify(payload).length < MAX_CLOUD_BYTES);
  assert.throws(() => parseCloudWorkspace(payload), /900 KiB/);
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.throws(() => parseCloudWorkspace(cyclic), /Dati cloud non validi/);
  assert.throws(() => parseCloudWorkspace({ value: BigInt(1) }), /Dati cloud non validi/);
});
test("cloud revisions and deletion tombstones are validated rather than treated as empty data", () => {
  const revision = crypto.randomUUID();
  assert.deepEqual(parseCloudRecord({ schemaVersion: 1, revision, deleted: true, data: "" }), { revision, state: null });
  assert.throws(() => parseCloudRecord({ schemaVersion: 1, revision, deleted: true, data: "{}" }), /non vuoto/);
  assert.throws(() => parseCloudRecord({ schemaVersion: 1, revision, deleted: false, data: "not-json" }), /JSON valido/);
  assert.throws(() => parseCloudRecord({ schemaVersion: 2, revision, data: "{}", deleted: false }), /non valido/);
});

class MemoryStorage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
}
test("local sync metadata is account-bound and corrupt metadata never becomes an empty baseline", () => {
  const storage = new MemoryStorage();
  const baseline = cloudSnapshot(empty());
  rememberCloudBaseline(storage, "project:owner", baseline);
  assert.deepEqual(loadCloudBaseline(storage, "project:owner"), baseline);
  assert.equal(loadCloudBaseline(storage, "project:someone-else"), undefined);
  storage.setItem("fit-chef.firebase-baseline.v1.project:owner", "bad-json");
  assert.throws(() => loadCloudBaseline(storage, "project:owner"), /danneggiati/);
});
test("both sides of manual conflict resolutions remain in separate exportable backups", async () => {
  const storage = new MemoryStorage();
  const first = await workspace(), second = empty();
  const firstKey = backupCloudWorkspace(storage, first);
  const secondKey = backupCloudWorkspace(storage, second);
  assert.notEqual(firstKey, secondKey);
  assert.deepEqual(cloudBackups(storage).map((backup) => backup.state), [first, second]);
});
test("local workspace reset removes sync bindings without touching explicit backups or other apps", () => {
  const storage = new MemoryStorage();
  const baseline = cloudSnapshot(empty());
  rememberCloudBaseline(storage, "project:owner", baseline);
  rememberCloudBaseline(storage, "project:second-owner", baseline);
  const backup = backupCloudWorkspace(storage, empty());
  storage.setItem("other-app", "preserve");
  clearCloudBinding(storage);
  assert.equal(loadCloudBaseline(storage, "project:owner"), undefined);
  assert.equal(loadCloudBaseline(storage, "project:second-owner"), undefined);
  assert.equal([...storage.values.keys()].some((key) => key.startsWith("fit-chef.firebase-baseline.")), false);
  assert.ok(storage.getItem(backup));
  assert.equal(storage.getItem("other-app"), "preserve");
});
test("three-way merge combines independent preferences and recipes while preserving deletions", async () => {
  const base = await workspace(), local = structuredClone(base), remote = structuredClone(base);
  local.input.targets.kcal = 430;
  remote.input.preferences.maxTime = 25;
  local.favoriteIds = [];
  const merged = mergeCloudWorkspaces(base, local, remote);
  assert.ok(merged.state);
  assert.equal(merged.state.input.targets.kcal, 430);
  assert.equal(merged.state.input.preferences.maxTime, 25);
  assert.deepEqual(merged.state.favoriteIds, []);
  assert.deepEqual(merged.state.recipes, base.recipes);
});
test("conflicting grams or simultaneous edits never silently choose a winner", () => {
  const base = empty(), local = empty(), remote = empty();
  local.input.targets.kcal = 450;
  remote.input.targets.kcal = 600;
  const merged = mergeCloudWorkspaces(base, local, remote);
  assert.equal(merged.state, undefined);
  assert.ok(merged.conflicts.includes("input.targets.kcal"));
  assert.equal(local.input.targets.kcal, 450);
  assert.equal(remote.input.targets.kcal, 600);
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
});
test("two distinct new recipes are merged by identity, not overwritten by array position", async () => {
  const base = empty(), local = await workspace(), remote = await workspace();
  const recipe = remote.recipes[0];
  recipe.id = "remote-new-recipe";
  remote.favoriteIds = [recipe.id];
  remote.cookedIds = [recipe.id];
  const merged = mergeCloudWorkspaces(base, local, remote);
  assert.ok(merged.state);
  assert.equal(merged.state.recipes.length, 2);
  assert.equal(merged.state.favoriteIds.length, 2);
});

function syncHarness(local: LocalState, remote: CloudSnapshot, baseline?: CloudSnapshot) {
  let receive: ((snapshot: CloudSnapshot) => void) | undefined;
  const h = {
    local: structuredClone(local), remote: structuredClone(remote), statuses: [] as SyncStatus[],
    writes: 0, backups: [] as LocalState[], remembered: baseline, blocked: false,
    writeError: null as Error | null, readError: null as Error | null, stopped: false,
    applyError: null as Error | null, events: [] as string[],
    afterWrite: undefined as ((saved: CloudSnapshot) => void) | undefined,
    notify(snapshot: CloudSnapshot) { h.remote = structuredClone(snapshot); receive?.(snapshot); },
  };
  const transport: SyncTransport = {
    async read() { if (h.readError) throw h.readError; return structuredClone(h.remote); },
    async write(state, revision) {
      h.writes++;
      if (h.writeError) throw h.writeError;
      if (revision !== h.remote.revision) throw new CloudConflictError(h.remote);
      h.remote = cloudSnapshot(state);
      receive?.(h.remote);
      const saved = structuredClone(h.remote);
      h.afterWrite?.(saved);
      return saved;
    },
    watch(next) { receive = next; return () => { receive = undefined; h.stopped = true; }; },
  };
  const ports: SyncPorts = {
    local: () => h.local,
    apply: (state) => {
      h.events.push("apply");
      if (h.applyError) throw h.applyError;
      h.local = structuredClone(state);
    },
    blocked: () => h.blocked,
    remember: (snapshot) => { h.events.push("remember"); h.remembered = structuredClone(snapshot); },
    backup: (state) => { h.backups.push(structuredClone(state)); },
    status: (status) => { h.statuses.push(status); },
    describeError: cloudErrorMessage,
  };
  return { ...h, h, session: new CloudSyncSession(transport, ports, baseline) };
}
test("first login never uploads guest/previous-account data or overwrites local state automatically", async (t) => {
  const local = empty(), remote = await workspace();
  const { h, session } = syncHarness(local, cloudSnapshot(remote));
  t.after(() => session.stop());
  await session.start();
  assert.equal(h.writes, 0);
  assert.deepEqual(h.local, local);
  assert.equal(h.statuses.at(-1)?.phase, "paused");
  session.chooseRemote();
  assert.deepEqual(h.local, remote);
  assert.deepEqual(h.backups, [local]);
  assert.equal(h.writes, 0);
});
test("explicit first upload enables automatic following saves and snapshots update another device", async (t) => {
  const { h, session } = syncHarness(empty(), { revision: null, state: null });
  t.after(() => session.stop());
  await session.start();
  assert.equal(h.writes, 0);
  await session.chooseLocal();
  assert.equal(h.writes, 1);
  h.local.input.targets.protein = 42;
  session.localChanged();
  await session.flush();
  assert.equal(h.remote.state?.input.targets.protein, 42);
  const changed = structuredClone(h.local);
  changed.input.preferences.maxTime = 55;
  h.notify(cloudSnapshot(changed));
  assert.equal(h.local.input.preferences.maxTime, 55);
});
test("offline edits survive a new session and are uploaded against the persisted baseline", async (t) => {
  const base = cloudSnapshot(empty());
  const local = empty();
  local.input.targets.kcal = 575;
  const { h, session } = syncHarness(local, base, base);
  t.after(() => session.stop());
  h.readError = new Error("offline");
  await session.start();
  assert.equal(h.writes, 0);
  assert.equal(h.local.input.targets.kcal, 575);
  h.readError = null;
  await session.start();
  await session.flush();
  assert.equal(h.remote.state?.input.targets.kcal, 575);
  assert.equal(h.statuses.at(-1)?.phase, "synced");
});
test("concurrent modifications are compared on revision, merged when safe and paused otherwise", async (t) => {
  const base = cloudSnapshot(empty());
  const local = empty();
  local.input.targets.kcal = 450;
  const { h, session } = syncHarness(local, base, base);
  t.after(() => session.stop());
  await session.start();
  const remote = empty();
  remote.input.targets.kcal = 600;
  h.remote = cloudSnapshot(remote);
  await session.flush();
  assert.equal(h.statuses.at(-1)?.phase, "conflict");
  assert.equal(h.remote.state?.input.targets.kcal, 600);
  assert.equal(h.local.input.targets.kcal, 450);
  await session.chooseLocal();
  assert.equal(h.remote.state?.input.targets.kcal, 450);
  assert.equal(h.backups[0].input.targets.kcal, 600);
});
test("remote updates do not interrupt an uncommitted editor and can apply when editing ends", async (t) => {
  const base = cloudSnapshot(empty());
  const { h, session } = syncHarness(empty(), base, base);
  t.after(() => session.stop());
  await session.start();
  h.blocked = true;
  const remote = empty();
  remote.input.targets.protein = 35;
  h.notify(cloudSnapshot(remote));
  assert.equal(h.local.input.targets.protein, null);
  h.blocked = false;
  session.localChanged();
  assert.equal(h.local.input.targets.protein, 35);
});
test("cloud deletion is a durable tombstone and is not undone by a later listener or reload", async (t) => {
  const base = cloudSnapshot(await workspace());
  const { h, session } = syncHarness(base.state!, base, base);
  t.after(() => session.stop());
  await session.start();
  await session.clearCloud();
  const tombstone = structuredClone(h.remote);
  assert.equal(tombstone.state, null);
  assert.ok(h.local.recipes.length > 0);
  h.notify(tombstone);
  session.localChanged();
  await session.flush();
  assert.equal(h.remote.state, null);
  assert.equal(h.writes, 1);
  const reloaded = syncHarness(h.local, tombstone, tombstone);
  t.after(() => reloaded.session.stop());
  await reloaded.session.start();
  await reloaded.session.flush();
  assert.equal(reloaded.h.writes, 0);
});
test("errors and stopped subscriptions never claim cloud success or change the local data", async () => {
  const base = cloudSnapshot(empty());
  const { h, session } = syncHarness(empty(), base, base);
  await session.start();
  h.local.input.targets.kcal = 510;
  h.writeError = new Error("permission denied");
  await session.flush();
  assert.equal(h.statuses.at(-1)?.phase, "error");
  assert.equal(h.local.input.targets.kcal, 510);
  assert.equal(h.remote.state?.input.targets.kcal, null);
  session.stop();
  h.notify(cloudSnapshot(empty()));
  assert.equal(h.local.input.targets.kcal, 510);
  assert.equal(h.stopped, true);
  assert.equal(sameWorkspace(h.local, h.remote.state), false);
});
test("Firebase errors explain permissions, domains, network and cancelled Google login", () => {
  assert.match(cloudErrorMessage({ code: "permission-denied" }), /regole Firestore/);
  assert.match(cloudErrorMessage({ code: "auth/unauthorized-domain" }), /domini autorizzati/);
  assert.match(cloudErrorMessage({ code: "unavailable" }), /dispositivo/);
  assert.match(cloudErrorMessage({ code: "auth/popup-closed-by-user" }), /annullato/);
});

test("a newer remote snapshot observed during a save is not replaced by the write acknowledgement", async (t) => {
  const base = cloudSnapshot(empty());
  const { h, session } = syncHarness(empty(), base, base);
  t.after(() => session.stop());
  await session.start();
  h.local.input.targets.protein = 40;
  h.afterWrite = (saved) => {
    assert.ok(saved.state);
    const newer = structuredClone(saved.state);
    newer.input.preferences.maxTime = 45;
    h.notify(cloudSnapshot(newer));
  };
  await session.flush();
  assert.equal(h.local.input.targets.protein, 40);
  assert.equal(h.local.input.preferences.maxTime, 45);
  assert.deepEqual(h.remembered, h.remote);
  assert.equal(h.writes, 1);
});

test("merged workspace is persisted before advancing the baseline and storage failure pauses synchronization", async (t) => {
  const base = cloudSnapshot(empty());
  const { h, session } = syncHarness(empty(), base, base);
  t.after(() => session.stop());
  await session.start();
  h.local.input.targets.kcal = 450;
  const remote = empty();
  remote.input.targets.protein = 35;
  h.events.length = 0;
  h.notify(cloudSnapshot(remote));
  assert.deepEqual(h.events, ["apply", "remember"]);
  assert.equal(h.local.input.targets.kcal, 450);
  assert.equal(h.local.input.targets.protein, 35);
  const baseline = structuredClone(h.remembered);
  h.applyError = new Error("Storage quota exceeded");
  remote.input.preferences.maxTime = 40;
  h.events.length = 0;
  h.notify(cloudSnapshot(remote));
  assert.deepEqual(h.events, ["apply"]);
  assert.deepEqual(h.remembered, baseline);
  assert.equal(h.statuses.at(-1)?.phase, "error");
  assert.notEqual(h.local.input.preferences.maxTime, 40);
});

test("a failed save stays paused across edits and snapshots until an explicit reconnect", async (t) => {
  const base = cloudSnapshot(empty());
  const { h, session } = syncHarness(empty(), base, base);
  t.after(() => session.stop());
  await session.start();
  h.local.input.targets.kcal = 500;
  h.writeError = new Error("offline");
  await session.flush();
  h.local.input.targets.protein = 40;
  session.localChanged();
  h.notify(base);
  await session.flush();
  assert.equal(h.writes, 1);
  assert.equal(h.statuses.at(-1)?.phase, "error");
  h.writeError = null;
  await session.start();
  await session.flush();
  assert.equal(h.remote.state?.input.targets.kcal, 500);
  assert.equal(h.remote.state?.input.targets.protein, 40);
  assert.equal(h.statuses.at(-1)?.phase, "synced");
});

test("explicit reactivation after a recovered cloud deletion restores automatic saves", async (t) => {
  const base = cloudSnapshot(empty());
  const { h, session } = syncHarness(empty(), base, base);
  t.after(() => session.stop());
  await session.start();
  h.local.input.targets.kcal = 500;
  h.writeError = new Error("offline");
  await session.flush();
  h.writeError = null;
  await session.clearCloud();
  await session.chooseLocal();
  h.local.input.targets.protein = 45;
  session.localChanged();
  assert.equal(h.statuses.at(-1)?.phase, "pending");
  await session.flush();
  assert.equal(h.remote.state?.input.targets.protein, 45);
});
