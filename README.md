# Centro Bucato Card

Card **indipendente** per una lavatrice O un'asciugatrice (metti due card per averle
separate), con grafica realistica animata, rilevamento fase dal consumo, storico
cicli e costo. Gira nel browser e legge/comanda le entità via `hass`, quindi non
dipende da server esterni.

- Una card = una macchina (`kind: lavatrice` o `kind: asciugatrice`) — spostabili,
  ridimensionabili e configurabili in modo indipendente
- Lavatrice e asciugatrice **disegnate realistiche e diverse tra loro**: la lavatrice
  ha cassetto detersivo e tacche livello acqua, l'asciugatrice ha sportellino filtro
  lanugine, sfiato posteriore e manopola temperatura
- **Rilevamento fase dal consumo** (euristica a soglie, regolabile nell'editor):
  Ferma → Lavaggio/risciacquo → Centrifuga (per la lavatrice, l'oblò gira più veloce)
  → Riscaldamento acqua; per l'asciugatrice: Ferma → Ventilazione → Riscaldamento
- **Costo dell'ultimo ciclo** visibile direttamente sulla card (durata, kWh, €)
- **Storico cicli** e **grafico consumo 7/30 giorni**, ricostruiti dallo storico
  energia già presente in Home Assistant (nessun helper nuovo da creare)
- Pulsante che accende/spegne la presa (se configurata)
- **Ridimensionabile in altezza/larghezza** dall'editor dashboard di HA (scheda "Layout")
- **Foto vera opzionale** (`photo_url`): se la imposti, sostituisce il disegno con la tua foto
- **Editor visuale** completo, senza toccare YAML

## Uso

```yaml
type: custom:centro-bucato-card
kind: lavatrice              # lavatrice | asciugatrice
name: Lavatrice
power: sensor.lavatrice_power
energy: sensor.lavatrice_energy   # serve per storico/costo
switch: switch.lavatrice          # opzionale
soglia: 10                        # W sopra cui è "in funzione"
soglia_centrifuga: 300            # solo lavatrice, 0 = disattiva
soglia_riscaldamento: 1500        # 0 = disattiva
prezzo_kwh: 0.30                  # €/kWh, costo orientativo
storico_giorni: 14                # 7/14/30
```

Le soglie di fase sono una stima dal consumo istantaneo: osserva i watt reali
durante un ciclo (Storico → sviluppatori → Stati) e regola i valori nell'editor
per separare bene lavaggio/centrifuga/riscaldamento sulla tua macchina.
