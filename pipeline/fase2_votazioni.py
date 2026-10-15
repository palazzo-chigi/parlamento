"""Fase 2 — Votazioni elettroniche in Assemblea (Camera e Senato) con il voto di ogni parlamentare.

Uso:
    python -m pipeline.fase2_votazioni [--n 40] [--solo camera|senato]

Output:
    data/votazioni/index.json                 elenco delle votazioni (senza i voti individuali)
    data/votazioni/<id>.json                  una votazione con il voto di ciascun parlamentare
"""
from __future__ import annotations

import argparse
import html
import json
import re
from collections import defaultdict
from pathlib import Path

from .camera import iso
from .resoconti_camera import atti_per_votazione, resoconto
from .sparql import CAMERA, SENATO, query

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "votazioni"
LEG_C = "http://dati.camera.it/ocd/legislatura.rdf/repubblica_19"

PFX_C = """
PREFIX ocd: <http://dati.camera.it/ocd/>
PREFIX dc: <http://purl.org/dc/elements/1.1/>
PREFIX dcterms: <http://purl.org/dc/terms/>
"""
PFX_S = """
PREFIX osr: <http://dati.senato.it/osr/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
"""

# ---------------------------------------------------------------- Camera
Q_VOTAZIONI_C = PFX_C + """
SELECT DISTINCT ?v ?data ?ident ?desc ?tipo ?finale ?fiducia ?segreta ?approvato ?fav ?con ?ast ?pres ?vot ?magg ?scheda WHERE {
  { SELECT DISTINCT ?v ?data ?ident WHERE {
      ?v a ocd:votazione ; ocd:rif_leg <%s> ; dc:date ?data ; dc:identifier ?ident .
    } ORDER BY DESC(?data) DESC(?ident) LIMIT %d }
  ?v dc:description ?desc ; dc:type ?tipo ; ocd:votazioneFinale ?finale ; ocd:richiestaFiducia ?fiducia ; ocd:votazioneSegreta ?segreta ;
     ocd:approvato ?approvato ; ocd:favorevoli ?fav ; ocd:contrari ?con ; ocd:astenuti ?ast ; ocd:presenti ?pres ; ocd:votanti ?vot ; ocd:maggioranza ?magg .
  OPTIONAL { ?v dc:relation ?scheda }
}
"""

Q_VOTI_C = PFX_C + """
SELECT ?dep ?tipo ?titolo WHERE {
  ?voto a ocd:voto ; ocd:rif_votazione <%s> ; ocd:rif_deputato ?dep ; dc:type ?tipo ; dc:title ?titolo .
}
"""

Q_ATTI_C = PFX_C + """
SELECT ?ident ?titolo ?tipo ?scheda ?iniziativa ?firmatario ?data ?stato ?natura WHERE {
  ?a a ocd:atto ; ocd:rif_leg <%s> ; dc:identifier ?ident ; dc:title ?titolo .
  OPTIONAL { ?a dc:type ?tipo }
  OPTIONAL { ?a dcterms:isReferencedBy ?scheda }
  OPTIONAL { ?a ocd:iniziativa ?iniziativa }
  OPTIONAL { ?a dc:creator ?firmatario }
  OPTIONAL { ?a dc:date ?data }
  OPTIONAL { ?a dc:description ?stato }
  OPTIONAL { ?a ocd:rif_natura ?natura }
  FILTER(?ident IN (%s))
}
"""

# forme viste nelle descrizioni: "PDL 2822-B - VOTO FINALE", "Pdl C. 2822-B art.3", "ODG 9/2822-B/41", "DDL 3118 - VOTO FINALE"
ATTO_RES = [
    re.compile(r"\b(?:PDL|DDL)\s*(?:COST\.?\s*)?(?:C\.\s*)?(\d+(?:-[A-Z]+)?)", re.I),
    re.compile(r"\bODG\s*9/(\d+(?:-[A-Z]+)?)/", re.I),
    re.compile(r"\bC\.\s*(\d+(?:-[A-Z]+)?)\b"),
]


def _atto_in_descrizione(desc: str) -> str | None:
    for rx in ATTO_RES:
        m = rx.search(desc)
        if m:
            return _base_atto(m.group(1).upper())
    return None


def _base_atto(ident: str) -> str:
    """'3045-A' -> '3045': il suffisso -A indica il testo della commissione, non un atto distinto
    (nei dati aperti l'atto è '3045'). -B, -C... sono letture successive e restano atti distinti."""
    return re.sub(r"-A$", "", ident)


def _titolo_breve(titolo: str) -> str | None:
    """Titolo breve per i decreti-legge: 'Conversione in legge ... del decreto-legge 7 agosto 2026, n. 144, recante X' -> 'Decreto-legge n. 144/2026: X'."""
    m = re.search(r"decreto-legge\s+\d+\s+\S+\s+(\d{4}),\s*n\.\s*(\d+),\s*recante\s+(.+)", titolo, re.I)
    if not m:
        return None
    resto = m.group(3).strip().rstrip(".")
    return f"Decreto-legge n. {m.group(2)}/{m.group(1)}: {resto[:1].upper()}{resto[1:]}"


def _norm_voto_camera(tipo: str, titolo: str) -> str:
    t = tipo.lower()
    if t.startswith("favorevole"):
        return "favorevole"
    if t.startswith("contrario"):
        return "contrario"
    if t.startswith("astensione"):
        return "astenuto"
    if t == "ha votato":
        return "votato"  # votazione segreta: il verso del voto non è pubblico
    if "missione" in titolo.lower():
        return "missione"
    return "assente"


def _pulisci_titolo_atto(t: str) -> str:
    t = html.unescape(t)
    t = re.sub(r"<[^>]+>", "", t)
    return re.sub(r"\s+", " ", t).strip()


def fetch_camera(n: int) -> list[dict]:
    print(f"[Camera] ultime {n} votazioni...")
    rows = query(CAMERA, Q_VOTAZIONI_C % (LEG_C, n))
    seen, votazioni = set(), []
    for r in rows:
        if r["v"] in seen:
            continue
        seen.add(r["v"])
        votazioni.append(r)

    # 1) atto citato nella descrizione (es. "PDL 2822-B - VOTO FINALE", "ODG 9/3045-A/22")
    idents = {}
    for r in votazioni:
        ident = _atto_in_descrizione(r["desc"])
        if ident:
            idents[r["v"]] = ident

    # 2) atto letto dal resoconto stenografico della seduta (articoli ed emendamenti non lo citano)
    da_resoconto = {}
    con_resoconto = set()
    sedute = {}
    for r in votazioni:
        sedute.setdefault(int(r["ident"][:3]), iso(r["data"]))
    for sed, data_sed in sorted(sedute.items()):
        html_sed = resoconto(sed, data_sed)
        mappa = atti_per_votazione(html_sed) if html_sed else {}
        print(f"  resoconto seduta {sed}: {len(mappa)} votazioni collegate a un atto")
        if mappa:
            con_resoconto.add(str(sed))
        for r in votazioni:
            if int(r["ident"][:3]) == sed and int(r["ident"][3:]) in mappa:
                da_resoconto[r["v"]] = _base_atto(mappa[int(r["ident"][3:])])

    atti = {}
    tutti = set(idents.values()) | set(da_resoconto.values())
    if tutti:
        lst = ", ".join(f'"{i}"' for i in sorted(tutti))
        for a in query(CAMERA, Q_ATTI_C % (LEG_C, lst)):
            titolo = _pulisci_titolo_atto(a["titolo"])
            # " S. 1971. - BIGNAMI ed altri: "Disposizioni..." (approvata...) (2822-B)" -> solo il titolo tra virgolette se c'è
            m = re.search(r'"([^"]+)"', titolo)
            atti.setdefault(
                a["ident"],
                {
                    "numero": a["ident"],
                    "titolo": m.group(1).strip() if m else titolo,
                    "titolo_breve": _titolo_breve(m.group(1) if m else titolo),
                    "titolo_completo": titolo,
                    "tipo": a.get("tipo"),
                    "natura": (a.get("natura") or "").rsplit("/", 1)[-1].replace("_", " ") or None,
                    "iniziativa": a.get("iniziativa"),
                    "primo_firmatario": a.get("firmatario"),
                    "data_presentazione": iso(a.get("data")),
                    "stato": (a.get("stato") or "").strip() or None,
                    "scheda": a.get("scheda") or f"https://www.camera.it/leg19/126?tab=&leg=19&idDocumento={a['ident']}",
                },
            )

    # 3) ultimo ripiego: la votazione più vicina della stessa seduta che cita l'atto
    by_seduta = defaultdict(list)
    for r in votazioni:
        by_seduta[r["ident"][:3]].append(r)
    inferiti = {}
    # (solo se il resoconto non c'è: se c'è e non cita un atto, la votazione non riguarda un provvedimento,
    # es. risoluzioni su documenti di bilancio; mai per documenti, mozioni e risoluzioni)
    for sed, rows in by_seduta.items():
        if sed.lstrip("0") in con_resoconto:
            continue
        rows = [x for x in rows if not re.match(r"\s*(DOC|MOZ|RIS)\b", x["desc"], re.I)]
        rows.sort(key=lambda x: int(x["ident"]))
        known = [(int(x["ident"]), idents[x["v"]]) for x in rows if x["v"] in idents and idents[x["v"]] in atti]
        if not known:
            continue
        for x in rows:
            if x["v"] in idents or da_resoconto.get(x["v"]) in atti:
                continue
            n = int(x["ident"])
            inferiti[x["v"]] = min(known, key=lambda k: abs(k[0] - n))[1]

    out = []
    for i, r in enumerate(votazioni):
        vid = "camera_" + r["ident"]
        print(f"  [{i + 1}/{len(votazioni)}] {vid} {r['desc'][:60]}")
        voti = {}
        for vr in query(CAMERA, Q_VOTI_C % r["v"]):
            dep = "camera_" + vr["dep"].rsplit("/", 1)[-1].lstrip("d").split("_")[0]
            voti[dep] = _norm_voto_camera(vr["tipo"], vr["titolo"])
        atto, atto_fonte = atti.get(idents.get(r["v"])), "descrizione"
        if atto is None and da_resoconto.get(r["v"]) in atti:
            atto, atto_fonte = atti[da_resoconto[r["v"]]], "resoconto"
        if atto is None and r["v"] in inferiti:
            atto, atto_fonte = atti[inferiti[r["v"]]], "dedotto"
        if atto is None:
            atto_fonte = None
        atto_inferito = atto_fonte == "dedotto"
        out.append(
            {
                "id": vid,
                "camera": "Camera",
                "data": iso(r["data"]),
                "numero": r["ident"],
                "oggetto": r["desc"].strip(),
                "tipo": r["tipo"],
                "finale": r["finale"] == "1",
                "fiducia": r["fiducia"] == "1",
                "segreta": r["segreta"] == "1",
                "esito": "approvato" if r["approvato"] == "1" else "respinto",
                "favorevoli": int(r["fav"]),
                "contrari": int(r["con"]),
                "astenuti": int(r["ast"]),
                "presenti": int(r["pres"]),
                "votanti": int(r["vot"]),
                "maggioranza": int(r["magg"]),
                "missione": sum(1 for v in voti.values() if v == "missione"),
                "atto": atto,
                "atto_fonte": atto_fonte,
                "atto_inferito": atto_inferito,
                "voti": voti,
                "fonti": {
                    "scheda_votazione": r.get("scheda"),
                    "resoconto_seduta": f"https://www.camera.it/leg19/410?idSeduta={int(r['ident'][:3]):04d}&tipo=stenografico",
                    "uri_linked_data": r["v"],
                    "sparql_endpoint": CAMERA,
                },
            }
        )
    return out


# ---------------------------------------------------------------- Senato
Q_VOTAZIONI_S = PFX_S + """
SELECT DISTINCT ?v ?data ?nseduta ?num ?label ?esito ?tipoVot ?fav ?con ?ast ?pres ?vot ?magg ?cong ?ddl ?titolo ?titoloBreve ?numeroFase ?natura ?iniz ?stato ?dataPres WHERE {
  ?v a osr:Votazione ; osr:legislatura 19 ; osr:seduta ?s ; osr:numero ?num .
  ?s osr:dataSeduta ?data ; osr:numeroSeduta ?nseduta .
  OPTIONAL { ?v rdfs:label ?label }
  OPTIONAL { ?v osr:esito ?esito }
  OPTIONAL { ?v osr:tipoVotazione ?tipoVot }
  OPTIONAL { ?v osr:favorevoli ?fav }
  OPTIONAL { ?v osr:contrari ?con }
  OPTIONAL { ?v osr:astenuti ?ast }
  OPTIONAL { ?v osr:presenti ?pres }
  OPTIONAL { ?v osr:votanti ?vot }
  OPTIONAL { ?v osr:maggioranza ?magg }
  OPTIONAL { ?v osr:congedoMissione ?cong }
  OPTIONAL { ?v osr:oggetto ?og . ?og osr:relativoA ?ddl .
    OPTIONAL { ?ddl osr:titolo ?titolo } OPTIONAL { ?ddl osr:titoloBreve ?titoloBreve }
    OPTIONAL { ?ddl osr:numeroFase ?numeroFase } OPTIONAL { ?ddl osr:natura ?natura }
    OPTIONAL { ?ddl osr:descrIniziativa ?iniz } OPTIONAL { ?ddl osr:statoDdl ?stato } OPTIONAL { ?ddl osr:dataPresentazione ?dataPres } }
  FILTER(STR(?data) >= "%s")
} ORDER BY DESC(?data) DESC(?num) LIMIT %d
"""

Q_VOTI_S = PFX_S + """
SELECT ?p ?sen WHERE {
  <%s> ?p ?sen .
  FILTER(?p IN (osr:favorevole, osr:contrario, osr:astenuto, osr:inCongedoMissione, osr:presenteNonVotante, osr:presente, osr:votante))
}
"""

VOTO_S = {"favorevole": "favorevole", "contrario": "contrario", "astenuto": "astenuto", "inCongedoMissione": "missione", "presenteNonVotante": "presente_non_votante"}


def _atto_principale(rs: list[dict]) -> dict:
    """Tra gli atti collegati a una votazione: prima i disegni di legge numerati; tra questi quello non
    'assorbito' (gli abbinati confluiscono nel testo votato e risultano assorbiti), poi il testo già approvato
    dalla Camera (iniziativa 'Dep. ...'), poi il numero più basso."""
    def chiave(r):
        num = r.get("numeroFase")
        if not num:
            return (1, 0, 0, 0)
        assorbito = "assorbit" in (r.get("stato") or "").lower()
        return (0, int(assorbito), 0 if (r.get("iniz") or "").startswith("Dep.") else 1, int(re.sub(r"\D.*", "", num) or 0))
    return min(rs, key=chiave)


def fetch_senato(n: int, dal: str) -> list[dict]:
    print(f"[Senato] ultime {n} votazioni (dal {dal})...")
    rows = query(SENATO, Q_VOTAZIONI_S % (dal, n * 3))
    # una votazione può essere collegata a più atti (il ddl esaminato e gli abbinati, petizioni, documenti):
    # tengo una riga per votazione, quella dell'atto principale
    per_v: dict[str, list[dict]] = {}
    for r in rows:
        per_v.setdefault(r["v"], []).append(r)
    votazioni = [_atto_principale(rs) for rs in per_v.values()][:n]

    # tutti i senatori in carica, per marcare gli assenti (chi non compare in nessuna lista)
    senatori = [p["id"] for p in json.loads((ROOT / "data" / "index.json").read_text())["parlamentari"] if p["camera"] == "Senato" and p["in_carica"]]

    out = []
    for i, r in enumerate(votazioni):
        vid = f"senato_{r['nseduta']}_{r['num']}"
        print(f"  [{i + 1}/{len(votazioni)}] {vid} {(r.get('titoloBreve') or r.get('label') or '')[:60]}")
        voti = {}
        presenti = set()
        for vr in query(SENATO, Q_VOTI_S % r["v"]):
            p = vr["p"].rsplit("/", 1)[-1]
            sid = "senato_" + vr["sen"].rsplit("/", 1)[-1]
            if p in VOTO_S:
                # un voto esplicito prevale su "presente non votante"
                if sid not in voti or VOTO_S[p] != "presente_non_votante":
                    voti[sid] = VOTO_S[p]
            elif p in ("presente", "votante"):
                presenti.add(sid)
        for sid in senatori:
            if sid not in voti:
                voti[sid] = "presente_non_votante" if sid in presenti else "assente"
        if r.get("ddl"):
            atto = {
                "numero": r.get("numeroFase"),
                "titolo": r.get("titolo"),
                "titolo_breve": r.get("titoloBreve"),
                "tipo": "Disegno di legge" if r.get("numeroFase") else "Documento",
                "natura": r.get("natura"),
                "iniziativa": r.get("iniz"),
                "stato": r.get("stato"),
                "data_presentazione": r.get("dataPres"),
                "scheda": f"https://www.senato.it/leg/19/BGT/Schede/Ddliter/{r['ddl'].rsplit('/', 1)[-1]}.htm",
            }
        else:
            atto = None
        esito = (r.get("esito") or "").lower() or None
        out.append(
            {
                "id": vid,
                "camera": "Senato",
                "data": r["data"],
                "numero": f"{r['nseduta']}/{r['num']}",
                "oggetto": r.get("label") or "Votazione",
                "tipo": r.get("tipoVot"),
                "finale": (r.get("label") or "").lower().startswith("votazione finale"),
                "fiducia": "fiducia" in (r.get("label") or "").lower(),
                "segreta": False,
                "esito": esito,
                "favorevoli": int(r.get("fav") or 0),
                "contrari": int(r.get("con") or 0),
                "astenuti": int(r.get("ast") or 0),
                "presenti": int(r.get("pres") or 0),
                "votanti": int(r.get("vot") or 0),
                "maggioranza": int(r.get("magg") or 0),
                "missione": int(r.get("cong") or 0),
                "atto": atto,
                "atto_fonte": "dati" if atto else None,
                "atto_inferito": False,
                "voti": voti,
                "fonti": {"scheda_votazione": None, "uri_linked_data": r["v"], "sparql_endpoint": SENATO},
            }
        )
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=40, help="numero di votazioni recenti per camera")
    ap.add_argument("--n-camera", type=int, help="override per la Camera (ha molte più votazioni per seduta)")
    ap.add_argument("--solo", choices=["camera", "senato"])
    ap.add_argument("--dal", default="2026-01-01", help="Senato: data minima della seduta (YYYY-MM-DD), per limitare la query")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    votazioni: list[dict] = []
    if args.solo in (None, "camera"):
        votazioni += fetch_camera(args.n_camera or args.n)
    if args.solo in (None, "senato"):
        votazioni += fetch_senato(args.n, args.dal)

    for v in votazioni:
        (OUT / f"{v['id']}.json").write_text(json.dumps(v, ensure_ascii=False))

    if args.solo:
        votazioni = [json.loads(f.read_text()) for f in OUT.glob("*.json") if f.name != "index.json"]
    def _key(x):
        nums = [int(t) for t in re.findall(r"\d+", x["numero"])]
        return (x["data"], nums)

    index = sorted(({k: v for k, v in x.items() if k != "voti"} for x in votazioni), key=_key, reverse=True)
    (OUT / "index.json").write_text(json.dumps({"votazioni": index}, ensure_ascii=False, indent=1))
    print(f"\nScritte {len(votazioni)} votazioni in {OUT.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
