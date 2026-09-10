"use client";

import { useEffect, useId, useRef, useState } from "react";
import { GoogleAuthProvider, getRedirectResult, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { Cloud, CloudDownload, CloudUpload, Download, LogOut, RefreshCw, Trash2, UserRound, X } from "lucide-react";
import {
  cloudErrorMessage, getCloudClient, isCloudConfigured, readCloudWorkspace, watchCloudWorkspace,
  writeCloudWorkspace, type CloudClient,
} from "@/lib/cloud";
import { CloudSyncSession, type SyncStatus } from "@/lib/cloud-sync";
import { backupCloudWorkspace, cloudBackups, loadCloudBaseline, rememberCloudBaseline } from "@/lib/cloud-storage";
import type { LocalState } from "@/lib/types";

type CloudAccountProps = {
  state: LocalState;
  onRestore: (state: LocalState) => void;
  onMessage: (message: string) => void;
  disabled?: boolean;
  ready?: boolean;
  onBusyChange?: (busy: boolean) => void;
};
const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function CloudAccount({ state, onRestore, onMessage, disabled = false, ready = true, onBusyChange }: CloudAccountProps) {
  const configured = isCloudConfigured();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(configured);
  const [user, setUser] = useState<User | null>(null);
  const [operation, setOperation] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<SyncStatus>({ phase: "paused", message: "Solo su questo dispositivo" });
  const [ignoreBaseline, setIgnoreBaseline] = useState(false);
  const clientRef = useRef<CloudClient | null>(null);
  const sessionRef = useRef<CloudSyncSession | null>(null);
  const latest = useRef({ state, disabled, ready, onRestore, onMessage });
  const dialogRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(false);
  const id = useId();
  const busy = disabled || !ready || checking || operation || status.phase === "saving";
  const userId = user?.uid;

  useEffect(() => { latest.current = { state, disabled, ready, onRestore, onMessage }; });
  useEffect(() => { sessionRef.current?.localChanged(); }, [state, disabled, ready]);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    async function initialize() {
      try {
        const client = getCloudClient();
        if (!client) return;
        clientRef.current = client;
        await client.ready;
        if (!active) return;
        unsubscribe = onAuthStateChanged(client.auth, (nextUser) => {
          if (!active) return;
          setUser(nextUser);
          setChecking(false);
        }, (error) => {
          if (active) { setError(cloudErrorMessage(error)); setChecking(false); }
        });
        await getRedirectResult(client.auth);
      } catch (error) {
        if (active) { setError(cloudErrorMessage(error)); setOpen(true); }
      } finally { if (active) setChecking(false); }
    }
    void initialize();
    return () => { active = false; unsubscribe?.(); };
  }, []);

  useEffect(() => {
    const client = clientRef.current;
    if (!client || !userId || !ready) return;
    const uid = userId;
    const account = `${client.db.app.options.projectId}:${uid}`;
    let active = true;
    let controller: CloudSyncSession | undefined;
    try {
      controller = new CloudSyncSession({
        read: () => readCloudWorkspace(client, uid),
        write: (workspace, revision) => writeCloudWorkspace(client, uid, workspace, revision),
        watch: (receive, error) => watchCloudWorkspace(client, uid, receive, error),
      }, {
        local: () => latest.current.state,
        blocked: () => latest.current.disabled || !latest.current.ready,
        apply: (workspace) => {
          if (!active || client.auth.currentUser?.uid !== uid) return;
          localStorage.setItem("fit-chef.workspace.v1", JSON.stringify(workspace));
          latest.current = { ...latest.current, state: workspace };
          latest.current.onRestore(workspace);
        },
        remember: (snapshot) => {
          localStorage.setItem("fit-chef.workspace.v1", JSON.stringify(latest.current.state));
          rememberCloudBaseline(localStorage, account, snapshot);
        },
        backup: (workspace) => { backupCloudWorkspace(localStorage, workspace); },
        status: (next) => {
          if (!active) return;
          setStatus(next);
          if ((next.phase === "conflict" || next.phase === "paused") && !latest.current.disabled) setOpen(true);
          if (next.phase === "error") latest.current.onMessage(next.message);
        },
        describeError: cloudErrorMessage,
      }, ignoreBaseline ? undefined : loadCloudBaseline(localStorage, account));
      sessionRef.current = controller;
      void controller.start();
    } catch (error) {
      latest.current.onMessage(cloudErrorMessage(error));
      // Initialization errors must not be replaced by an empty cloud baseline.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(cloudErrorMessage(error));
      setOpen(true);
    }
    const retry = () => { if (active) void controller?.start(); };
    window.addEventListener("online", retry);
    return () => {
      active = false;
      controller?.stop();
      if (sessionRef.current === controller) sessionRef.current = null;
      window.removeEventListener("online", retry);
    };
  }, [userId, ready, ignoreBaseline]);

  useEffect(() => {
    if (!userId || !ready || (status.phase !== "pending" && status.phase !== "saving")) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status.phase, userId, ready]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    const elements = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => element.getClientRects().length > 0);
    const focus = () => (elements()[0] ?? dialog).focus();
    focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
      if (event.key !== "Tab") return;
      const first = elements()[0], last = elements().at(-1);
      if (!first || !last) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const trap = (event: FocusEvent) => { if (event.target instanceof Node && !dialog.contains(event.target)) focus(); };
    document.addEventListener("keydown", key, true);
    document.addEventListener("focusin", trap);
    return () => {
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("focusin", trap);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [open]);

  async function run(action: () => Promise<unknown> | void) {
    if (busy || busyRef.current) return;
    busyRef.current = true;
    setOperation(true);
    onBusyChange?.(true);
    setError("");
    try { await action(); }
    catch (error) {
      const message = cloudErrorMessage(error);
      setError(message);
      latest.current.onMessage(message);
    } finally {
      busyRef.current = false;
      setOperation(false);
      onBusyChange?.(false);
    }
  }

  function login() {
    void run(() => {
      const client = clientRef.current;
      if (!client) throw new Error("Firebase non configurato. Controlla le impostazioni del progetto.");
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      return signInWithPopup(client.auth, provider);
    });
  }

  function requireSession(): CloudSyncSession {
    const session = sessionRef.current;
    if (!session) throw new Error("Sincronizzazione non inizializzata. Ricollega confrontando le copie prima di continuare.");
    return session;
  }

  function downloadBackups() {
    void run(() => {
      const backups = cloudBackups(localStorage);
      if (!backups.length) throw new Error("Non ci sono ancora copie di sicurezza create durante i confronti cloud.");
      const url = URL.createObjectURL(new Blob([JSON.stringify({ backups }, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "fit-chef-copie-sicurezza.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  return <div className="cloud-account">
    <button type="button" className="button button-secondary" aria-haspopup="dialog" onClick={() => setOpen(true)}><UserRound size={16}/>{user ? "Account Google" : "Account"}</button>
    {user && <span className={`firebase-sync-status sync-${status.phase}`} role="status" title={status.message}><Cloud size={13}/><span>{status.message}</span></span>}
    {open && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section ref={dialogRef} className="modal cloud-modal" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}>
        <div className="modal-header"><div><h2 id={`${id}-title`}>Account e copia cloud</h2><p>Gli stessi dati su PC e telefono, con Firebase.</p></div><button className="icon-button" onClick={() => setOpen(false)} aria-label="Chiudi account"><X size={20}/></button></div>
        {!configured ? <div className="notice"><p>Firebase non e ancora configurato. L&apos;app continua a salvare sul dispositivo. Configura progetto, accesso Google e regole Firestore prima di usare il cloud.</p></div>
          : checking ? <p>Controllo dell&apos;accesso Google...</p>
          : !user ? <div className="cloud-login"><p>Accedi con lo stesso account Google su PC e telefono. Al primo collegamento scegli se caricare i dati del dispositivo o recuperare la copia cloud.</p><button className="button button-primary" disabled={busy} onClick={login}><UserRound size={17}/>Accedi con Google</button><p className="micro-copy">Consenti il popup Google. Se il browser interno di un&apos;altra app blocca l&apos;accesso, apri questo sito direttamente in Safari o Chrome.</p></div>
          : <div className="cloud-actions">
            <p><strong>{user.displayName ?? "Account Google"}</strong><br/>{user.email}</p>
            <div className={`notice sync-${status.phase}`} role="status">{status.message}</div>
            {(status.phase === "paused" || status.phase === "conflict") && <>
              <p className="micro-copy">Prima di una sostituzione conserviamo la copia precedente in un backup locale esportabile. Le modifiche simultanee compatibili vengono unite; quelle in conflitto richiedono la tua scelta.</p>
              {status.canUseRemote && <button className="button button-secondary" disabled={busy} onClick={() => {
                if (window.confirm("Usare la copia cloud su questo dispositivo? Prima conserveremo gli attuali dati locali in una copia di sicurezza esportabile.")) void run(() => requireSession().chooseRemote());
              }}><CloudDownload size={16}/>Usa i dati cloud</button>}
              <button className="button button-primary" disabled={busy} onClick={() => {
                if (window.confirm("Collegare i dati visibili su questo dispositivo all'account Google indicato? Eventuali dati cloud precedenti saranno conservati in una copia di sicurezza locale prima della sostituzione.")) void run(() => requireSession().chooseLocal());
              }}><CloudUpload size={16}/>Sincronizza i dati del dispositivo</button>
            </>}
            <button className="button button-secondary" disabled={busy} onClick={() => void run(() => requireSession().start())}><RefreshCw size={16}/>Riprova sincronizzazione</button>
            <button className="button button-secondary" disabled={busy} onClick={downloadBackups}><Download size={16}/>Esporta copie di sicurezza</button>
            <button className="text-button" disabled={busy} onClick={() => {
              if (window.confirm("Eliminare la copia cloud di FIT Chef e fermare la sincronizzazione? I dati locali, gli altri progetti Firebase e l'account Google non verranno eliminati.")) void run(() => requireSession().clearCloud());
            }}><Trash2 size={15}/>Elimina solo la copia cloud FIT Chef</button>
            <button className="text-button" disabled={busy} onClick={() => {
              if (window.confirm("Uscire da Google su questo dispositivo? I dati locali rimangono presenti. Eventuali modifiche non ancora sincronizzate non saranno visibili sul telefono finche non accedi di nuovo.")) void run(async () => {
                const client = clientRef.current;
                if (!client) throw new Error("Client Firebase non disponibile.");
                await signOut(client.auth);
                sessionRef.current?.stop();
                setUser(null);
                latest.current.onMessage("Uscita completata. I dati rimangono su questo dispositivo; nessun dato viene caricato in un altro account automaticamente.");
              });
            }}><LogOut size={15}/>Esci da Google</button>
          </div>}
        {error && <div className="notice error-notice" role="alert"><p>{error}</p>{user && <button className="text-button" disabled={busy} onClick={() => {
          if (window.confirm("Ricollegare il cloud confrontando le copie da zero? Nessuna copia verra sovrascritta prima della tua scelta.")) { setIgnoreBaseline(true); setError(""); }
        }}>Ricollega confrontando le copie</button>}</div>}
        <p className="micro-copy">Le foto AI create dal server locale non vengono caricate su Firebase: su un altro dispositivo resta disponibile l&apos;illustrazione della ricetta. La dieta, le ricette, le scelte e i preferiti sono inclusi nel salvataggio.</p>
      </section>
    </div>}
  </div>;
}
