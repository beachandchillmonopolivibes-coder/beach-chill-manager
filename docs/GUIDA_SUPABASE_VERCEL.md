# Guida precisa · Supabase, Vercel e amministratori

Beach & Chill Tournament Manager Pro 11 — 22 ottobre 2026.

Questa guida pubblica il frontend su Vercel e usa Supabase per utenti, dati e aggiornamenti Live. Il pacchetto non crea automaticamente risorse nei tuoi account e non contiene password o credenziali di un progetto pronto all’uso.

## 1. Cosa preparare

- Un account [Supabase](https://supabase.com/dashboard) e un progetto.
- Un account [Vercel](https://vercel.com/) e, per il percorso consigliato, un repository GitHub/GitLab/Bitbucket con i file di questo pacchetto.
- Un nome e una chiave torneo, per esempio `Beach & Chill 2026` e `beach-chill-2026`.
- Un account personale per ogni organizzatore. Esempio: `paolo`, `giulia`, `marco`.

La chiave torneo identifica l’evento; non è una password. Il link Live può essere inoltrato dal pubblico e non deve essere usato per informazioni riservate.

## 2. Supabase: nuovo progetto

1. In Supabase crea il progetto nell’organizzazione desiderata, scegli la regione e imposta una password del database conservandola nel tuo gestore di password.
2. Aspetta che il progetto sia operativo.
3. Apri **SQL Editor → New query**.
4. Apri il file `schema.sql` del pacchetto, copia tutto il contenuto nella query ed esegui **Run**.
5. Verifica che in **Table Editor** compaiano `tournaments` e `tournament_members`.
6. Controlla nella sezione delle pubblicazioni/replication che `public.tournaments` appartenga alla pubblicazione `supabase_realtime`. Lo schema lo imposta già; controllalo se Live non si aggiorna.

`schema.sql` comprende i controlli della versione 11: autorizzazioni, salvataggio con revisione e blocco della struttura dopo l’avvio. Non occorre eseguire anche la migrazione V11 su una nuova installazione.

**Se usi già il database della vecchia app**, segui invece [AGGIORNAMENTO_V11.md](AGGIORNAMENTO_V11.md). Non cancellare tabelle o utenti e non importare un backup sopra un torneo avviato.

## 3. Supabase: impostazioni di autenticazione

1. Apri **Authentication → Sign In / Providers** o la sezione equivalente delle impostazioni Auth.
2. Lascia attivo il provider **Email/password**.
3. Disabilita **Allow new users to sign up**: gli account vengono creati dall’organizzatore nel dashboard, senza registrazione pubblica.
4. Lascia disattivato l’accesso anonimo agli account Auth. Il pubblico Live usa la chiave pubblica con permessi di sola lettura: non gli serve un utente anonimo.
5. In **URL Configuration** imposta come **Site URL** l’URL Vercel di produzione, una volta ottenuto. Il flusso attuale usa login con password e non richiede callback Magic Link.

La creazione manuale degli utenti confermati descritta sotto permette di mantenere la conferma email prevista dalle tue impostazioni generali. Non serve configurare SMTP per questo flusso: gli indirizzi tecnici non sono caselle a cui inviare inviti o recuperi password.

## 4. Crea il primo utente amministratore

1. Vai in **Authentication → Users**.
2. Premi **Add user → Create new user** (i nomi possono variare leggermente nel dashboard).
3. Inserisci l’email tecnica `paolo@admin.beachvolley.app`.
4. Imposta una password unica e robusta e abilita **Auto Confirm User**, se l’opzione è presente. Controlla che l’utente risulti confermato.
5. Salva e conserva la password in modo sicuro.

Nell’app Paolo inserirà **username `paolo`**, non l’intero indirizzo email, e la password impostata. Lo username può contenere da 3 a 32 caratteri: lettere minuscole, numeri, punto, trattino e underscore; deve iniziare con una lettera o un numero. Il dominio tecnico deve restare esattamente `admin.beachvolley.app`: è condiviso da frontend e funzioni SQL.

La creazione dell’utente Auth abilita il login, ma **non assegna automaticamente l’accesso a un torneo già esistente**. Chi crea un nuovo torneo nell’app ne diventa proprietario; gli altri devono essere aggiunti a quel torneo dal proprietario.

## 5. Recupera la configurazione pubblica

Nel dashboard Supabase apri **Connect** oppure **Settings → API Keys** e copia:

- il **Project URL**, per esempio `https://il-tuo-project-ref.supabase.co`;
- una **Publishable key** che inizi con `sb_publishable_`.

Il Project URL non deve terminare con `/rest/v1` o contenere una password. Questo pacchetto richiede una Publishable key moderna per il build. Per un progetto vecchio crea le nuove API keys dal dashboard se non sono ancora disponibili.

La Publishable key sarà leggibile nel browser: l’accesso ai dati dipende dalle policy e dalle funzioni SQL, non dal nascondere questa chiave. Le chiavi secret e `service_role` hanno privilegi elevati e non devono essere inserite nei file frontend, nel repository o nelle variabili usate per generare la configurazione pubblica.

## 6. Pubblica su Vercel dal repository

### Prepara il repository

1. Estrai il pacchetto.
2. Apri la cartella che contiene `index.html`, `package.json`, `vercel.json` e `schema.sql`.
3. Carica questi file in un repository Git privato o pubblico. Non aggiungere `.env`, `node_modules/`, `dist/` o backup di tornei al repository. Il `.gitignore` è già preparato.
4. Non caricare la cartella compressa come unico file: Vercel deve vedere `package.json` e i sorgenti.

### Importa e configura

1. In Vercel scegli **Add New → Project** e importa il repository.
2. Se il repository contiene una cartella esterna, imposta **Root Directory** sulla cartella che contiene `package.json`.
3. Controlla le impostazioni:

| Impostazione | Valore |
| --- | --- |
| Framework Preset | `Other` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm ci` oppure rilevamento automatico npm |
| Node.js | 22 o successivo supportato da Vercel |

`vercel.json` include già build e output. Non lasciare un vecchio preset Next.js/React ereditato da un progetto precedente. La cartella `dist` viene creata dal build: non devi prepararla manualmente.

### Aggiungi le variabili

Prima di premere Deploy, nella sezione **Environment Variables** aggiungi:

| Nome esatto | Esempio da sostituire | Necessità |
| --- | --- | --- |
| `SUPABASE_URL` | `https://il-tuo-project-ref.supabase.co` | Obbligatoria |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_valore-del-tuo-progetto` | Obbligatoria |
| `DEFAULT_TOURNAMENT_SLUG` | `beach-chill-2026` | Facoltativa |
| `DEFAULT_TOURNAMENT_NAME` | `Beach & Chill 2026` | Facoltativa |

Seleziona **Production**. Per una preview connessa abilita anche **Preview**; usa un progetto Supabase di prova se vuoi isolare i test dai dati reali. Le preview che puntano allo stesso Supabase vedono e modificano gli stessi tornei autorizzati.

La chiave proposta deve contenere 3–50 caratteri minuscoli, numeri e trattini e iniziare con un carattere alfanumerico. Il nome proposto deve contenere 1–160 caratteri. Questi valori sono suggerimenti per l’interfaccia: cambiare `DEFAULT_TOURNAMENT_SLUG` non rinomina un torneo già salvato e non ne cambia l’identificativo.

4. Premi **Deploy**.
5. Attendi lo stato **Ready** e apri l’URL HTTPS.
6. Torna in Supabase e aggiorna il Site URL con il dominio di produzione.
7. Se cambi una variabile in seguito, esegui un **nuovo deployment/redeploy**: una modifica non aggiorna i file già pubblicati.

Il build interrompe il deploy se URL o chiave obbligatori mancano, se viene inserita una chiave segreta o se l’URL è malformato. Leggi il primo errore nei Build Logs e correggi la variabile. Non risolvere rimuovendo i controlli.

### Alternativa con Vercel CLI

Dalla stessa cartella, con Node.js disponibile:

```sh
npm ci
npm test
npx vercel login
npx vercel link
npx vercel env add SUPABASE_URL production
npx vercel env add SUPABASE_PUBLISHABLE_KEY production
npx vercel env add DEFAULT_TOURNAMENT_SLUG production
npx vercel env add DEFAULT_TOURNAMENT_NAME production
npx vercel --prod
```

Inserisci i valori quando la CLI li richiede. Non scrivere password o token di accesso nei comandi da condividere. `vercel link` deve selezionare il progetto Vercel corretto se stai aggiornando un sito esistente.

## 7. Crea il torneo e assegna altri admin

1. Apri l’URL normale del sito, senza `live=1`.
2. Inserisci la chiave torneo, lo username `paolo` e la password.
3. Se la chiave non corrisponde a un torneo esistente accessibile, usa il modulo di creazione con nome e chiave desiderati. Se stai già lavorando su un evento e vuoi crearne un altro, in **Altro** premi **Nuovo torneo**.
4. Premi **Attiva torneo online**: il tuo utente diventa **Proprietario** di quel torneo. Un evento precedente resta accessibile dal suo link con la relativa chiave.
5. In Supabase crea il secondo account, ad esempio `giulia@admin.beachvolley.app`, con password propria e utente confermato.
6. Nell’app, come proprietario, apri **Altro → Accesso & Live → Gestione amministratori**, inserisci `giulia` e premi **Aggiungi**.
7. Giulia apre lo stesso sito, usa la **stessa chiave torneo** e accede con il proprio username e la propria password.

| Ruolo | Permessi |
| --- | --- |
| Proprietario (`owner`) | Gestisce il torneo, concede/rimuove admin, abilita/disabilita Live |
| Amministratore (`editor`) | Gestisce squadre e configurazione prima dell’avvio; nomi, risultati e avanzamento dopo l’avvio |
| Pubblico Live | Consulta risultati, classifiche e tabellone se il proprietario abilita la vista giocatori |
| Utente Auth senza appartenenza | Non modifica il torneo; l’eventuale accesso pubblico resta sola lettura |

Per revocare l’accesso a un torneo, il proprietario usa **Rimuovi** nella gestione amministratori. Non eliminare l’utente Auth del proprietario dal dashboard: il database usa un collegamento con eliminazione a cascata e la cancellazione dell’account può cancellare i tornei di cui è proprietario. Per recuperare l’accesso o cambiare password usa il dashboard Supabase con il tuo account di gestione del progetto; l’app non invia email di recupero agli indirizzi tecnici.

## 8. Prepara squadre e avvia

Apri la pagina **Squadre**, inserisci o modifica le coppie partecipanti (nome da 1 a 120 caratteri) e verifica che non rimangano squadre dimostrative. Configura formato, eventuali gironi manuali, teste di serie, campi e orari. Controlla l’organico insieme a un secondo operatore.

**Il primo avvio blocca iscrizioni e struttura.** Da quel momento sono consentiti nomi delle squadre, punteggi e avanzamento delle fasi. Non si aggiungono o rimuovono partecipanti, non si modificano teste di serie, assegnazioni dei gironi o formato. Il blocco è applicato anche nel database. Per una nuova lista partecipanti crea un nuovo torneo con una chiave diversa.

Per il dettaglio di risultati, avanzamento e correzioni leggi il [Manuale operativo](MANUALE_OPERATIVO.md).

## 9. Condividi la vista Live

Come proprietario abilita **Abilita vista giocatori** nella sezione **Accesso & Live** e copia il **Link Live per giocatori**. Il link contiene la chiave e `live=1`.

Aprilo in una finestra privata senza login: deve mostrare solo le informazioni Live. Non distribuire il link amministrativo con credenziali. Se vuoi una vista completamente privata disabilita la lettura pubblica; cambiare solo la chiave o nascondere un pulsante non sostituisce i permessi del database.

La lettura pubblica rende accessibile lo stato del torneo agli utenti non autenticati. Inserisci solo i dati necessari al torneo: nomi sportivi e risultati. Non mettere telefoni, email, annotazioni riservate o credenziali nei nomi delle squadre o nei backup da condividere.

## 10. Collaudo sul tuo progetto prima dell’evento

Esegui la prova su un torneo separato, per esempio `collaudo-beach-2026`.

1. Proprietario su computer, secondo admin su telefono, link Live in finestra privata.
2. Prima dell’avvio inserisci e modifica una squadra. Verifica l’aggiornamento sul secondo admin.
3. Avvia il torneo e verifica che aggiunta/rimozione di squadre e modifica del formato siano bloccate.
4. Correggi il nome di una squadra: deve aggiornarsi anche nelle partite già presenti.
5. Inserisci un risultato valido, premi **Salva punteggio** e controlla gli altri dispositivi.
6. Completa una fase e avanza alla successiva.
7. Correggi un risultato precedente che cambia una qualificazione: controlla la richiesta di conferma e l’annullamento dei turni successivi. Rigenera l’avanzamento dalla fase corretta.
8. Verifica che il link Live non consenta modifiche e che un utente senza appartenenza non possa salvare.
9. Revoca il secondo admin e verifica con un nuovo accesso che non possa più modificare il torneo.
10. Ricarica la pagina e chiudi/riapri il browser; confronta i punteggi con il database. Esporta un backup JSON.

I test automatici inclusi verificano casi locali; questa prova controlla configurazione reale, Auth, permessi, rete e dispositivi.

## 11. Problemi comuni

| Sintomo | Controllo e soluzione |
| --- | --- |
| Deploy fallisce per configurazione | Verifica variabili Production/Preview, prefisso `sb_publishable_`, URL senza `/rest/v1`; poi redeploy |
| Pagina 404 o build non trovato | Root Directory con `package.json`; preset Other; build `npm run build`; output `dist` |
| Login rifiutato | Username senza `@`, password corretta, account confermato, email tecnica nel progetto Supabase collegato |
| Login riuscito ma non posso modificare | Usa la chiave corretta; chiedi al proprietario di aggiungere lo username a quel torneo |
| `admin_not_found` | Crea prima l’utente Auth confermato con dominio esatto, poi aggiungilo nell’app |
| Funzione RPC mancante / schema vecchio | Esegui lo schema per nuovo database o la migrazione V11 per database esistente, seguendo l’ordine previsto |
| Live non si aggiorna | Verifica connessione, lettura pubblica, pubblicazione `supabase_realtime` e tabella `tournaments`; prova un ricaricamento |
| Vedo ancora la vecchia interfaccia | Verifica l’URL del deployment di produzione; ricarica, chiudi la PWA; solo dopo backup elimina la vecchia cache del sito |
| Punteggio non accettato | Controlla formato della fase, punteggio intero, margine di due punti e numero di set |
| Conflitto fra due admin | Controlla gli ultimi dati, ricarica/risolvi il conflitto e reinserisci il risultato verificato; non sovrascrivere alla cieca |
| Sito protetto da Vercel login | Controlla Deployment Protection; il link pubblico deve essere raggiungibile dai giocatori secondo le tue impostazioni |

Non disabilitare RLS per risolvere un problema: verifica schema, appartenenza e configurazione corretti.

## Riferimenti ufficiali verificati il 22 ottobre 2026

- [Supabase: API keys e differenza tra Publishable e Secret](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase: configurazione generale Auth](https://supabase.com/docs/guides/auth/general-configuration)
- [Supabase: autenticazione con password](https://supabase.com/docs/guides/auth/passwords)
- [Supabase: gestione utenti](https://supabase.com/docs/guides/auth/managing-user-data)
- [Supabase: Postgres Changes e pubblicazioni Realtime](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Vercel: Build Command e Output Directory](https://vercel.com/docs/builds/configure-a-build)
- [Vercel: gestione delle variabili di ambiente](https://vercel.com/docs/environment-variables/managing-environment-variables)
- [Vercel: deploy dalla CLI](https://vercel.com/docs/projects/deploy-from-cli)

Le etichette del dashboard possono cambiare; i nomi di variabili, file e funzioni riportati corrispondono a questo pacchetto.
