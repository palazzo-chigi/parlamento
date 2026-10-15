"""Client SPARQL minimale (GET, JSON) con retry e cache su disco."""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import requests

CAMERA = "https://dati.camera.it/sparql"
SENATO = "https://dati.senato.it/sparql"
WIKIDATA = "https://query.wikidata.org/sparql"

# dati.senato.it risponde 403 con lo User-Agent di default di requests; Wikidata richiede uno UA identificativo
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; Emiciclo/0.1; progetto civico open data sul Parlamento italiano)",
    "Accept": "application/sparql-results+json",
}

CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "raw" / "sparql_cache"


def query(endpoint: str, sparql: str, use_cache: bool = True, retries: int = 3) -> list[dict]:
    """Esegue la query e restituisce una lista di dict {var: valore}."""
    key = hashlib.sha1((endpoint + sparql).encode()).hexdigest()
    cache_file = CACHE_DIR / f"{key}.json"
    if use_cache and cache_file.exists():
        return json.loads(cache_file.read_text())

    last_err = None
    for attempt in range(retries):
        try:
            # Wikidata (Blazegraph) non accetta il MIME type come valore di `format`
            params = {"query": sparql, "format": "json" if endpoint == WIKIDATA else "application/sparql-results+json"}
            r = requests.get(endpoint, params=params, headers=HEADERS, timeout=180)
            r.raise_for_status()
            rows = [{k: v["value"] for k, v in b.items()} for b in r.json()["results"]["bindings"]]
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(json.dumps(rows, ensure_ascii=False))
            return rows
        except (requests.RequestException, ValueError, KeyError) as e:
            last_err = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Query fallita su {endpoint}: {last_err}\n{sparql[:300]}")
