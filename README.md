# Franska Flashcards

En personlig PWA för att träna **muntlig produktion** av franska. Övningen utgår
alltid från svenskan — du säger den franska motsvarigheten högt och vänder sedan
kortet för att bedöma dig själv. Installeras på iPhone via Safari, fungerar offline,
och all data ligger lokalt i IndexedDB med manuell backup.

## Funktioner

- **Övningsläge** — visar svenska först, avslöjar aldrig franskan innan du vänder kortet. Knapparna *Rätt*/*Fel* uppdaterar både Leitner-box och statistik.
- **Spaced repetition (SM-2 light)** — varje kort har ett intervall och en lätthetsfaktor (`ease`). Rätt → intervallet växer (1 → 3 → 7 → 16 → 37 … dagar), så kort du kan perfekt glider iväg på allt längre intervall och slutar belasta dagshögen. Fel → tillbaka till relearning (öva igen) och `ease` sänks lite så kortet kommer tätare ett tag. Gamla box-baserade kort/backuper (v1) migreras automatiskt.
- **Svåra kort** — separat läge som plockar dina mest felade kort, oberoende av schemat.
- **Statistik** — totalt/förfallna/övade, fördelning per box, och topplista över svåraste korten.
- **Kort** — lägg till, redigera, ta bort och sök. Fält: franska, svenska, valfri exempelmening, valfria taggar.
- **Färdiga kortpaket** — två inbyggda paket att ladda in: **B1 – vardagsuttryck** (100 extremt användbara vardagsfraser) och **B2 – fraser & uttryck** (100 konnektorer, åsikter, idiom, flera med subjonctif). Ladda dem från tomma Kort-vyn eller under Backup. Idempotent — befintliga kort och din historik rörs aldrig.
- **Backup** — exportera hela databasen som tidsstämplad JSON (`franska-flashcards-ÅÅÅÅ-MM-DD.json`), importera med *Ersätt allt* eller *Slå ihop*. Diskret påminnelse om backup är > 7 dagar gammal eller kort ändrats sedan dess.

## Köra lokalt

Ingen byggprocess, inga beroenden. Servera mappen över HTTP (krävs för service worker):

```sh
python3 -m http.server 8000
# öppna http://localhost:8000
```

## Deploya på GitHub Pages (gratis)

1. Skapa ett repo och pusha alla filer till `main`.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**, välj `main` / `/ (root)`.
3. Appen hamnar på `https://<användare>.github.io/<repo>/`. Alla sökvägar är relativa, så subpathen fungerar utan ändringar.

## Installera på iPhone

Öppna sidan i **Safari** → dela-knappen → **Lägg till på hemskärmen**. Appen startar sedan i helskärm och fungerar offline.

> **Tips:** Tryck *Be om beständig lagring* under Backup och exportera regelbundet — iOS Safari kan annars rensa lokal data.

## Filer

| Fil | Ansvar |
|-----|--------|
| `index.html`, `styles.css` | UI-skal (mobile-first) |
| `app.js` | Vyer och applikationslogik |
| `db.js` | IndexedDB (kort + metadata, persistent storage) |
| `leitner.js` | Kortmodell + spaced repetition |
| `stats.js` | Träffsäkerhet + urval av svåra kort |
| `backup.js` | Export/import + backuppåminnelse |
| `starter-deck.js` | Kortpaket B2 (100 fraser & uttryck) |
| `starter-deck-b1.js` | Kortpaket B1 (100 vardagsuttryck) |
| `manifest.json`, `sw.js` | PWA: installerbar + offline |
| `icons/` | App-ikoner (regenereras med `node generate-icons.js`) |

## Backup-format

```json
{ "version": 1, "exportedAt": "ISO-tid", "cards": [ /* alla kort med fullt tillstånd */ ] }
```

`version` finns från start så framtida formatändringar kan läsa in gamla backuper.
