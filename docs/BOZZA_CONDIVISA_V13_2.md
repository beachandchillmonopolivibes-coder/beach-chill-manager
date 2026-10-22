# Glow Arena 13.2 · preparare insieme il torneo

Due amministratori possono preparare lo stesso elenco di squadre online prima dell’avvio del torneo, mantenendo la vista pubblica disabilitata. Ogni persona accede con il proprio account; il proprietario assegna gli accessi al torneo.

## Aggiornamento in tre passaggi

### 1. Supabase: applica la migrazione prima del deploy

Dal pacchetto apri **`MIGRATION_SHARED_DRAFT_V13_2.sql`**, copia l’intero contenuto e, nel progetto Supabase già collegato all’app, apri **SQL Editor → New query → Run**. Esegui questo passaggio una volta per progetto, prima di pubblicare il nuovo frontend.

La migrazione aggiunge la funzione che crea la bozza online **privata fin dalla prima scrittura**, senza passare dalla precedente creazione con vista pubblica predefinita. I tornei già esistenti mantengono il loro attuale stato pubblico o privato: l’aggiornamento non li pubblica e non li nasconde automaticamente.

Se il database è precedente alla versione 11, applica prima gli aggiornamenti indicati in [Aggiornamento V11](AGGIORNAMENTO_V11.md). Per una prima installazione usa lo schema aggiornato del pacchetto e segui anche la [Guida Supabase + Vercel](GUIDA_SUPABASE_VERCEL.md).

### 2. GitHub e Vercel: aggiorna il pacchetto completo

Conserva un backup JSON del torneo da **Altro → Backup e ripristino → Esporta backup**. Estrai lo ZIP e copia **il contenuto della cartella con `package.json`, `index.html` e `vercel.json` nella radice del repository GitHub collegato a Vercel**, sovrascrivendo i file precedenti. Carica i file, non lo ZIP e non una cartella esterna che sposti la radice del progetto.

Pubblica il commit sul branch collegato a Vercel e attendi **Ready**. Mantieni build `npm run build`, output `dist` e le variabili di ambiente esistenti: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e gli eventuali valori predefiniti del torneo.

Aggiorna insieme anche `db.js`, `app.js`, `index.html`, i CSS, `sw.js`, manifest e gli altri file inclusi. La versione degli asset e della cache è **13.2**. Ricarica l’app; se l’hai installata come PWA, chiudila e riaprila. Una ricarica forzata aggiorna la grafica senza cancellare i dati del sito.

### 3. Accessi: stessa chiave torneo e account personali

1. Il proprietario accede all’app con il proprio username e password e sceglie una **chiave torneo**, per esempio `beach-chill-2026`.
2. La prima modifica a una squadra, effettuata da un utente autenticato, avvia automaticamente la creazione della **bozza online privata**, se il torneo non esiste ancora. Puoi anche usare il pulsante dedicato alla creazione della bozza nel pannello **Accesso & Live**. Attendi la conferma del salvataggio online.
3. In **Altro → Accesso & Live → Amministratori**, il proprietario aggiunge lo **username del collega già creato**. Per esempio, all’account tecnico `marco@admin.beachvolley.app` corrisponde lo username `marco`. Dopo averlo aggiunto, usa **“Copia link accesso admin”** e passa quel link al collega.
4. Il collega apre il link di accesso admin ed entra con **il proprio account e la stessa chiave torneo**. La chiave identifica il torneo; l’appartenenza agli amministratori autorizza a modificarlo.
5. Il proprietario verifica che **“Pubblica vista giocatori” sia disattivato**. La bozza è condivisa con gli amministratori autorizzati; l’app non abilita automaticamente il Live pubblico né all’inserimento delle squadre né all’avvio del torneo.

Se gli account sono già stati creati, **non serve altro SQL per aggiungere il collega**: il proprietario lo autorizza dal pannello Amministratori. Se manca l’account, crealo prima in **Supabase → Authentication → Users**, seguendo la [guida agli accessi](GUIDA_SUPABASE_VERCEL.md); poi aggiungi il suo username al torneo nell’app.

## Lavorare contemporaneamente

- Le modifiche alle squadre vengono accodate con una breve attesa di circa **600 ms** dalla digitazione. Il badge distingue la bozza conservata nel browser dal salvataggio online.
- Gli aggiornamenti degli altri admin arrivano tramite Realtime; un controllo ogni circa **3 secondi** offre un recupero aggiuntivo. Durante la digitazione l’app conserva il campo attivo e applica gli aggiornamenti compatibili.
- Le modifiche contemporanee a campi diversi dell’elenco vengono ricomposte quando possibile. Se entrambi modificate lo stesso campo in modi diversi, l’app protegge la bozza e richiede una risoluzione manuale del conflitto. Controlla il messaggio prima di scegliere quale versione conservare.
- Prima dell’avvio potete inserire e rimuovere le coppie e preparare la configurazione. Dopo l’avvio restano modificabili **nomi e punteggi**; organico, teste di serie, gironi e impostazioni restano protetti.
- Per confermare i punti dei set usate sempre **“Salva punteggio” nella singola partita**. Il salvataggio generale non conferma automaticamente le bozze dei punteggi.

Per una verifica pratica, il primo admin inserisce una coppia e attende la sincronizzazione; il secondo controlla la stessa coppia con il proprio account. Provate poi modifiche a due righe diverse. Infine il proprietario ricontrolla che il Live pubblico sia disabilitato.

## Calendario dei gironi

Con **due campi e due gironi**, le partite del **girone A sono programmate sul Campo 1** e quelle del **girone B sul Campo 2**. I due gironi avanzano in parallelo, quando sono disponibili incontri per lo stesso slot.

Con **più di due gironi**, il calendario alterna i gironi tra gli slot e usa i campi disponibili: la programmazione ruota tra i gruppi, invece di completare prima tutte le gare di A e poi quelle di B. La disponibilità delle squadre e i vincoli di orario restano rispettati.

Questa regola si applica **alla generazione di nuovi calendari**. Un torneo già avviato conserva le partite, i campi e gli orari esistenti: l’aggiornamento non azzera e non riprogramma automaticamente un torneo in corso.

## Verifica e limiti

Sono passati **78 test automatici**, inclusi 16 nuovi casi sulla persistenza e collaborazione tra admin, 5 sulla creazione privata e 8 sulla pianificazione dei gironi.

Nel browser, con backend simulato, è stata provata una sessione con due amministratori: la prima squadra crea la bozza privata, il proprietario aggiunge il collega dal pannello, il collega inserisce un’altra squadra e il proprietario la riceve senza ricaricare la pagina, anche mantenendo selezionato il campo di ricerca. La vista pubblica resta disabilitata per entrambi.

La visita pubblica della bozza è risultata non disponibile. È stato inoltre generato un torneo con 8 squadre, due gironi e due campi: tutte le 12 gare dei gironi rispettavano A sul Campo 1 e B sul Campo 2, con orari paralleli.

Le prove locali e i backend simulati verificano i flussi dell’app, ma non attestano un accesso o una sincronizzazione sul tuo progetto Supabase reale, né un deployment sul tuo account Vercel. Dopo l’aggiornamento verifica i due account, la stessa chiave torneo, i relativi permessi e il salvataggio sul sito pubblicato.
