# Scanner di sagome

Dalla foto del cartone al DXF in scala reale (layer LUCE e VETRO).
Funziona nel browser del telefono e, dopo la prima apertura, anche senza connessione.

## Pubblicare su GitHub Pages
1. Crea un repository (anche privato non va: per Pages gratuito serve pubblico) e carica tutti i file di questa cartella.
2. Settings → Pages → Source: "Deploy from a branch", branch `main`, cartella `/ (root)` → Save.
3. Dopo 1–2 minuti l'app è su `https://<utente>.github.io/<repository>/`.
4. Sul telefono aprila con Chrome → menu ⋮ → "Aggiungi a schermata Home" / "Installa app".

## Aggiornare
Carica i file nuovi e cambia `VERSIONE` in `sw.js` (es. `sagome-v2`), così i telefoni scaricano la versione nuova.

js-aruco2: licenza in `LICENSE-js-aruco2.txt`.
