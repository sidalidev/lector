# Maison Autonome : Schémas de Câblage

Ce document illustre les schémas de câblage d'une maison autonome en utilisant WireViz.

## Installation Solaire

Câblage entre les panneaux solaires, le régulateur MPPT, la batterie et l'onduleur.

```wireviz
connectors:
  Panneaux:
    type: MC4
    subtype: Solaire 2x400W
    pinlabels: ["+DC", "-DC"]
    pincolors: [RD, BK]
    color: "#2d5016"
    notes: "2 panneaux en série, 800W"
  MPPT:
    type: Victron
    subtype: SmartSolar 100/30
    pinlabels: ["PV+", "PV-", "BAT+", "BAT-"]
    pincolors: [RD, BK, RD, BK]
    color: "#003366"
  Batterie:
    type: LiFePO4
    subtype: "12V 200Ah"
    pinlabels: ["+", "-"]
    pincolors: [RD, BK]
    color: "#8B0000"
    notes: "2.4 kWh utilisable"
  Onduleur:
    type: Convertisseur
    subtype: "12V → 230V 2000W"
    pinlabels: ["+DC", "-DC"]
    pincolors: [RD, BK]
    color: "#444444"

cables:
  PV:
    wirecount: 2
    gauge: 6
    length: 5
    colors: [RD, BK]
    notes: "Câble solaire H07RN-F"
  BAT:
    wirecount: 2
    gauge: 16
    length: 1.5
    colors: [RD, BK]
    notes: "Câble batterie souple"
  INV:
    wirecount: 2
    gauge: 10
    length: 2
    colors: [RD, BK]

connections:
  - - Panneaux: [1, 2]
    - PV: [1, 2]
    - MPPT: [1, 2]
  - - MPPT: [3, 4]
    - BAT: [1, 2]
    - Batterie: [1, 2]
  - - Batterie: [1, 2]
    - INV: [1, 2]
    - Onduleur: [1, 2]
```

## Câblage Ethernet T568B

Liaison RJ45 Cat6 avec les 8 fils selon la norme T568B.

```wireviz
connectors:
  RJ45_M:
    type: RJ45
    subtype: "Mâle"
    pinlabels: ["TX+", "TX-", "RX+", "BI4+", "BI4-", "RX-", "BI3+", "BI3-"]
    pincolors: [WHOG, OG, WHGN, BU, WHBU, GN, WHBN, BN]
    color: "#336699"
  RJ45_F:
    type: RJ45
    subtype: "Femelle"
    pinlabels: ["TX+", "TX-", "RX+", "BI4+", "BI4-", "RX-", "BI3+", "BI3-"]
    pincolors: [WHOG, OG, WHGN, BU, WHBU, GN, WHBN, BN]
    color: "#336699"

cables:
  CAT6:
    wirecount: 8
    color_code: T568B
    category: "Cat6 U/UTP"
    gauge: 0.5
    length: 15
    shield: false
    wirelabels: ["TX+", "TX-", "RX+", "BI4+", "BI4-", "RX-", "BI3+", "BI3-"]

connections:
  - - RJ45_M: [1-8]
    - CAT6: [1-8]
    - RJ45_F: [1-8]
```

## Circuit Eclairage

Circuit basique : tableau disjoncteur vers interrupteur vers luminaire (phase, neutre, terre).

```wireviz
connectors:
  Tableau:
    type: Disjoncteur
    subtype: "10A courbe C"
    pinlabels: ["Phase", "Neutre", "Terre"]
    pincolors: [RD, BU, YEGN]
    color: "#555555"
    notes: "Départ éclairage"
  Interrupteur:
    type: Simple allumage
    subtype: Legrand Niloe
    pinlabels: ["Entrée L", "Sortie L", "Neutre", "Terre"]
    pincolors: [RD, OG, BU, YEGN]
    color: "#f5f5f0"
  Luminaire:
    type: Plafonnier
    subtype: LED 18W
    pinlabels: ["Phase", "Neutre", "Terre"]
    pincolors: [RD, BU, YEGN]
    color: "#ffffcc"
    notes: "2700K blanc chaud"

cables:
  C1:
    wirecount: 3
    gauge: 1.5
    length: 8
    colors: [RD, BU, YEGN]
    notes: "H07V-U rigide"
  C2:
    wirecount: 3
    gauge: 1.5
    length: 3
    colors: [OG, BU, YEGN]

connections:
  - - Tableau: [1, 2, 3]
    - C1: [1, 2, 3]
    - Interrupteur: [1, 3, 4]
  - - Interrupteur: [2, 3, 4]
    - C2: [1, 2, 3]
    - Luminaire: [1, 2, 3]
```
