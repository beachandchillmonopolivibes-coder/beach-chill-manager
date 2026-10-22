# Manuale operativo · Pro 11

## 1. Gli accessi

Ogni organizzatore usa il proprio username e la propria password. Il proprietario crea il torneo e assegna gli altri amministratori in **Altro → Accesso & Live**. La chiave torneo deve essere uguale per tutti gli operatori di quell’evento.

La modalità locale senza Supabase serve per provare l’app su un dispositivo; non distribuisce i dati agli altri. Per un evento con più amministratori usa il sito collegato al database e controlla l’indicatore di connessione e salvataggio. Per preparare un altro evento, in **Altro** premi **Nuovo torneo**, scegli una nuova chiave e un nome, quindi **Attiva torneo online**. Il torneo precedente resta nel database e si riapre dal suo link con la relativa chiave.

## 2. Iscrizioni: la pagina Squadre

Prima dell’avvio apri **Squadre**:

1. Inserisci le coppie partecipanti nelle righe disponibili.
2. Scrivi il nome della squadra; puoi usare il campo anche per indicare i due giocatori, per esempio `Paolo / Giulia`. Il nome deve contenere da 1 a 120 caratteri.
3. Controlla le teste di serie e le eventuali assegnazioni manuali dei gironi.
4. Rimuovi o lascia vuote le righe non utilizzate. Una riga vuota non deve essere usata per aggiungere una squadra dopo l’avvio.
5. Controlla che nessun nome dimostrativo venga incluso per errore.

Puoi incollare una coppia per riga oppure colonne Excel separate da tab/punto e virgola: `Nome coppia; TS; Girone` o `Giocatore 1; Giocatore 2; TS; Girone`. Il numero iniziale è facoltativo. L’anteprima segnala nomi duplicati, nomi troppo lunghi e liste oltre 24 coppie: correggi l’elenco prima di importare; nessuna riga eccedente viene scartata automaticamente.

Il motore gestisce al massimo 24 squadre. Le formule a eliminazione richiedono almeno 2 squadre; il girone unico con Final Four richiede da 4 a 10 squadre. Per gironi + playoff l’app controlla anche numero di gironi, dimensioni, qualificate e teste di serie: risolvi i messaggi di validazione prima dell’avvio.

Non usare i nomi per salvare contatti o dati riservati: se abiliti Live lo stato del torneo diventa leggibile dal pubblico.

## 3. Configurazione e scelta della formula

In **Configura** imposta nome evento, data, campi, inizio e fine giornata, durata media dello slot, formula e regole delle fasi.

| Formula | Flusso |
| --- | --- |
| Gironi + playoff | Gironi all’italiana, classifiche, qualificazioni Gold ed eventuale Silver |
| Girone unico + Final Four | Tutte le coppie si affrontano nel girone; le prime quattro accedono alle semifinali |
| Eliminazione diretta | Avanza chi vince; eventuali bye secondo le impostazioni |
| Doppia eliminazione | Percorsi vincenti/perdenti; l’eliminazione dipende dalle sconfitte previste dalla formula |

Nei gironi puoi usare il sorteggio protetto dalle teste di serie o la composizione manuale. Il codice di sorteggio permette di ripetere la stessa estrazione con gli stessi dati e impostazioni. Prima di avviare controlla il numero di squadre per girone e le qualificazioni.

I formati delle gare possono essere impostati separatamente per gironi, turni preliminari/quarti e semifinali. Le finali Gold e Silver usano il formato classico 21/21/15. Il nome del formato mostrato sulla partita è il riferimento per inserire i punteggi.

La stima della durata usa slot medi. La programmazione automatica considera i campi, evita che una squadra giochi due partite nello stesso slot e lascia un intervallo fra le sue gare. Se una gara non entra prima della fine della giornata, rimane senza orario: controlla gli avvisi e correggi la configurazione **prima** dell’avvio. La durata reale dipende dall’andamento delle partite.

## 4. Controllo prima dell’avvio

Con un secondo organizzatore verifica elenco squadre, teste di serie, gironi, formula, punteggi delle fasi e capacità della giornata. Esporta un backup della preparazione.

Avvia solo quando le iscrizioni sono definitive. **La generazione iniziale del torneo è il momento dell’avvio**, anche se non è stato ancora giocato un punto. Il marcatore di avvio viene conservato e applicato anche ai tornei generati dalle versioni precedenti.

| Operazione | Prima dell’avvio | Dopo l’avvio |
| --- | --- | --- |
| Correggere nome squadra | Sì | Sì, in ogni fase |
| Aggiungere/rimuovere squadre | Sì | No |
| Cambiare teste di serie, ordine, girone o attivazione | Sì | No |
| Cambiare formula, formato, campi/orari di configurazione | Sì | No |
| Inserire/correggere punteggi | Quando esistono le gare | Sì, in ogni fase |
| Avanzare ai turni successivi | Quando la fase è completa | Sì |
| Sostituire lo stato tramite import/reset/rigenerazione | In preparazione | No |
| Esportare un backup | Sì | Sì |

Il blocco vale anche per il proprietario. La concessione/revoca degli accessi e la visibilità Live restano controlli amministrativi del proprietario. Per un’altra lista partecipanti crea un torneo separato: non riutilizzare quello avviato.

## 5. Risultati e avanzamento

1. Apri **Partite** e seleziona la gara, eventualmente filtrando fase o stato.
2. Inserisci i punti nei set previsti. Usa numeri interi da 0 a 999.
3. Premi **Salva punteggio** e verifica il messaggio di salvataggio. La digitazione nei campi non equivale al salvataggio. Usa **Annulla modifiche** per tornare al punteggio salvato della gara; chiudendo la pagina con campi non salvati compare un avviso.
4. Controlla il vincitore, la classifica e la vista Live.
5. Quando tutte le gare della fase sono concluse, usa il comando per generare/avanzare alla fase successiva.

Un punteggio finale richiede il raggiungimento del target del set e due punti di vantaggio. Per esempio, nel set a 21: `21–19` è concluso; `21–20` è ancora in corso; `22–20` è concluso; `22–18` è incoerente perché la partita si sarebbe conclusa prima. Ai vantaggi il primo margine di due punti conclude il set.

I punteggi parziali possono essere salvati come gara in corso. In un 2 su 3 i set devono essere inseriti in sequenza: non compilare il terzo set dopo un 2–0 e non iniziare un nuovo set prima di chiudere quello precedente. Un risultato non valido viene segnalato e non deve essere forzato scegliendo un vincitore a mano.

Un bye avanza automaticamente secondo la formula; non è una partita da segnare con un risultato inventato.

## 6. Correggere un risultato di una fase precedente

Puoi aprire una partita già conclusa in qualsiasi fase, modificare i punteggi e salvarla. Prima di confermare, leggi l’effetto sui turni successivi.

| Correzione | Effetto |
| --- | --- |
| Gara a eliminazione: cambiano i punti ma resta lo stesso vincitore | I turni successivi vengono conservati |
| Gara a eliminazione: cambia il vincitore, oppure la gara torna incompleta | Vengono rimossi tutti gli stage successivi; i risultati delle altre gare dello stesso stage restano |
| Gara dei gironi: cambia qualsiasi punteggio | Viene rimossa la fase successiva ai gironi, perché punti e differenza punti possono cambiare le qualificazioni |

L’app richiede conferma quando serve annullare i turni successivi. L’annullamento è prudenziale e può coinvolgere gare successive che non dipendono direttamente da quella corretta. Dopo il salvataggio controlla la fase corrente, completa eventuali gare e rigenera l’avanzamento; i risultati rimossi non vengono attribuiti ai nuovi accoppiamenti.

Esempio: una semifinale aveva qualificato la squadra A. Se correggi il risultato e vince B, la finale precedente viene eliminata. Genera di nuovo il turno con B e inserisci il risultato effettivo della nuova finale. Non conservare il punteggio giocato contro A.

Prima di correzioni che annullano turni esporta un backup e concorda l’intervento con gli altri amministratori. Per evitare conflitti, assegna una singola gara a un solo operatore alla volta.

## 7. Correggere i nomi dopo l’avvio

Apri **Squadre**, correggi il nome della squadra registrata (da 1 a 120 caratteri) e verifica il salvataggio. Se il nome contiene i due giocatori, puoi correggerne la grafia nello stesso campo. Le gare referenziano l’identità interna della squadra: il nuovo nome compare anche nelle fasi già generate senza ricreare gli accoppiamenti.

La rinomina non deve diventare una sostituzione di partecipanti o una modifica di teste di serie. In caso di parità completa il criterio finale resta stabile sull’ordine di iscrizione e non sul testo del nome: una correzione ortografica non deve cambiare una qualificazione.

## 8. Collaborazione fra amministratori

Gli amministratori vedono gli aggiornamenti tramite Supabase. Un campo aperto o una modifica in corso può ritardare l’applicazione di un aggiornamento remoto per non interrompere la digitazione. Dopo aver salvato o lasciato il campo controlla l’ultimo stato.

Se appare un conflitto, conserva il punteggio verificato, ricarica i dati aggiornati e ripeti l’operazione solo dopo il confronto. Non importare un backup o ripetere un avvio per risolvere una divergenza. Due operatori sulla stessa gara devono concordare chi effettua il salvataggio definitivo.

Se manca la connessione, considera i dati sul dispositivo come una copia locale non ancora confermata dal server. Evita correzioni contemporanee su altri dispositivi e controlla il completamento della sincronizzazione al ripristino. La PWA e la cache dell’interfaccia non sostituiscono un backup né garantiscono la collaborazione offline.

## 9. Backup e fine evento

Esporta un JSON prima dell’avvio, al termine dei gironi, prima di correzioni dei turni precedenti e alla fine dell’evento. Conserva nome file, chiave torneo, data e ora insieme al backup.

L’import di un backup è un’operazione di preparazione su uno stato non avviato; non consente di sostituire un torneo già partito. Se serve ricostruire un evento crea una nuova chiave e lavora su una copia, mantenendo il precedente come archivio. Conserva anche un backup del database per proteggere configurazione e appartenenze: l’esportazione dell’app contiene lo stato sportivo, non account e password.

Alla fine verifica campioni, classifiche e punteggi, esporta l’ultimo JSON e conserva l’accesso del proprietario. Puoi lasciare la vista Live attiva per consultazione o disabilitarla dalla sezione Accesso & Live.
