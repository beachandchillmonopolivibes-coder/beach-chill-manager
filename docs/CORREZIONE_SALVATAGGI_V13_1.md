# Glow Arena 13.1 · correzione dei salvataggi

Questa versione corregge casi in cui una modifica sembrava presente nell’interfaccia ma non veniva conservata, soprattutto lasciando un campo ancora selezionato oppure preparando un torneo prima dell’attivazione online.

## Come si salvano le modifiche

- **Nomi delle squadre:** le modifiche valide vengono registrate durante l’inserimento, anche prima di uscire dal campo. Dopo l’avvio restano obbligatori nomi non vuoti e distinti; la correzione del nome non cambia l’organico.
- **Configurazione prima dell’avvio:** i valori validi vengono acquisiti durante la compilazione. Le impostazioni e la struttura restano protette dopo l’avvio del torneo.
- **Bozza prima dell’attivazione online:** la preparazione viene conservata nel browser per l’utente autenticato e la chiave torneo. Per ritrovarla usa lo stesso account, dominio, browser e profilo. La bozza diventa condivisa quando attivi il torneo online.
- **Modifiche durante l’attivazione:** la creazione usa una copia coerente dei dati. Le modifiche effettuate mentre l’attivazione è in corso vengono accodate e salvate dopo la creazione.
- **Pulsante “Salva modifiche”:** permette di richiedere esplicitamente il salvataggio delle modifiche generali. Il relativo stato distingue la conservazione nel browser dalla sincronizzazione con Supabase. Prima di controllare da un altro dispositivo, attendi la conferma della sincronizzazione online.

## Punteggi delle partite

Per confermare i punti digitati usa **“Salva punteggio” nella singola partita**. I campi dei set sono bozze fino a questa conferma: il comando generale “Salva modifiche” non li conferma automaticamente. La barra di salvataggio segnala questa distinzione.

Puoi correggere i punteggi anche nelle fasi precedenti. Se cambiano le qualificazioni, l’app chiede conferma prima di rimuovere le gare dipendenti, che potrai poi rigenerare.

## Aggiornare il sito esistente

1. Conserva un backup JSON del torneo da **Altro → Backup e ripristino → Esporta backup**.
2. Estrai il nuovo ZIP e apri la cartella con `package.json`, `index.html` e `vercel.json`.
3. Copia il contenuto nella **radice del repository GitHub collegato a Vercel**, sovrascrivendo i file precedenti. L’aggiornamento completo del pacchetto è consigliato. Se aggiorni solo l’interfaccia, sostituisci almeno **`app.js`, `index.html`, `arena.css` e `sw.js` insieme**; mantieni coerenti anche manifest, asset e metadati di versione inclusi.
4. Pubblica il commit sul branch collegato a Vercel e attendi **Ready**. Build `npm run build` e output `dist` restano invariati.
5. Ricarica l’app. Se è installata come PWA, chiudila e riaprila per completare l’aggiornamento della cache. Per una grafica rimasta vecchia usa una ricarica forzata, senza cancellare i dati del sito.
6. Prova a correggere un nome, verifica lo stato di salvataggio e ricarica la pagina. Per la modalità online, controlla lo stesso torneo da un secondo dispositivo solo dopo la conferma della sincronizzazione.

Per aggiornare da una versione 11, 12 o 13 già funzionante **non serve eseguire SQL**, ricreare il database o ricreare gli admin. Conserva le variabili Vercel esistenti: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e gli eventuali valori predefiniti del torneo.

Le chiavi di salvataggio esistenti sono preservate. Mantieni lo stesso dominio e profilo del browser per ritrovare i dati locali. Le correzioni non possono ricostruire valori già persi prima dell’aggiornamento: in quel caso riparti dall’ultimo salvataggio disponibile o dal tuo backup.

## Verifica e limiti

Sono passati **49 test automatici**, inclusi **11 nuovi test sulla persistenza delle modifiche**. La suite copre anche motore del torneo, build, contratti dell’interfaccia e database locale.

Nel browser è stata verificata la correzione del nome di una squadra a torneo avviato, seguita da un aggiornamento immediato della pagina senza uscire prima dal campo: il nome resta conservato. Con backend online simulato sono stati verificati il recupero della bozza prima dell’attivazione, il nome della squadra, il nome del nuovo torneo e i campi numerici della configurazione dopo un aggiornamento della pagina. Nello stesso collaudo sono passati anche l’attivazione, la modifica successiva di un nome, il salvataggio esplicito e il recupero della modifica al ricaricamento.

Queste prove non attestano un accesso o una sincronizzazione sul tuo progetto Supabase reale, né un deployment sul tuo account Vercel: entrambi restano da verificare sul sito pubblicato. Dopo l’aggiornamento controlla il salvataggio e il recupero del torneo, quindi la sincronizzazione tra due dispositivi autorizzati.
