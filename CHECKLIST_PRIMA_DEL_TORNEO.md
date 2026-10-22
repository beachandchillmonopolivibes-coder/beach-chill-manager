# Checklist prima del torneo · Pro 11

- [ ] Supabase è configurato con lo schema V11 o la migrazione appropriata; RLS resta attivo.
- [ ] Vercel pubblica `dist` con build `npm run build` e variabili pubbliche corrette.
- [ ] Ogni amministratore usa un account personale confermato ed è aggiunto al torneo.
- [ ] Il proprietario e un secondo admin lavorano sulla stessa chiave torneo.
- [ ] Il salvataggio viene verificato su due dispositivi e dopo un ricaricamento.
- [ ] Squadre, nomi, teste di serie, gironi e formula sono definitivi.
- [ ] Campi, data, orari e durata degli slot permettono di programmare le gare; non ci sono partite prive di orario da risolvere.
- [ ] I formati dei punteggi di tutte le fasi sono corretti.
- [ ] Il link Live è stato provato in navigazione privata e consente sola lettura.
- [ ] È stata provata una correzione che cambia qualificazioni su un torneo di collaudo.
- [ ] È stato esportato un backup prima dell’avvio.
- [ ] Gli operatori sanno che dal primo avvio organico e struttura sono bloccati e restano modificabili nomi e punteggi.

Procedura completa: [Guida Supabase + Vercel](docs/GUIDA_SUPABASE_VERCEL.md). Uso giornaliero: [Manuale operativo](docs/MANUALE_OPERATIVO.md).
