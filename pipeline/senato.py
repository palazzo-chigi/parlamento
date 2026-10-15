"""Fase 1 — Senato della Repubblica: anagrafica, elezione, gruppi, commissioni, incarichi (ontologia OSR).

Nota: l'endpoint del Senato usa un Virtuoso datato: niente BIND, niente VALUES.
"""
from __future__ import annotations

from collections import defaultdict

from .sparql import SENATO, WIKIDATA, query

LEG = 19

PREFIXES = """
PREFIX osr: <http://dati.senato.it/osr/>
PREFIX ocd: <http://dati.camera.it/ocd/>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX bio: <http://purl.org/vocab/bio/0.1/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
"""

Q_SENATORI = PREFIXES + f"""
SELECT DISTINCT ?senatore ?nome ?cognome ?genere ?foto ?dataNascita ?cittaNascita ?provinciaNascita ?nazioneNascita ?professione
  ?mandato ?inizio ?fine ?tipoMandato ?tipoElezione ?collegio ?regione
WHERE {{
  ?senatore a osr:Senatore ; osr:mandato ?mandato ; foaf:firstName ?nome ; foaf:lastName ?cognome .
  ?mandato a ocd:mandatoSenato ; osr:legislatura {LEG} .
  OPTIONAL {{ ?senatore foaf:gender ?genere }}
  OPTIONAL {{ ?senatore foaf:depiction ?foto }}
  OPTIONAL {{ ?senatore bio:birth ?b . ?b bio:date ?dataNascita }}
  OPTIONAL {{ ?senatore osr:cittaNascita ?cittaNascita }}
  OPTIONAL {{ ?senatore osr:provinciaNascita ?provinciaNascita }}
  OPTIONAL {{ ?senatore osr:nazioneNascita ?nazioneNascita }}
  OPTIONAL {{ ?senatore osr:professione ?p . ?p rdfs:label ?professione }}
  OPTIONAL {{ ?mandato osr:inizio ?inizio }}
  OPTIONAL {{ ?mandato osr:fine ?fine }}
  OPTIONAL {{ ?mandato osr:tipoMandato ?tipoMandato }}
  OPTIONAL {{ ?mandato osr:tipoElezione ?tipoElezione }}
  OPTIONAL {{ ?mandato osr:collegioElezione ?collegio }}
  OPTIONAL {{ ?mandato osr:regioneElezione ?regione }}
}}
"""

Q_GRUPPI = PREFIXES + f"""
SELECT DISTINCT ?senatore ?gruppo ?carica ?inizio ?fine ?nome ?sigla ?denInizio ?denFine WHERE {{
  ?senatore a osr:Senatore ; osr:mandato ?m ; ocd:aderisce ?a .
  ?m a ocd:mandatoSenato ; osr:legislatura {LEG} .
  ?a osr:legislatura {LEG} ; osr:gruppo ?gruppo .
  OPTIONAL {{ ?a osr:carica ?carica }}
  OPTIONAL {{ ?a osr:inizio ?inizio }}
  OPTIONAL {{ ?a osr:fine ?fine }}
  OPTIONAL {{ ?gruppo osr:denominazione ?den .
    OPTIONAL {{ ?den osr:titolo ?nome }}
    OPTIONAL {{ ?den osr:titoloBreve ?sigla }}
    OPTIONAL {{ ?den osr:inizio ?denInizio }}
    OPTIONAL {{ ?den osr:fine ?denFine }} }}
}}
"""

Q_COMMISSIONI = PREFIXES + f"""
SELECT DISTINCT ?senatore ?af ?commissione ?carica ?inizio ?fine ?nome ?sigla ?denInizio ?denFine ?categoria WHERE {{
  ?senatore a osr:Senatore ; osr:mandato ?m ; osr:afferisce ?af .
  ?m a ocd:mandatoSenato ; osr:legislatura {LEG} .
  ?af osr:legislatura {LEG} ; osr:commissione ?commissione .
  OPTIONAL {{ ?af osr:carica ?carica }}
  OPTIONAL {{ ?af osr:inizio ?inizio }}
  OPTIONAL {{ ?af osr:fine ?fine }}
  OPTIONAL {{ ?commissione osr:categoriaCommissione ?categoria }}
  OPTIONAL {{ ?commissione osr:denominazione ?den .
    OPTIONAL {{ ?den osr:titolo ?nome }}
    OPTIONAL {{ ?den osr:titoloBreve ?sigla }}
    OPTIONAL {{ ?den osr:inizio ?denInizio }}
    OPTIONAL {{ ?den osr:fine ?denFine }} }}
}}
"""

Q_LEGISLATURE_PRECEDENTI = PREFIXES + f"""
SELECT DISTINCT ?senatore ?leg ?tipo ?inizio ?fine WHERE {{
  ?senatore a osr:Senatore ; osr:mandato ?m19 ; osr:mandato ?m .
  ?m19 a ocd:mandatoSenato ; osr:legislatura {LEG} .
  ?m a ?tipo ; osr:legislatura ?leg . FILTER(?m != ?m19)
  OPTIONAL {{ ?m osr:inizio ?inizio }}
  OPTIONAL {{ ?m osr:fine ?fine }}
}}
"""

Q_DOCUMENTI_PATRIMONIALI = PREFIXES + f"""
SELECT DISTINCT ?senatore ?anno ?url WHERE {{
  ?senatore a osr:Senatore ; osr:mandato ?m ; osr:documentoPatrimoniale ?d .
  ?m a ocd:mandatoSenato ; osr:legislatura {LEG} .
  ?d osr:anno ?anno ; osr:url ?url .
}}
"""

# senato.it serve le foto dietro un challenge WAF che blocca l'hotlinking: uso Wikimedia Commons via Wikidata (P2549 = ID senato.it)
Q_FOTO_WIKIDATA = """
SELECT ?id ?img ?item WHERE {
  ?item wdt:P2549 ?id ; wdt:P18 ?img .
}
"""


def sen_id(uri: str) -> str:
    return uri.rsplit("/", 1)[-1]


def _group_by_sen(rows: list[dict]) -> dict[str, list[dict]]:
    out = defaultdict(list)
    for r in rows:
        out[r["senatore"]].append(r)
    return out


def _pick_denominazione(rows_for_group: list[dict]) -> tuple[str | None, str | None]:
    """Un gruppo può cambiare nome: prende la denominazione più recente (senza fine o con inizio massimo)."""
    best = None
    for r in rows_for_group:
        if not r.get("nome"):
            continue
        key = (r.get("denFine") is None, r.get("denInizio") or "")
        if best is None or key > best[0]:
            best = (key, r)
    if best is None:
        return None, None
    return best[1].get("nome"), best[1].get("sigla")


def fetch() -> list[dict]:
    print("[Senato] senatori...")
    base = query(SENATO, Q_SENATORI)
    print("[Senato] gruppi...")
    gruppi_rows = _group_by_sen(query(SENATO, Q_GRUPPI))
    print("[Senato] commissioni...")
    commissioni = _group_by_sen(query(SENATO, Q_COMMISSIONI))
    print("[Senato] legislature precedenti...")
    legs_prec = _group_by_sen(query(SENATO, Q_LEGISLATURE_PRECEDENTI))
    print("[Senato] documenti patrimoniali...")
    docs = _group_by_sen(query(SENATO, Q_DOCUMENTI_PATRIMONIALI))
    print("[Senato] foto da Wikidata/Commons...")
    foto_wd = {}
    for r in query(WIKIDATA, Q_FOTO_WIKIDATA):
        # Special:FilePath -> versione ridimensionata servita da Commons
        foto_wd.setdefault(r["id"], (r["img"].replace("http://", "https://") + "?width=300", r["item"]))

    by_sen: dict[str, dict] = {}
    for r in base:
        cur = by_sen.setdefault(r["senatore"], {})
        for k, v in r.items():
            cur.setdefault(k, v)

    out = []
    for uri, r in by_sen.items():
        # le righe gruppo sono duplicate per ogni denominazione storica: raggruppo per adesione
        adesioni: dict[tuple, list[dict]] = defaultdict(list)
        for g in gruppi_rows.get(uri, []):
            adesioni[(g["gruppo"], g.get("inizio"), g.get("fine"), g.get("carica"))].append(g)
        storico = []
        for (gruppo, inizio, fine, carica), rows in adesioni.items():
            nome, sigla = _pick_denominazione(rows)
            storico.append(
                {"gruppo_id": sen_id(gruppo), "nome": nome, "sigla": sigla, "carica": carica, "dal": inizio, "al": fine, "motivo_fine": None}
            )
        storico.sort(key=lambda x: x["dal"] or "")
        attuale = next((g for g in reversed(storico) if not g["al"]), None)

        # incarichi: cariche nei gruppi diverse da "Membro" e cariche in commissione diverse da "Membro"
        incarichi = [
            {"carica": g["carica"], "organo": f"Gruppo {g['sigla'] or g['nome'] or ''}".strip(), "dal": g["dal"], "al": g["al"]}
            for g in storico
            if g.get("carica") and g["carica"] != "Membro"
        ]
        comms = []
        afferenze: dict[str, list[dict]] = defaultdict(list)
        for c in commissioni.get(uri, []):
            afferenze[c["af"]].append(c)
        for rows in afferenze.values():
            c = rows[0]
            titolo, breve = _pick_denominazione(rows)
            item = {
                "organo_id": sen_id(c["commissione"]),
                "nome": " ".join(x for x in [titolo, breve if breve != titolo else None] if x) or None,
                "tipo_organo": c.get("categoria"),
                "ruolo": c.get("carica"),
                "dal": c.get("inizio"),
                "al": c.get("fine"),
            }
            comms.append(item)
            if item["ruolo"] and item["ruolo"] != "Membro":
                incarichi.append({"carica": item["ruolo"], "organo": item["nome"], "dal": item["dal"], "al": item["al"]})
        comms.sort(key=lambda x: (x["al"] or "9", x["dal"] or ""))
        incarichi.sort(key=lambda x: (x["al"] or "9", x["dal"] or ""))

        fine = r.get("fine")
        tipo_mandato = r.get("tipoMandato") or "elettivo"
        tipo_el = (r.get("tipoElezione") or "").lower()
        if "uninominale" in tipo_el:
            tipo_el_norm = "uninominale"
        elif "proporzionale" in tipo_el or "plurinominale" in tipo_el:
            tipo_el_norm = "plurinominale"
        elif "ester" in tipo_el:
            tipo_el_norm = "estero"
        else:
            tipo_el_norm = None
        luogo = ", ".join(
            x for x in [r.get("cittaNascita"), r.get("provinciaNascita") if r.get("provinciaNascita") != r.get("cittaNascita") else None] if x
        )
        if r.get("nazioneNascita") and r.get("nazioneNascita") != "Italia":
            luogo = f"{luogo} ({r['nazioneNascita']})" if luogo else r["nazioneNascita"]
        sid = sen_id(uri)
        foto, wikidata = foto_wd.get(sid, (None, None))

        out.append(
            {
                "id": f"senato_{sid}",
                "camera": "Senato",
                "legislatura": 19,
                "anagrafica": {
                    "nome": r["nome"],
                    "cognome": r["cognome"],
                    "genere": r.get("genere"),
                    "foto": foto,
                    "foto_fonte": "Wikimedia Commons (via Wikidata P2549)" if foto else None,
                    "foto_senato": r.get("foto"),
                    "data_nascita": r.get("dataNascita"),
                    "luogo_nascita": luogo or None,
                    "titolo_studio": None,  # non esposto dall'endpoint del Senato
                    "professione": r.get("professione"),
                },
                "elezione": {
                    "tipo": tipo_el_norm,
                    "circoscrizione": r.get("regione"),
                    "collegio": r.get("collegio"),
                    "lista": None,  # non esposto dall'endpoint del Senato
                    "data_elezione": None,
                    "data_proclamazione": r.get("inizio"),
                    "data_convalida": None,
                    "descrizione": r.get("tipoElezione"),
                },
                "mandato": {
                    "inizio": r.get("inizio"),
                    "fine": fine,
                    "motivo_fine": None,
                    "in_carica": fine is None,
                    "tipo": tipo_mandato,
                },
                "politica": {
                    "gruppo_attuale": attuale,
                    "storico_gruppi": storico,
                    "cambi_di_gruppo": max(0, len({g["gruppo_id"] for g in storico}) - 1),
                    "legislature_precedenti": sorted(
                        (
                            {
                                "legislatura": int(l["leg"]),
                                "camera": "Camera" if l["tipo"].endswith("mandatoCamera") else "Senato",
                                "dal": l.get("inizio"),
                                "al": l.get("fine"),
                            }
                            for l in legs_prec.get(uri, [])
                        ),
                        key=lambda x: (x["legislatura"], x["camera"]),
                    ),
                },
                "ruoli": {"commissioni": comms, "incarichi": incarichi},
                "documenti_patrimoniali": sorted(
                    ({"anno": int(d["anno"]), "url": d["url"]} for d in docs.get(uri, [])), key=lambda x: x["anno"]
                ),
                "fonti": {
                    "scheda_ufficiale": f"https://www.senato.it/leg/19/BGT/Schede/Attsen/{int(sid):08d}.htm",
                    "sparql_endpoint": SENATO,
                    "uri_linked_data": uri,
                    "wikidata": wikidata,
                },
            }
        )
    return out
