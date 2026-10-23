# Inizia da qui · Glow Arena 13.3.1

- **Installazione 13.3.1 completa:** segui **[docs/INSTALLAZIONE_13_3_1.md](docs/INSTALLAZIONE_13_3_1.md)**. Esegui il file intero `00_AGGIORNAMENTO_SUPABASE.sql` in una query SQL nuova e vuota, poi carica tutti i file estratti nella radice di GitHub.
- **Eliminare il tabellone:** [docs/ELIMINAZIONE_TABELLONE_V13_3.md](docs/ELIMINAZIONE_TABELLONE_V13_3.md) descrive la funzione. Per l’installazione attuale prevale la guida 13.3.1 sopra.
- **Bozza privata condivisa tra admin:** [docs/BOZZA_CONDIVISA_V13_2.md](docs/BOZZA_CONDIVISA_V13_2.md).
- **Calendario dei gironi:** due campi e due gironi avanzano in parallelo, A sul Campo 1 e B sul Campo 2; con più gironi si alternano i gruppi. Vale per i nuovi calendari; i tornei già avviati mantengono quelli esistenti.
- **Salvataggi e punteggi:** la correzione 13.1 è inclusa; [docs/CORREZIONE_SALVATAGGI_V13_1.md](docs/CORREZIONE_SALVATAGGI_V13_1.md) spiega i comandi. Per installare la 13.3.1 segui la guida corrente sopra e il file SQL unico.
- **Installazione e accessi:** [docs/GUIDA_SUPABASE_VERCEL.md](docs/GUIDA_SUPABASE_VERCEL.md).
- **Database precedente alla versione 11?** Segui prima [docs/AGGIORNAMENTO_V11.md](docs/AGGIORNAMENTO_V11.md), poi la guida 13.3.1 e il file SQL unico.
- **Gestione squadre, avvio e risultati:** [docs/MANUALE_OPERATIVO.md](docs/MANUALE_OPERATIVO.md).

Il pacchetto usa configurazione Supabase vuota per la demo locale. Su Vercel imposta `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`; build `npm run build`, output `dist`.

Dopo il primo avvio sono modificabili solo nomi e punteggi, con avanzamento delle fasi. Organico, teste di serie, gironi e impostazioni restano bloccati nelle modifiche ordinarie. Il proprietario può scegliere esplicitamente **Altro → Reset → Elimina tabellone** per tornare a una bozza privata, con conferma e backup locale.
