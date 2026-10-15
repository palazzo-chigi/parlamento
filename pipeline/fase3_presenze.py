"""Fase 3 — Presenze alle votazioni elettroniche in Assemblea, per parlamentare e per seduta, su tutta la legislatura.

Per ogni parlamentare una query aggregata (GROUP BY data) sull'endpoint: ~1-2 s ciascuna.

Uso: python -m pipeline.fase3_presenze [--solo camera|senato]

Output:
    data/presenze/<id>.json     sedute: [{data, votazioni, votato, missione, assente}], totali e percentuali
    data/presenze/index.json    totali per parlamentare (per le statistiche)
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

from .camera import iso
from .sparql import CAMERA, SENATO, query

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "presenze"

Q_CAMERA = """
PREFIX ocd: <http://dati.camera.it/ocd/>
PREFIX dc: <http://purl.org/dc/elements/1.1/>
SELECT ?data ?tipo ?miss (COUNT(DISTINCT ?v) AS ?n) WHERE {
  ?voto a ocd:voto ; ocd:rif_deputato <%s> ; ocd:rif_votazione ?v ; dc:type ?tipo ; dc:title ?titolo .
  ?v dc:date ?data .
  BIND(CONTAINS(LCASE(STR(?titolo)), "missione") AS ?miss)
} GROUP BY ?data ?tipo ?miss
"""

# Senato: il voto è una lista di senatori per predicato; conto le votazioni per seduta in cui il senatore compare in ciascuna lista
Q_SENATO = """
PREFIX osr: <http://dati.senato.it/osr/>
SELECT ?data ?p (COUNT(?v) AS ?n) WHERE {
  ?v ?p <%s> .
  FILTER(?p = osr:votante || ?p = osr:inCongedoMissione || ?p = osr:presenteNonVotante)
  ?v a osr:Votazione ; osr:legislatura 19 ; osr:seduta ?s .
  ?s osr:dataSeduta ?data .
} GROUP BY ?data ?p
"""

# totale votazioni per seduta al Senato, per calcolare le assenze
Q_SENATO_TOT = """
PREFIX osr: <http://dati.senato.it/osr/>
SELECT ?data (COUNT(?v) AS ?n) WHERE {
  ?v a osr:Votazione ; osr:legislatura 19 ; osr:seduta ?s .
  ?s osr:dataSeduta ?data .
} GROUP BY ?data
"""


def _summary(sedute: list[dict]) -> dict:
    tot = sum(s["votazioni"] for s in sedute)
    votato = sum(s["votato"] for s in sedute)
    miss = sum(s["missione"] for s in sedute)
    ass = sum(s["assente"] for s in sedute)
    pnv = sum(s.get("presente_non_votante", 0) for s in sedute)
    # percentuali come le pubblica la Camera: presenze sul totale delle votazioni; "assenze al netto delle missioni"
    return {
        "votazioni": tot,
        "votato": votato,
        "missione": miss,
        "assente": ass,
        "presente_non_votante": pnv,
        "pct_presenza": round(100 * votato / tot, 1) if tot else None,
        "pct_assenza": round(100 * ass / tot, 1) if tot else None,
        "pct_missione": round(100 * miss / tot, 1) if tot else None,
        "sedute_con_votazioni": len(sedute),
        "sedute_presente": sum(1 for s in sedute if s["votato"] > 0),
    }


def camera(pid: str, uri: str) -> list[dict]:
    per = defaultdict(lambda: {"votazioni": 0, "votato": 0, "missione": 0, "assente": 0})
    for r in query(CAMERA, Q_CAMERA % uri):
        d = per[iso(r["data"])]
        n = int(r["n"])
        d["votazioni"] += n
        if r["tipo"] == "Non ha votato":
            d["missione" if r["miss"] in ("true", "1") else "assente"] += n
        else:
            d["votato"] += n
    return [{"data": k, **v} for k, v in sorted(per.items())]


def senato(pid: str, uri: str, tot_per_data: dict[str, int], inizio: str | None) -> list[dict]:
    per = defaultdict(lambda: {"votato": 0, "missione": 0, "presente_non_votante": 0})
    for r in query(SENATO, Q_SENATO % uri):
        key = r["p"].rsplit("/", 1)[-1]
        d = per[r["data"]]
        n = int(r["n"])
        if key == "votante":
            d["votato"] += n
        elif key == "inCongedoMissione":
            d["missione"] += n
        elif key == "presenteNonVotante":
            d["presente_non_votante"] += n
    out = []
    for data, tot in sorted(tot_per_data.items()):
        if inizio and data < inizio:
            continue  # votazioni prima dell'inizio del mandato
        d = per.get(data, {"votato": 0, "missione": 0, "presente_non_votante": 0})
        votato, miss, pnv = d["votato"], d["missione"], d["presente_non_votante"]
        out.append({"data": data, "votazioni": tot, "votato": votato, "missione": miss, "presente_non_votante": pnv, "assente": max(0, tot - votato - miss - pnv)})
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--solo", choices=["camera", "senato"])
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    files = sorted((ROOT / "data" / "parlamentari").glob("*.json"))
    tot_sen = None
    index = {}
    for i, f in enumerate(files):
        p = json.loads(f.read_text())
        if args.solo and p["camera"].lower() != args.solo:
            continue
        uri = p["fonti"]["uri_linked_data"]
        if p["camera"] == "Camera":
            sedute = camera(p["id"], uri)
        else:
            if tot_sen is None:
                print("[Senato] totale votazioni per seduta...")
                tot_sen = {r["data"]: int(r["n"]) for r in query(SENATO, Q_SENATO_TOT)}
            sedute = senato(p["id"], uri, tot_sen, p["mandato"]["inizio"])
        summ = _summary(sedute)
        (OUT / f"{p['id']}.json").write_text(json.dumps({"id": p["id"], "totali": summ, "sedute": sedute, "fonte": p["fonti"]["sparql_endpoint"]}, ensure_ascii=False))
        index[p["id"]] = summ
        print(f"[{i + 1}/{len(files)}] {p['id']}: {summ['votazioni']} votazioni, presenza {summ['pct_presenza']}%")

    if args.solo:
        for f in OUT.glob("*.json"):
            if f.name != "index.json":
                d = json.loads(f.read_text())
                index.setdefault(d["id"], d["totali"])
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False))
    print(f"\nScritte presenze per {len(index)} parlamentari in {OUT.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
