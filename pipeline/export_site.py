"""Copia i JSON prodotti dalla pipeline in site/data/ (fase 8).

Uso: python3 -m pipeline.export_site
"""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data"
DST = ROOT / "site" / "data"


def main() -> None:
    if DST.exists():
        shutil.rmtree(DST)
    DST.mkdir(parents=True)
    shutil.copy(SRC / "index.json", DST / "index.json")
    shutil.copytree(SRC / "parlamentari", DST / "parlamentari")
    if (SRC / "votazioni").exists():
        shutil.copytree(SRC / "votazioni", DST / "votazioni")
    if (SRC / "presenze").exists():
        shutil.copytree(SRC / "presenze", DST / "presenze")
    n = len(list((DST / "parlamentari").glob("*.json")))
    nv = len(list((DST / "votazioni").glob("*.json"))) - 1 if (DST / "votazioni").exists() else 0
    print(f"Copiati index.json, {n} schede e {nv} votazioni in {DST.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
