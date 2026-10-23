# Glow Arena 13.3.2 · reset e importazione

Questa versione corregge il controllo grafico del caricamento dei backup e il comando **“Azzera risultati”**, che ora permette al proprietario di ripartire dai risultati vuoti anche quando il torneo è già avviato e pubblicato. Le indicazioni di questa guida aggiornano il comportamento descritto nelle guide precedenti.

## Scegliere il comando

| Comando | Risultato |
| --- | --- |
| **Azzera risultati** | Cancella punteggi e fasi successive. Conserva il sorteggio iniziale, i gironi, campi e orari delle partite iniziali, l’avvio e l’impostazione pubblica/privata. Permette di rigiocare lo stesso torneo dalla fase iniziale. |
| **Elimina tabellone** | Rimuove tutto il tabellone e torna a una bozza privata nella pagina Configura. Conserva squadre, nomi, teste di serie, assegnazioni manuali, impostazioni, chiave e accessi admin. Permette di cambiare la preparazione e generare un nuovo sorteggio. |
| **Importa backup** | Carica un file JSON in una bozza senza tabellone avviato. Per importare in un torneo già avviato, usa prima Elimina tabellone. |

Per i tornei online, **Azzera risultati** ed **Elimina tabellone** sono riservati al proprietario. Entrambi richiedono conferma e un backup locale prima della modifica. Il controllo della revisione protegge dalle modifiche salvate nel frattempo da un altro admin.

### Per azzerare i punteggi mantenendo il sorteggio

Apri **Altro → Reset → Azzera risultati**, leggi cosa verrà cancellato e conferma. L’app conserva prima il backup sul browser del proprietario, poi salva il reset. Le gare delle fasi successive vengono rimosse; il sorteggio iniziale e la sua programmazione restano quelli già generati.

Il torneo rimane avviato: organico e impostazioni restano protetti. Anche la pubblicazione resta come l’avevi impostata; se il torneo era pubblico, il Live resta pubblico.

### Per ricreare il tabellone o importare un backup

Apri **Altro → Reset → Elimina tabellone** e conferma. Il backup locale deve riuscire prima dell’operazione online. Al completamento il torneo torna una **bozza privata** su Configura, con squadre e impostazioni conservate.

Ora puoi usare **Altro → Backup e ripristino → Importa backup**. Il controllo è un pulsante che apre il selettore del file JSON. Durante un torneo avviato l’importazione rimane intenzionalmente disabilitata e il pannello spiega di eliminare prima il tabellone. **Azzera risultati non sblocca l’importazione**, perché conserva l’avvio e il sorteggio.

Per recuperare il backup automatico usa il pulsante di download sul dispositivo del proprietario che ha eseguito il reset. Mantieni lo stesso browser, profilo e dominio finché non hai scaricato il JSON; quel backup è conservato localmente.

## Se un’operazione non riesce

Il messaggio di errore resta visibile nel pannello **Reset**, anche dopo la scomparsa della notifica temporanea. Leggi quel messaggio per distinguere permessi insufficienti, migrazione mancante, mancato backup o conflitto con un altro salvataggio. In caso di conflitto ricontrolla la versione online prima di ripetere il comando.

La versione visibile **`v13.3.2`** permette di riconoscere la pagina aggiornata. Una pagina già aperta può continuare a mostrare la copia precedente fino al completamento del nuovo deployment e al ricaricamento.

## Aggiornare il sito

1. Conserva un backup JSON del torneo. Se l’aggiornamento SQL della **13.3 è già stato applicato**, questa versione non richiede nuovo SQL. Se manca, apri ed esegui l’intero **`00_AGGIORNAMENTO_SUPABASE.sql`** in una query Supabase nuova e vuota; segui [Installazione completa](INSTALLAZIONE_13_3_1.md) e verifica l’esito `AGGIORNAMENTO_COMPLETATO`.
2. Estrai il nuovo ZIP: i file sono già nella radice. Carica **tutto il contenuto estratto nella radice del repository GitHub collegato a Vercel**, sovrascrivendo i file precedenti. In particolare `app.js`, `engine.js`, `index.html`, CSS, `sw.js` e gli altri file inclusi devono essere aggiornati insieme. Non caricare soltanto la documentazione e non caricare lo ZIP.
3. Pubblica il commit e attendi **Ready** su Vercel. Mantieni build `npm run build`, output `dist`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e gli eventuali valori predefiniti già funzionanti.
4. Ricarica l’app e controlla **`v13.3.2`**. Se necessario esegui una ricarica forzata o chiudi e riapri la PWA, senza cancellare i dati del sito.

## Verifiche della versione

La suite automatica comprende **111 test, tutti superati**: motore dei tornei, salvataggi, permessi, revisioni concorrenti, reset e migrazioni SQL eseguite su PostgreSQL incorporato. Nel browser sono stati verificati l’azzeramento di un torneo avviato e pubblico, l’eliminazione del tabellone con conservazione delle squadre e l’importazione effettiva di un file JSON dal nuovo pulsante, usando un backend simulato. Il selettore file nascosto mantiene dimensioni zero anche quando disabilitato.

Le prove locali e con backend simulato non attestano un deployment né un’operazione sul tuo Supabase reale. Il comportamento sul sito pubblicato va verificato dopo l’aggiornamento.
