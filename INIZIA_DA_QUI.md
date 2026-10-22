# Inizia da qui · Glow Arena 13.1

- **Le modifiche non restavano salvate?** Installa questa versione seguendo [docs/CORREZIONE_SALVATAGGI_V13_1.md](docs/CORREZIONE_SALVATAGGI_V13_1.md).
- **Aggiorni la versione 11 o 12 già online?** [docs/AGGIORNAMENTO_LAYOUT_V13.md](docs/AGGIORNAMENTO_LAYOUT_V13.md). Per il restyling non serve SQL.
- **Installazione e accessi:** [docs/GUIDA_SUPABASE_VERCEL.md](docs/GUIDA_SUPABASE_VERCEL.md).
- **Hai già un torneo nel vecchio database?** Segui prima [docs/AGGIORNAMENTO_V11.md](docs/AGGIORNAMENTO_V11.md).
- **Gestione squadre, avvio e risultati:** [docs/MANUALE_OPERATIVO.md](docs/MANUALE_OPERATIVO.md).

Il pacchetto usa configurazione Supabase vuota per la demo locale. Su Vercel imposta `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`; build `npm run build`, output `dist`.

Dopo il primo avvio sono modificabili solo nomi e punteggi, con avanzamento delle fasi. Organico, teste di serie, gironi e impostazioni restano bloccati.
