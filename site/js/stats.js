import { GROUPS, ORDER, groupKey, groupColor } from './groups.js';
import { age } from './card.js';
import { isEP, onThemeChange } from './theme.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// colori dei grafici per ciascuno stile (vedi theme.js)
const CHART_THEMES = {
  hud: {
    accent: '#38e8ff', muted: '#7f93a8', border: 'rgba(56, 232, 255, 0.12)', grid: 'rgba(56,232,255,0.08)',
    font: "'JetBrains Mono', ui-monospace, monospace", tooltipBg: 'rgba(5, 8, 15, 0.95)', tooltipText: '#dbe7f3', surface: '#05080f', marker: '#fff',
    palette: ['#38e8ff', '#4c6fff', '#ff4d6d', '#ffd23f', '#2ee59d', '#ff7ad9', '#8f7bff', '#5fe3c0', '#3fb6ff', '#c2b280', '#8fe64a', '#9aa7b8'],
    women: '#ff7ad9', men: '#3fb6ff', violet: '#8f7bff', blue: '#4c6fff', green: '#2ee59d', yellow: '#ffd23f', teal: '#5fe3c0',
    scale: ['#ff4d6d', '#ffd23f', '#1f8a62', '#26b57d', '#2ee59d'],
  },
  ep: {
    accent: '#003399', muted: '#5d6b7c', border: '#dde2e9', grid: '#e9edf2',
    font: "'Open Sans', system-ui, sans-serif", tooltipBg: '#ffffff', tooltipText: '#1f2933', surface: '#ffffff', marker: '#1f2933',
    palette: ['#003399', '#2b8cd6', '#d6334a', '#e0a800', '#1b8a52', '#c2408f', '#6a4fc7', '#1f9e89', '#5b7db8', '#9c8a55', '#4c9a2a', '#8794a6'],
    women: '#c2408f', men: '#2b8cd6', violet: '#6a4fc7', blue: '#003399', green: '#1b8a52', yellow: '#e0a800', teal: '#1f9e89',
    scale: ['#c8323f', '#e0a800', '#7cbf98', '#3c9a68', '#1b8a52'],
  },
};
let T = CHART_THEMES.hud;

function applyChartTheme() {
  T = CHART_THEMES[isEP() ? 'ep' : 'hud'];
  Chart.defaults.color = T.muted;
  Chart.defaults.borderColor = T.border;
  Chart.defaults.font.family = T.font;
  Chart.defaults.font.size = 11;
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.plugins.tooltip.backgroundColor = T.tooltipBg;
  Chart.defaults.plugins.tooltip.titleColor = T.tooltipText;
  Chart.defaults.plugins.tooltip.bodyColor = T.tooltipText;
  Chart.defaults.plugins.tooltip.borderColor = T.accent;
  Chart.defaults.plugins.tooltip.borderWidth = 1;
}
applyChartTheme();

const state = { index: null, scope: 'all', charts: {} };

// ---------- normalizzazioni ----------
const key = (p) => groupKey(p.gruppo_sigla, p.gruppo);

function titoloCategoria(t) {
  if (!t) return null;
  const s = t.toLowerCase();
  if (s.startsWith('dottorato') || s.startsWith('phd') || s.startsWith('ph.d')) return 'Dottorato di ricerca';
  if (s.startsWith('master') || s.startsWith('specializzazione') || s.startsWith('abilitazione')) return 'Post-laurea';
  if (s.startsWith('laurea') || s.startsWith('bachelor')) return 'Laurea';
  if (s.startsWith('diploma') || s.startsWith('maturit') || s.startsWith('perito') || s.startsWith('ragionier')) return 'Diploma';
  if (s.startsWith('licenza') || s.startsWith('scuola')) return "Licenza media / dell'obbligo";
  return 'Altro';
}

// indirizzo di laurea, da "Laurea in X" / "Laurea magistrale in X" / "Dottorato in X"
const LAUREA_STEMS = [
  ['giurisprud', 'Giurisprudenza'], ['legge', 'Giurisprudenza'], ['giuridic', 'Giurisprudenza'], ['diritto', 'Giurisprudenza'],
  ['economi', 'Economia'], ['commercio', 'Economia'], ['aziendal', 'Economia'], ['management', 'Economia'], ['finanz', 'Economia'], ['marketing', 'Economia'],
  ['scienze politiche', 'Scienze politiche'], ['relazioni internazionali', 'Scienze politiche'], ['politic', 'Scienze politiche'], ['internazionali e diplomatiche', 'Scienze politiche'], ['amministrazione', 'Scienze politiche'], ['investigazione', 'Scienze politiche'],
  ['letter', 'Lettere e filosofia'], ['filosof', 'Lettere e filosofia'], ['stori', 'Lettere e filosofia'], ['beni culturali', 'Lettere e filosofia'], ['dams', 'Lettere e filosofia'], ['arte', 'Lettere e filosofia'], ['conservatorio', 'Lettere e filosofia'], ['spettacolo', 'Lettere e filosofia'],
  ['ingegner', 'Ingegneria'], ['architett', 'Architettura'], ['urbanist', 'Architettura'], ['design', 'Architettura'],
  ['medicin', 'Medicina e sanità'], ['odontoiatr', 'Medicina e sanità'], ['farmaci', 'Medicina e sanità'], ['infermier', 'Medicina e sanità'], ['veterinar', 'Medicina e sanità'], ['fisioterap', 'Medicina e sanità'], ['ostetric', 'Medicina e sanità'], ['sanitari', 'Medicina e sanità'],
  ['sociolog', 'Sociologia e psicologia'], ['psicolog', 'Sociologia e psicologia'], ['servizio sociale', 'Sociologia e psicologia'], ['scienze sociali', 'Sociologia e psicologia'],
  ['comunicazion', 'Comunicazione'], ['media', 'Comunicazione'], ['scienze della formazione', 'Scienze della formazione'], ['pedagog', 'Scienze della formazione'], ['educazion', 'Scienze della formazione'],
  ['lingue', 'Lingue'], ['matemat', 'Scienze (mat., fis., chim., bio.)'], ['fisic', 'Scienze (mat., fis., chim., bio.)'], ['chimic', 'Scienze (mat., fis., chim., bio.)'], ['biolog', 'Scienze (mat., fis., chim., bio.)'], ['geolog', 'Scienze (mat., fis., chim., bio.)'], ['natural', 'Scienze (mat., fis., chim., bio.)'], ['informa', 'Scienze (mat., fis., chim., bio.)'], ['statistic', 'Scienze (mat., fis., chim., bio.)'], ['trasporti', 'Scienze (mat., fis., chim., bio.)'],
  ['agrar', 'Agraria'], ['forestal', 'Agraria'], ['motorie', 'Scienze motorie'], ['isef', 'Scienze motorie'],
];

function indirizzoLaurea(t) {
  if (!t) return null;
  const s = t.toLowerCase();
  if (!/laurea|dottorato|phd|bachelor|master/.test(s)) return null;
  for (const [stem, label] of LAUREA_STEMS) if (s.includes(stem)) return label;
  return /^(laurea|dottorato)( magistrale| di ricerca| triennale)?$/.test(s.trim()) ? 'Indirizzo non indicato' : 'Altro indirizzo';
}

const PROF_STEMS = [
  ['avvocat', 'Avvocato/a'], ['imprendit', 'Imprenditore/trice'], ['docente universitari', 'Docente universitario/a'],
  ['professor', 'Docente universitario/a'], ['docente', 'Docente'], ['insegnant', 'Insegnante'], ['giornalist', 'Giornalista'],
  ['medic', 'Medico'], ['dirigent', 'Dirigente'], ['consulent', 'Consulente'], ['commercialist', 'Commercialista'],
  ['architett', 'Architetto/a'], ['ingegner', 'Ingegnere/a'], ['funzionari', 'Funzionario/a'], ['impiegat', 'Impiegato/a'],
  ['parlamentar', 'Parlamentare / politico'], ['politic', 'Parlamentare / politico'], ['sindac', 'Amministratore locale'],
  ['pensionat', 'Pensionato/a'], ['libero professionist', 'Libero/a professionista'], ['libera professionist', 'Libero/a professionista'],
  ['magistrat', 'Magistrato/a'], ['notai', 'Notaio/a'], ['farmacist', 'Farmacista'], ['psicolog', 'Psicologo/a'],
  ['agricolt', 'Agricoltore/trice'], ['operai', 'Operaio/a'], ['ricercat', 'Ricercatore/trice'], ['militar', 'Militare / forze dell\'ordine'],
  ['carabinier', 'Militare / forze dell\'ordine'], ['polizi', 'Militare / forze dell\'ordine'], ['student', 'Studente/ssa'],
  ['casaling', 'Casalinga/o'], ['sindacal', 'Sindacalista'], ['infermier', 'Infermiere/a'], ['agente di commercio', 'Agente di commercio'],
];

function professioneNorm(p) {
  if (!p) return null;
  const s = p.toLowerCase().replace(/[.;,]+$/, '').trim();
  for (const [stem, label] of PROF_STEMS) if (s.includes(stem)) return label;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function regione(p) {
  const c = p.circoscrizione;
  if (!c) return p.tipo_elezione === 'estero' ? 'Estero' : (p.tipo_mandato !== 'elettivo' ? 'Senatori a vita' : 'n.d.');
  const s = c.replace(/\s*-\s*[PU]\d+\s*$/, '').replace(/\s+\d+$/, '').trim();
  const up = s.toUpperCase();
  if (/AMERICA|EUROPA|ASIA|AFRICA|OCEANIA/.test(up)) return 'Estero';
  return s.toLowerCase().replace(/(^|[\s-])\S/g, (m) => m.toUpperCase());
}

function fascia(a) {
  if (a == null) return null;
  if (a < 35) return '< 35';
  if (a < 45) return '35–44';
  if (a < 55) return '45–54';
  if (a < 65) return '55–64';
  if (a < 75) return '65–74';
  return '75+';
}

// ---------- helpers ----------
function count(items, fn) {
  const m = new Map();
  for (const it of items) { const k = fn(it); if (k == null) continue; m.set(k, (m.get(k) || 0) + 1); }
  return m;
}
const sortDesc = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function groupsPresent(people) {
  return ORDER.filter((k) => people.some((p) => key(p) === k));
}
function groupLabel(k, people) {
  const p = people.find((x) => key(x) === k);
  return p?.gruppo_sigla || GROUPS[k].label;
}

function card(id, title, text, source, extraClass = 'col-lg-6') {
  return `<div class="${extraClass}"><div class="card h-100 chart-card">
    <div class="card-header">${title}</div>
    <div class="card-body">
      <p class="chart-text">${text}</p>
      <div class="chart-wrap"><canvas id="${id}"></canvas></div>
    </div>
    <div class="card-footer">${source}</div>
  </div></div>`;
}

function chart(id, config) {
  state.charts[id]?.destroy();
  state.charts[id] = new Chart($(`#${id}`), config);
}

const hbar = (labels, data, colors, opts = {}) => ({
  type: 'bar',
  data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0, borderRadius: 2 }] },
  options: {
    indexAxis: 'y', maintainAspectRatio: false,
    plugins: { legend: { display: false }, ...opts.plugins },
    scales: { x: { grid: { color: T.grid }, ticks: { precision: 0 } }, y: { grid: { display: false } } },
    ...opts,
  },
});

const SRC_CAMERA = '<a href="https://dati.camera.it/sparql" target="_blank" rel="noopener">dati.camera.it</a>';
const SRC_SENATO = '<a href="https://dati.senato.it/sparql" target="_blank" rel="noopener">dati.senato.it</a>';
const src = (what) => `Fonte: ${what} — ${SRC_CAMERA}, ${SRC_SENATO} (SPARQL, legislatura XIX).`;

// ---------- render ----------
function render() {
  const all = state.index.parlamentari.filter((p) => p.in_carica && (state.scope === 'all' || p.camera === state.scope));
  const n = all.length;
  const gk = groupsPresent(all);
  const gLabels = gk.map((k) => groupLabel(k, all));
  const gColors = gk.map(groupColor);
  const byGroup = (fn) => gk.map((k) => fn(all.filter((p) => key(p) === k)));
  const ages = all.map((p) => age(p.data_nascita)).filter((x) => x != null);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  // card sintetiche
  const donne = all.filter((p) => p.genere === 'F').length;
  const prime = all.filter((p) => p.n_legislature_precedenti === 0).length;
  const cambi = all.filter((p) => p.cambi_di_gruppo > 0).length;
  const laureati = all.filter((p) => p.camera === 'Camera' && /Laurea|Dottorato|Post/.test(titoloCategoria(p.titolo_studio) || ''));
  const camOnly = all.filter((p) => p.camera === 'Camera').length;
  const youngest = all.reduce((a, p) => (!a || (p.data_nascita && p.data_nascita > a.data_nascita) ? p : a), null);
  const oldest = all.reduce((a, p) => (!a || (p.data_nascita && p.data_nascita < a.data_nascita) ? p : a), null);
  $('#stat-cards').innerHTML = [
    [n, 'parlamentari in carica'],
    [`${pct(donne, n)}%`, `donne (${donne})`],
    [mean(ages)?.toFixed(1) ?? '—', `età media · mediana ${median(ages) ?? '—'}`],
    [`${pct(prime, n)}%`, 'alla prima legislatura'],
    [cambi, 'hanno cambiato gruppo'],
    [camOnly ? `${pct(laureati.length, camOnly)}%` : 'n.d.', camOnly ? 'laureati (solo Camera)' : 'laureati: dato non pubblicato'],
  ].map(([v, l]) => `<div class="col"><div class="card stat-card h-100"><div class="card-body"><div class="value">${v}</div><div class="label">${l}</div></div></div></div>`).join('');

  $('#charts').innerHTML = [
    card('c-gruppi', 'Seggi per gruppo', `Quanti parlamentari in carica appartengono a ciascun gruppo parlamentare (${n} in totale). Il gruppo è quello attuale, non la lista con cui sono stati eletti.`, src('adesione ai gruppi (<code>ocd:aderisce</code>)')),
    card('c-genere', 'Donne e uomini per gruppo', `Percentuale di donne e uomini in ogni gruppo. Nel complesso le donne sono il ${pct(donne, n)}% (${donne} su ${n}).`, src('genere dichiarato (<code>foaf:gender</code>)')),
    card('c-eta', 'Distribuzione per età', `Parlamentari per fascia d'età, calcolata oggi dalla data di nascita. ${youngest ? `Il più giovane: ${esc(youngest.nome)} ${esc(youngest.cognome)} (${age(youngest.data_nascita)} anni)` : ''}${oldest ? `; il più anziano: ${esc(oldest.nome)} ${esc(oldest.cognome)} (${age(oldest.data_nascita)}).` : ''}`, src('data di nascita (<code>bio:date</code>)')),
    card('c-eta-gruppo', 'Età media per gruppo', 'Età media (barra) e mediana (punto) dei componenti di ciascun gruppo. La mediana è meno sensibile a pochi valori estremi.', src('data di nascita')),
    card('c-titolo', 'Titolo di studio', state.scope === 'Senato'
      ? 'Il Senato non pubblica il titolo di studio nei dati aperti: questo grafico è disponibile solo per la Camera.'
      : `Titolo di studio dichiarato, raggruppato per livello. Disponibile solo per i deputati (${camOnly}): il Senato non lo pubblica nei dati aperti.`, src('titolo di studio (<code>dc:description</code>, Camera)')),
    card('c-laurea', 'Indirizzo di laurea', state.scope === 'Senato'
      ? 'Dato disponibile solo per la Camera.'
      : 'Area disciplinare della laurea dichiarata dai deputati laureati (es. "Laurea in giurisprudenza" → Giurisprudenza). Classificazione automatica dal testo libero della dichiarazione.', src('titolo di studio (<code>dc:description</code>, Camera)')),
    card('c-prof', 'Professioni più frequenti', 'Le 14 professioni dichiarate più frequenti. Le dizioni sono state normalizzate (es. "avvocato" e "avvocata" sono conteggiati insieme); la voce originale è nella scheda di ciascun parlamentare.', src('professione dichiarata (<code>dc:description</code> / <code>osr:professione</code>)')),
    card('c-regione', 'Provenienza: circoscrizione di elezione', 'Parlamentari per regione della circoscrizione in cui sono stati eletti (non la regione di nascita). "Estero" raggruppa le ripartizioni della circoscrizione Estero.', src('circoscrizione (<code>dc:coverage</code> / <code>osr:regioneElezione</code>)')),
    card('c-elezione', 'Sistema di elezione per gruppo', 'Quanti componenti di ogni gruppo sono stati eletti nei collegi uninominali (maggioritario), nei collegi plurinominali (proporzionale) o all\'estero. I senatori a vita non sono eletti.', src('tipo di elezione (<code>ocd:tipoElezione</code> / <code>osr:tipoElezione</code>)')),
    card('c-legis', 'Esperienza: legislature precedenti', `Quante legislature ha già fatto ciascun parlamentare prima di questa (Camera o Senato). Il ${pct(prime, n)}% è alla prima esperienza.`, src('mandati nelle legislature precedenti')),
    card('c-prime-gruppo', 'Prima legislatura per gruppo', 'Percentuale di componenti di ogni gruppo che non avevano mai avuto un mandato parlamentare prima del 2022.', src('mandati nelle legislature precedenti')),
    card('c-cambi', 'Mobilità: cambi di gruppo', `Parlamentari che hanno cambiato almeno una volta gruppo dall'inizio della legislatura, per gruppo <em>attuale</em>. In totale ${cambi} su ${n}.`, src('storico delle adesioni ai gruppi con date')),
    card('c-commissioni', 'Carico di lavoro: commissioni', 'Numero di commissioni e organi di cui i parlamentari fanno parte oggi. Non include le commissioni concluse.', src('appartenenza a organi (<code>ocd:membro</code> / <code>osr:afferisce</code>)')),
    ...(state.presenze ? [
      card('c-presenze', 'Presenze alle votazioni per gruppo', 'Quota media di votazioni elettroniche in Aula a cui i componenti di ogni gruppo hanno partecipato dall\'inizio del mandato (barra) e quota in missione (punto). Le missioni sono assenze autorizzate per incarichi istituzionali.', src('voti nominali di tutte le votazioni elettroniche della legislatura')),
      card('c-presenze-dist', 'Distribuzione delle presenze', 'Quanti parlamentari hanno partecipato a una certa quota delle votazioni. Chi è subentrato in corso di legislatura è valutato solo sulle votazioni successive al suo ingresso.', src('voti nominali di tutte le votazioni elettroniche della legislatura')),
    ] : []),
  ].join('');

  // 1. seggi per gruppo
  chart('c-gruppi', hbar(gLabels, byGroup((g) => g.length), gColors));

  // 2. genere per gruppo (stacked %)
  chart('c-genere', {
    type: 'bar',
    data: {
      labels: gLabels,
      datasets: [
        { label: 'Donne', data: byGroup((g) => pct(g.filter((p) => p.genere === 'F').length, g.length)), backgroundColor: T.women, borderWidth: 0 },
        { label: 'Uomini', data: byGroup((g) => pct(g.filter((p) => p.genere === 'M').length, g.length)), backgroundColor: T.men, borderWidth: 0 },
      ],
    },
    options: { indexAxis: 'y', maintainAspectRatio: false, scales: { x: { stacked: true, max: 100, ticks: { callback: (v) => v + '%' } }, y: { stacked: true, grid: { display: false } } }, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw}%` } } } },
  });

  // 3. fasce d'età
  const fasce = ['< 35', '35–44', '45–54', '55–64', '65–74', '75+'];
  const cf = count(all, (p) => fascia(age(p.data_nascita)));
  chart('c-eta', {
    type: 'bar',
    data: { labels: fasce, datasets: [{ data: fasce.map((f) => cf.get(f) || 0), backgroundColor: T.accent, borderWidth: 0, borderRadius: 2 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { precision: 0 } }, x: { grid: { display: false } } } },
  });

  // 4. età media/mediana per gruppo
  chart('c-eta-gruppo', {
    type: 'bar',
    data: {
      labels: gLabels,
      datasets: [
        { type: 'bar', label: 'Media', data: byGroup((g) => +mean(g.map((p) => age(p.data_nascita)).filter((x) => x != null)).toFixed(1)), backgroundColor: gColors.map((c) => c + 'aa'), borderWidth: 0 },
        { type: 'scatter', label: 'Mediana', data: byGroup((g) => median(g.map((p) => age(p.data_nascita)).filter((x) => x != null))), backgroundColor: T.marker, pointRadius: 4 },
      ],
    },
    options: { maintainAspectRatio: false, scales: { y: { min: 30, max: 80 }, x: { grid: { display: false } } } },
  });

  // 5. titolo di studio (solo Camera)
  const ct = sortDesc(count(all.filter((p) => p.camera === 'Camera'), (p) => titoloCategoria(p.titolo_studio) || 'Non dichiarato'));
  chart('c-titolo', {
    type: 'doughnut',
    data: { labels: ct.map((x) => x[0]), datasets: [{ data: ct.map((x) => x[1]), backgroundColor: T.palette, borderColor: T.surface, borderWidth: 2 }] },
    options: { maintainAspectRatio: false, cutout: '58%', plugins: { legend: { position: 'right' } } },
  });

  // 5b. indirizzo di laurea (solo Camera)
  const cli = sortDesc(count(all.filter((p) => p.camera === 'Camera'), (p) => indirizzoLaurea(p.titolo_studio)));
  chart('c-laurea', hbar(cli.map((x) => x[0]), cli.map((x) => x[1]), T.violet));

  // 6. professioni
  const cp = sortDesc(count(all, (p) => professioneNorm(p.professione))).slice(0, 14);
  chart('c-prof', hbar(cp.map((x) => x[0]), cp.map((x) => x[1]), T.accent));

  // 7. regione
  const cr = sortDesc(count(all, regione));
  chart('c-regione', hbar(cr.map((x) => x[0]), cr.map((x) => x[1]), T.blue));

  // 8. sistema di elezione per gruppo
  const tipi = [['uninominale', 'Uninominale', T.green], ['plurinominale', 'Plurinominale', T.blue], ['estero', 'Estero', T.yellow]];
  chart('c-elezione', {
    type: 'bar',
    data: { labels: gLabels, datasets: tipi.map(([t, l, c]) => ({ label: l, data: byGroup((g) => g.filter((p) => p.tipo_elezione === t).length), backgroundColor: c, borderWidth: 0 })) },
    options: { indexAxis: 'y', maintainAspectRatio: false, scales: { x: { stacked: true, ticks: { precision: 0 } }, y: { stacked: true, grid: { display: false } } } },
  });

  // 9. legislature precedenti
  const buckets = ['0', '1', '2', '3', '4+'];
  const cl = count(all, (p) => (p.n_legislature_precedenti >= 4 ? '4+' : String(p.n_legislature_precedenti)));
  chart('c-legis', {
    type: 'bar',
    data: { labels: buckets.map((b) => (b === '0' ? 'Nessuna (prima legislatura)' : `${b} precedenti`)), datasets: [{ data: buckets.map((b) => cl.get(b) || 0), backgroundColor: T.violet, borderWidth: 0, borderRadius: 2 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { precision: 0 } }, x: { grid: { display: false } } } },
  });

  // 10. prima legislatura per gruppo
  chart('c-prime-gruppo', hbar(gLabels, byGroup((g) => pct(g.filter((p) => p.n_legislature_precedenti === 0).length, g.length)), gColors, {
    scales: { x: { max: 100, ticks: { callback: (v) => v + '%' } }, y: { grid: { display: false } } },
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.raw}% alla prima legislatura` } } },
  }));

  // 11. cambi di gruppo
  chart('c-cambi', hbar(gLabels, byGroup((g) => g.filter((p) => p.cambi_di_gruppo > 0).length), gColors));

  // 12. commissioni attive
  const cc = count(all, (p) => (p.n_commissioni_attive >= 5 ? '5+' : String(p.n_commissioni_attive)));
  const ccl = ['0', '1', '2', '3', '4', '5+'];
  chart('c-commissioni', {
    type: 'bar',
    data: { labels: ccl.map((b) => `${b} commission${b === '1' ? 'e' : 'i'}`), datasets: [{ data: ccl.map((b) => cc.get(b) || 0), backgroundColor: T.teal, borderWidth: 0, borderRadius: 2 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { precision: 0 } }, x: { grid: { display: false } } } },
  });

  // 13-14. presenze
  if (state.presenze) {
    const pres = (p) => state.presenze[p.id];
    const withP = all.filter((p) => pres(p)?.votazioni);
    chart('c-presenze', {
      type: 'bar',
      data: {
        labels: gLabels,
        datasets: [
          { type: 'bar', label: 'Ha votato (%)', data: byGroup((g) => { const xs = g.filter((p) => pres(p)?.votazioni).map((p) => pres(p).pct_presenza); return xs.length ? +mean(xs).toFixed(1) : 0; }), backgroundColor: gColors.map((c) => c + 'aa'), borderWidth: 0 },
          { type: 'scatter', label: 'In missione (%)', data: byGroup((g) => { const xs = g.filter((p) => pres(p)?.votazioni).map((p) => pres(p).pct_missione); return xs.length ? +mean(xs).toFixed(1) : 0; }), backgroundColor: T.violet, pointRadius: 4 },
        ],
      },
      options: { maintainAspectRatio: false, scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } }, x: { grid: { display: false } } } },
    });
    const bins = ['< 50%', '50–69%', '70–79%', '80–89%', '90–100%'];
    const cb = count(withP, (p) => { const x = pres(p).pct_presenza; return x < 50 ? bins[0] : x < 70 ? bins[1] : x < 80 ? bins[2] : x < 90 ? bins[3] : bins[4]; });
    chart('c-presenze-dist', {
      type: 'bar',
      data: { labels: bins, datasets: [{ data: bins.map((b) => cb.get(b) || 0), backgroundColor: T.scale, borderWidth: 0, borderRadius: 2 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { precision: 0 } }, x: { grid: { display: false } } } },
    });
  }
}

document.querySelectorAll('input[name=scope]').forEach((r) => r.addEventListener('change', () => { state.scope = r.value; render(); }));

const res = await fetch('data/index.json');
state.index = await res.json();
try { state.presenze = await (await fetch('data/presenze/index.json')).json(); } catch { state.presenze = null; }
$('#updated-at').textContent = state.index.aggiornato_il;
onThemeChange(() => { applyChartTheme(); render(); });
render();
