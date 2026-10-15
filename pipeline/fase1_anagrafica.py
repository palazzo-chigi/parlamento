"""Fase 1 della pipeline: anagrafica, gruppi, commissioni e incarichi via SPARQL.

Uso:
    python -m pipeline.fase1_anagrafica [--no-cache] [--solo camera|senato]

Output:
    data/parlamentari/<id>.json   un file per parlamentare
    data/index.json               indice generale (campi sintetici)
    data/index.csv                stesso indice in CSV
"""
import argparse
import json
from datetime import date
from pathlib import Path

import pandas as pd

from . import camera, senato
from .sparql import CACHE_DIR

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT_DIR = DATA / "parlamentari"


def index_row(p: dict) -> dict:
    g = p["politica"]["gruppo_attuale"] or {}
    return {
        "id": p["id"],
        "camera": p["camera"],
        "cognome": p["anagrafica"]["cognome"],
        "nome": p["anagrafica"]["nome"],
        "genere": p["anagrafica"]["genere"],
        "data_nascita": p["anagrafica"]["data_nascita"],
        "luogo_nascita": p["anagrafica"]["luogo_nascita"],
        "professione": p["anagrafica"]["professione"],
        "titolo_studio": p["anagrafica"]["titolo_studio"],
        "gruppo": g.get("nome"),
        "gruppo_sigla": g.get("sigla"),
        "tipo_elezione": p["elezione"]["tipo"],
        "circoscrizione": p["elezione"]["circoscrizione"],
        "collegio": p["elezione"]["collegio"],
        "lista": p["elezione"]["lista"],
        "tipo_mandato": p["mandato"]["tipo"],
        "in_carica": p["mandato"]["in_carica"],
        "mandato_inizio": p["mandato"]["inizio"],
        "mandato_fine": p["mandato"]["fine"],
        "cambi_di_gruppo": p["politica"]["cambi_di_gruppo"],
        "n_legislature_precedenti": len(p["politica"]["legislature_precedenti"]),
        "n_commissioni_attive": sum(1 for c in p["ruoli"]["commissioni"] if not c["al"]),
        "n_incarichi_attivi": sum(1 for c in p["ruoli"]["incarichi"] if not c["al"]),
        "foto": p["anagrafica"]["foto"],
        "scheda_ufficiale": p["fonti"]["scheda_ufficiale"],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-cache", action="store_true", help="ignora la cache SPARQL su disco")
    ap.add_argument("--solo", choices=["camera", "senato"])
    args = ap.parse_args()

    if args.no_cache and CACHE_DIR.exists():
        for f in CACHE_DIR.glob("*.json"):
            f.unlink()

    oggi = date.today().isoformat()
    parlamentari: list[dict] = []
    if args.solo in (None, "camera"):
        parlamentari += camera.fetch()
    if args.solo in (None, "senato"):
        parlamentari += senato.fetch()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for p in parlamentari:
        p["fonti"]["aggiornato_il"] = oggi
        (OUT_DIR / f"{p['id']}.json").write_text(json.dumps(p, ensure_ascii=False, indent=2))

    # con --solo l'indice va ricostruito da tutti i file su disco, non solo da quelli appena scaricati
    if args.solo:
        parlamentari = [json.loads(f.read_text()) for f in sorted(OUT_DIR.glob("*.json"))]

    df = pd.DataFrame([index_row(p) for p in parlamentari]).sort_values(["camera", "cognome", "nome"])
    index = {
        "legislatura": 19,
        "aggiornato_il": oggi,
        "fonti": {"camera": camera.CAMERA, "senato": senato.SENATO},
        "totali": {
            "camera": int((df.camera == "Camera").sum()),
            "camera_in_carica": int(((df.camera == "Camera") & df.in_carica).sum()),
            "senato": int((df.camera == "Senato").sum()),
            "senato_in_carica": int(((df.camera == "Senato") & df.in_carica).sum()),
        },
        "parlamentari": df.where(pd.notnull(df), None).to_dict(orient="records"),
    }
    (DATA / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2))
    df.to_csv(DATA / "index.csv", index=False)

    print(f"\nScritti {len(parlamentari)} file in {OUT_DIR.relative_to(ROOT)}/")
    print(json.dumps(index["totali"], indent=2))
    print("\nIn carica per gruppo:")
    print(df[df.in_carica].groupby(["camera", "gruppo_sigla"], dropna=False).size().to_string())


if __name__ == "__main__":
    main()
