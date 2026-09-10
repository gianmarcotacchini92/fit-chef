import { CloudConflictError, parseCloudWorkspace, type CloudSnapshot } from "./cloud";
import { mergeCloudWorkspaces, sameWorkspace } from "./cloud-merge";
import type { LocalState } from "./types";

export type SyncStatus = {
  phase: "connecting" | "synced" | "pending" | "saving" | "conflict" | "error" | "paused";
  message: string;
  canUseRemote?: boolean;
};
export type SyncTransport = {
  read: () => Promise<CloudSnapshot>;
  write: (state: LocalState | null, revision: string | null) => Promise<CloudSnapshot>;
  watch: (receive: (snapshot: CloudSnapshot) => void, error: (error: unknown) => void) => () => void;
};
export type SyncPorts = {
  local: () => LocalState;
  apply: (state: LocalState) => void;
  blocked: () => boolean;
  remember: (snapshot: CloudSnapshot) => void;
  backup: (state: LocalState) => void;
  status: (status: SyncStatus) => void;
  describeError: (error: unknown) => string;
};

export class CloudSyncSession {
  private stopped = false;
  private enabled = false;
  private writing = false;
  private failed = false;
  private epoch = 0;
  private baseline: CloudSnapshot | undefined;
  private latest: CloudSnapshot | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unwatch: (() => void) | undefined;

  constructor(private readonly transport: SyncTransport, private readonly ports: SyncPorts, baseline?: CloudSnapshot) {
    this.baseline = baseline;
  }

  async start(): Promise<void> {
    if (this.writing) {
      this.ports.status({ phase: "saving", message: "Attendi il salvataggio in corso prima di ricollegare il cloud." });
      return;
    }
    const epoch = ++this.epoch;
    this.enabled = false;
    this.failed = false;
    if (this.timer) clearTimeout(this.timer);
    this.unwatch?.();
    this.ports.status({ phase: "connecting", message: "Connessione al tuo spazio Firebase..." });
    try {
      const remote = await this.transport.read();
      if (this.stopped || epoch !== this.epoch) return;
      this.receive(remote);
      this.unwatch = this.transport.watch((snapshot) => {
        if (!this.stopped && epoch === this.epoch) this.receive(snapshot);
      }, (error) => this.fail(error));
    } catch (error) {
      if (!this.stopped && epoch === this.epoch) this.fail(error);
    }
  }

  private remember(snapshot: CloudSnapshot): void {
    this.ports.remember(snapshot);
    this.baseline = snapshot;
  }

  private receive(remote: CloudSnapshot): void {
    this.latest = remote;
    if (this.writing || this.failed) return;
    try {
      const local = this.ports.local();
      if (remote.state && sameWorkspace(local, remote.state)) {
        this.remember(remote);
        this.enabled = true;
        this.ports.status({ phase: "synced", message: "Sincronizzato con Firebase" });
        return;
      }
      if (!remote.state) {
        this.enabled = false;
        this.ports.status({ phase: "paused", message: "Attiva il salvataggio dei dati di questo dispositivo nel tuo spazio Firebase." });
        return;
      }
      if (this.baseline && this.baseline.revision === remote.revision) {
        this.enabled = true;
        this.localChanged();
        return;
      }
      if (this.baseline?.state && remote.state) {
        const merged = mergeCloudWorkspaces(this.baseline.state, local, remote.state);
        if (merged.state && !this.ports.blocked()) {
          if (!sameWorkspace(local, merged.state)) this.ports.apply(merged.state);
          this.remember(remote);
          this.enabled = true;
          this.localChanged();
          return;
        }
        if (merged.conflicts.length) {
          this.enabled = false;
          this.ports.status({ phase: "conflict", message: "PC e telefono hanno modificato gli stessi dati. Le due copie sono conservate: scegli quale usare.", canUseRemote: true });
          return;
        }
      }
      this.enabled = false;
      this.ports.status({
        phase: "paused",
        message: remote.state
          ? "Esiste una copia nel cloud. Scegli come collegare questo dispositivo; nessun dato verra sostituito automaticamente."
          : "Attiva il salvataggio dei dati di questo dispositivo nel tuo spazio Firebase.",
        canUseRemote: Boolean(remote.state),
      });
    } catch (error) { this.fail(error); }
  }

  localChanged(): void {
    if (this.stopped || this.writing || this.failed) return;
    if (!this.enabled) {
      if (this.latest && this.baseline?.state && this.latest.state && !this.ports.blocked()) this.receive(this.latest);
      return;
    }
    if (sameWorkspace(this.ports.local(), this.baseline?.state ?? null)) {
      this.ports.status({ phase: "synced", message: "Sincronizzato con Firebase" });
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.ports.status({ phase: "pending", message: "Modifiche salvate sul dispositivo, sincronizzazione in attesa..." });
    if (!this.ports.blocked()) this.timer = setTimeout(() => { void this.flush(); }, 900);
  }

  async flush(): Promise<void> {
    if (this.stopped || this.writing || !this.enabled || !this.baseline || this.ports.blocked()) return;
    const epoch = this.epoch;
    const expectedRevision = this.baseline.revision;
    this.writing = true;
    this.ports.status({ phase: "saving", message: "Salvataggio su Firebase..." });
    try {
      const snapshot = parseCloudWorkspace(this.ports.local());
      const saved = await this.transport.write(snapshot, expectedRevision);
      if (this.stopped || epoch !== this.epoch) return;
      this.remember(saved);
      if (!this.latest || this.latest.revision === expectedRevision || this.latest.revision === saved.revision) this.latest = saved;
      this.ports.status({ phase: "synced", message: "Sincronizzato con Firebase" });
    } catch (error) {
      if (this.stopped || epoch !== this.epoch) return;
      if (error instanceof CloudConflictError) this.latest = error.latest;
      else this.fail(error);
    } finally {
      this.writing = false;
      if (!this.stopped && epoch === this.epoch) {
        if (this.latest && this.latest.revision !== this.baseline?.revision) this.receive(this.latest);
        else if (this.enabled) this.localChanged();
      }
    }
  }

  async chooseLocal(): Promise<void> {
    if (!this.latest || this.writing || this.ports.blocked() || this.stopped) return;
    try {
      if (this.latest.state) this.ports.backup(this.latest.state);
      this.remember(this.latest);
      this.failed = false;
      this.enabled = true;
      await this.flush();
    } catch (error) { this.fail(error); }
  }

  chooseRemote(): void {
    if (!this.latest?.state || this.writing || this.ports.blocked() || this.stopped) return;
    try {
      this.ports.backup(this.ports.local());
      this.ports.apply(this.latest.state);
      this.remember(this.latest);
      this.failed = false;
      this.enabled = true;
      this.ports.status({ phase: "synced", message: "Copia Firebase caricata e sincronizzazione attiva" });
    } catch (error) { this.fail(error); }
  }

  async clearCloud(): Promise<void> {
    if (this.writing || this.ports.blocked() || this.stopped) return;
    this.enabled = false;
    this.writing = true;
    const epoch = this.epoch;
    try {
      const current = await this.transport.read();
      if (this.stopped || epoch !== this.epoch) return;
      if (current.state) this.ports.backup(current.state);
      const deleted = await this.transport.write(null, current.revision);
      if (this.stopped || epoch !== this.epoch) return;
      this.remember(deleted);
      this.latest = deleted;
      this.failed = false;
      this.ports.status({ phase: "paused", message: "Copia cloud eliminata; sincronizzazione disattivata. La copia locale e conservata." });
    } catch (error) {
      if (!this.stopped && epoch === this.epoch) this.fail(error);
    } finally { this.writing = false; }
  }

  private fail(error: unknown): void {
    if (this.stopped) return;
    this.enabled = false;
    this.failed = true;
    if (this.timer) clearTimeout(this.timer);
    this.ports.status({ phase: "error", message: this.ports.describeError(error) });
  }

  stop(): void {
    this.stopped = true;
    this.epoch++;
    this.enabled = false;
    if (this.timer) clearTimeout(this.timer);
    this.unwatch?.();
  }
}
