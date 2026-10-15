import { Hemicycle } from './hemicycle.js';
import { GROUPS, ORDER, vacantColor, dimmedColor, groupKey, groupColor } from './groups.js';
import { isEP, onThemeChange } from './theme.js';
import { renderCard, renderPresenze, age } from './card.js';

const SEATS = { Camera: 400, Senato: null }; // Senato: 200 eletti + senatori a vita (dai dati)

const state = { index: null, chamber: 'Camera', people: [], seatPeople: [], filter: null, byId: new Map(), votes: [], vote: null };

const VOTE = {
  favorevole: { label: 'Favorevoli', one: 'Favorevole', color: '#2ee59d' },
  contrario: { label: 'Contrari', one: 'Contrario', color: '#ff4d6d' },
  astenuto: { label: 'Astenuti', one: 'Astenuto', color: '#ffd23f' },
  votato: { label: 'Hanno votato (scrutinio segreto)', one: 'Ha votato (scrutinio segreto)', color: '#8f7bff' },
  presente_non_votante: { label: 'Presenti non votanti', one: 'Presente, non votante', color: '#5b6b80' },
  missione: { label: 'In missione', one: 'In missione', color: '#3a4a60' },
  assente: { label: 'Assenti', one: 'Assente', color: '#232c3a' },
};
const VOTE_ORDER = Object.keys(VOTE);

// colori dei voti per lo stile Europarl (fondo chiaro); quelli HUD sono in VOTE
const VOTE_COLORS = {
  hud: Object.fromEntries(VOTE_ORDER.map((k) => [k, VOTE[k].color])),
  ep: { favorevole: '#1b8a52', contrario: '#c8323f', astenuto: '#e0a800', votato: '#6a4fc7', presente_non_votante: '#8c99ab', missione: '#b4bfcd', assente: '#dde2e9' },
};
const applyVoteColors = () => { const p = VOTE_COLORS[isEP() ? 'ep' : 'hud']; VOTE_ORDER.forEach((k) => { VOTE[k].color = p[k]; }); };
applyVoteColors();

const VOTE_HELP = {
  missione: 'Deputati/senatori autorizzati dalla Presidenza ad assentarsi per incarichi istituzionali (delegazioni, missioni di commissione, impegni di governo). Sono conteggiati come presenti ai fini del numero legale. La destinazione della missione non è pubblicata nei dati aperti; compare solo nel resoconto stenografico della seduta.',
  presente_non_votante: 'Presenti in Aula che non hanno partecipato al voto: al Senato è spesso una scelta politica ("non partecipazione al voto").',
  assente: 'Non presenti alla votazione e non in missione.',
  votato: 'Scrutinio segreto: i dati aperti indicano solo chi ha partecipato, non come ha votato.',
};

// sigle usate in Aula alla Camera per l\'oggetto della votazione
const OGGETTO_GLOSSARIO = [
  [/^EM\b/i, 'Emendamento', 'proposta di modifica al testo'],
  [/^SUBEM\b/i, 'Subemendamento', 'modifica a un emendamento'],
  [/^ART\.?\s*AGG/i, 'Articolo aggiuntivo', 'proposta di inserire un nuovo articolo'],
  [/^ART/i, 'Articolo', 'approvazione di un articolo del testo'],
  [/^ODG|^O\.D\.G/i, 'Ordine del giorno', 'impegno politico rivolto al Governo, non modifica il testo'],
  [/^PREG|PREGIUDIZIALE/i, 'Questione pregiudiziale', 'se approvata, l\'esame del provvedimento non prosegue'],
  [/^SOSP|SOSPENSIVA/i, 'Questione sospensiva', 'rinvio dell\'esame'],
  [/FIDUCIA/i, 'Questione di fiducia', 'il Governo lega la propria permanenza all\'approvazione'],
  [/VOTO FINALE|^Votazione finale/i, 'Voto finale', 'approvazione dell\'intero provvedimento'],
  [/^MOZ/i, 'Mozione', 'atto di indirizzo politico'],
  [/^RIS|risoluzione/i, 'Risoluzione', 'atto di indirizzo su un documento'],
  [/^DOC/i, 'Documento', 'relazione o documento parlamentare'],
  [/non passare all'esame/i, 'Proposta di non passare agli articoli', 'se approvata, il disegno di legge è respinto'],
  [/numero legale/i, 'Verifica del numero legale', 'controllo dei presenti, non è un voto di merito'],
];

function spiegaOggetto(oggetto) {
  for (const [re, nome, spiega] of OGGETTO_GLOSSARIO) if (re.test(oggetto)) return { nome, spiega };
  return null;
}

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const panel = new bootstrap.Offcanvas($('#panel'));

const hemicycle = new Hemicycle($('#scene'), {
  onHover(i) {
    if (i < 0) { hemicycle.hideTag(); return; }
    const p = state.seatPeople[i];
    const el = document.createElement('div');
    el.className = 'seat-tag';
    const v = p && state.vote ? state.vote.voti[p.id] || 'assente' : null;
    el.innerHTML = p
      ? `<div class="t-line"></div><div class="t-box"><strong>${esc(p.cognome)}</strong> ${esc(p.nome)}<span>${esc(p.gruppo_sigla || p.gruppo || 'senza gruppo')}</span>${v ? `<span class="t-vote" style="color:${VOTE[v].color}">● ${esc(VOTE[v].one)}</span>` : ''}</div>`
      : `<div class="t-line"></div><div class="t-box"><span>Seggio vacante</span></div>`;
    hemicycle.showTag(i, el);
  },
  onClick(i) {
    const p = state.seatPeople[i];
    if (p) openDossier(p, i);
  },
});

function personKey(p) {
  return groupKey(p.gruppo_sigla, p.gruppo);
}

function build() {
  const all = state.index.parlamentari.filter((p) => p.camera === state.chamber && p.in_carica);
  all.sort((a, b) =>
    ORDER.indexOf(personKey(a)) - ORDER.indexOf(personKey(b)) ||
    a.cognome.localeCompare(b.cognome, 'it') || a.nome.localeCompare(b.nome, 'it'));
  state.people = all;

  const n = SEATS[state.chamber] ?? all.length;
  state.seatPeople = Array.from({ length: n }, (_, i) => all[i] ?? null);
  state.vote = null;
  hemicycle.build(n, colors());
  hemicycle.select(-1);
  $('#hud-chamber').textContent = state.chamber === 'Camera' ? 'Camera dei Deputati' : 'Senato della Repubblica';
  $('#hud-count').textContent = `${all.length} / ${n} seggi`;
  renderLegend();
  renderStats();
  renderSearch();
  renderVoteList();
}

function colors() {
  return state.seatPeople.map((p) => {
    if (!p) return vacantColor();
    if (state.vote) return VOTE[state.vote.voti[p.id] || 'assente'].color;
    const k = personKey(p);
    return state.filter && state.filter !== k ? dimmedColor() : groupColor(k);
  });
}

// ---------- votazioni ----------
function fmtShort(iso) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}`; }

// "Articolo 18", "Emendamento 17.4", "Ordine del giorno n. 22": cosa si vota, in italiano leggibile
function oggettoBreve(v) {
  let o = v.oggetto.replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
  if (v.camera === 'Senato') {
    const chi = (x) => (x ? ` · ${x.trim()}` : '');
    const rs = [
      [/^Votazione finale$/i, () => 'Voto finale'],
      [/^Votazione (questione .+)$/i, (m) => m[1].charAt(0).toUpperCase() + m[1].slice(1)],
      [/^Emm\.\s+(.+?)(?:,\s*([^\d,\s][^,]*))?$/i, (m) => `Emendamenti ${m[1]}${chi(m[2])}`],
      [/^Em\.\s+(.+?)(?:,\s*([^\d,\s][^,]*))?$/i, (m) => `Emendamento ${m[1]}${chi(m[2])}`],
      [/^ODG\s+([^,]+)(?:,\s*(.+))?$/i, (m) => `Ordine del giorno ${m[1]}${chi(m[2])}`],
      [/^Coord\.\s*([^,]+)(?:,\s*(.+))?$/i, (m) => `Proposta di coordinamento ${m[1]}${chi(m[2])}`],
    ];
    for (const [re, fn] of rs) { const m = o.match(re); if (m) return fn(m); }
    return o;
  }
  if (/fiducia/i.test(o)) { const a = o.match(/art\.?\s*(\d+)/i); return `Questione di fiducia${a ? ` sull'articolo ${a[1]}` : ''}`; }
  // toglie il riferimento all'atto in testa: "DDL 2957 - ARTICOLO 1", "TU PDL 2360 E ABB-A - EM 1.500"
  o = o.replace(/^(TU\s+)?(PDL|DDL)\b.*?\s-\s/i, '');
  const r = [
    [/^VOTO FINALE$/i, () => 'Voto finale'],
    [/^ARTICOLO\s+(.+)$/i, (m) => `Articolo ${m[1]}`],
    [/^MANTENIMENTO ARTICOLO\s+(.+)$/i, (m) => `Mantenimento dell'articolo ${m[1]}`],
    [/^ART\.?\s*AGG\.?\s+(.+)$/i, (m) => `${/,/.test(m[1]) ? 'Articoli aggiuntivi' : 'Articolo aggiuntivo'} ${m[1]}`],
    [/^ART\.?\s*PREM\.?\s+(.+)$/i, (m) => `Articolo premissivo ${m[1]}`],
    [/^SUBEM\s+(.+)$/i, (m) => `Subemendamento ${m[1]}`],
    [/^EM\s+(.+?)(\s+RIF)?$/i, (m) => `${/,/.test(m[1]) ? 'Emendamenti' : 'Emendamento'} ${m[1]}${m[2] ? ' (riformulato)' : ''}`],
    [/^ODG\s+.*\/(\d+)$/i, (m) => `Ordine del giorno n. ${m[1]}`],
    [/^PREG\.?\s*COST\.?\s+(.+)$/i, (m) => `Questioni pregiudiziali di costituzionalità ${m[1].toLowerCase()}`],
    [/^DOC\s+([^,]+),\s*N\.?\s*(\S+)(?:\s+-\s+(.+))?$/i, (m) => `Documento ${m[1]} n. ${m[2]}${m[3] ? ` · ${/RIS\s+([\d-]+)/i.test(m[3]) ? `risoluzione ${m[3].match(/RIS\s+([\d-]+)/i)[1]}` : m[3]}` : ''}`],
  ];
  for (const [re, fn] of r) { const m = o.match(re); if (m) return fn(m); }
  return o === o.toUpperCase() ? o.charAt(0) + o.slice(1).toLowerCase() : o;
}

// "Disegno di legge A.C. 2789", "Decreto-legge (conversione) A.C. 3083", "Disegno di legge A.S. 610"
function attoEtichetta(v) {
  const a = v.atto;
  if (!a.numero) return a.tipo === 'Documento' ? 'Documento' : 'Atto parlamentare';
  const num = attoNumero(v);
  if (/conversione in legge/i.test(a.titolo || '')) return `Conversione di decreto-legge · ${num}`;
  if (v.camera === 'Senato') return `${a.tipo || 'Disegno di legge'} · ${num}`;
  const gov = /governo/i.test(a.iniziativa || '');
  return `${gov ? 'Disegno di legge (Governo)' : 'Proposta di legge'} · ${num}`;
}

const attoTitolo = (a) => a.titolo_breve || a.titolo;
// votazioni che per natura non riguardano una legge (documenti, risoluzioni, mozioni, numero legale)
const nonSuLegge = (v) => /^\s*(DOC|MOZ|RIS)\b|risoluzione|mozione|numero legale|comunicazioni/i.test(v.oggetto);
// stati abbreviati dei dati del Senato
function statoAtto(st) {
  if (!st) return null;
  const m = [
    [/^appr\.?\s*def(init)?\.?\s*legge/i, 'approvato definitivamente: è legge'],
    [/^appr\.?\s*def\.?\s*non pubbl/i, 'approvato definitivamente, non ancora pubblicato'],
    [/^appr\.?\s*con modificaz/i, 'approvato con modifiche'],
  ].find(([re]) => re.test(st));
  return m ? m[1] : st;
}
const attoNumero = (v) => (v.atto?.numero ? `${v.camera === 'Camera' ? 'A.C.' : 'A.S.'} ${v.atto.numero}` : '');
const tronca = (t, n) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

// chiave del provvedimento di una votazione; le votazioni senza legge stanno in un gruppo a parte
const leggeKey = (v) => (v.atto ? `atto|${v.atto.numero || v.atto.titolo}` : 'altre');

// scelta in due passi: prima la legge (una voce per provvedimento, anche se votato in più giorni), poi la votazione
function renderVoteList() {
  const list = state.votes.filter((v) => v.camera === state.chamber);
  const leggi = new Map();
  for (const v of list) {
    const k = leggeKey(v);
    if (!leggi.has(k)) leggi.set(k, { v0: v, vs: [] });
    leggi.get(k).vs.push(v);
  }
  state.leggi = leggi;
  // data in testa, così resta visibile anche quando il titolo viene tagliato
  const label = ({ v0, vs }) => {
    const giorni = [...new Set(vs.map((v) => v.data))].sort();
    const quando = giorni.length > 1 ? `${fmtShort(giorni[0]).slice(0, 5)}–${fmtShort(giorni.at(-1))}` : fmtShort(giorni[0]);
    const nome = v0.atto ? [attoNumero(v0), tronca(attoTitolo(v0.atto), 70)].filter(Boolean).join(' · ')
      : vs.every(nonSuLegge) ? 'Altre votazioni (non su leggi)' : 'Altre votazioni (legge non indicata nei dati)';
    return `${quando} · ${nome} (${vs.length} ${vs.length === 1 ? 'voto' : 'voti'})`;
  };
  const date = list.map((v) => v.data).sort();
  const nLeggi = [...leggi.values()].filter((g) => g.v0.atto?.numero).length;
  $('#vote-intro').innerHTML = list.length
    ? `Le <b>${list.length}</b> votazioni in Aula più recenti ${state.chamber === 'Camera' ? 'della Camera' : 'del Senato'}, dal <b>${fmt(date[0])}</b> al <b>${fmt(date.at(-1))}</b>: <b>${nLeggi}</b> leggi. Scegli una legge per vedere come si è votato.`
    : 'Nessuna votazione disponibile.';
  // le leggi in ordine di ultima votazione, le "altre" in fondo
  const ordine = [...leggi.entries()].sort(([a], [b]) => (a === 'altre') - (b === 'altre'));
  $('#law-select').innerHTML = `<option value="">— scegli una legge (${nLeggi}) —</option>`
    + ordine.map(([k, g]) => `<option value="${esc(k)}">${esc(label(g))}</option>`).join('');
  $('#law-select').value = '';
  $('#vote-select').classList.add('d-none');
  $('#vote-select').innerHTML = '';
  $('#vote-result').classList.add('d-none');
  $('#vote-source').classList.add('d-none');
  $('#vote-exit').classList.add('d-none');
}

// elenco delle votazioni di una legge, per giorno; parte subito il voto finale (o il più recente)
function selectLaw(k) {
  const g = state.leggi?.get(k);
  if (!g) { exitVote(); renderVoteList(); return; }
  const perGiorno = new Map();
  for (const v of g.vs) { if (!perGiorno.has(v.data)) perGiorno.set(v.data, []); perGiorno.get(v.data).push(v); }
  const sel = $('#vote-select');
  sel.innerHTML = [...perGiorno.entries()].map(([d, vs]) => `<optgroup label="${fmtShort(d)} · ${vs.length} ${vs.length === 1 ? 'votazione' : 'votazioni'}">`
    + vs.map((v) => `<option value="${v.id}">${v.esito === 'approvato' ? '✓' : '✗'} ${esc(tronca(oggettoBreve(v), 70))}${v.finale && !/finale/i.test(oggettoBreve(v)) ? ' · voto finale' : ''}</option>`).join('')
    + '</optgroup>').join('');
  sel.classList.remove('d-none');
  const primo = g.vs.find((v) => v.finale) || g.vs[0];
  sel.value = primo.id;
  selectVote(primo.id);
}

async function selectVote(id) {
  if (!id) { exitVote(); return; }
  const r = await fetch(`data/votazioni/${encodeURIComponent(id)}.json`);
  state.vote = await r.json();
  state.filter = null;
  closeDossier();
  const target = colors();
  renderVoteResult(voteCounts(), 0);
  hemicycle.animateColors(target, 2400, (k) => renderVoteResult(voteCounts(), k));
  renderLegendVote();
  $('#hud-count').textContent = `${state.vote.camera === 'Camera' ? 'Votazione n.' : 'Seduta/votazione'} ${state.vote.numero} · ${fmtShort(state.vote.data)}`;
  $('#vote-exit').classList.remove('d-none');
}

// conteggio dei seggi già colorati per tipo di voto (segue l'animazione)
function voteCounts() {
  const c = Object.fromEntries(VOTE_ORDER.map((k) => [k, 0]));
  hemicycle.colors.forEach((col, i) => { const p = state.seatPeople[i]; if (!p) return; const k = VOTE_ORDER.find((x) => VOTE[x].color === col); if (k) c[k]++; });
  return c;
}

function renderVoteResult(c, k) {
  const v = state.vote;
  const tot = v.favorevoli + v.contrari + v.astenuti;
  const box = $('#vote-result');
  box.classList.remove('d-none');
  const bar = (key, val) => tot ? `<span style="width:${(val / tot) * 100}%;background:${VOTE[key].color}"></span>` : '';
  const done = k >= 1;
  const a = v.atto;
  const gl = spiegaOggetto(v.oggetto.replace(/^(TU\s+)?(PDL|DDL)\b.*?\s-\s/i, '')) || spiegaOggetto(v.oggetto);
  const attoDesc = a ? [
    a.iniziativa ? `iniziativa ${/^\p{L}+$/u.test(a.iniziativa) ? a.iniziativa.toLowerCase() : a.iniziativa}` : null,
    a.primo_firmatario ? `primo firmatario ${a.primo_firmatario}` : null,
    a.data_presentazione ? `presentato il ${fmt(a.data_presentazione)}` : null,
    statoAtto(a.stato),
  ].filter(Boolean).join(' · ') : '';
  const fonteAtto = {
    resoconto: 'I dati aperti della Camera non collegano articoli ed emendamenti alla legge: il collegamento è letto dal resoconto stenografico della seduta.',
    dedotto: 'Collegamento dedotto dalla votazione più vicina della stessa seduta che cita la legge: da verificare nel resoconto.',
  }[v.atto_fonte];
  const nonLegge = nonSuLegge(v);
  const titoloCompleto = a && a.titolo_breve && a.titolo !== a.titolo_breve ? a.titolo : null;
  box.innerHTML = `
    ${a ? `
      <div class="v-kicker">${esc(attoEtichetta(v))}${fonteAtto ? ` <span class="hud-help" title="${esc(fonteAtto)}">${v.atto_fonte === 'dedotto' ? '(dedotto)' : '(dal resoconto)'}</span>` : ''}</div>
      <div class="v-law">${a.scheda ? `<a href="${esc(a.scheda)}" target="_blank" rel="noopener">${esc(attoTitolo(a))}</a>` : esc(attoTitolo(a))}</div>
      ${titoloCompleto ? `<div class="v-law-full">${esc(titoloCompleto)}</div>` : ''}
      ${attoDesc ? `<div class="v-sub">${esc(attoDesc)}</div>` : ''}` : `
      <div class="v-kicker">${nonLegge ? 'Votazione (non su un disegno di legge)' : 'Provvedimento non indicato nei dati aperti'}</div>
      <div class="v-law">${esc(oggettoBreve(v))}</div>
      ${!nonLegge && v.fonti.resoconto_seduta ? `<div class="v-sub">Il testo votato è indicato nel <a href="${esc(v.fonti.resoconto_seduta)}" target="_blank" rel="noopener">resoconto della seduta</a>.</div>` : ''}`}
    <div class="v-obj"><b>Cosa si vota</b>${a ? `: ${esc(oggettoBreve(v))}` : ''}${gl ? ` <span class="text-secondary">— ${esc(gl.spiega)}</span>` : ''}${oggettoBreve(v) !== v.oggetto ? `<div class="v-code">dicitura ufficiale: ${esc(v.oggetto)}</div>` : ''}</div>
    <div class="v-when">Votazione del <b>${fmt(v.data)}</b> · ${v.camera === 'Camera' ? `seduta n. ${Number(v.numero.slice(0, 3))}, votazione n. ${Number(v.numero.slice(3))}` : `seduta/votazione ${esc(v.numero)}`}</div>
    <div class="v-esito ${v.esito}">${v.esito === 'approvato' ? 'APPROVATA' : v.esito === 'respinto' ? 'RESPINTA' : esc(v.esito || '')}${v.finale ? ' · VOTO FINALE' : ''}${v.fiducia ? ' · FIDUCIA' : ''}${v.segreta ? ' · SCRUTINIO SEGRETO' : ''}</div>
    <div class="v-bar">${bar('favorevole', v.favorevoli)}${bar('astenuto', v.astenuti)}${bar('contrario', v.contrari)}</div>
    <div class="v-counts">
      ${VOTE_ORDER.filter((key) => (done ? (key === 'favorevole' || key === 'contrario' || key === 'astenuto' ? true : c[key] > 0) : c[key] > 0 || ['favorevole', 'contrario', 'astenuto'].includes(key))).map((key) =>
        `<div><span class="swatch" style="background:${VOTE[key].color};color:${VOTE[key].color}"></span><span class="${VOTE_HELP[key] ? 'hud-help' : ''}" title="${esc(VOTE_HELP[key] || '')}">${VOTE[key].label}</span><b>${c[key]}</b></div>`).join('')}
      <div><span class="swatch" style="background:transparent;border:1px solid var(--line-strong)"></span>Maggioranza richiesta<b>${v.maggioranza}</b></div>
    </div>`;
  const src = $('#vote-source');
  src.classList.remove('d-none');
  src.innerHTML = `Fonte: ${v.fonti.scheda_votazione ? `<a href="${esc(v.fonti.scheda_votazione)}" target="_blank" rel="noopener">scheda votazione</a> · ` : ''}<a href="${esc(v.fonti.uri_linked_data)}" target="_blank" rel="noopener">dati aperti</a>${a?.scheda ? ` · <a href="${esc(a.scheda)}" target="_blank" rel="noopener">scheda e testo del provvedimento</a>` : ''}${v.fonti.resoconto_seduta ? ` · <a href="${esc(v.fonti.resoconto_seduta)}" target="_blank" rel="noopener">resoconto della seduta</a>` : ''}.`;
}

// legenda in modalità voto: come ha votato ogni gruppo
function renderLegendVote() {
  const v = state.vote;
  const groups = new Map();
  for (const p of state.people) {
    const k = personKey(p);
    if (!groups.has(k)) groups.set(k, { sigla: p.gruppo_sigla || GROUPS[k].label, n: 0, favorevole: 0, contrario: 0, astenuto: 0, altro: 0 });
    const g = groups.get(k);
    g.n++;
    const x = v.voti[p.id] || 'assente';
    if (x in g) g[x]++; else g.altro++;
  }
  const ul = $('#legend');
  ul.innerHTML = ORDER.filter((k) => groups.has(k)).map((k) => {
    const g = groups.get(k);
    const seg = (key, val) => (val ? `<span style="width:${(val / g.n) * 100}%;background:${VOTE[key].color}" title="${VOTE[key].label}: ${val}"></span>` : '');
    return `<li class="list-group-item vote-row">
      <div class="d-flex justify-content-between"><span><span class="swatch" style="background:${groupColor(k)};color:${groupColor(k)}"></span>${esc(g.sigla)}</span>
      <span class="v-mini"><b style="color:${VOTE.favorevole.color}">${g.favorevole}</b> / <b style="color:${VOTE.contrario.color}">${g.contrario}</b> / <b style="color:${VOTE.astenuto.color}">${g.astenuto}</b></span></div>
      <div class="v-bar sm">${seg('favorevole', g.favorevole)}${seg('astenuto', g.astenuto)}${seg('contrario', g.contrario)}<span style="width:${(g.altro / g.n) * 100}%;background:${VOTE.assente.color}" title="assenti / in missione / non votanti: ${g.altro}"></span></div>
    </li>`;
  }).join('');
  $('#clear-filter').classList.add('d-none');
  $('#legend-source').href = v.fonti.sparql_endpoint;
}

function exitVote() {
  if (!state.vote) return;
  state.vote = null;
  hemicycle.setColors(colors());
  renderLegend();
  renderStats();
  $('#hud-count').textContent = `${state.people.length} / ${state.seatPeople.length} seggi`;
  renderVoteList();
}

$('#vote-select').addEventListener('change', (e) => selectVote(e.target.value));
$('#law-select').addEventListener('change', (e) => selectLaw(e.target.value));
$('#vote-exit').addEventListener('click', exitVote);

function renderLegend() {
  const counts = new Map();
  const names = new Map();
  for (const p of state.people) {
    const k = personKey(p);
    counts.set(k, (counts.get(k) || 0) + 1);
    if (!names.has(k)) names.set(k, p.gruppo && p.gruppo_sigla ? `${p.gruppo} (${p.gruppo_sigla})` : p.gruppo || p.gruppo_sigla || GROUPS[k].label);
  }
  const ul = $('#legend');
  ul.innerHTML = ORDER.filter((k) => counts.has(k)).map((k) => `
    <li class="list-group-item d-flex justify-content-between align-items-center ${state.filter && state.filter !== k ? 'dimmed' : ''} ${state.filter === k ? 'active-group' : ''}" data-key="${k}">
      <span><span class="swatch" style="background:${groupColor(k)};color:${groupColor(k)}"></span>${esc(names.get(k))}</span>
      <span class="badge text-bg-light border">${counts.get(k)}</span>
    </li>`).join('');
  ul.querySelectorAll('li').forEach((li) => li.addEventListener('click', () => setFilter(li.dataset.key === state.filter ? null : li.dataset.key)));
  $('#clear-filter').classList.toggle('d-none', !state.filter);
  $('#legend-source').href = state.index.fonti[state.chamber.toLowerCase()];
  $('#updated-at').textContent = state.index.aggiornato_il;
}

function setFilter(k) {
  if (state.vote) return;
  state.filter = k;
  hemicycle.setColors(colors());
  renderLegend();
  renderStats();
}

function renderStats() {
  const sel = state.filter ? state.people.filter((p) => personKey(p) === state.filter) : state.people;
  const n = sel.length;
  const donne = sel.filter((p) => p.genere === 'F').length;
  const ages = sel.map((p) => age(p.data_nascita)).filter((x) => x != null);
  const etaMedia = ages.length ? (ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1) : '—';
  const cambi = sel.filter((p) => p.cambi_di_gruppo > 0).length;
  const prime = sel.filter((p) => p.n_legislature_precedenti === 0).length;
  const seats = SEATS[state.chamber] ?? n;
  const cards = [
    [state.filter ? n : `${n} / ${seats}`, state.filter ? 'parlamentari nel gruppo' : 'seggi occupati'],
    [n ? `${Math.round((donne / n) * 100)}%` : '—', `donne (${donne})`],
    [etaMedia, 'età media'],
    [n ? `${Math.round((prime / n) * 100)}%` : '—', 'alla prima legislatura'],
    [cambi, 'hanno cambiato gruppo'],
    [state.chamber === 'Senato' ? sel.filter((p) => p.tipo_mandato !== 'elettivo').length : sel.filter((p) => p.tipo_elezione === 'uninominale').length,
      state.chamber === 'Senato' ? 'senatori a vita' : 'eletti nell\'uninominale'],
  ];
  $('#stat-cards').innerHTML = cards.map(([v, l]) => `
    <div class="col"><div class="card stat-card h-100"><div class="card-body p-2">
      <div class="value">${v}</div><div class="label">${l}</div>
    </div></div></div>`).join('');
}

function renderSearch() {
  const dl = $('#search-list');
  dl.innerHTML = state.people.map((p) => `<option value="${esc(p.cognome)} ${esc(p.nome)}${p.gruppo_sigla ? ` (${esc(p.gruppo_sigla)})` : ''}" data-id="${p.id}">`).join('');
}

$('#search').addEventListener('change', (e) => {
  const q = e.target.value.trim().toLowerCase();
  if (!q) return;
  const opt = [...$('#search-list').options].find((o) => {
    const v = o.value.toLowerCase();
    return v === q || v.replace(/\s*\([^)]*\)\s*$/, '') === q;
  });
  if (!opt) return;
  const i = state.seatPeople.findIndex((p) => p && p.id === opt.dataset.id);
  if (i >= 0) openDossier(state.seatPeople[i], i);
  e.target.value = '';
});

const GLYPHS = '▓▒░█ABCDEF0123456789';

// effetto "decodifica": i caratteri si risolvono progressivamente da sinistra
function decode(el, duration = 700) {
  const final = el.dataset.text ?? el.textContent;
  el.dataset.text = final;
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / duration);
    const solved = Math.floor(final.length * k);
    let out = final.slice(0, solved);
    for (let j = solved; j < final.length; j++) out += final[j] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    el.textContent = out;
    if (k < 1) requestAnimationFrame(step);
  };
  step();
}

function fmt(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function openDossier(p, seatIndex) {
  hemicycle.select(seatIndex);
  hemicycle.flyTo(seatIndex);
  const k = personKey(p);
  const col = groupColor(k);
  const eta = age(p.data_nascita);
  const ruolo = p.camera === 'Camera' ? (p.genere === 'F' ? 'Deputata' : 'Deputato') : (p.genere === 'F' ? 'Senatrice' : 'Senatore');
  const rows = [
    ['Nascita', `${fmt(p.data_nascita)}${eta != null ? ` · ${eta} anni` : ''}${p.luogo_nascita ? ` · ${p.luogo_nascita}` : ''}`],
    ['Professione', p.professione || '—'],
    ['Elezione', [p.tipo_elezione, p.circoscrizione].filter(Boolean).join(' · ') || (p.tipo_mandato !== 'elettivo' ? p.tipo_mandato : '—')],
    ['Legislature', p.n_legislature_precedenti ? `${p.n_legislature_precedenti} precedenti` : 'prima legislatura'],
    ['Commissioni', `${p.n_commissioni_attive} attive · ${p.n_incarichi_attivi} incarichi`],
    ['Gruppo', p.cambi_di_gruppo ? `${p.cambi_di_gruppo} cambi di gruppo` : 'nessun cambio'],
  ];
  const voto = state.vote ? state.vote.voti[p.id] || 'assente' : null;
  if (voto) rows.unshift(['Voto', `${VOTE[voto].one} · ${fmt(state.vote.data)}`]);
  const pres = state.presenze?.[p.id];
  if (pres) rows.push(['Presenze', `${pres.pct_presenza}% delle votazioni · ${pres.pct_missione}% in missione`]);
  const el = document.createElement('div');
  el.className = 'dossier';
  el.dataset.group = k;
  el.style.setProperty('--g', col);
  el.innerHTML = `
    <div class="d-line"></div>
    <div class="d-card">
      <div class="d-head">
        <span class="d-tag">DOSSIER // ${esc(p.camera.toUpperCase())}</span>
        <span class="d-id">ID ${esc(p.id.split('_')[1])}</span>
        <button class="d-close" aria-label="Chiudi">×</button>
      </div>
      <div class="d-body">
        <img class="d-photo" src="${esc(p.foto || '')}" alt="" onerror="this.classList.add('missing')">
        <div class="d-main">
          <div class="d-role">${ruolo} · XIX legislatura</div>
          <div class="d-name dec">${esc(p.nome)} ${esc(p.cognome)}</div>
          <div class="d-group"><span class="swatch" style="background:${col};color:${col}"></span><span class="dec">${esc(p.gruppo || p.gruppo_sigla || 'senza gruppo')}</span></div>
          <dl>${rows.map(([l, v]) => `<dt>${l}</dt><dd class="dec">${esc(v)}</dd>`).join('')}</dl>
        </div>
      </div>
      <div class="d-foot">
        <span class="d-status"><i></i>${p.in_carica ? 'IN CARICA' : 'MANDATO CONCLUSO'}</span>
        <button class="d-open">Fascicolo completo →</button>
      </div>
      <div class="d-scan"></div>
    </div>`;
  el.querySelector('.d-close').addEventListener('click', (e) => { e.stopPropagation(); closeDossier(); });
  el.querySelector('.d-open').addEventListener('click', (e) => { e.stopPropagation(); openCard(p, seatIndex); });
  hemicycle.showDossier(seatIndex, el);
  if (!isEP()) el.querySelectorAll('.dec').forEach((n, idx) => setTimeout(() => decode(n), 120 + idx * 60));
}

function closeDossier() {
  hemicycle.hideDossier();
  hemicycle.select(-1);
}

$('#reset-view').addEventListener('click', () => { closeDossier(); hemicycle.resetView(); });

async function openCard(p, seatIndex) {
  hemicycle.select(seatIndex);
  $('#panel-title').textContent = `${p.nome} ${p.cognome}`;
  $('#panel-body').innerHTML = '<p class="text-secondary">Caricamento…</p>';
  panel.show();
  try {
    const r = await fetch(`data/parlamentari/${encodeURIComponent(p.id)}.json`);
    if (!r.ok) throw new Error(r.statusText);
    $('#panel-body').innerHTML = renderCard(await r.json());
    const pr = await fetch(`data/presenze/${encodeURIComponent(p.id)}.json`);
    const box = $('#presenze-box');
    if (box) box.innerHTML = renderPresenze(pr.ok ? await pr.json() : null);
  } catch (err) {
    $('#panel-body').innerHTML = `<p class="text-danger">Impossibile caricare la scheda (${esc(err.message)}).</p>`;
  }
}

$('#panel').addEventListener('hidden.bs.offcanvas', () => { if (!hemicycle.dossier.visible) hemicycle.select(-1); });
$('#clear-filter').addEventListener('click', () => setFilter(null));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const had = hemicycle.dossier.visible; closeDossier(); if (had) hemicycle.resetView(); } });
document.querySelectorAll('input[name=chamber]').forEach((r) =>
  r.addEventListener('change', () => { state.chamber = r.value; state.filter = null; build(); }));

const res = await fetch('data/index.json');
state.index = await res.json();
try {
  state.votes = (await (await fetch('data/votazioni/index.json')).json()).votazioni;
} catch { state.votes = []; }
try {
  state.presenze = await (await fetch('data/presenze/index.json')).json();
} catch { state.presenze = null; }
// cambio di stile: ricolora seggi, legende e dossier aperto senza ricostruire la scena
onThemeChange(() => {
  applyVoteColors();
  hemicycle.setColors(colors());
  if (state.vote) { renderVoteResult(voteCounts(), 1); renderLegendVote(); } else renderLegend();
  document.querySelectorAll('.dossier[data-group]').forEach((el) => {
    const col = groupColor(el.dataset.group);
    el.style.setProperty('--g', col);
    el.querySelectorAll('.d-group .swatch').forEach((sw) => { sw.style.background = col; sw.style.color = col; });
  });
});

build();
