// backup.js — Export/import av hela databasen som JSON.
// version-fältet finns från start så framtida format kan läsa gamla backuper.

import { getAllCards, bulkPutCards, clearCards, getCard, setMeta, getMeta } from './db.js';
import { normalizeCard } from './leitner.js';

export const EXPORT_VERSION = 1;

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Bygg export-objektet.
export async function buildExport() {
  const cards = await getAllCards();
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    cards,
  };
}

// Ladda ner hela databasen som tidsstämplad JSON-fil.
export async function exportToFile() {
  const data = await buildExport();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `franska-flashcards-${dateStamp()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  await setMeta('lastExportAt', data.exportedAt);
  return data;
}

// Validera ett inläst objekt. Kastar fel med begripligt meddelande.
export function validateImport(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Filen är inte giltig JSON.');
  if (typeof obj.version !== 'number') throw new Error('Saknar version-fält.');
  if (obj.version > EXPORT_VERSION) {
    throw new Error(`Backupen är från en nyare appversion (v${obj.version}). Uppdatera appen först.`);
  }
  if (!Array.isArray(obj.cards)) throw new Error('Saknar kort-lista (cards).');
  return true;
}

// Läs en File och returnera det parsade, validerade objektet.
export async function readImportFile(file) {
  const text = await file.text();
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('Kunde inte tolka filen som JSON.');
  }
  validateImport(obj);
  return obj;
}

// Ersätt allt: töm databasen och skriv in backupens kort.
export async function importReplace(obj) {
  validateImport(obj);
  const cards = obj.cards.map(normalizeCard);
  await clearCards();
  await bulkPutCards(cards);
  return cards.length;
}

// Slå ihop: merge på id. Vid konflikt behålls det kort som ändrats senast (updatedAt).
export async function importMerge(obj) {
  validateImport(obj);
  let added = 0;
  let updated = 0;
  const toWrite = [];
  for (const raw of obj.cards) {
    const incoming = normalizeCard(raw);
    const existing = await getCard(incoming.id);
    if (!existing) {
      toWrite.push(incoming);
      added++;
    } else {
      const existingTime = Date.parse(existing.updatedAt || existing.createdAt || 0) || 0;
      const incomingTime = Date.parse(incoming.updatedAt || incoming.createdAt || 0) || 0;
      if (incomingTime > existingTime) {
        toWrite.push(incoming);
        updated++;
      }
    }
  }
  if (toWrite.length) await bulkPutCards(toWrite);
  return { added, updated };
}

// ---- Påminnelse om backup ----
// Påminn om senaste export var > 7 dagar sen, eller om kort lagts till/ändrats sen dess.
export async function backupReminder(cards) {
  const lastExportAt = await getMeta('lastExportAt', null);
  if (!lastExportAt) {
    if (cards.length > 0) return { due: true, reason: 'Du har aldrig exporterat en backup.' };
    return { due: false };
  }
  const last = Date.parse(lastExportAt);
  const days = (Date.now() - last) / (24 * 60 * 60 * 1000);
  if (days >= 7) {
    return { due: true, reason: `Senaste backup var ${Math.floor(days)} dagar sedan.` };
  }
  // Har något kort ändrats efter senaste export?
  const changedSince = cards.some((c) => Date.parse(c.updatedAt || c.createdAt || 0) > last);
  if (changedSince) {
    return { due: true, reason: 'Du har ändrat kort sedan senaste backup.' };
  }
  return { due: false };
}
