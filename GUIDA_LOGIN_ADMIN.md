# Accessi amministrativi Pro 11

1. In Supabase crea l’utente Auth confermato `username@admin.beachvolley.app`, con una password personale.
2. Nell’app usa la chiave torneo, solo lo username e la password.
3. Il creatore di un torneo diventa proprietario. Per gli altri account, il proprietario deve aggiungere lo username in **Altro → Accesso & Live → Gestione amministratori**.
4. Per revocare l’accesso usa Rimuovi nell’app. Non cancellare l’utente Auth del proprietario: la cancellazione può eliminare i suoi tornei.

Procedura completa: **[Guida Supabase + Vercel](docs/GUIDA_SUPABASE_VERCEL.md)**. Il dominio tecnico resta `admin.beachvolley.app`; gli indirizzi non sono caselle per inviti o recupero password. Gli account si gestiscono dal dashboard Supabase.
