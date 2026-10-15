"""Fase 4 (Camera) — link ai PDF delle dichiarazioni patrimoniali e di cariche dalle pagine personali su camera.it.

I dati aperti della Camera non espongono questi link (il Senato sì, via osr:documentoPatrimoniale):
si leggono dalla pagina pubblica https://www.camera.it/deputati/elenco/19-<id> (robots.txt: nessuna restrizione).

Uso: python -m pipeline.fase4_dichiarazioni_camera [--solo-mancanti]
"""
from __future__ import annotations

import argparse
import html
import json
import re
import time
from pathlib import Path

import requests

from .sparql import HEADERS

ROOT = Path(__file__).resolve().parent.parent
DIR = ROOT / "data" / "parlamentari"

RE_PATR = re.compile(r'<a class="link-pdf" href="([^"]+)"\s+title="Documentazione patrimoniale (\d{4})[^"]*"', re.I)
RE_CARICHE = re.compile(r'href="(https://documenti\.camera\.it/dichiarazioni_cariche_deputati/[^"]+)"', re.I)


def scrape(url: str) -> tuple[list[dict], str | None]:
    r = requests.get(url, headers={"User-Agent": HEADERS["User-Agent"]}, timeout=60)
    r.raise_for_status()
    page = r.text
    docs = sorted(({"anno": int(a), "url": html.unescape(u)} for u, a in RE_PATR.findall(page)), key=lambda d: d["anno"])
    m = RE_CARICHE.search(page)
    return docs, html.unescape(m.group(1)) if m else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--solo-mancanti", action="store_true", help="salta chi ha già documenti_patrimoniali")
    args = ap.parse_args()

    files = sorted(DIR.glob("camera_*.json"))
    ok = err = 0
    for i, f in enumerate(files):
        p = json.loads(f.read_text())
        if args.solo_mancanti and p.get("documenti_patrimoniali"):
            continue
        url = p["fonti"]["scheda_ufficiale"]
        try:
            docs, cariche = scrape(url)
            p["documenti_patrimoniali"] = docs
            p["dichiarazione_cariche"] = cariche
            p["fonti"]["dichiarazioni"] = url + "#patrimoniali"
            f.write_text(json.dumps(p, ensure_ascii=False, indent=2))
            ok += 1
            print(f"[{i + 1}/{len(files)}] {p['id']}: {len(docs)} PDF patrimoniali{', cariche' if cariche else ''}")
        except requests.RequestException as e:
            err += 1
            print(f"[{i + 1}/{len(files)}] {p['id']}: ERRORE {e}")
        time.sleep(0.4)
    print(f"\nAggiornati {ok} deputati, {err} errori")


if __name__ == "__main__":
    main()
