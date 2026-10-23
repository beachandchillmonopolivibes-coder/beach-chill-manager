# Beach & Chill · Glow Arena 13.3.2

Applicazione web responsive per organizzare tornei di beach volley, gestire squadre e risultati e condividere la vista Live con i giocatori. Frontend statico su Vercel; autenticazione, database e aggiornamenti su Supabase.

## Parti da qui

La **13.3.2 corregge il pulsante di importazione e rende operativo “Azzera risultati” anche per un torneo avviato e pubblicato**, con conferma, backup locale e protezione dalle modifiche contemporanee. Segui **[Correzioni reset e importazione 13.3.2](docs/CORREZIONI_RESET_IMPORT_13_3_2.md)** per aggiornare il pacchetto e scegliere il comando adatto.

Lo ZIP contiene i file direttamente nella radice, pronti per GitHub. **Se hai già applicato l’aggiornamento SQL della 13.3, non serve nuovo SQL**. Se manca, esegui l’intero `00_AGGIORNAMENTO_SUPABASE.sql` come descritto nella [guida di installazione](docs/INSTALLAZIONE_13_3_1.md), poi aggiorna tutti i file su GitHub/Vercel. Per verificare il deployment cerca nell’app **`v13.3.2`**.

Il proprietario può eliminare esplicitamente il tabellone anche dopo l’avvio e la pubblicazione, con conferma e backup locale obbligatorio. Il torneo torna una bozza privata, conservando squadre, impostazioni, chiave e accessi admin. La **[guida all’eliminazione del tabellone](docs/ELIMINAZIONE_TABELLONE_V13_3.md)** descrive la funzione; per installare questa versione segui la guida corrente sopra, che specifica quando il file SQL unico è necessario.

La bozza privata condivisa tra admin della 13.2 è inclusa: consulta **[Bozza condivisa e accessi](docs/BOZZA_CONDIVISA_V13_2.md)** per lavorare sullo stesso torneo con account personali.

Il calendario dei nuovi tornei fa avanzare i gironi in parallelo: con due campi e due gironi usa Campo 1 per A e Campo 2 per B; con più gironi alterna i gruppi tra gli slot. I tornei già avviati conservano il calendario esistente.

La correzione dei salvataggi della 13.1 è inclusa: la relativa [guida](docs/CORREZIONE_SALVATAGGI_V13_1.md) spiega salvataggio locale, sincronizzazione online e conferma dei punteggi. Per installare la **13.3.2** segui la guida corrente sopra.

1. Leggi **[Guida Supabase + Vercel](docs/GUIDA_SUPABASE_VERCEL.md)** per installazione, amministratori e pubblicazione.
2. Per un database precedente alla 11 segui prima **[Aggiornamento senza perdita di dati](docs/AGGIORNAMENTO_V11.md)**, poi usa **[Correzioni 13.3.2](docs/CORREZIONI_RESET_IMPORT_13_3_2.md)** e il file SQL unico prima del deploy.
3. Segui **[Manuale operativo](docs/MANUALE_OPERATIVO.md)** per iscrizioni, avvio, punteggi e correzioni.

## Regola operativa del torneo

**Prima dell’avvio** puoi preparare squadre, teste di serie, gironi, formula e impostazioni. **Dal primo avvio** l’organico e la struttura sono bloccati: si possono correggere nomi delle squadre e punteggi in qualsiasi fase, oltre ad avanzare il torneo. Una correzione che cambia gli accoppiamenti richiede conferma e annulla i turni successivi interessati. Per ripartire con lo stesso torneo il proprietario può usare **Altro → Reset → Elimina tabellone**, con conferma e backup: questa operazione esplicita riapre la preparazione e disattiva il Live pubblico. Le normali modifiche al torneo avviato mantengono i blocchi descritti sopra.

Gli accessi sono individuali: il proprietario gestisce gli amministratori; gli amministratori autorizzati gestiscono il torneo; il link Live permette sola lettura. Il database applica i controlli di accesso e il blocco della struttura anche alle chiamate dirette.

## Funzioni

- Pagina dedicata all’inserimento e alla modifica delle squadre.
- Gironi + playoff Gold, Silver opzionale, Gold a 4/6/8; girone unico + Final Four; eliminazione diretta; doppia eliminazione.
- Composizione manuale o sorteggio riproducibile con teste di serie.
- Calendario dei gironi in parallelo, con rotazione dei gruppi sugli slot disponibili.
- Formati distinti per gironi, turni eliminatori e semifinali; finali 21/21/15.
- Risultati con validazione, classifiche, tabelloni e avanzamento dei turni.
- Backup JSON e vista Live per pubblico e giocatori.
- Azzera risultati e cancellazione esplicita del tabellone riservati al proprietario online, con conferma e backup locale prima dell’operazione.
- Interfaccia adattata a telefono e desktop, temi chiaro/scuro, installazione PWA.

## Prova locale

Richiede Node.js 22 o successivo.

```sh
npm ci
npm test
npm run dev
```

Apri `http://localhost:4173`. Con `config.js` vuoto l’app funziona in modalità dimostrativa locale: nessun account, nessuna condivisione fra dispositivi. Questa modalità serve a provare l’interfaccia e le formule.

Per un’anteprima collegata al tuo Supabase, copia `.env.example` in `.env`, compila i quattro valori pubblici e usa:

```sh
node --env-file=.env scripts/build.cjs
npm start
```

Il build produce `dist/` con i soli file dell’app, incluso il client Supabase 2.118.0 distribuito localmente in `vendor/`. La relativa licenza è inclusa. `scripts/serve.cjs` è un server di anteprima locale. Vercel pubblica `dist/` e usa le impostazioni in `vercel.json`.

## Configurazione

| Variabile Vercel | Valore |
| --- | --- |
| `SUPABASE_URL` | URL HTTPS del tuo progetto, senza `/rest/v1` |
| `SUPABASE_PUBLISHABLE_KEY` | Chiave pubblica `sb_publishable_...` |
| `DEFAULT_TOURNAMENT_SLUG` | Chiave proposta al login, per esempio `beach-chill-2026` |
| `DEFAULT_TOURNAMENT_NAME` | Nome proposto, per esempio `Beach & Chill 2026` |

Le prime due variabili sono obbligatorie per il deploy Vercel. Le ultime due sono facoltative. Non inserire password, chiavi `sb_secret_...` o `service_role`: il frontend usa esclusivamente configurazione pubblica. Il dominio tecnico degli utenti resta `admin.beachvolley.app`, coerente con le funzioni SQL.

## Verifica e limiti

`npm test` esegue i test del motore, del build e del database locale inclusi nel pacchetto. I test SQL usano PostgreSQL tramite PGlite, installato solo per lo sviluppo. Per le prove dell’interfaccia con Chromium:

```sh
npx playwright install chromium
npm run test:browser
```

Il test browser richiede il browser installato e avvia il server locale secondo il runner incluso. La prova su un progetto Supabase reale e su dispositivi connessi resta necessaria prima dell’evento; la procedura è nella guida.

Non condividere password tra operatori. In caso di connessione instabile controlla lo stato di salvataggio e conserva un backup. Orari e capacità della giornata sono una stima basata sulla durata degli slot, non una garanzia sui tempi reali delle partite.

Documentazione e configurazione preparate il **22 ottobre 2026**. Per installazione e gestione usa i documenti della versione 11 qui collegati.
