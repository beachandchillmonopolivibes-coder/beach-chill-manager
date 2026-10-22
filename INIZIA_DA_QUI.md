# Inizia da qui · Glow Arena 13.2

- **Aggiornamento 13.2 e bozza condivisa privata:** segui **[docs/BOZZA_CONDIVISA_V13_2.md](docs/BOZZA_CONDIVISA_V13_2.md)**. Esegui prima una volta `MIGRATION_SHARED_DRAFT_V13_2.sql` nel progetto Supabase, poi aggiorna tutti i file su GitHub/Vercel.
- **Calendario dei gironi:** due campi e due gironi avanzano in parallelo, A sul Campo 1 e B sul Campo 2; con più gironi si alternano i gruppi. Vale per i nuovi calendari; i tornei già avviati mantengono quelli esistenti.
- **Salvataggi e punteggi:** la correzione 13.1 è inclusa; [docs/CORREZIONE_SALVATAGGI_V13_1.md](docs/CORREZIONE_SALVATAGGI_V13_1.md) spiega i comandi. Per l’installazione della 13.2 prevale la guida sopra, con la nuova migrazione obbligatoria.
- **Installazione e accessi:** [docs/GUIDA_SUPABASE_VERCEL.md](docs/GUIDA_SUPABASE_VERCEL.md).
- **Database precedente alla versione 11?** Segui prima [docs/AGGIORNAMENTO_V11.md](docs/AGGIORNAMENTO_V11.md), poi la migrazione della 13.2.
- **Gestione squadre, avvio e risultati:** [docs/MANUALE_OPERATIVO.md](docs/MANUALE_OPERATIVO.md).

Il pacchetto usa configurazione Supabase vuota per la demo locale. Su Vercel imposta `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`; build `npm run build`, output `dist`.

Dopo il primo avvio sono modificabili solo nomi e punteggi, con avanzamento delle fasi. Organico, teste di serie, gironi e impostazioni restano bloccati.
