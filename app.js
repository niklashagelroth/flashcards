// app.js — UI och applikationslogik. Knyter ihop db/leitner/stats/backup.

import {
  getAllCards, getCard, putCard, deleteCard, bulkPutCards, getMeta, setMeta,
  requestPersistentStorage, storageEstimate,
} from './db.js';
import {
  createCard, normalizeCard, applyResult, pickDueCards, isDue,
  NUM_BOXES, BOX_INTERVALS_DAYS,
} from './leitner.js';
import {
  summarize, accuracy, accuracyLabel, reviewCount, pickHardCards, hardestList,
} from './stats.js';
import {
  exportToFile, readImportFile, importReplace, importMerge, backupReminder,
} from './backup.js';
import { STARTER_DECK } from './starter-deck.js';
import { STARTER_DECK_B1 } from './starter-deck-b1.js';

// Inbyggda kortpaket. Korten har globalt unika id:n så paketen aldrig krockar.
const PACKS = [
  { name: 'B1 – vardagsuttryck', desc: 'extremt användbara vardagsfraser', deck: STARTER_DECK_B1 },
  { name: 'B2 – fraser & uttryck', desc: 'konnektorer, åsikter, idiom', deck: STARTER_DECK },
];

const app = document.getElementById('app');
const viewTitle = document.getElementById('view-title');
const reminderEl = document.getElementById('reminder');
const toastEl = document.getElementById('toast');

let currentView = 'practice';

// ---- Hjälpare ----

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2500);
}

// ---- Navigering ----

function setView(view) {
  currentView = view;
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  render();
}

document.querySelectorAll('.nav-btn').forEach((b) => {
  b.addEventListener('click', () => setView(b.dataset.view));
});

async function render() {
  const cards = await getAllCards();
  await refreshReminder(cards);
  clear(app);
  if (currentView === 'practice') renderPractice(cards);
  else if (currentView === 'cards') renderCards(cards);
  else if (currentView === 'stats') renderStats(cards);
  else if (currentView === 'backup') renderBackup(cards);
}

const TITLES = { practice: 'Öva', cards: 'Kort', stats: 'Statistik', backup: 'Backup' };

// ---- Backuppåminnelse ----

async function refreshReminder(cards) {
  const r = await backupReminder(cards);
  clear(reminderEl);
  if (r.due) {
    reminderEl.classList.remove('hidden');
    reminderEl.appendChild(el('span', {}, `💾 ${r.reason}`));
    reminderEl.appendChild(el('button', {
      type: 'button',
      onclick: () => setView('backup'),
    }, 'Backa upp'));
  } else {
    reminderEl.classList.add('hidden');
  }
}

// =====================================================================
//  ÖVNINGSLÄGE
// =====================================================================

// Sessionstillstånd hålls i modulen så det överlever omrenderingar.
let session = null; // { mode, queue, index, revealed, results }

function renderPractice(cards) {
  viewTitle.textContent = TITLES.practice;

  // Om en session pågår: visa den.
  if (session && session.index < session.queue.length) {
    renderSessionCard();
    return;
  }
  if (session && session.index >= session.queue.length) {
    renderSessionDone();
    return;
  }

  // Startvy: välj läge.
  const dueCards = pickDueCards(cards);
  const hardCards = pickHardCards(cards);

  app.appendChild(el('div', { class: 'mode-switch' }, [
    el('button', { class: 'active', id: 'mode-due', type: 'button' }, `Förfallna (${dueCards.length})`),
    el('button', { id: 'mode-hard', type: 'button' }, `Svåra kort (${hardCards.length})`),
  ]));

  const container = el('div', { id: 'mode-body' });
  app.appendChild(container);

  let mode = 'due';
  const renderModeBody = () => {
    clear(container);
    const list = mode === 'due' ? dueCards : hardCards;
    if (cards.length === 0) {
      container.appendChild(emptyState('🇫🇷', 'Inga kort ännu', 'Lägg till kort under fliken Kort för att börja öva.'));
      return;
    }
    if (list.length === 0) {
      const msg = mode === 'due'
        ? 'Inga förfallna kort just nu. Kom tillbaka senare eller öva svåra kort.'
        : 'Inga svåra kort ännu — öva mer så dyker dina svaga kort upp här.';
      container.appendChild(emptyState('✅', 'Inget att öva', msg));
      return;
    }
    const intro = mode === 'due'
      ? 'Förfallna kort enligt Leitner-schemat.'
      : 'Dina mest felade kort, oberoende av schemat.';
    container.appendChild(el('p', { class: 'muted center' }, intro));
    container.appendChild(el('button', {
      class: 'btn primary',
      type: 'button',
      onclick: () => startSession(mode, list),
    }, `Starta övning (${list.length} kort)`));
  };

  document.getElementById('mode-due').addEventListener('click', () => {
    mode = 'due';
    document.getElementById('mode-due').classList.add('active');
    document.getElementById('mode-hard').classList.remove('active');
    renderModeBody();
  });
  document.getElementById('mode-hard').addEventListener('click', () => {
    mode = 'hard';
    document.getElementById('mode-hard').classList.add('active');
    document.getElementById('mode-due').classList.remove('active');
    renderModeBody();
  });

  renderModeBody();
}

function startSession(mode, queue) {
  session = { mode, queue, index: 0, revealed: false, results: { correct: 0, incorrect: 0 } };
  render();
}

function endSession() {
  session = null;
  render();
}

function renderSessionCard() {
  viewTitle.textContent = session.mode === 'hard' ? 'Svåra kort' : 'Öva';
  const card = session.queue[session.index];
  const remaining = session.queue.length - session.index;

  app.appendChild(el('div', { class: 'session-progress' },
    `Kort ${session.index + 1} av ${session.queue.length} · ${remaining} kvar`));

  const fc = el('div', { class: 'flashcard' });
  // ALLTID svenska (back) först. Avslöja aldrig franskan innan vändning.
  fc.appendChild(el('div', { class: 'label' }, 'Svenska — säg på franska'));
  fc.appendChild(el('div', { class: 'swedish' }, card.back));

  if (session.revealed) {
    fc.appendChild(el('div', { class: 'divider' }));
    fc.appendChild(el('div', { class: 'label' }, 'Franska'));
    fc.appendChild(el('div', { class: 'french' }, card.front));
    if (card.example) fc.appendChild(el('div', { class: 'example' }, card.example));
    if (card.tags && card.tags.length) {
      fc.appendChild(el('div', { class: 'tags' }, card.tags.map((t) => el('span', { class: 'tag' }, t))));
    }
  }
  app.appendChild(fc);

  if (!session.revealed) {
    app.appendChild(el('button', {
      class: 'btn primary', type: 'button',
      onclick: () => { session.revealed = true; render(); },
    }, 'Visa svar'));
  } else {
    app.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn red', type: 'button', onclick: () => grade(false) }, '✗ Fel'),
      el('button', { class: 'btn green', type: 'button', onclick: () => grade(true) }, '✓ Rätt'),
    ]));
  }

  app.appendChild(el('button', {
    class: 'btn ghost small', type: 'button',
    style: 'margin-top:16px;',
    onclick: endSession,
  }, 'Avsluta session'));
}

async function grade(correct) {
  const card = session.queue[session.index];
  const updated = applyResult(card, correct);
  await putCard(updated);
  if (correct) session.results.correct++;
  else session.results.incorrect++;
  session.index++;
  session.revealed = false;
  render();
}

function renderSessionDone() {
  viewTitle.textContent = 'Klart!';
  const { correct, incorrect } = session.results;
  const total = correct + incorrect;
  const pct = total ? Math.round((correct / total) * 100) : 0;
  app.appendChild(el('div', { class: 'empty-state' }, [
    el('div', { class: 'big' }, '🎉'),
    el('h2', {}, 'Session klar'),
    el('p', { class: 'muted' }, `${correct} rätt · ${incorrect} fel · ${pct}% träffsäkerhet`),
  ]));
  app.appendChild(el('button', { class: 'btn primary', type: 'button', onclick: endSession }, 'Tillbaka'));
}

function emptyState(emoji, title, text) {
  return el('div', { class: 'empty-state' }, [
    el('div', { class: 'big' }, emoji),
    el('h2', {}, title),
    el('p', { class: 'muted' }, text),
  ]);
}

// Ladda ett kortpaket. Idempotent: hoppar över kort som redan finns (på id)
// så din inlärningshistorik aldrig skrivs över.
async function loadDeck(deck) {
  const toAdd = [];
  let skipped = 0;
  for (const seed of deck) {
    if (await getCard(seed.id)) { skipped++; continue; }
    const card = createCard({ front: seed.front, back: seed.back, example: seed.example || '', tags: seed.tags || [] });
    card.id = seed.id;
    toAdd.push(card);
  }
  if (toAdd.length) await bulkPutCards(toAdd);
  return { added: toAdd.length, skipped };
}

async function handleLoadPack(pack) {
  const { added, skipped } = await loadDeck(pack.deck);
  if (added === 0) toast(`"${pack.name}" är redan inläst (${skipped} kort finns).`);
  else toast(`${added} kort tillagda från "${pack.name}".`);
  render();
}

// =====================================================================
//  KORT: lista, sök, lägg till, redigera, ta bort
// =====================================================================

let cardSearch = '';

function renderCards(cards) {
  viewTitle.textContent = TITLES.cards;

  app.appendChild(el('button', {
    class: 'btn primary', type: 'button',
    onclick: () => openCardForm(null),
  }, '+ Nytt kort'));

  app.appendChild(el('div', { class: 'search-row', style: 'margin-top:16px;' }, [
    el('input', {
      type: 'search', placeholder: 'Sök franska, svenska, tagg…', value: cardSearch,
      oninput: (e) => { cardSearch = e.target.value; renderCardListOnly(cards); },
    }),
  ]));

  const listWrap = el('div', { id: 'card-list-wrap' });
  app.appendChild(listWrap);
  renderCardListOnly(cards);
}

function renderCardListOnly(cards) {
  const wrap = document.getElementById('card-list-wrap');
  if (!wrap) return;
  clear(wrap);

  const q = cardSearch.trim().toLowerCase();
  const filtered = q
    ? cards.filter((c) =>
        (c.front || '').toLowerCase().includes(q) ||
        (c.back || '').toLowerCase().includes(q) ||
        (c.example || '').toLowerCase().includes(q) ||
        (c.tags || []).some((t) => t.toLowerCase().includes(q)))
    : cards;

  if (cards.length === 0) {
    wrap.appendChild(emptyState('🗂️', 'Inga kort', 'Tryck på "Nytt kort" för att lägga till ditt första — eller ladda ett färdigt paket.'));
    for (const pack of PACKS) {
      wrap.appendChild(el('button', {
        class: 'btn ghost', type: 'button', style: 'margin-bottom:10px;',
        onclick: () => handleLoadPack(pack),
      }, `📚 ${pack.name} (${pack.deck.length} kort)`));
    }
    return;
  }
  if (filtered.length === 0) {
    wrap.appendChild(el('p', { class: 'muted center', style: 'margin-top:20px;' }, 'Inga träffar.'));
    return;
  }

  const sorted = [...filtered].sort((a, b) =>
    Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));

  const list = el('div', { class: 'card-list' });
  for (const c of sorted) {
    const meta = `Box ${c.box} · ${accuracyLabel(c)} (${reviewCount(c)} ggr)` +
      (c.tags && c.tags.length ? ` · ${c.tags.join(', ')}` : '');
    list.appendChild(el('div', { class: 'card-item' }, [
      el('div', { class: 'ci-main' }, [
        el('div', { class: 'ci-front' }, c.front || '(tomt)'),
        el('div', { class: 'ci-back' }, c.back || '(tomt)'),
        el('div', { class: 'ci-meta' }, meta),
      ]),
      el('div', { class: 'ci-actions' }, [
        el('button', { class: 'icon-btn', type: 'button', title: 'Redigera', onclick: () => openCardForm(c) }, '✏️'),
        el('button', { class: 'icon-btn danger', type: 'button', title: 'Ta bort', onclick: () => confirmDelete(c) }, '🗑️'),
      ]),
    ]));
  }
  wrap.appendChild(list);
}

function openCardForm(existing) {
  const isEdit = !!existing;
  const overlay = el('div', { class: 'modal-overlay' });
  const closeModal = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  const frontInput = el('input', { type: 'text', value: existing ? existing.front : '', placeholder: 'p.ex. bonjour' });
  const backInput = el('input', { type: 'text', value: existing ? existing.back : '', placeholder: 'p.ex. god dag' });
  const exampleInput = el('textarea', { placeholder: 'Valfri exempelmening (franska)' });
  exampleInput.value = existing ? (existing.example || '') : '';
  const tagsInput = el('input', { type: 'text', value: existing ? (existing.tags || []).join(', ') : '', placeholder: 'valfria taggar, kommaseparerade' });

  const save = async () => {
    const front = frontInput.value.trim();
    const back = backInput.value.trim();
    if (!front || !back) { toast('Franska och svenska krävs.'); return; }
    const tags = tagsInput.value.split(',').map((t) => t.trim()).filter(Boolean);
    if (isEdit) {
      const updated = { ...existing, front, back, example: exampleInput.value.trim(), tags, updatedAt: new Date().toISOString() };
      await putCard(updated);
      toast('Kort uppdaterat.');
    } else {
      await putCard(createCard({ front, back, example: exampleInput.value.trim(), tags }));
      toast('Kort tillagt.');
    }
    closeModal();
    render();
  };

  const modal = el('div', { class: 'modal' }, [
    el('h3', {}, isEdit ? 'Redigera kort' : 'Nytt kort'),
    el('label', { class: 'field' }, [el('span', {}, 'Franska (front)'), frontInput]),
    el('label', { class: 'field' }, [el('span', {}, 'Svenska (back)'), backInput]),
    el('label', { class: 'field' }, [el('span', {}, 'Exempelmening (valfri)'), exampleInput]),
    el('label', { class: 'field' }, [el('span', {}, 'Taggar (valfria)'), tagsInput]),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', type: 'button', onclick: closeModal }, 'Avbryt'),
      el('button', { class: 'btn primary', type: 'button', onclick: save }, 'Spara'),
    ]),
  ]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  frontInput.focus();
}

function confirmDelete(card) {
  const overlay = el('div', { class: 'modal-overlay' });
  const closeModal = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  overlay.appendChild(el('div', { class: 'modal' }, [
    el('h3', {}, 'Ta bort kort?'),
    el('p', { class: 'muted' }, `"${card.front}" → "${card.back}" tas bort permanent.`),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', type: 'button', onclick: closeModal }, 'Avbryt'),
      el('button', {
        class: 'btn red', type: 'button',
        onclick: async () => { await deleteCard(card.id); closeModal(); toast('Kort borttaget.'); render(); },
      }, 'Ta bort'),
    ]),
  ]));
  document.body.appendChild(overlay);
}

// =====================================================================
//  STATISTIK
// =====================================================================

function renderStats(cards) {
  viewTitle.textContent = TITLES.stats;

  if (cards.length === 0) {
    app.appendChild(emptyState('📊', 'Ingen statistik ännu', 'Lägg till och öva kort för att se statistik.'));
    return;
  }

  const s = summarize(cards);
  const grid = el('div', { class: 'stat-grid' }, [
    statBox(s.total, 'Kort totalt'),
    statBox(s.due, 'Förfallna'),
    statBox(cards.filter((c) => reviewCount(c) > 0).length, 'Övade'),
    statBox(s.perBox[NUM_BOXES], `I box ${NUM_BOXES}`),
  ]);
  app.appendChild(grid);

  // Box-fördelning
  const maxBox = Math.max(1, ...Object.values(s.perBox));
  const bars = el('div', { class: 'box-bars' });
  for (let b = 1; b <= NUM_BOXES; b++) {
    const count = s.perBox[b];
    const interval = BOX_INTERVALS_DAYS[b];
    const intervalLbl = interval === 0 ? 'varje session' : `${interval} d`;
    bars.appendChild(el('div', { class: 'box-bar' }, [
      el('div', { class: 'name', title: intervalLbl }, `Box ${b}`),
      el('div', { class: 'track' }, [el('div', { class: 'fill', style: `width:${(count / maxBox) * 100}%` })]),
      el('div', { class: 'val' }, String(count)),
    ]));
  }
  app.appendChild(el('div', { class: 'panel' }, [el('h2', { class: 'section' }, 'Fördelning per box'), bars]));

  // Svåraste korten
  const hardest = hardestList(cards, 10);
  const panel = el('div', { class: 'panel' }, [el('h2', { class: 'section' }, 'Svåraste korten')]);
  if (hardest.length === 0) {
    panel.appendChild(el('p', { class: 'muted' }, 'Inga övade kort ännu.'));
  } else {
    const list = el('div', { class: 'card-list' });
    for (const c of hardest) {
      list.appendChild(el('div', { class: 'card-item' }, [
        el('div', { class: 'ci-main' }, [
          el('div', { class: 'ci-front' }, c.front),
          el('div', { class: 'ci-back' }, c.back),
          el('div', { class: 'ci-meta' }, `${accuracyLabel(c)} · ${c.correctCount}✓ ${c.incorrectCount}✗ · ${c.lapses} lapses`),
        ]),
      ]));
    }
    panel.appendChild(list);
  }
  app.appendChild(panel);
}

function statBox(num, lbl) {
  return el('div', { class: 'stat-box' }, [
    el('div', { class: 'num' }, String(num)),
    el('div', { class: 'lbl' }, lbl),
  ]);
}

// =====================================================================
//  BACKUP: export / import
// =====================================================================

async function renderBackup(cards) {
  viewTitle.textContent = TITLES.backup;

  const lastExportAt = await getMeta('lastExportAt', null);
  const persisted = (navigator.storage && navigator.storage.persisted)
    ? await navigator.storage.persisted() : null;

  // Export
  const exportPanel = el('div', { class: 'panel' }, [
    el('h2', { class: 'section' }, 'Export'),
    el('p', { class: 'muted', style: 'margin-top:0;' }, `${cards.length} kort. Laddar ner allt (kort + Leitner-tillstånd + statistik) som JSON.`),
    el('div', { class: 'backup-meta' }, lastExportAt
      ? `Senaste backup: ${new Date(lastExportAt).toLocaleString('sv-SE')}`
      : 'Ingen backup gjord ännu.'),
    el('button', {
      class: 'btn primary', type: 'button',
      onclick: async () => {
        if (cards.length === 0) { toast('Inga kort att exportera.'); return; }
        await exportToFile();
        toast('Backup nedladdad.');
        render();
      },
    }, '⬇️ Exportera JSON'),
  ]);
  app.appendChild(exportPanel);

  // Import
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', style: 'display:none;' });
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const obj = await readImportFile(file);
      openImportDialog(obj);
    } catch (err) {
      toast('Fel: ' + err.message);
    }
    fileInput.value = '';
  });

  const importPanel = el('div', { class: 'panel' }, [
    el('h2', { class: 'section' }, 'Import'),
    el('p', { class: 'muted', style: 'margin-top:0;' }, 'Läs in en tidigare backup. Du får välja att ersätta allt eller slå ihop.'),
    fileInput,
    el('button', { class: 'btn ghost', type: 'button', onclick: () => fileInput.click() }, '⬆️ Välj backupfil'),
  ]);
  app.appendChild(importPanel);

  // Färdiga kortpaket
  const starterPanel = el('div', { class: 'panel' }, [
    el('h2', { class: 'section' }, 'Färdiga kortpaket'),
    el('p', { class: 'muted', style: 'margin-top:0;' }, 'Läggs till utan att röra dina egna kort eller din historik.'),
  ]);
  for (const pack of PACKS) {
    starterPanel.appendChild(el('div', { style: 'margin-bottom:14px;' }, [
      el('div', { style: 'font-weight:600;margin-bottom:2px;' }, pack.name),
      el('div', { class: 'muted', style: 'font-size:0.85rem;margin-bottom:6px;' }, `${pack.deck.length} kort · ${pack.desc}`),
      el('button', { class: 'btn ghost', type: 'button', onclick: () => handleLoadPack(pack) }, '📚 Ladda in'),
    ]));
  }
  app.appendChild(starterPanel);

  // Lagringsstatus
  const est = await storageEstimate();
  const storagePanel = el('div', { class: 'panel' }, [
    el('h2', { class: 'section' }, 'Lagring'),
    el('p', { class: 'muted', style: 'margin-top:0;' },
      persisted === true ? '✅ Beständig lagring beviljad — datan rensas inte automatiskt.'
        : persisted === false ? '⚠️ Beständig lagring ej beviljad. Tryck nedan för att be om den.'
        : 'Beständig lagring stöds inte i denna webbläsare.'),
    est ? el('p', { class: 'muted' }, `Använt ca ${formatBytes(est.usage || 0)} av ${formatBytes(est.quota || 0)}.`) : null,
    persisted === false ? el('button', {
      class: 'btn ghost', type: 'button',
      onclick: async () => {
        const ok = await requestPersistentStorage();
        toast(ok ? 'Beständig lagring beviljad.' : 'Begäran nekades.');
        render();
      },
    }, 'Be om beständig lagring') : null,
  ]);
  app.appendChild(storagePanel);
}

function openImportDialog(obj) {
  const count = obj.cards.length;
  const overlay = el('div', { class: 'modal-overlay' });
  const closeModal = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  overlay.appendChild(el('div', { class: 'modal' }, [
    el('h3', {}, 'Importera backup'),
    el('p', { class: 'muted' }, `Filen innehåller ${count} kort (format v${obj.version}).`),
    el('p', { class: 'muted' }, 'Ersätt allt: din nuvarande data raderas och ersätts. Slå ihop: kort läggs till/uppdateras per id (senaste ändring vinner).'),
    el('div', { class: 'btn-row' }, [
      el('button', {
        class: 'btn ghost', type: 'button',
        onclick: async () => {
          const r = await importMerge(obj);
          closeModal();
          toast(`Hopslaget: ${r.added} nya, ${r.updated} uppdaterade.`);
          render();
        },
      }, 'Slå ihop'),
      el('button', {
        class: 'btn red', type: 'button',
        onclick: async () => {
          const n = await importReplace(obj);
          closeModal();
          toast(`Ersatt allt: ${n} kort inlästa.`);
          render();
        },
      }, 'Ersätt allt'),
    ]),
    el('button', { class: 'btn ghost small', type: 'button', style: 'margin-top:12px;', onclick: closeModal }, 'Avbryt'),
  ]));
  document.body.appendChild(overlay);
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// =====================================================================
//  Uppstart
// =====================================================================

async function boot() {
  // Be om beständig lagring vid första start (viktigt mot iOS-rensning).
  const asked = await getMeta('persistAsked', false);
  if (!asked) {
    await requestPersistentStorage();
    await setMeta('persistAsked', true);
  }

  await render();

  // Registrera service worker (relativ sökväg → fungerar på subpath).
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (err) {
      console.warn('SW-registrering misslyckades:', err);
    }
  }
}

boot();
