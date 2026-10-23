# Glow Arena 13.3 · eliminare e rigenerare il tabellone

Il proprietario può eliminare il tabellone di un torneo online anche quando è già avviato e pubblicato. Dopo la conferma, l’app conserva un backup locale, esegue il reset e torna alla pagina **Configura** con una bozza privata pronta da preparare nuovamente.

## Cosa conserva e cosa azzera

| Rimane nel torneo | Viene azzerato |
| --- | --- |
| Squadre e relativi nomi | Partite e turni del tabellone |
| Teste di serie e assegnazioni manuali ai gironi | Gironi generati e classifiche derivate |
| Formula, campi, orari e altre impostazioni | Punteggi e risultati |
| Chiave e identità del torneo | Marcatori di avvio del torneo |
| Proprietario e accessi degli admin | Pubblicazione della vista giocatori |

La vista Live viene disattivata: il torneo torna **privato**. Potrai prepararlo con gli amministratori già autorizzati e pubblicarlo nuovamente quando vorrai.

## Come eliminare il tabellone

1. Accedi con l’account **proprietario** e la chiave del torneo.
2. Apri **Altro → Reset → Elimina tabellone**.
3. Leggi la conferma, controlla che sia il torneo corretto e conferma l’operazione.
4. L’app deve riuscire a conservare il backup nel browser del proprietario **prima** di richiedere il reset online. Se il backup non riesce, l’eliminazione si interrompe.
5. Dopo il completamento, l’app torna su **Configura**. Le squadre e le impostazioni sono ancora presenti; puoi modificarle e generare un nuovo tabellone. La vista giocatori resta privata.

Online l’operazione è riservata al proprietario: gli altri admin possono gestire il torneo, ma non usare questo reset. Nella modalità locale la può eseguire chi può modificare il torneo in quel browser.

Il reset controlla anche la revisione del torneo: se nel frattempo un altro admin ha salvato modifiche, la richiesta viene rifiutata per evitare di sovrascriverle. In caso di conflitto ricontrolla la versione online prima di ripetere l’operazione.

Questa è l’eccezione esplicita al blocco del torneo avviato. Le modifiche ordinarie mantengono protetti organico, teste di serie, gironi e impostazioni. Dalla **13.3.2**, il proprietario può anche usare **“Azzera risultati”** dopo l’avvio: mantiene sorteggio e calendario iniziale, rimuove punteggi e fasi successive e conserva la visibilità Live. Vedi la [guida aggiornata ai reset](CORREZIONI_RESET_IMPORT_13_3_2.md). Per correggere un singolo risultato puoi continuare a usare **“Salva punteggio”** nella relativa partita.

## Recuperare il backup dell’eliminazione

Il backup automatico è conservato **nel browser del proprietario che ha confermato l’eliminazione**, sul dispositivo usato per l’operazione. Non è un backup cloud. Mantieni lo stesso dominio, browser e profilo e non cancellare i dati del sito prima di averlo scaricato.

Dal dispositivo del proprietario usa il pulsante dedicato per **scaricare il backup dell’eliminazione**, poi conserva il file JSON. Per ripristinarlo, usa **Altro → Backup e ripristino → Importa backup** mentre il torneo è ancora una bozza con tabellone vuoto. Se vuoi recuperare il torneo precedente, fallo prima di generare un nuovo tabellone.

Il ripristino importa i dati del torneo dal JSON; controlla squadre, risultati e avanzamento recuperati. Il proprietario gestisce separatamente la pubblicazione tramite **“Pubblica vista giocatori”**.

## Aggiornare Supabase e Vercel

1. **Prima del deploy**, apri il progetto Supabase già collegato all’app e usa **SQL Editor → New query → Run** con il contenuto completo di **`MIGRATION_RESET_BRACKET_V13_3.sql`**. Se la migrazione della 13.2 non è stata ancora installata, esegui prima **`MIGRATION_SHARED_DRAFT_V13_2.sql`**, poi quella della 13.3. Per un database precedente alla 11 segui prima anche [Aggiornamento V11](AGGIORNAMENTO_V11.md).
2. Conserva un backup JSON del torneo esistente. Estrai il nuovo ZIP e copia **il contenuto della cartella con `package.json`, `index.html` e `vercel.json` nella radice del repository GitHub collegato a Vercel**, sovrascrivendo i file precedenti. Aggiorna il pacchetto completo, inclusi `app.js`, `db.js`, `engine.js`, `index.html`, CSS, `sw.js`, manifest e asset.
3. Pubblica il commit sul branch collegato a Vercel e attendi **Ready**. Mantieni build `npm run build`, output `dist` e le variabili esistenti `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e gli eventuali valori predefiniti del torneo. Gli account e gli accessi admin esistenti restano validi.
4. Ricarica l’app; se è installata come PWA, chiudila e riaprila per completare l’aggiornamento della cache **13.3**. Se serve, esegui una ricarica forzata senza cancellare i dati del sito.

La migrazione abilita l’operazione riservata al proprietario; non elimina automaticamente alcun tabellone durante l’aggiornamento.

## Calendario dopo la rigenerazione

Il nuovo tabellone usa la programmazione corretta dei gironi: con due campi e due gironi, **A sul Campo 1 e B sul Campo 2 in parallelo**; con più gironi, rotazione dei gruppi tra gli slot disponibili. Le impostazioni conservate nel reset possono essere riviste prima di generare il nuovo calendario.

## Verifica e limiti

Sono passati **96 test automatici**, inclusi 18 nuovi casi dedicati al reset: permessi, revisione concorrente, backup, annullamento, pubblicazione e cambio account durante la richiesta.

Nel browser, con backend simulato, un torneo avviato con 8 squadre e 12 gare a gironi è stato pubblicato e poi eliminato dal proprietario tramite il comando e la conferma. Dopo il reset erano ancora presenti tutte le 8 squadre, il Live era disattivato, il pulsante “Avvia torneo” era nuovamente disponibile e il backup prima dell’eliminazione era scaricabile da Altro. Queste prove non hanno eliminato dati da un progetto Supabase reale.

Le prove locali e i backend simulati verificano i flussi dell’app, ma non attestano un accesso o un reset sul tuo progetto Supabase reale, né un deployment sul tuo account Vercel. Dopo l’aggiornamento verifica gli accessi e prova il recupero del backup su un torneo di prova prima di usare il reset durante un evento.
