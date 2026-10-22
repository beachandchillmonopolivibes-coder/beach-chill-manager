# Beach & Chill · Tournament Manager Pro 11

Applicazione web responsive per organizzare tornei di beach volley, gestire squadre e risultati e condividere la vista Live con i giocatori. Frontend statico su Vercel; autenticazione, database e aggiornamenti su Supabase.

## Parti da qui

1. Leggi **[Guida Supabase + Vercel](docs/GUIDA_SUPABASE_VERCEL.md)** per installazione, amministratori e pubblicazione.
2. Per un database esistente segui **[Aggiornamento senza perdita di dati](docs/AGGIORNAMENTO_V11.md)** prima del deploy.
3. Segui **[Manuale operativo](docs/MANUALE_OPERATIVO.md)** per iscrizioni, avvio, punteggi e correzioni.

## Regola operativa della versione 11

**Prima dell’avvio** puoi preparare squadre, teste di serie, gironi, formula e impostazioni. **Dal primo avvio** l’organico e la struttura sono bloccati: si possono correggere nomi delle squadre e punteggi in qualsiasi fase, oltre ad avanzare il torneo. Una correzione che cambia gli accoppiamenti richiede conferma e annulla i turni successivi interessati. Per un organico diverso crea un nuovo torneo.

Gli accessi sono individuali: il proprietario gestisce gli amministratori; gli amministratori autorizzati gestiscono il torneo; il link Live permette sola lettura. Il database applica i controlli di accesso e il blocco della struttura anche alle chiamate dirette.

## Funzioni

- Pagina dedicata all’inserimento e alla modifica delle squadre.
- Gironi + playoff Gold, Silver opzionale, Gold a 4/6/8; girone unico + Final Four; eliminazione diretta; doppia eliminazione.
- Composizione manuale o sorteggio riproducibile con teste di serie.
- Formati distinti per gironi, turni eliminatori e semifinali; finali 21/21/15.
- Risultati con validazione, classifiche, tabelloni e avanzamento dei turni.
- Backup JSON e vista Live per pubblico e giocatori.
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
