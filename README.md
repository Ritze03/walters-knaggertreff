# Walters Knaggertreff

Ein bekloppt-liebevolles Brettspiel im Partyspiel-Stil voller deutscher Memes. Läuft komplett im Browser, 2-6 Spieler, jeder an seinem eigenen PC.

## Jetzt spielen

**https://ritze03.github.io/walters-knaggertreff/**

Nur für den PC (Tastatur oder Gamepad), kein Touch, kein Handy. Ein Spieler pro Browser. Sprachchat gibt es nicht im Spiel, ruft euch am besten über Discord o. ä. an.

## Zusammen spielen in 5 Schritten

Kein Server, kein Account: Die Verbindung läuft direkt von Browser zu Browser (WebRTC, Trystero über Nostr-Relays). Einer ist Host, alle anderen kommen per Einladungslink dazu.

1. **Host:** Link oben öffnen, Name, Farbe und Hut wählen, auf **Spiel erstellen** klicken.
2. **Einladung:** In der Lobby den Einladungslink mit dem Kopieren-Button kopieren und z. B. in Discord teilen. Er sieht so aus: `https://ritze03.github.io/walters-knaggertreff/#<gameId>`
3. **Freunde:** Link öffnen, Name, Farbe und Hut wählen, auf **Beitreten** klicken. Jede Farbe gibt es pro Spiel nur einmal.
4. **Host:** Das **Sternziel** einstellen (Standard 5, ca. 45 Minuten mit 4 Spielern, jeder Stern mehr oder weniger ca. 9 Minuten, möglich sind 1-15), das Brett wählen und auf **Start** klicken (ab 2 Spielern).
5. **Gewinnen:** Wer zuerst das Sternziel erreicht, gewinnt. Danach kann der Host eine **Revanche** starten.

Hängt der Beitritt bei "Verbinde mit dem Spiel…"? Manche Netze (strenge Firmen-/Uni-Firewalls, manche Handy-Hotspots) blocken direkte Verbindungen. Dann probiert ein anderes Netzwerk.

### Verbindung weg? Kein Drama

- **Mitspieler:** Einfach denselben Einladungslink im **selben Browser** nochmal öffnen. Ihr bekommt euren Platz samt Münzen, Sternen und Position zurück (der Browser merkt sich euch per localStorage).
- Solange jemand weg ist, spielt das Spiel dessen Platz automatisch mit.
- **Host:** Fällt der Host aus, steht bei allen "Host ist weg — warte…". Der Host öffnet denselben Link im selben Browser, dann geht es vom letzten Speicherstand weiter. Einen Host-Wechsel gibt es nicht, also: Tab offen und im Vordergrund lassen!

## Spielregeln in Kurzform

- Jede Runde würfelt jeder reihum einen **W10** (1-10) und zieht.
- Felder: **blau** = +3 Pfand (Münzen), **rot** = -3, **Eventfelder** = brettspezifisches Chaos, dazu **Shops**.
- Die Spielwirtschaft ist klassisch gehalten: Jeder startet mit **10 Münzen**, der **Stern** kostet **20 Münzen**. Es gibt immer nur einen Stern auf dem Brett. Kaufen kannst du ihn beim Vorbeigehen oder Draufstehen, danach springt er an eine neue Stelle.
- **Items** (max. 3) gibt es im Shop: Doppelwürfel (10), Goldener Döner (12, nochmal würfeln), Münzklau (15, klaut bis zu 10 Münzen) und eine Falle (10, klaut bis zu 8 Münzen), die du auf ein Feld legst.
- Landest du auf dem Feld eines anderen, gibt es ein **Duell** (1-gegen-1-Minispiel um 10 Münzen). Duelle gibt es erst ab Runde 2, nicht auf dem Startfeld und höchstens **eines pro Runde**.
- Nach jeder Runde steigt ein **Minispiel** für alle: Platz 1 bekommt +10, Platz 2 +5, Platz 3 +2 Münzen. Geht ein Minispiel kaputt (fehlt, stürzt ab, Zeit um), gibt es keine Münzen.
- **Endspurt:** Ist jemand nur noch 2 Sterne vom Ziel entfernt, zählen Münzfelder doppelt.

### Bretter

- **Späti-Kiez** - die Straße mit Döner, Pfand und Ordnungsamt
- **DB Hauptbahnhof** - Gleise, Verspätungen und Fundbüro

### Minispiele

- **Forza lädt herunter** - stoppe den Download-Balken bei exakt 100 %
- **Ordnungsamt-Flucht** - weich den Transportern aus und schubs deine Freunde rein
- **Aura-Farming** - Arena: sammle Aura-Kugeln und schubs Rivalen, damit sie Aura verlieren; die meiste Aura gewinnt
- **Sitzplatz-Krieg im ICE** - Team (2 gegen 2): färbe mehr Sitze in deiner Teamfarbe ein, wirf Jacken zum Reservieren und weich dem Schaffner aus
- **Pfand-Tauziehen** - Team (2 gegen 2): wechselt zwischen zwei Tasten, um die Pfandkiste über die Linie zu ziehen
- **U-Bahn-Surfers** - Solo: renn durch den Tunnel, weich Hindernissen aus und sammle Pfand; Strecke plus Pfand zählt
- **Bahnsteig-Chaos** - Arena: der Bahnsteig bricht stückweise weg, schubs Rivalen runter und bleib als Letzter oben
- **Nur nach oben: Knaggerturm** - Solo: spring über Plattformen den Turm hinauf, wer am höchsten kommt, gewinnt
- **Pfandautomat** - füttere den Automaten im Takt mit Flaschen; Müll und schlechtes Timing verstopfen ihn
- **Bürgeramt-Stempel** - ein mürrischer Beamter gibt Befehle, befolge sie nur nach einem "Bitte" und hör auf seine Worte, nicht auf sein Schild
- **Doodle-Knagger** - endloses Hüpfen und Klettern auf Karopapier, die maximale Höhe zählt
- **Döner mit alles** - bau die gezeigte Bestellung so schnell wie möglich zusammen
- **Flappy Taube** - flieg mit einer Taste als Taube durch einen Berliner Hindernisparcours
- **Schlager Hero** - triff die fallenden Noten im Takt eines Schlager-Loops
- Weitere Minispiele folgen.

## Steuerung

| Aktion | Tastatur | Gamepad |
|---|---|---|
| Bewegen / Menü | WASD oder Pfeiltasten | linker Stick oder D-Pad |
| Springen | Leertaste | A |
| Aktion (z. B. Schubsen, Stoppen) | E oder Shift | X oder Y |
| Bestätigen | Enter oder Leertaste | A |
| Zurück | Esc oder Backspace | B |

Gamepads (Xbox, PlayStation, generisch) laufen über die Gamepad-API des Browsers, die Menüs lassen sich komplett per Pad bedienen. Ton lässt sich mit dem 🔇-Button stummschalten. Sprüche nutzen die deutsche Sprachausgabe des Browsers, falls vorhanden; Untertitel gibt es immer.

## Entwicklung

Vite + Vanilla JS.

```bash
npm ci
npm run dev     # Dev-Server
npm test             # Unit-Tests (Regelwerk, headless)
npm run build        # Produktions-Build
npm run test:e2e     # Playwright, 3 Bots spielen ein Match (lokal, Port 4173)
npm run test:online  # Playwright gegen die LIVE-Seite über echte Relays (nur nach einem Deploy sinnvoll)
npm run sim -- --players 4 --target 5   # Balance-Simulation (siehe unten)
```

### Balancing

Alle Regelzahlen stehen in `src/core/rules.js`. `npm run sim` spielt viele Bot-Partien durch die echte Regel-Engine und druckt Runden bis zum Sternziel, geschätzte Minuten (130 s pro Runde), gehaltene Münzen und Duelle pro Runde. Optionen: `--players N`, `--target N`, `--games N`, `--board <id>`, `--max-duels N`, `--json`.

Bei jedem Push auf `main` deployt GitHub Actions automatisch auf GitHub Pages.

### Debug-URL-Parameter

| Parameter | Wirkung |
|---|---|
| `?local` | mehrere Tabs auf einem Rechner spielen gegeneinander (BroadcastChannel, kein Internet nötig) |
| `?pid=<x>` | eigener Spieler pro Tab (mit `?local`) |
| `?bot` | dieser Tab spielt sich selbst |
| `?seed=<n>` | fester Zufalls-Seed |
| `?stars=<n>` | Sternziel vorgeben |
| `?mg=<id>` | Minispiel erzwingen, z. B. `forza` oder `ordnungsamt` |

Beispiel: In zwei Tabs desselben Browsers `http://localhost:5173/walters-knaggertreff/?local&pid=a` und `http://localhost:5173/walters-knaggertreff/?local&pid=b` öffnen.

## Hinweis

Die Memes sind nur Zitate und Witze. Es gibt keine Bilder echter Personen, alle Grafiken und Sounds werden im Code erzeugt.
