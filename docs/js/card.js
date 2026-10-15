import { groupKey, groupColor } from './groups.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return d && m ? `${d}/${m}/${y}` : iso;
}

export function age(iso) {
  if (!iso) return null;
  const b = new Date(iso), now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) a--;
  return a;
}

const dash = (v) => (v == null || v === '' ? '—' : esc(v));
const period = (dal, al) => `${fmtDate(dal)} → ${al ? fmtDate(al) : 'in corso'}`;

function row(label, value) {
  return `<tr><td>${label}</td><td>${value}</td></tr>`;
}

function section(title, body, sourceUrl, sourceLabel = 'fonte') {
  const src = sourceUrl ? ` <a class="source" href="${esc(sourceUrl)}" target="_blank" rel="noopener">${sourceLabel} ↗</a>` : '';
  return `<div class="section-title">${title}${src}</div>${body}`;
}

function list(items, render, empty = 'Nessun dato disponibile.') {
  if (!items || !items.length) return `<p class="small text-secondary mb-0">${empty}</p>`;
  return `<ul class="list-unstyled small mb-0">${items.map((i) => `<li class="mb-1">${render(i)}</li>`).join('')}</ul>`;
}

export function renderCard(p) {
  const a = p.anagrafica, e = p.elezione, m = p.mandato, pol = p.politica, f = p.fonti;
  const g = pol.gruppo_attuale;
  const key = groupKey(g?.sigla, g?.nome);
  const scheda = f.scheda_ufficiale;
  const sparql = f.uri_linked_data;
  const eta = age(a.data_nascita);

  const head = `
    <div class="d-flex gap-3">
      <img class="photo" src="${esc(a.foto || '')}" alt="" onerror="this.style.visibility='hidden'">
      <div>
        <div class="text-secondary small">${p.camera === 'Camera' ? 'Deputat' + (a.genere === 'F' ? 'a' : 'o') : 'Senat' + (a.genere === 'F' ? 'rice' : 'ore')} · XIX legislatura</div>
        <h4 class="mb-1">${esc(a.nome)} ${esc(a.cognome)}</h4>
        <div class="mb-2">
          ${g ? `<span class="swatch" style="background:${groupColor(key)}"></span>${esc(g.nome || g.sigla)}${g.sigla && g.nome ? ` <span class="text-secondary">(${esc(g.sigla)})</span>` : ''}` : '<span class="text-secondary">senza gruppo</span>'}
        </div>
        ${!m.in_carica ? `<span class="badge text-bg-light border">mandato concluso il ${fmtDate(m.fine)}</span>` : ''}
        ${m.tipo !== 'elettivo' ? `<span class="badge text-bg-light border">${esc(m.tipo)}</span>` : ''}
      </div>
    </div>`;

  const anagrafica = `<table class="table table-sm table-borderless mb-0">
    ${row('Nascita', `${fmtDate(a.data_nascita)}${eta != null ? ` (${eta} anni)` : ''}${a.luogo_nascita ? `, ${esc(a.luogo_nascita)}` : ''}`)}
    ${row('Titolo di studio', dash(a.titolo_studio))}
    ${row('Professione', dash(a.professione))}
  </table>`;

  const elezione = `<table class="table table-sm table-borderless mb-0">
    ${row('Tipo', dash(e.tipo))}
    ${row('Circoscrizione', dash(e.circoscrizione))}
    ${row('Collegio', dash(e.collegio))}
    ${row('Lista', dash(e.lista))}
    ${row('Elezione', fmtDate(e.data_elezione))}
    ${row('Proclamazione', fmtDate(e.data_proclamazione))}
    ${e.descrizione ? row('Note', esc(e.descrizione)) : ''}
  </table>`;

  const gruppi = list(pol.storico_gruppi, (x) =>
    `<span class="swatch" style="background:${groupColor(groupKey(x.sigla, x.nome))}"></span>${esc(x.nome || x.sigla)}
     <span class="text-secondary">· ${period(x.dal, x.al)}${x.motivo_fine ? ` · ${esc(x.motivo_fine)}` : ''}</span>`);

  const legs = pol.legislature_precedenti?.length
    ? `<p class="small mb-0">${pol.legislature_precedenti.map((l) => `${l.legislatura}ª (${esc(l.camera)})`).join(', ')}</p>`
    : '<p class="small text-secondary mb-0">Prima legislatura.</p>';

  const commAttive = p.ruoli.commissioni.filter((c) => !c.al);
  const commPassate = p.ruoli.commissioni.filter((c) => c.al);
  const commissioni = list(commAttive, (c) => `${esc(c.nome)} <span class="text-secondary">· ${esc(c.ruolo || '')} dal ${fmtDate(c.dal)}</span>`, 'Nessuna commissione attiva.')
    + (commPassate.length ? `<details class="small mt-1"><summary class="text-secondary">${commPassate.length} precedenti</summary>${list(commPassate, (c) => `${esc(c.nome)} <span class="text-secondary">· ${esc(c.ruolo || '')} · ${period(c.dal, c.al)}</span>`)}</details>` : '');

  const incarichi = list(p.ruoli.incarichi, (i) => `<strong>${esc(i.carica)}</strong> ${i.organo ? `· ${esc(i.organo)}` : ''} <span class="text-secondary">· ${period(i.dal, i.al)}</span>`, 'Nessun incarico registrato.');

  const schedaDich = f.dichiarazioni || scheda;
  const docs = (p.documenti_patrimoniali?.length
    ? `<p class="small mb-1">Documentazione patrimoniale e dichiarazione dei redditi (PDF): ${p.documenti_patrimoniali.map((d) => `<a href="${esc(d.url)}" target="_blank" rel="noopener">${d.anno}</a>`).join(' · ')}</p>`
    : `<p class="small text-secondary mb-1">Nessun PDF pubblicato finora sulla <a href="${esc(schedaDich)}" target="_blank" rel="noopener">scheda ufficiale</a>.</p>`)
    + (p.dichiarazione_cariche ? `<p class="small mb-1"><a href="${esc(p.dichiarazione_cariche)}" target="_blank" rel="noopener">Dichiarazione di cariche e professioni</a> (Codice di condotta)</p>` : '')
    + '<p class="small text-secondary mb-0">I valori di reddito e patrimonio saranno mostrati solo dopo verifica manuale dei PDF.</p>';

  const presenze = '<div id="presenze-box" class="small text-secondary">Caricamento presenze…</div>';

  const fonti = `<ul class="list-unstyled small mb-0">
    <li><a href="${esc(scheda)}" target="_blank" rel="noopener">Scheda personale ufficiale</a></li>
    <li><a href="${esc(sparql)}" target="_blank" rel="noopener">Dati aperti (linked data)</a> — endpoint <a href="${esc(f.sparql_endpoint)}" target="_blank" rel="noopener">SPARQL</a></li>
    ${a.foto_fonte ? `<li>Foto: ${esc(a.foto_fonte)}${f.wikidata ? ` — <a href="${esc(f.wikidata)}" target="_blank" rel="noopener">Wikidata</a>` : ''}</li>` : ''}
    <li class="text-secondary">Aggiornato il ${fmtDate(f.aggiornato_il)}</li>
  </ul>`;

  return head
    + section('Anagrafica', anagrafica, scheda, 'scheda')
    + section('Elezione e mandato', elezione, sparql, 'dati aperti')
    + section('Gruppo parlamentare', gruppi, sparql, 'dati aperti')
    + section('Legislature precedenti', legs, sparql, 'dati aperti')
    + section('Commissioni', commissioni, sparql, 'dati aperti')
    + section('Incarichi', incarichi, sparql, 'dati aperti')
    + section('Presenze alle votazioni in Aula', presenze, f.sparql_endpoint, 'SPARQL')
    + section('Dichiarazioni patrimoniali e dei redditi', docs, schedaDich, 'scheda')
    + section('Fonti', fonti);
}

// calendario presenze: una cella per seduta con votazioni, raggruppate per mese
export function renderPresenze(d) {
  if (!d) return '<p class="small text-secondary mb-0">Dati di presenza non ancora elaborati per questo parlamentare.</p>';
  const t = d.totali;
  const months = new Map();
  for (const s of d.sedute) {
    const m = s.data.slice(0, 7);
    if (!months.has(m)) months.set(m, []);
    months.get(m).push(s);
  }
  const cls = (s) => {
    if (!s.votazioni) return 'none';
    const r = s.votato / s.votazioni;
    if (s.missione >= s.votazioni * 0.5 && r < 0.5) return 'miss';
    if (r >= 0.75) return 'p4'; if (r >= 0.5) return 'p3'; if (r >= 0.25) return 'p2'; if (r > 0) return 'p1';
    return 'abs';
  };
  const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const grid = [...months.entries()].map(([m, ss]) => {
    const [y, mm] = m.split('-');
    return `<div class="cal-month"><div class="cal-label">${MESI[+mm - 1]} ${y.slice(2)}</div><div class="cal-cells">${ss.map((s) =>
      `<span class="cal-cell ${cls(s)}" title="${fmtDate(s.data)}: ${s.votato}/${s.votazioni} votazioni${s.missione ? `, ${s.missione} in missione` : ''}${s.presente_non_votante ? `, ${s.presente_non_votante} presente non votante` : ''}${s.assente ? `, ${s.assente} assente` : ''}"></span>`).join('')}</div></div>`;
  }).join('');
  const pnv = t.presente_non_votante ? `<tr><td>Presente, non votante</td><td>${t.presente_non_votante} <span class="text-secondary">(${(100 * t.presente_non_votante / t.votazioni).toFixed(1)}%)</span></td></tr>` : '';
  return `
    <table class="table table-sm table-borderless mb-2">
      <tr><td>Votazioni elettroniche</td><td>${t.votazioni} in ${t.sedute_con_votazioni} sedute (dall'inizio del mandato)</td></tr>
      <tr><td>Ha votato</td><td><b>${t.pct_presenza}%</b> <span class="text-secondary">(${t.votato})</span></td></tr>
      <tr><td>In missione</td><td>${t.pct_missione}% <span class="text-secondary">(${t.missione})</span></td></tr>
      ${pnv}
      <tr><td>Assente</td><td>${t.pct_assenza}% <span class="text-secondary">(${t.assente})</span></td></tr>
      <tr><td>Sedute con almeno un voto</td><td>${t.sedute_presente} su ${t.sedute_con_votazioni}</td></tr>
    </table>
    <div class="cal">${grid}</div>
    <div class="cal-legend"><span class="cal-cell p4"></span> &ge;75% dei voti &nbsp; <span class="cal-cell p2"></span> parziale &nbsp; <span class="cal-cell abs"></span> assente &nbsp; <span class="cal-cell miss"></span> in missione</div>
    <p class="small text-secondary mt-2 mb-0">Ogni cella è una seduta con votazioni elettroniche; il colore indica la quota di votazioni a cui ha partecipato. "In missione" = assenza autorizzata per incarichi istituzionali (conteggiata come presenza ai fini del numero legale); i dati aperti non indicano la destinazione.</p>`;
}
