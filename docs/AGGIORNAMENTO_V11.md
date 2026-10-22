# Aggiornamento alla versione 11 senza perdere i dati

Il deploy del frontend non deve cambiare progetto Supabase, chiave del torneo o utenti. La versione 11 aggiunge controlli anche nel database: aggiornare solo i file dell’interfaccia non basta.

## 1. Prima di iniziare

1. Concorda una finestra senza inserimenti con tutti gli amministratori.
2. Nell’app attuale esporta il backup JSON dei tornei da conservare.
3. Dal dashboard Supabase conserva un backup del database secondo le funzioni disponibili nel tuo piano. Il JSON dell’app non comprende utenti Auth o appartenenze.
4. Annota Project URL, chiave torneo effettiva, URL Vercel e account proprietario. Non confondere una chiave predefinita in `config.js` con la chiave realmente usata nell’URL `?t=...`.
5. Conserva il vecchio pacchetto per consultazione. Prepara una copia di prova se l’evento è in corso.

Non cancellare tabelle, non eseguire `drop table`, non eliminare utenti Auth del proprietario e non importare un vecchio JSON sopra il torneo attuale.

## 2. Scegli il percorso SQL

| Database di partenza | Cosa eseguire nel SQL Editor |
| --- | --- |
| Nuovo progetto vuoto | Solo `schema.sql` della versione 11 |
| Versione v10 con username/password già funzionanti | `MIGRATION_PRO_V11.sql` |
| Vecchia versione con Magic Link, senza RPC username/password | Prima `MIGRATION_ADMIN_LOGIN.sql`, poi `MIGRATION_PRO_V11.sql` |

Esegui i file completi nell’ordine indicato e controlla il successo di ogni query. Se compare un errore, conserva il messaggio e fermati prima del deploy: non rimuovere policy o controlli per farlo passare. La migrazione V11 conserva le righe dei tornei; aggiunge/sostituisce funzioni e controlli richiesti dalla nuova app.

Gli eventi già generati vengono riconosciuti come avviati: la nuova versione non riapre le iscrizioni. La presenza o l’assenza di risultati non cambia questo comportamento.

### Solo se cambi il proprietario dal vecchio account Magic Link

Se il torneo appartiene ancora a un indirizzo email Magic Link e vuoi amministrarlo con un nuovo username tecnico, crea prima il nuovo utente Auth confermato. Poi apri `TRASFERISCI_PROPRIETARIO_ESEMPIO.sql`, imposta consapevolmente `v_username` e `v_slug` sui valori reali ed esegui lo script nel SQL Editor. Questo trasferisce la proprietà e conserva lo stato sportivo, anche se il torneo è avviato; l’ex proprietario perde il ruolo di proprietario. Verifica il nuovo accesso prima di proseguire. Non eliminare l’account Auth del vecchio proprietario per effettuare il passaggio.

Questa operazione non è necessaria se usi già gli stessi account username/password e vuoi mantenere l’attuale proprietario.

## 3. Aggiorna Vercel

1. Sostituisci i sorgenti nel repository/progetto con il pacchetto aggiornato. Mantieni `package-lock.json` e `vercel.json`.
2. Seleziona lo stesso progetto Vercel e la stessa Root Directory.
3. Configura **Other**, build **`npm run build`**, output **`dist`**, Node.js 22 o successivo.
4. Aggiungi `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` con i valori dello **stesso progetto Supabase esistente**. Il nuovo pacchetto non conserva i vecchi valori pubblici incorporati nei sorgenti.
5. Imposta eventuali `DEFAULT_TOURNAMENT_SLUG` e `DEFAULT_TOURNAMENT_NAME`. Non rinominano i dati nel database.
6. Esegui il deploy e apri il dominio di produzione con la stessa chiave torneo, ad esempio `https://tuo-sito.vercel.app/?t=beach-chill-2026`.

Se mantieni una vecchia configurazione di deploy senza build, il sito può restare in modalità demo: verifica le impostazioni e l’indicatore di connessione prima di inserire dati reali.

## 4. Verifica prima di riprendere gli inserimenti

- Accedi come proprietario e confronta nomi, numero squadre, risultati e fase col backup.
- Accedi come secondo amministratore e controlla l’appartenenza al torneo.
- Apri il link Live in navigazione privata se la lettura pubblica era attiva.
- In un torneo già avviato verifica il blocco di iscrizioni, struttura, reset e rigenerazione.
- Verifica una modifica del nome e un salvataggio su un torneo di prova prima di intervenire sull’evento reale.
- Controlla che non siano rimaste modifiche locali in attesa di sincronizzazione.

La cache PWA si aggiorna con la nuova versione. Se continua a comparire la vecchia app, verifica prima l’URL di produzione, poi ricarica e chiudi/riapri la PWA. Non cancellare i dati del sito prima di aver esportato eventuali modifiche rimaste solo sul dispositivo.

## 5. Se qualcosa non torna

Sospendi gli inserimenti, confronta la riga `tournaments` e il backup, controlla le variabili del progetto e leggi l’errore. Una chiave torneo diversa può aprire un altro evento; un Project URL diverso può puntare a un altro database.

Un rollback del solo frontend non ripristina il database e non annulla le nuove regole. Dopo la migrazione V11, una vecchia app potrebbe proporre operazioni che il database ora rifiuta. Correggi la configurazione o completa il deploy V11 invece di disabilitare i controlli. Per un ripristino completo serve un piano sul backup del database, mantenendo la copia corrente e coordinando tutti gli operatori.
