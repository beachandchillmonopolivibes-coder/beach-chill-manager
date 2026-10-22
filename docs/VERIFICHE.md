# Verifiche della versione 11

Data: 22 ottobre 2026.

## Correzione aggiuntiva dell’indicatore di connessione

Il badge iniziale poteva restare su “Locale” anche con Supabase configurato quando non era ancora stato caricato un torneo; inoltre la creazione non lo aggiornava subito. Ora mostra “Connessione…”, “Login richiesto”, “Crea o apri torneo”, “Torneo non disponibile” o “Online” secondo il caso. “Locale” è riservato alla modalità senza configurazione Supabase. È stato corretto anche il ripristino della scheda precedente: quando serve il login rimane visibile la pagina di accesso, anche dopo il ritorno all’app. Per applicare questa correzione al sito già pubblicato basta sostituire `app.js` con quello di questo pacchetto e attendere il nuovo deployment. Non occorrono migrazioni SQL.

## Correzione dello svuotamento dell’esempio

“Svuota” accanto a “Carica esempio” pulisce subito il testo da importare, la relativa anteprima e il selettore delle TS; il caricamento rimane disabilitato finché non si inserisce un nuovo elenco valido. Le squadre già caricate hanno il comando esplicito “Svuota squadre”, con conferma e verifica del blocco all’avvio. Per applicare questa modifica sostituire entrambi `app.js` e `index.html` nel repository.

## Problemi corretti

- Importazione di backup con gare o partecipanti inesistenti: verifica completa prima di sostituire lo stato e attivare il blocco del torneo.
- Nomi delle squadre bloccati dopo la generazione: ora la pagina Squadre permette la rinomina in ogni fase.
- Possibile riapertura delle iscrizioni mediante reset/rigenerazione: struttura e organico restano bloccati dal primo avvio, nell’interfaccia e nel database.
- Punteggi negativi, decimali, set ai vantaggi impossibili e set fuori sequenza: validazione prima del salvataggio.
- Campioni non aggiornati in alcuni casi di doppia eliminazione: ricalcolo immediato.
- Correzioni di risultati precedenti con qualificazioni non aggiornate: conferma e invalidazione delle fasi successive quando necessaria.
- Sovrascrittura automatica di modifiche di altri admin: controllo della revisione, conservazione della bozza e risoluzione esplicita.
- Bozze non sincronizzate perse al ricaricamento: recupero dello stato salvato localmente, associato a torneo e utente, con controllo della revisione originale.
- Dati locali di un torneo remoto non più accessibile mostrati al pubblico: caricamento senza usare quei dati come ripiego.
- Richieste di aggiornamento pendenti che potevano sostituire modifiche più recenti: controllo della richiesta, della versione locale e dei permessi.
- Collisioni nel calendario e gare accatastate a fine giornata: occupazione effettiva di campi/squadre e avvisi sulle gare senza slot disponibile.
- Import da Excel che poteva perdere il secondo giocatore, troncare oltre 24 coppie o ignorare duplicati: anteprima e rifiuto degli elenchi da correggere.
- Cache PWA troppo ampia e risposte HTML usate al posto di risorse mancanti: elenco ristretto di risorse dell’app e ripiego HTML solo per la navigazione.
- Configurazione pubblica legata al precedente progetto: variabili di build validate, senza credenziali incorporate.
- Sovrapposizione nome/TS su telefono: campi separati e controllo del layout.

## Esito finale

- **38/38 test automatici** superati (motore, database, configurazione/build e contratti dell’interfaccia).
- **17/17 scenari browser** superati su Chromium 153, desktop e smartphone simulato.
- **930 simulazioni complete di torneo**, comprese nella suite del motore, e controllo dei backup generati.
- Build locale e build con configurazione di produzione validate.
- Layout delle squadre e dei punteggi verificato visivamente in tema chiaro e scuro.
- Annullamento ed Escape nelle conferme verificati anche dopo una precedente conferma accettata.

## Riprodurre le verifiche

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
npm run build
```

I test del motore comprendono 930 simulazioni complete delle formule e delle configurazioni supportate. I test SQL eseguono le funzioni e le policy con PostgreSQL embedded/PGlite e ruoli Auth simulati; i test del browser usano Chromium reale e bloccano richieste esterne. Le prove comprendono nomi e punteggi, correzioni delle fasi, blocco delle iscrizioni, import, conflitti fra admin, recupero bozze e layout desktop/mobile chiaro/scuro.

## Collaudo dopo il deploy

Non sono stati creati utenti o risorse nei tuoi account e non è stato contattato il progetto Supabase originariamente configurato. Auth, Realtime e dominio pubblico devono essere collaudati nell’ambiente effettivo seguendo la checklist della guida Supabase/Vercel. Le verifiche automatiche coprono i casi elencati; non equivalgono a una garanzia di assenza di qualsiasi difetto futuro.
