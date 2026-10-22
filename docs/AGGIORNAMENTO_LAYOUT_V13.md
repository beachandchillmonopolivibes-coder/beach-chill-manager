# Aggiornare a Glow Arena 13

Glow Arena riprende i colori vivaci e l’atmosfera della grafica Glow originale, con un layout rivisto per desktop e telefono. Le funzioni di gestione del torneo seguono le regole della versione 11.

## Se l’app funziona già su Vercel con la versione 11 o 12

1. Prima dell’aggiornamento è consigliato conservare un backup JSON: nell’app apri **Altro → Backup e ripristino → Esporta backup**.
2. Estrai lo ZIP e apri la cartella contenente `package.json`, `index.html` e `vercel.json`.
3. Copia **il contenuto di quella cartella nella radice del repository GitHub collegato a Vercel**, sovrascrivendo i file precedenti. Carica l’intero pacchetto: non lo ZIP e non una cartella esterna che sposti la radice del progetto.
4. Esegui il commit sul branch collegato a Vercel. Mantieni build `npm run build`, output `dist` e tutte le variabili di ambiente già funzionanti.
5. Attendi lo stato **Ready**, apri l’app e ricarica. Se l’avevi installata come PWA, chiudila e riaprila per completare l’aggiornamento della cache.
6. Controlla il torneo, le squadre, i risultati e il link Live. Se vedi ancora la grafica precedente, esegui una ricarica forzata senza cancellare i dati del sito.

Per questo passaggio **11/12 → 13 non serve eseguire SQL**, ricreare le tabelle o ricreare gli account admin. Le migrazioni SQL incluse restano quelle necessarie per una prima installazione o per aggiornare versioni precedenti alla 11.

## Configurazione e dati

- Conserva `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` nelle impostazioni Vercel. Anche `DEFAULT_TOURNAMENT_SLUG` e `DEFAULT_TOURNAMENT_NAME`, se presenti, restano validi.
- Il formato dei dati del torneo e la chiave di salvataggio del browser rimangono gli stessi. Mantieni dominio, browser e profilo per ritrovare anche i tornei locali.
- Se hai personalizzato direttamente `config.js`, conserva i tuoi valori pubblici. Su Vercel usa preferibilmente le variabili di ambiente già configurate.
- Prima dell’avvio puoi modificare organico, teste di serie, gironi e impostazioni. Dopo l’avvio restano modificabili **nomi e punteggi in tutte le fasi**, con avanzamento dei turni.
- Aggiorna tutti i file dell’interfaccia insieme: `index.html`, `app.js`, `arena.css`, gli altri CSS inclusi, `sw.js`, manifest e asset. I vecchi file grafici non più referenziati non sono necessari al nuovo tema.

Per una prima installazione consulta [Guida Supabase + Vercel](GUIDA_SUPABASE_VERCEL.md). Per un database più vecchio della versione 11 consulta anche [Aggiornamento V11](AGGIORNAMENTO_V11.md).

## Verifica

Su questa versione sono passati **38 test automatici su 38**. Sono stati controllati nel browser il dashboard, le schede partita, l’elenco squadre, il tema chiaro/scuro, la vista Live senza comandi admin e l’accesso con backend simulato. Il layout è stato ispezionato anche a 390 e 320 px: nessun campo esce dal bordo dello schermo.

Le prove usano dati dimostrativi in anteprima. Non sono stati effettuati accessi al progetto Supabase reale o deployment sul tuo account Vercel. La suite browser automatica richiede Chromium locale e non è stata rieseguita in questo ambiente.

I test inclusi coprono motore del torneo, database locale, build e riferimenti dell’interfaccia. `npm run test:browser` richiede Chromium installato. I controlli locali e i backend simulati non sostituiscono una verifica degli accessi e della sincronizzazione sul tuo progetto Supabase reale.
