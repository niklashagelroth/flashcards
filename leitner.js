// leitner.js — Spaced repetition: SM-2 light (växande intervall + ease) + kortmodell.
//
// I stället för fasta boxar har varje kort ett intervall (dagar till nästa gång)
// och en lätthetsfaktor (ease). Rätt → intervall × ease (växer geometriskt) så
// kort du kan perfekt glider iväg på allt längre intervall och slutar dyka upp i
// dagshögen. Fel → tillbaka till relearning (öva igen) och ease sänks lite.

export const INITIAL_EASE = 2.3;   // startfaktor för nya kort
export const MIN_EASE = 1.3;       // ease kan inte sjunka under detta
export const EASE_PENALTY = 0.2;   // ease sänks så mycket vid fel
export const FIRST_INTERVAL = 1;   // dagar efter första rätt
export const SECOND_INTERVAL = 3;  // dagar efter andra rätt
export const MAX_INTERVAL = 365;   // tak så intervallen inte skenar

// Mognadsnivåer härleds ur intervallet (endast för visning/statistik).
export const NUM_LEVELS = 5;
export const LEVEL_NAMES = { 1: 'Ny', 2: 'Ung', 3: 'Mognar', 4: 'Mogen', 5: 'Behärskar' };

// Gammal box-modell → startintervall, för migrering av äldre kort/backuper.
const OLD_BOX_INTERVALS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 16 };

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
    ease: INITIAL_EASE,
    interval: 0,        // dagar; 0 = ny/relearning → förfallet nu
    reps: 0,            // antal rätt i rad
    dueDate: now,       // direkt förfallet → dyker upp i första sessionen
    correctCount: 0,
    incorrectCount: 0,
    recentResults: [],  // lista av true/false, senaste sist (max 10)
    lapses: 0,
    createdAt: now,
    updatedAt: now,
    reviewedAt: null,
  };
}

// Säkerställ att ett (ev. importerat eller äldre) kort har alla fält.
// Migrerar gamla box-baserade kort till intervall/ease-modellen.
export function normalizeCard(raw) {
  const base = createCard({
    front: raw.front,
    back: raw.back,
    example: raw.example,
    tags: raw.tags,
  });
  const merged = { ...base, ...raw };

  // Migrering: gammalt kort utan intervall men med box → härled intervall/reps.
  if (typeof raw.interval !== 'number') {
    const box = Math.min(5, Math.max(1, Math.round(Number(raw.box) || 1)));
    merged.interval = OLD_BOX_INTERVALS[box] ?? 0;
    merged.reps = Math.max(0, box - 1);
  }

  if (typeof merged.ease !== 'number' || merged.ease < MIN_EASE) merged.ease = INITIAL_EASE;
  if (typeof merged.interval !== 'number' || merged.interval < 0) merged.interval = 0;
  if (typeof merged.reps !== 'number' || merged.reps < 0) merged.reps = 0;
  if (!Array.isArray(merged.recentResults)) merged.recentResults = [];
  if (typeof merged.correctCount !== 'number') merged.correctCount = 0;
  if (typeof merged.incorrectCount !== 'number') merged.incorrectCount = 0;
  if (typeof merged.lapses !== 'number') merged.lapses = 0;
  if (!merged.dueDate) merged.dueDate = merged.createdAt || new Date().toISOString();
  if (!merged.id) merged.id = base.id;
  delete merged.box; // nya modellen använder inte box
  return merged;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

// Härled mognadsnivå (1–5) ur intervallet, för visning och statistik.
export function maturityLevel(card) {
  const i = card.interval || 0;
  if (i < 1) return 1;    // ny / lär in
  if (i < 3) return 2;    // ung
  if (i < 10) return 3;   // mognar
  if (i < 30) return 4;   // mogen
  return 5;               // behärskar
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
  const ease = typeof updated.ease === 'number' ? updated.ease : INITIAL_EASE;

  if (correct) {
    updated.correctCount = (updated.correctCount || 0) + 1;
    updated.reps = (updated.reps || 0) + 1;
    if (updated.reps === 1) {
      updated.interval = FIRST_INTERVAL;
    } else if (updated.reps === 2) {
      updated.interval = SECOND_INTERVAL;
    } else {
      const prev = updated.interval || SECOND_INTERVAL;
      updated.interval = Math.min(MAX_INTERVAL, Math.round(prev * ease));
    }
    updated.ease = ease; // ease är oförändrat vid Rätt
  } else {
    updated.incorrectCount = (updated.incorrectCount || 0) + 1;
    updated.lapses = (updated.lapses || 0) + 1;
    updated.reps = 0;
    updated.ease = Math.max(MIN_EASE, ease - EASE_PENALTY);
    updated.interval = 0; // relearning: öva igen samma dag/session
  }

  const recent = Array.isArray(updated.recentResults) ? [...updated.recentResults] : [];
  recent.push(!!correct);
  while (recent.length > RECENT_MAX) recent.shift();
  updated.recentResults = recent;

  updated.dueDate = addDays(now, updated.interval).toISOString();
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
