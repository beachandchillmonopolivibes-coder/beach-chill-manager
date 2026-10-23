# Inizia da qui · Glow Arena 13.3

- **Aggiornamento 13.3 ed eliminazione del tabellone:** segui **[docs/ELIMINAZIONE_TABELLONE_V13_3.md](docs/ELIMINAZIONE_TABELLONE_V13_3.md)**. Prima del deploy esegui `MIGRATION_RESET_BRACKET_V13_3.sql`; se non hai installato la 13.2, applica prima anche `MIGRATION_SHARED_DRAFT_V13_2.sql`.
- **Bozza privata condivisa tra admin:** [docs/BOZZA_CONDIVISA_V13_2.md](docs/BOZZA_CONDIVISA_V13_2.md).
- **Calendario dei gironi:** due campi e due gironi avanzano in parallelo, A sul Campo 1 e B sul Campo 2; con più gironi si alternano i gruppi. Vale per i nuovi calendari; i tornei già avviati mantengono quelli esistenti.
- **Salvataggi e punteggi:** la correzione 13.1 è inclusa; [docs/CORREZIONE_SALVATAGGI_V13_1.md](docs/CORREZIONE_SALVATAGGI_V13_1.md) spiega i comandi. Per installare la 13.3 segui la guida corrente sopra e le relative migrazioni.
- **Installazione e accessi:** [docs/GUIDA_SUPABASE_VERCEL.md](docs/GUIDA_SUPABASE_VERCEL.md).
- **Database precedente alla versione 11?** Segui prima [docs/AGGIORNAMENTO_V11.md](docs/AGGIORNAMENTO_V11.md), poi le migrazioni della 13.2 e della 13.3.
- **Gestione squadre, avvio e risultati:** [docs/MANUALE_OPERATIVO.md](docs/MANUALE_OPERATIVO.md).

Il pacchetto usa configurazione Supabase vuota per la demo locale. Su Vercel imposta `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`; build `npm run build`, output `dist`.

Dopo il primo avvio sono modificabili solo nomi e punteggi, con avanzamento delle fasi. Organico, teste di serie, gironi e impostazioni restano bloccati nelle modifiche ordinarie. Il proprietario può scegliere esplicitamente **Altro → Reset → Elimina tabellone** per tornare a una bozza privata, con conferma e backup locale.
