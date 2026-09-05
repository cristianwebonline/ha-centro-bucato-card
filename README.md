# Centro Bucato Card

Centro di controllo per **lavatrice e asciugatrice** in Home Assistant, con grafica
realistica e animata. Gira nel browser e legge/comanda le entità via `hass`, quindi
non dipende da server esterni.

- Lavatrice e asciugatrice **disegnate realistiche** (SVG): corpo, pannello, oblò in vetro
- **Oblò che gira** quando la macchina è in funzione
- **Acqua + schiuma** animate nella lavatrice, **vapore/calore** nell'asciugatrice
- Stato live (In funzione / Ferma), **potenza (W)** ed **energia (kWh)**
- LED e display che si accendono
- Pulsante che **accende/spegne la presa** (se configurata) o apre i dettagli
- **Editor visuale**: scegli entità, nomi, soglie senza toccare YAML

## Uso

```yaml
type: custom:centro-bucato-card
title: Lavatoio
lavatrice:
  name: Lavatrice
  power: sensor.lavatrice_power
  energy: sensor.lavatrice_energy
  switch: ""          # opzionale (switch. o input_boolean.)
  soglia: 10          # W sopra cui è "in funzione"
asciugatrice:
  name: Asciugatrice
  power: sensor.asciugatrice_power
  energy: sensor.asciugatrice_energy
  switch: ""
  soglia: 10
```
