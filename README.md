# Centro Bucato Card

Centro di controllo per **lavatrice e asciugatrice** in Home Assistant, con grafica
realistica e animata, storico cicli e costo. Gira nel browser e legge/comanda le
entità via `hass`, quindi non dipende da server esterni.

- Lavatrice e asciugatrice **disegnate realistiche e DIVERSE tra loro** (SVG):
  la lavatrice ha cassetto detersivo e tacche livello acqua, l'asciugatrice ha
  sportellino filtro lanugine, sfiato posteriore e manopola temperatura
- **Oblò che gira** quando la macchina è in funzione
- **Acqua + schiuma** animate nella lavatrice, **vapore/calore** nell'asciugatrice
- Stato live (In funzione / Ferma), **potenza (W)**
- **Costo dell'ultimo ciclo** visibile direttamente sulla card (durata, kWh, €)
- **Storico cicli** (data/ora, durata, kWh, costo) e **grafico consumo 7/30 giorni**,
  ricostruiti dallo storico energia già presente in Home Assistant (nessun helper
  nuovo da creare) — si apre toccando l'oblò o "📜 Storico e costi"
- LED e display che si accendono
- Pulsante che **accende/spegne la presa** (se configurata)
- **Editor visuale**: scegli entità, nomi, soglie, prezzo €/kWh senza toccare YAML

## Uso

```yaml
type: custom:centro-bucato-card
title: Lavatoio
prezzo_kwh: 0.30        # €/kWh, costo orientativo
storico_giorni: 14      # 7/14/30 - quanti giorni indietro per storico e grafico
lavatrice:
  name: Lavatrice
  power: sensor.lavatrice_power
  energy: sensor.lavatrice_energy   # serve per storico/costo
  switch: ""          # opzionale (switch. o input_boolean.)
  soglia: 10          # W sopra cui è "in funzione"
asciugatrice:
  name: Asciugatrice
  power: sensor.asciugatrice_power
  energy: sensor.asciugatrice_energy
  switch: ""
  soglia: 10
```
