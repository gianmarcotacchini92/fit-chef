# FIT Chef

Web app italiana per trasformare gli alimenti previsti dalla dieta in una ricetta gustosa. Le grammature originali restano fisse, le aggiunte richiedono conferma e i nutrienti vengono calcolati, non inventati da un modello AI.

La versione online funziona anche sul telefono e genera le ricette direttamente nel browser: non richiede che il PC rimanga acceso. Google Authentication e Cloud Firestore conservano il workspace privato tra dispositivi.

## Uso

1. **Dalla mia settimana**: importa il tuo piano, scegli giorno e pasto, completa i pesi mancanti e conferma i prodotti effettivamente utilizzati. Il repository pubblico non contiene diete personali.
2. **Dal mio pasto**: scrivi alimenti e quantita, anche su righe separate. Sono accettati `g`, `gr`, `gr.`, `grammo`, `grammi` e la virgola decimale. Un alimento riconosciuto senza peso rimane da completare, non viene scartato o quantificato automaticamente.
3. Conferma soltanto gli extra disponibili, come pangrattato, farina, olio o yogurt. Nessuna aggiunta e autorizzata automaticamente.
4. Genera la ricetta e confronta **pasto originale + extra effettivi = totale**, per porzione e per l'intera preparazione.

La modalita **Dal frigo** permette anche ricette libere con ingredienti e scorte disponibili. I target numerici sono facoltativi e riguardano una porzione del pasto, non l'intera giornata.

I prodotti generici richiedono attenzione allo stato di peso e all'etichetta: un formaggio classico non diventa light, il riso integrale non diventa bianco, pezzi e porzioni non vengono convertiti automaticamente in grammi. Indicare il taglio della carne, non soltanto "carne rossa". Le voci generiche di marca sono segnalate come stime, non dati ufficiali del produttore.

## Le proposte dello chef

Dopo aver confermato il pasto, l'app propone un intervento culinario concreto e piccole aggiunte pertinenti: non mostra automaticamente lo stesso elenco di farine e condimenti per qualsiasi combinazione.

Se premi **Trasforma il mio pasto** senza aver scelto extra, una proposta disponibile viene mostrata prima della generazione, con grammature e calorie aggiuntive massime. Puoi confermare **Ho questi extra, usali**, scegliere soltanto quelli che possiedi oppure continuare esplicitamente senza aggiunte.

Gli extra proposti devono essere compatibili con gli alimenti di base e con una preparazione del catalogo; allergie, esclusioni, strumenti e tempo filtrano la proposta. La generazione finale verifica anche i vincoli nutrizionali. Non si riducono pollo, pane o altri alimenti prescritti per compensare una salsa. Se una variante non usa una delle aggiunte confermate, l'app lo dichiara e non la conteggia nei macros.

Le aggiunte sono disponibilita massime, non ingredienti fittizi: una proposta non autorizza alcun alimento finche non viene confermata. La modalita frigo conserva il proprio comportamento.

Per pollo o tacchino, finocchi e pane sono disponibili preparazioni al crumble tostato con slaw oppure tartine con carne sfilacciata e finocchi brasati. Richiedono 30-32 minuti per una porzione, 35 per due; usano il pane gia prescritto e incorporano gli extra confermati nella preparazione. Una versione semplice resta disponibile se i vincoli escludono le trasformazioni. Esaurite le varianti compatibili, l'app dichiara la ripetizione invece di presentare il vecchio piatto semplice come una nuova idea.

## Account Google e sincronizzazione

Apri **Account** e accedi con lo stesso account Google sul PC e sul telefono. Alla prima connessione scegli esplicitamente se usare la copia cloud o sincronizzare quella del dispositivo. Non viene sovrascritto automaticamente un piano gia presente.

Per trasferire un workspace gia utilizzato in locale:

1. Apri l'app locale nello stesso browser in cui sono salvati i tuoi dati.
2. Accedi con Google e scegli **Sincronizza i dati del dispositivo**. Attendi lo stato di sincronizzazione completata prima di chiudere.
3. Apri la versione online sul telefono, accedi con lo stesso Google e scegli **Usa i dati cloud**, se richiesto.

Successivamente modifiche, piano settimanale, ricette, preferiti e impostazioni vengono sincronizzati automaticamente. Il collegamento Firebase CLI utilizzato per configurare il progetto non sostituisce l'accesso Google dentro l'app.

- Le transazioni confrontano la revisione cloud: una copia vecchia non puo sovrascrivere silenziosamente una piu recente.
- Modifiche indipendenti vengono unite; modifiche incompatibili sospendono la sincronizzazione e richiedono una scelta esplicita.
- Prima di una sostituzione manuale viene conservata una copia locale separata, esportabile dal pannello account.
- Senza rete le modifiche restano sul dispositivo. Alla riconnessione vengono confrontate con il cloud; gli errori sono visibili.
- Il primo collegamento a un account diverso richiede nuovamente conferma: i dati locali non vengono attribuiti automaticamente a un altro utente.

Il salvataggio locale non sostituisce un backup: cancellare i dati del browser puo eliminare modifiche ancora non sincronizzate e copie di sicurezza locali. Esporta periodicamente il workspace.

## Piano settimanale privato

Il piano fa parte di `weeklyDiet.plan` nel workspace dell'utente, non di una costante condivisa nel codice pubblico. Il calendario gestisce sette giorni e quattro pasti, alternative, pasti liberi e pesi da confermare.

L'importazione del piano valida struttura, ingredienti e quantita. Un piano assente mostra le opzioni di configurazione, non una dieta dimostrativa spacciata per personale. Modificare manualmente un pasto non riscrive la prescrizione originale.

Per la migrazione dalla precedente installazione locale, il piano e conservato esclusivamente in `.data\weekly-diet-import.json`, ignorato da Git. L'app interroga `GET /api/weekly-diet` soltanto sul loopback, se manca un piano e la migrazione non e gia avvenuta. Questa API e il relativo file non vengono inclusi nel sito statico. Un piano gia presente non viene sostituito; dopo un azzeramento esplicito non viene reimportato automaticamente.

## Architettura

| Componente | Implementazione |
|---|---|
| Interfaccia | Next.js, React, TypeScript, layout responsive |
| Catalogo | Ingredienti e valori nutrizionali generici versionati |
| Composizione | Archetipi culinari, vincoli, diversita e HiGHS |
| Versione online | Export statico, generazione nel browser e Web Worker |
| Account | Firebase Authentication, Google, persistenza locale della sessione |
| Sincronizzazione | Cloud Firestore, `fitChefUsers/{uid}`, transazioni e listener |
| Distribuzione | GitHub Pages tramite GitHub Actions |
| AI facoltativa | Solo backend locale configurato e consenso esplicito |

Il progetto Firebase configurato e `sincro-ai`, gia usato dalle altre app del proprietario. FIT Chef ha una propria app web registrata e una collezione separata: non legge o modifica i documenti PAC ETF o diario corporeo. Non viene inizializzato Firebase Analytics.

La configurazione web Firebase e pubblica per definizione; la protezione dei dati dipende dalle regole e dall'identita autenticata, non dal nascondere la web API key. Non inserire mai service account, token CLI o altre credenziali amministrative nel codice o nelle variabili `NEXT_PUBLIC_*`.

## Avvio locale

Richiede Node.js 22 o successivo; sviluppo effettuato con Node.js 24.

```powershell
npm.cmd ci
npm.cmd run dev
```

Apri http://127.0.0.1:3000. Il server e le sue API accettano esclusivamente l'accesso locale; non esporli tramite proxy, tunnel o cambiando semplicemente hostname.

```powershell
npm.cmd run build
npm.cmd start
```

Su Windows usa `npm.cmd` se l'esecuzione di `npm.ps1` e bloccata. Non servono chiavi AI per creare ricette.

## Versione statica e GitHub Pages

Il workflow `.github\workflows\pages.yml` pubblica il contenuto di `site\out` sul push a `main`. Il sito ha base path `/fit-chef` e non include API server, file `.data`, credenziali o piani personali.

```powershell
npm.cmd run build:static
```

HiGHS e i relativi asset vengono serviti dallo stesso sito, senza CDN esterne per il solver. La versione statica disabilita esplicitamente le funzioni AI a pagamento. Le illustrazioni editoriali locali sono disponibili anche senza un backend immagini.

Il manifest permette di aggiungere l'app alla schermata iniziale. Il service worker conserva le risorse statiche gia visitate per l'uso offline; login, Firebase e API non sono memorizzati nella sua cache. Il primo accesso e il primo caricamento del generatore richiedono rete.

## Configurazione Firebase

`src\lib\firebase-config.ts` contiene la configurazione pubblica dell'app FIT Chef. `.env.example` documenta gli override per un progetto differente; impostare tutti e sei i valori in modo coerente e ricompilare il sito.

1. Abilitare Google in Firebase Authentication.
2. Autorizzare i domini effettivi del sito, incluso il dominio GitHub Pages; per sviluppo locale usare `localhost` e `127.0.0.1`.
3. Aggiungere `firebase\fit-chef.rules.fragment` dentro il blocco `/databases/{database}/documents` delle regole Firestore esistenti.
4. Conservare le regole delle altre applicazioni. Non distribuire il frammento come se fosse un ruleset completo.
5. Accertarsi che nessuna regola piu ampia conceda accesso alla collezione FIT Chef: le autorizzazioni delle regole sovrapposte si sommano.

Le regole consentono lettura e scrittura del singolo documento solo al suo proprietario, vietano la lista della collezione e validano l'involucro del workspace. La cancellazione cloud scrive una tombstone senza dati personali, cosi i dispositivi con copie vecchie non ricreano automaticamente il documento.

Non e incluso un `firebase.json` che possa sovrascrivere accidentalmente le regole condivise. Per aggiornamenti amministrativi leggere e conservare prima il ruleset attivo del progetto.

## AI locale facoltativa

Copia `.env.example` in `.env.local` e configura esclusivamente le integrazioni desiderate.

- `FIT_ENABLE_AI=true` abilita le funzionalita AI del backend locale.
- `OPENAI_API_KEY` rimane esclusivamente sul server.
- `OPENAI_TEXT_MODEL` e `OPENAI_IMAGE_MODEL` selezionano i modelli.
- L'invio del piano richiede consenso in UI; l'immagine richiede una successiva azione esplicita.

L'AI non puo sostituire ingredienti, istruzioni critiche o nutrienti calcolati. Gli errori vengono mostrati e non trasformati in risultati inventati. Le API sono a consumo: configurare budget presso il fornitore.

Le immagini AI locali sono in `.data`: la sincronizzazione conserva i riferimenti, non carica i file su Firebase Storage. Il sito statico usa le illustrazioni; non promette di rendere disponibili sul telefono immagini conservate soltanto sul PC.

## Persistenza, limiti e privacy

Il browser conserva `fit-chef.workspace.v1`: piano, input, fino a 100 ricette e 50 preferiti. La diversita considera le ultime 30 ricette. Il documento cloud ha un limite applicativo di 900 KiB; un workspace troppo grande viene segnalato senza tagliare silenziosamente dati.

I dati locali, importati e ricevuti dal cloud sono validati. Dati incompatibili sospendono la sovrascrittura e possono essere esportati. Generare una ricetta o segnarla come cucinata non scala automaticamente le scorte.

L'azzeramento del workspace locale scollega Google e rimuove i metadati di sincronizzazione: non invia un workspace vuoto agli altri dispositivi. Conserva il cloud, le copie di sicurezza separate e i file esportati. La cancellazione cloud non elimina le copie locali ne l'identita Google/Firebase, condivisa con altre applicazioni del progetto. I backup locali sono separati dal workspace sincronizzato.

Il catalogo contiene stime medie: controllare etichette, allergeni, stato crudo/cotto e strumenti. Non si garantisce l'assenza di contaminazione crociata. Densita calorica e zuccheri aggiunti sconosciuti non vengono inventati. Gli obiettivi generali non determinano automaticamente il fabbisogno personale.

Questa e un'app personale, non una piattaforma clinica. Prima di offrirla commercialmente occorrono revisione nutrizionale, prove di cucina, informativa privacy, gestione della conservazione, cancellazione account e accordi con i fornitori. Per API pubbliche a pagamento servono autenticazione server, quote durevoli, rate limit condivisi e archivio immagini protetto.

## Sviluppo

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:e2e
```

I percorsi browser richiedono il server locale attivo; i test non chiamano integrazioni AI a pagamento. I test di sincronizzazione usano un trasporto controllato: non sostituiscono la configurazione e la verifica delle regole del progetto Firebase.

| Percorso | Responsabilita |
|---|---|
| `src\components\chef-app.tsx` | Workspace, navigazione e generazione |
| `src\components\weekly-diet.tsx` | Piano privato, calendario e conferme |
| `src\components\meal-composer.tsx` | Grammature fisse ed extra |
| `src\components\cloud-account.tsx` | Login, stato e risoluzione conflitti |
| `src\lib\cloud.ts` | Trasporto Firebase e transazioni |
| `src\lib\cloud-sync.ts` | Coordinamento automatico delle copie |
| `src\lib\cloud-merge.ts` | Fusione a tre vie |
| `src\lib\cloud-storage.ts` | Baseline per account e backup locali |
| `src\lib\catalog.ts` | Ingredienti e fonti nutrizionali |
| `src\lib\engine.ts` | Composizione, ottimizzazione e diversita |
| `src\lib\validation.ts` | Schemi condivisi |
| `src\lib\server` | Funzioni riservate al backend locale |
| `site` | Applicazione statica per GitHub Pages |
