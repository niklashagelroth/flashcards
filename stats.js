// stats.js — Statistik per kort + urval av "svåra kort".

import { NUM_BOXES, isDue } from './leitner.js';

// Antal granskningar (rätt + fel) för ett kort.
export function reviewCount(card) {
  return (card.correctCount || 0) + (card.incorrectCount || 0);
}

// Träffsäkerhet 0..1. null om kortet aldrig granskats.
export function accuracy(card) {
  const total = reviewCount(card);
  if (total === 0) return null;
  return (card.correctCount || 0) / total;
}

// Procent som heltal, eller '–' om aldrig granskat.
export function accuracyLabel(card) {
  const a = accuracy(card);
  return a === null ? '–' : Math.round(a * 100) + '%';
}

// Sammanfattande statistik över hela samlingen.
export function summarize(cards, now = new Date()) {
  const perBox = {};
  for (let b = 1; b <= NUM_BOXES; b++) perBox[b] = 0;
  let due = 0;
  for (const c of cards) {
    perBox[Math.min(NUM_BOXES, Math.max(1, c.box || 1))]++;
    if (isDue(c, now)) due++;
  }
  return {
    total: cards.length,
    due,
    perBox,
  };
}

// Difficulty-score: högre = svårare. Används för sortering och urval.
// Väger in låg träffsäkerhet, antal fel och lapses.
function difficultyScore(card) {
  const a = accuracy(card);
  const acc = a === null ? 1 : a; // ogranskade räknas som "lätta" (sist)
  const wrong = card.incorrectCount || 0;
  const lapses = card.lapses || 0;
  // Lägre acc → högre score. Plus vikt på faktiska fel/lapses.
  return (1 - acc) * 100 + wrong * 2 + lapses * 3;
}

// Sortera kort från svårast till lättast.
export function byHardest(cards) {
  return [...cards].sort((x, y) => difficultyScore(y) - difficultyScore(x));
}

// Urval för övningsläget "Svåra kort", oberoende av Leitner-schemat.
// Plockar kort som faktiskt granskats och har låg träffsäkerhet / hög felfrekvens.
export function pickHardCards(cards, { threshold = 0.7, minReviews = 1, limit = 50 } = {}) {
  const reviewed = cards.filter((c) => reviewCount(c) >= minReviews);
  let hard = reviewed.filter((c) => {
    const a = accuracy(c);
    return (a !== null && a < threshold) || (c.lapses || 0) >= 2;
  });
  // Om inga under tröskeln: fall tillbaka på de granskade korten med lägst träffsäkerhet.
  if (hard.length === 0) hard = reviewed;
  return byHardest(hard).slice(0, limit);
}

// Topplista över svåraste korten för statistikvyn (endast granskade).
export function hardestList(cards, limit = 10) {
  const reviewed = cards.filter((c) => reviewCount(c) >= 1);
  return byHardest(reviewed).slice(0, limit);
}
