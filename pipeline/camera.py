"""Fase 1 — Camera dei Deputati: anagrafica, elezione, gruppi, commissioni, incarichi (ontologia OCD)."""
from __future__ import annotations

import re
from collections import defaultdict

from .sparql import CAMERA, query

LEG = "http://dati.camera.it/ocd/legislatura.rdf/repubblica_19"

PREFIXES = """
PREFIX ocd: <http://dati.camera.it/ocd/>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX dc: <http://purl.org/dc/elements/1.1/>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX bio: <http://purl.org/vocab/bio/0.1/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
"""

Q_DEPUTATI = PREFIXES + f"""
SELECT DISTINCT ?deputato ?persona ?nome ?cognome ?genere ?foto ?descrizione ?scheda
  ?mandato ?mandatoInizio ?mandatoFine ?motivoFine ?convalida
  ?dataNascita ?luogoNascita
  ?elezione ?tipoElezione ?circoscrizione ?collegio ?lista ?dataElezione
WHERE {{
  ?deputato a ocd:deputato ; ocd:rif_leg <{LEG}> ; ocd:rif_mandatoCamera ?mandato ;
            foaf:firstName ?nome ; foaf:surname ?cognome .
  OPTIONAL {{ ?deputato foaf:gender ?genere }}
  OPTIONAL {{ ?deputato foaf:depiction ?foto }}
  OPTIONAL {{ ?deputato dc:description ?descrizione }}
  OPTIONAL {{ ?deputato dcterms:isReferencedBy ?scheda }}
  OPTIONAL {{ ?mandato ocd:startDate ?mandatoInizio }}
  OPTIONAL {{ ?mandato ocd:endDate ?mandatoFine }}
  OPTIONAL {{ ?mandato ocd:motivoTermine ?motivoFine }}
  OPTIONAL {{ ?mandato ocd:convalida ?convalida }}
  OPTIONAL {{
    ?persona a foaf:Person ; ocd:rif_mandatoCamera ?mandato .
    OPTIONAL {{ ?persona bio:Birth ?nascita .
      OPTIONAL {{ ?nascita bio:date ?dataNascita }}
      OPTIONAL {{ ?nascita ocd:rif_luogo ?luogo . ?luogo dc:title ?luogoNascita }} }}
  }}
  OPTIONAL {{
    ?mandato ocd:rif_elezione ?elezione .
    OPTIONAL {{ ?elezione ocd:tipoElezione ?tipoElezione }}
    OPTIONAL {{ ?elezione dc:coverage ?circoscrizione }}
    OPTIONAL {{ ?elezione dcterms:spatial ?collegio }}
    OPTIONAL {{ ?elezione ocd:lista ?lista }}
    OPTIONAL {{ ?elezione dc:date ?dataElezione }}
  }}
}}
"""

Q_GRUPPI = PREFIXES + f"""
SELECT DISTINCT ?deputato ?gruppo ?nome ?sigla ?inizio ?fine ?motivo WHERE {{
  ?deputato a ocd:deputato ; ocd:rif_leg <{LEG}> ; ocd:aderisce ?a .
  ?a ocd:rif_gruppoParlamentare ?gruppo .
  OPTIONAL {{ ?gruppo dc:title ?nome }}
  OPTIONAL {{ ?gruppo dcterms:alternative ?sigla }}
  OPTIONAL {{ ?a ocd:startDate ?inizio }}
  OPTIONAL {{ ?a ocd:endDate ?fine }}
  OPTIONAL {{ ?a ocd:motivoTermine ?motivo }}
}}
"""

Q_COMMISSIONI = PREFIXES + f"""
SELECT DISTINCT ?deputato ?organo ?nome ?tipoOrgano ?ruolo ?inizio ?fine WHERE {{
  ?deputato a ocd:deputato ; ocd:rif_leg <{LEG}> ; ocd:membro ?m .
  ?m ocd:rif_organo ?organo .
  OPTIONAL {{ ?organo dc:title ?nome }}
  OPTIONAL {{ ?organo dc:type ?tipoOrgano }}
  OPTIONAL {{ ?m dc:type ?ruolo }}
  OPTIONAL {{ ?m ocd:startDate ?inizio }}
  OPTIONAL {{ ?m ocd:endDate ?fine }}
}}
"""

Q_UFFICI = PREFIXES + f"""
SELECT DISTINCT ?deputato ?carica ?organo ?nomeOrgano ?inizio ?fine WHERE {{
  ?u a ocd:ufficioParlamentare ; ocd:rif_leg <{LEG}> ; ocd:rif_deputato ?deputato ; ocd:carica ?carica .
  OPTIONAL {{ ?u ocd:rif_organo ?organo . ?organo dc:title ?nomeOrgano }}
  OPTIONAL {{ ?u ocd:startDate ?inizio }}
  OPTIONAL {{ ?u ocd:endDate ?fine }}
}}
"""

Q_INCARICHI_GRUPPO = PREFIXES + f"""
SELECT DISTINCT ?deputato ?ruolo ?gruppo ?nomeGruppo ?inizio ?fine WHERE {{
  ?i a ocd:incarico ; ocd:rif_leg <{LEG}> ; ocd:rif_deputato ?deputato ; ocd:ruolo ?ruolo .
  OPTIONAL {{ ?i ocd:rif_gruppoParlamentare ?gruppo . ?gruppo dcterms:alternative ?nomeGruppo }}
  OPTIONAL {{ ?i ocd:startDate ?inizio }}
  OPTIONAL {{ ?i ocd:endDate ?fine }}
}}
"""

Q_LEGISLATURE_PRECEDENTI = PREFIXES + f"""
SELECT DISTINCT ?deputato ?leg ?inizio ?fine WHERE {{
  ?deputato a ocd:deputato ; ocd:rif_leg <{LEG}> ; ocd:rif_mandatoCamera ?m19 .
  ?persona a foaf:Person ; ocd:rif_mandatoCamera ?m19 ; ocd:rif_mandatoCamera ?m .
  ?m ocd:rif_leg ?leg . FILTER(?leg != <{LEG}>)
  OPTIONAL {{ ?m ocd:startDate ?inizio }}
  OPTIONAL {{ ?m ocd:endDate ?fine }}
}}
"""


def iso(d: str | None) -> str | None:
    """'20221013' -> '2022-10-13'."""
    if not d or len(d) < 8:
        return d or None
    return f"{d[:4]}-{d[4:6]}-{d[6:8]}"


def dep_id(uri: str) -> str:
    # http://dati.camera.it/ocd/deputato.rdf/d307571_19 -> 307571
    return uri.rsplit("/", 1)[-1].lstrip("d").split("_")[0]


def leg_num(uri: str) -> int:
    return int(uri.rsplit("_", 1)[-1])


_TITOLO_RE = re.compile(r"^(laurea|diploma|dottorato|master|specializzazione|abilitazione|licenza|scuola|phd|ph\.d|bachelor|maturit|perito|ragionier)", re.I)


def split_descrizione(desc: str | None) -> tuple[str | None, str | None]:
    """'Laurea in giurisprudenza; Consulente legale' -> (titolo, professione).

    Senza ';' la Camera riporta spesso solo la professione: la si riconosce dal fatto che non inizia come un titolo.
    """
    if not desc:
        return None, None
    parts = [p.strip() for p in desc.split(";") if p.strip()]
    if not parts:
        return None, None
    if len(parts) == 1 and not _TITOLO_RE.match(parts[0]):
        return None, parts[0]
    titolo = parts[0] or None
    professione = "; ".join(parts[1:]) or None
    return titolo, professione


def _group_by_dep(rows: list[dict]) -> dict[str, list[dict]]:
    out = defaultdict(list)
    for r in rows:
        out[r["deputato"]].append(r)
    return out


def _dedup(items: list[dict], key_fields: tuple[str, ...]) -> list[dict]:
    """L'endpoint tiene sia la versione aperta che quella chiusa dello stesso incarico: tiene quella con data fine."""
    best: dict[tuple, dict] = {}
    for it in items:
        k = tuple(it.get(f) for f in key_fields)
        if k not in best or (it.get("al") and not best[k].get("al")):
            best[k] = it
    return list(best.values())


def fetch() -> list[dict]:
    print("[Camera] deputati...")
    base = query(CAMERA, Q_DEPUTATI)
    print("[Camera] gruppi...")
    gruppi = _group_by_dep(query(CAMERA, Q_GRUPPI))
    print("[Camera] commissioni...")
    commissioni = _group_by_dep(query(CAMERA, Q_COMMISSIONI))
    print("[Camera] uffici...")
    uffici = _group_by_dep(query(CAMERA, Q_UFFICI))
    print("[Camera] incarichi di gruppo...")
    incarichi = _group_by_dep(query(CAMERA, Q_INCARICHI_GRUPPO))
    print("[Camera] legislature precedenti...")
    legs_prec = _group_by_dep(query(CAMERA, Q_LEGISLATURE_PRECEDENTI))

    # una riga per deputato: la query può duplicare per valori opzionali multipli
    by_dep: dict[str, dict] = {}
    for r in base:
        cur = by_dep.setdefault(r["deputato"], {})
        for k, v in r.items():
            cur.setdefault(k, v)

    out = []
    for uri, r in by_dep.items():
        titolo, professione = split_descrizione(r.get("descrizione"))
        storico = sorted(
            _dedup(
                [
                    {
                        "gruppo_id": g["gruppo"].rsplit("/", 1)[-1],
                        "nome": (g.get("nome") or "").split(" (")[0].strip() or None,
                        "sigla": g.get("sigla"),
                        "dal": iso(g.get("inizio")),
                        "al": iso(g.get("fine")),
                        "motivo_fine": g.get("motivo"),
                    }
                    for g in gruppi.get(uri, [])
                ],
                ("gruppo_id", "dal"),
            ),
            key=lambda x: x["dal"] or "",
        )
        attuale = next((g for g in reversed(storico) if not g["al"]), None)
        mandato_fine = iso(r.get("mandatoFine"))
        tipo_el = r.get("tipoElezione") or ""
        if tipo_el.startswith("maggioritario"):
            tipo_el_norm = "uninominale"
        elif tipo_el.startswith("proporzionale"):
            tipo_el_norm = "plurinominale"
        else:
            tipo_el_norm = tipo_el or None
        # l'URL foto esposto via SPARQL (getFoto.asp) oggi reindirizza a un 404: uso il percorso del sito attuale
        foto = f"https://documenti.camera.it/_dati/leg19/schededeputatinuovosito/fotoDefinitivo/big/d{dep_id(uri)}.jpg"
        out.append(
            {
                "id": f"camera_{dep_id(uri)}",
                "camera": "Camera",
                "legislatura": 19,
                "anagrafica": {
                    "nome": r["nome"].title(),
                    "cognome": r["cognome"].title(),
                    "genere": {"male": "M", "female": "F"}.get(r.get("genere"), r.get("genere")),
                    "foto": foto,
                    "foto_sparql": r.get("foto"),
                    "data_nascita": iso(r.get("dataNascita")),
                    "luogo_nascita": (r.get("luogoNascita") or "").title() or None,
                    "titolo_studio": titolo,
                    "professione": professione,
                },
                "elezione": {
                    "tipo": tipo_el_norm,
                    "circoscrizione": r.get("circoscrizione"),
                    "collegio": r.get("collegio"),
                    "lista": r.get("lista"),
                    "data_elezione": iso(r.get("dataElezione")),
                    "data_proclamazione": iso(r.get("mandatoInizio")),
                    "data_convalida": r.get("convalida"),
                    "descrizione": tipo_el or None,
                },
                "mandato": {
                    "inizio": iso(r.get("mandatoInizio")),
                    "fine": mandato_fine,
                    "motivo_fine": r.get("motivoFine"),
                    "in_carica": mandato_fine is None,
                    "tipo": "elettivo",
                },
                "politica": {
                    "gruppo_attuale": attuale,
                    "storico_gruppi": storico,
                    "cambi_di_gruppo": max(0, len({g["gruppo_id"] for g in storico}) - 1),
                    "legislature_precedenti": sorted(
                        (
                            {"legislatura": leg_num(l["leg"]), "camera": "Camera", "dal": iso(l.get("inizio")), "al": iso(l.get("fine"))}
                            for l in legs_prec.get(uri, [])
                        ),
                        key=lambda x: x["legislatura"],
                    ),
                },
                "ruoli": {
                    "commissioni": sorted(
                        _dedup(
                            [
                                {
                                    "organo_id": c["organo"].rsplit("/", 1)[-1],
                                    "nome": c.get("nome"),
                                    "tipo_organo": c.get("tipoOrgano"),
                                    "ruolo": c.get("ruolo"),
                                    "dal": iso(c.get("inizio")),
                                    "al": iso(c.get("fine")),
                                }
                                for c in commissioni.get(uri, [])
                            ],
                            ("organo_id", "ruolo", "dal"),
                        ),
                        key=lambda x: (x["al"] or "9", x["dal"] or ""),
                    ),
                    "incarichi": sorted(
                        _dedup(
                            [
                                {"carica": u["carica"], "organo": u.get("nomeOrgano"), "dal": iso(u.get("inizio")), "al": iso(u.get("fine"))}
                                for u in uffici.get(uri, [])
                            ]
                            + [
                                {"carica": i["ruolo"], "organo": f"Gruppo {i.get('nomeGruppo') or ''}".strip(), "dal": iso(i.get("inizio")), "al": iso(i.get("fine"))}
                                for i in incarichi.get(uri, [])
                            ],
                            ("carica", "organo", "dal"),
                        ),
                        key=lambda x: (x["al"] or "9", x["dal"] or ""),
                    ),
                },
                "fonti": {
                    # il sito attuale usa /deputati/elenco/19-<id>; l'URN esposto via SPARQL oggi reindirizza all'elenco generale
                    "scheda_ufficiale": f"https://www.camera.it/deputati/elenco/19-{dep_id(uri)}",
                    "scheda_urn": r.get("scheda"),
                    "sparql_endpoint": CAMERA,
                    "uri_linked_data": uri,
                },
            }
        )
    return out
