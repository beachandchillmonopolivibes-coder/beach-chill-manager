# Installazione completa · Glow Arena 13.3.1

Questa procedura aggiorna l’app già collegata al tuo progetto Supabase. Il pacchetto mantiene tutte le funzioni della 13.3 e riunisce gli aggiornamenti SQL della 13.2 e della 13.3 in **`00_AGGIORNAMENTO_SUPABASE.sql`**. Per una prima installazione su un progetto vuoto segui invece anche la [Guida Supabase + Vercel](GUIDA_SUPABASE_VERCEL.md).

## 1. Scarica ed estrai il pacchetto

Scarica lo ZIP e decomprimilo sul computer. I file **`package.json`, `index.html` e `vercel.json` sono direttamente nella radice dello ZIP**, insieme alle cartelle `docs`, `scripts`, `tests` e `vendor`. Non serve aprire una cartella esterna con il nome del pacchetto.

Conserva un backup JSON del torneo prima dell’aggiornamento, usando **Altro → Backup e ripristino → Esporta backup**.

## 2. Esegui il file SQL intero

1. Apri il file scaricato **`00_AGGIORNAMENTO_SUPABASE.sql` in un editor di testo**. Usa **Ctrl+A** su Windows/Linux o **Cmd+A** su Mac, poi copia tutto. Copia dal file aperto sul computer, evitando una selezione parziale nell’anteprima.
2. Apri il progetto corretto in **Supabase → SQL Editor → New query**. La query deve essere **nuova e completamente vuota**.
3. Incolla tutto il file. Non riutilizzare il vecchio frammento: rimuovi eventuali righe aggiunte separatamente, come **`ALTER TABLE v_active_ids ...`**. `v_active_ids` è una variabile della funzione, non una tabella da modificare.
4. Vai in fondo alla query e controlla che il file includa il testo finale **`AGGIORNAMENTO_COMPLETATO`**. Se manca, il contenuto è incompleto: sostituiscilo con il file intero prima di eseguire.
5. **Non lasciare testo selezionato** nel SQL Editor: clicca nel testo per togliere la selezione e premi **Run una volta** per eseguire l’intera query. Non eseguire pezzi separati.
6. Nel risultato deve comparire **`AGGIORNAMENTO_COMPLETATO`**.

Il file esegue insieme i due aggiornamenti in una sola transazione. Può essere rieseguito e **non elimina tornei, squadre, risultati o account**; non esegue il reset del tabellone. Se hai già installato una delle due migrazioni, puoi usare comunque questo file unico.

## 3. Carica tutti i file nella radice di GitHub

Nel repository collegato a Vercel carica **tutto il contenuto estratto**: file e cartelle, sovrascrivendo quelli precedenti. Non caricare lo ZIP e non aggiornare soltanto la cartella `docs` o i file SQL.

Controlla la pagina principale del repository: **`package.json`, `index.html` e `vercel.json` devono comparire insieme nella radice**, con `app.js`, `db.js`, `engine.js`, i CSS e le altre cartelle del pacchetto. Poi esegui il **commit** sul branch collegato a Vercel.

Vercel avvia il deployment dal commit. Mantieni le impostazioni già funzionanti:

| Impostazione | Valore |
| --- | --- |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| `SUPABASE_URL` | Il valore esistente del tuo progetto |
| `SUPABASE_PUBLISHABLE_KEY` | La chiave pubblica esistente |

Mantieni anche `DEFAULT_TOURNAMENT_SLUG` e `DEFAULT_TOURNAMENT_NAME`, se li avevi configurati.

## 4. Verifica la versione pubblicata

Attendi **Ready** su Vercel, apri l’app e controlla il riferimento visibile **`v13.3.1`**. Se compare ancora una versione precedente, ricarica la pagina con una ricarica forzata; se è una PWA installata, chiudila e riaprila. Non cancellare i dati del sito per aggiornare la grafica o la cache.

Gli account admin esistenti e la chiave del torneo restano validi. Per aggiungere un collega già creato, il proprietario usa **Altro → Accesso & Live → Amministratori**, poi **“Copia link accesso admin”**: non serve SQL per ogni amministratore.

La verifica sul tuo Supabase e sul tuo Vercel si completa dopo questi passaggi. Le prove locali e con backend simulato non attestano un deployment o una modifica già effettuata nei tuoi account.
