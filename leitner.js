// leitner.js — Spaced repetition (Leitner, 5 boxar) + kortmodell.

export const NUM_BOXES = 5;

// Granskningsintervall per box, i dagar.
// box 1 = varje session (0 dagar), sen 1, 3, 7, 16.
export const BOX_INTERVALS_DAYS = {
  1: 0,
  2: 1,
  3: 3,
  4: 7,
  5: 16,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RECENT_MAX = 10;

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Fallback om randomUUID saknas.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Skapa ett nytt kort. front = franska, back = svenska.
export function createCard({ front, back, example = '', tags = [] }) {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    front: (front || '').trim(),
    back: (back || '').trim(),
    example: (example || '').trim(),
    tags: Array.isArray(tags) ? tags : [],
    box: 1,
    dueDate: now, // direkt förfallet → dyker upp i första sessionen
    correctCount: 0,
    incorrectCount: 0,
    recentResults: [], // lista av true/false, senaste sist (max 10)
    lapses: 0,
    createdAt: now,
    updatedAt: now,
    reviewedAt: null,
  };
}

// Säkerställ att ett (ev. importerat eller äldre) kort har alla fält.
export function normalizeCard(raw) {
  const base = createCard({
    front: raw.front,
    back: raw.back,
    example: raw.example,
    tags: raw.tags,
  });
  const merged = { ...base, ...raw };
  merged.box = clampBox(merged.box);
  if (!Array.isArray(merged.recentResults)) merged.recentResults = [];
  if (typeof merged.correctCount !== 'number') merged.correctCount = 0;
  if (typeof merged.incorrectCount !== 'number') merged.incorrectCount = 0;
  if (typeof merged.lapses !== 'number') merged.lapses = 0;
  if (!merged.dueDate) merged.dueDate = merged.createdAt || new Date().toISOString();
  if (!merged.id) merged.id = base.id;
  return merged;
}

function clampBox(box) {
  const n = Number(box) || 1;
  return Math.min(NUM_BOXES, Math.max(1, Math.round(n)));
}

function addDays(date, days) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

// Är kortet förfallet (due) just nu?
export function isDue(card, now = new Date()) {
  if (!card.dueDate) return true;
  return new Date(card.dueDate).getTime() <= now.getTime();
}

// Applicera ett resultat och returnera ett UPPDATERAT kort (muterar inte).
export function applyResult(card, correct, now = new Date()) {
  const updated = { ...card };
  const nowIso = now.toISOString();

  if (correct) {
    updated.correctCount = (updated.correctCount || 0) + 1;
    updated.box = clampBox((updated.box || 1) + 1);
  } else {
    updated.incorrectCount = (updated.incorrectCount || 0) + 1;
    updated.lapses = (updated.lapses || 0) + 1;
    updated.box = 1;
  }

  const recent = Array.isArray(updated.recentResults) ? [...updated.recentResults] : [];
  recent.push(!!correct);
  while (recent.length > RECENT_MAX) recent.shift();
  updated.recentResults = recent;

  const interval = BOX_INTERVALS_DAYS[updated.box] ?? 0;
  updated.dueDate = addDays(now, interval).toISOString();
  updated.reviewedAt = nowIso;
  updated.updatedAt = nowIso;
  return updated;
}

// Plocka förfallna kort för en vanlig session (slumpad ordning).
export function pickDueCards(cards, now = new Date()) {
  return shuffle(cards.filter((c) => isDue(c, now)));
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
