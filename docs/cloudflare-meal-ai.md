# Cloudflare Workers AI per FIT Diario (opzionale, piano gratuito)

## Stato
Il codice è disponibile ma **non è attivo nel sito pubblico finché non configuri e pubblichi il Worker nel tuo account Cloudflare**. Non esiste un collegamento diretto tra account Cloudflare e questo repository.

La UI richiede consenso esplicito per ogni sessione, invia soltanto la descrizione digitata e **non** i dati del diario. L'AI estrae nomi/segmenti, non inventa quantità o nutrienti. Dopo l'interpretazione, gli alimenti non risolti richiedono ancora una corrispondenza nutrizionale verificabile. Una ricetta sconosciuta non viene automaticamente convertita nella somma dei suoi ingredienti.

## Distribuzione semplificata con GitHub Actions (consigliata)

È disponibile un workflow manuale **Deploy FIT Diario AI to Cloudflare**. Evita di installare Wrangler sul PC e non richiede di copiare codice nel pannello Cloudflare.

1. In **Cloudflare → My Profile → API Tokens**, crea un token limitato al tuo account con permessi **Workers Scripts: Edit** e **Workers AI: Read** se richiesto dalla tua configurazione. Verifica la lista di permessi suggeriti dalla documentazione di Wrangler; assegna il minimo necessario.
2. Recupera **Cloudflare Account ID** dalla dashboard Cloudflare.
3. Nel repository **GitHub → Settings → Secrets and variables → Actions → Secrets**, configura:
   - `CLOUDFLARE_API_TOKEN` — token Cloudflare (segreto, mai in chat).
   - `CLOUDFLARE_ACCOUNT_ID` — ID account Cloudflare.
   - `FIT_FIREBASE_PROJECT_ID` — project ID del Firebase Authentication già usato da FIT Diario.
   - `FIT_ALLOWED_FIREBASE_UID` — UID esatto del tuo utente, visualizzato in **Firebase console → Authentication → Users**. Non usare email o password.
4. In **Actions → Deploy FIT Diario AI to Cloudflare → Run workflow**, avvia il deploy dal branch `main`. Il job controlla che i parametri siano presenti, pubblica il Worker, configura le autorizzazioni come secret e blocca le richieste quando mancano.
5. Da Cloudflare **Workers & Pages → fit-diario-meal-ai**, copia l'indirizzo HTTPS `https://....workers.dev`.
6. In GitHub **Settings → Secrets and variables → Actions → Variables**, crea `NEXT_PUBLIC_MEAL_AI_URL` con l'indirizzo pubblico del Worker. **L'URL non contiene segreti.**
7. In **Actions → Publish FIT Chef → Run workflow**, rilancia la build pubblica. Alla pubblicazione completata, apri FIT Diario, accedi con lo stesso account Google collegato a Firebase e abilita la casella AI nel Diario.

Se il deploy fallisce per permessi Cloudflare, verifica gli scope del token nel tuo account, senza incollare qui token o dati personali. Se una richiesta fallisce per quota AI, non tentare di forzare fatturazione: il fallback locale continua a funzionare.

**Stato di sicurezza:** il workflow non si avvia in automatico al push e non pubblica alcun token nel frontend. Il Worker è chiuso finché non riceve tutte le configurazioni. Il piano Free di Cloudflare può limitare il numero delle interpretazioni; controlla la dashboard prima di attivare eventuale billing.

## Passaggi per la distribuzione manuale
1. Nel dashboard Cloudflare crea un nuovo Worker (Workers & Pages) **nel piano Free**, con un binding Workers AI chiamato **AI**.
2. Incolla o pubblica `cloudflare/meal-ai-worker.ts` come Worker (con `wrangler deploy` dopo compilazione TypeScript; non esporre il codice come JS non compilato). Modello predefinito: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Verifica il modello nel catalogo Cloudflare e che sia ammesso sul piano Free.
3. Configura le variabili **FIREBASE_PROJECT_ID** (ID progetto Firebase esistente), **ALLOWED_FIREBASE_UID** (UID esatto dell'unico account autorizzato) e **ALLOWED_ORIGIN** = `https://gianmarcotacchini92.github.io`. Un valore vuoto blocca tutte le richieste.
4. Imposta il binding AI e assicurati che il Worker risponda in HTTPS (esempio `https://fit-diario-ai.<subdomain>.workers.dev`). Non committare token Firebase, chiavi API, segreti o dati del diario.
5. In GitHub Actions del repository aggiungi una **Repository Variable** `NEXT_PUBLIC_MEAL_AI_URL` con l'URL HTTPS del Worker. Il workflow di pubblicazione deve passare la variabile al comando `npm run build:static`. L'URL non è una credenziale segreta.
6. Rilascia il sito e fai accesso con Google/Firebase. Nella sezione Diario abilita il consenso AI e interpreta una frase mista. Le richieste sono bloccate senza token Firebase valido, UID consentito o Origin atteso.
7. Controlla su Cloudflare il consumo di Neurons, i limiti e l'assenza di fatturazione a consumo. Nel piano Free l'esaurimento quota fa fallire la richiesta: il diario continua con la revisione locale.

**Sicurezza:** per ora l'accesso è intenzionalmente a singolo UID. Il Worker verifica firma RS256, issuer, audience, scadenza e UID del Firebase ID token usando le chiavi pubbliche Google. CORS non sostituisce l'autenticazione. L'accesso a più utenti richiede una progettazione aggiuntiva di quote, autorizzazioni e protezione da abusi; non aprire l'endpoint pubblicamente eliminando l'allowlist.

**Costi:** Cloudflare indica 10.000 Neurons/giorno gratuiti per Workers AI sul piano Free. Non tutti i modelli sono disponibili senza billing, e la quota può esaurirsi. Per questo il servizio è opt-in e l'app non assume disponibilità garantita.

## Limiti noti
- I modelli possono segmentare male piatti misti. La UI verifica che il testo originale sia preservato e richiede conferma delle corrispondenze.
- Un piatto casalingo non ha nutrienti attendibili se non esiste un prodotto, una ricetta personale o una stima documentata.
- Si consiglia un test con descrizioni reali, tra cui pizza al taglio, torta rustica, arrosto e cene miste, prima di sostituire la revisione locale.
- Il servizio invia la frase del pasto a Cloudflare. Prima di abilitarlo leggere l'informativa privacy e le condizioni applicabili.
