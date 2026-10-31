# Interpretazione dei pasti

## Comportamento disponibile anche nella versione statica

Il testo viene suddiviso in voci e confrontato con l'intero catalogo e con gli alimenti personali. Un nome confermato può essere ricordato nell'alimento tramite `mealAliases` (opzionale, massimo 20 nomi). Le associazioni sopravvivono al salvataggio/export/cloud; le quantità vengono sempre lette dal nuovo testo, mai ricordate come se fossero quelle del pasto attuale.

- Massa esplicita: g/gr/grammi, hg/etti, kg; virgola decimale e peso dopo il nome.
- Pezzi, fette, bicchieri e altre unità: conserva il conteggio ma richiede un peso confermato. Non equipara automaticamente ml e g.
- Un alimento noto senza peso chiede solo la quantità. La porzione suggerita dal catalogo è dichiarata indicativa e mostra lo stato crudo/cotto.
- Un nome incerto mostra candidati, anche con piccoli errori ortografici. La scelta non viene fatta automaticamente.
- Un piatto composto sconosciuto non viene sostituito da un solo ingrediente (per esempio pasta al pesto ≠ pasta secca).
- La ricerca online, attivata da un pulsante, invia solo il nome da cercare a Open Food Facts. I risultati devono avere nutrienti completi per 100 g, fibra compresa. Valori mancanti, per 100 ml e negativi vengono esclusi. Nessuna ricerca a ogni tasto: cache 10 minuti e massimo 5 ricerche/minuto nella sessione.
- I risultati Open Food Facts sono prodotti confezionati da confermare, non ricette equivalenti a un piatto fatto in casa. Sono dati collaborativi, non verificati, con provenienza ODbL visibile.
- Tutte le voci irrisolte impediscono la registrazione. Modifiche al testo annullano richieste e anteprime; modifiche nella scheda invalidano soltanto quella voce.

Il modello della torta rustica rimane un caso guidato sfoglia + ricotta. Non viene proposto automaticamente quando ci sono altri ingredienti o parole fuori dal suo modello. Le altre preparazioni possono essere cercate o associate a un alimento/ricetta già salvato: la versione statica non conosce qualsiasi ricetta.

## Interpretazione AI

`POST /api/meal-language` usa il provider e la configurazione server già presenti (`FIT_ENABLE_AI`, `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL`). Non modifica i valori nutrizionali né inventa quantità: produce soltanto segmenti del testo e nomi da cercare, con output JSON strutturato.

La concatenazione dei segmenti deve ricostruire esattamente il testo originale. I segmenti di contesto possono contenere solo connettivi/introduzioni ammessi, non alimenti. Risposte incomplete, rifiuti, JSON invalido o omissioni fanno tornare alla revisione locale. I nomi suggeriti dal modello migliorano la ricerca, ma non autorizzano a sostituire automaticamente un alimento non riconosciuto nel testo originale.

La UI mostra il consenso solo quando `/api/config` dichiara il servizio disponibile. Viene inviata soltanto la descrizione, non il profilo, gli alimenti salvati o il diario. La chiave resta sul server. Endpoint soggetto alle protezioni esistenti: origine locale, consenso esplicito, corpo limitato, quote globali/sessione, timeout e concorrenza limitata.

**Limite di distribuzione:** GitHub Pages esporta HTML/JS e non esegue questa API. La parte AI non è attiva sul sito pubblico semplicemente unendo questa PR. Il backend esistente rifiuta intenzionalmente host remoti: per una distribuzione pubblica servono hosting server, autenticazione server e quote persistenti prima di rimuovere quel vincolo. Nessuna chiave deve essere inserita in `NEXT_PUBLIC_*`. L'implementazione non dichiara né presume che tale servizio sia stato attivato.

## Fonti tecniche

- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat
- Open Food Facts API e limiti: https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/
- Ricerca testuale: https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/ref-cheatsheet/

La ricerca utilizza `/cgi/search.pl`, endpoint legacy che supporta il testo libero. Le API v2/v3 di ricerca non supportano questo campo; l'adattatore è isolato per consentire la migrazione a Search-a-licious senza cambiare il flusso.

## Verifica

Test unitari per quantità, corrispondenze, errori ortografici, ricette composte, memoria dei nomi, validazione dei segmenti AI, API e risposte di ricerca. Test browser desktop/mobile per conferma della sola quantità mancante, ricerca con dati sintetici, persistenza, consenso AI e risposte obsolete. I test di provider e Open Food Facts usano risposte simulate: non dimostrano disponibilità/qualità di un servizio live e non effettuano chiamate AI a pagamento.
