"""Camera: a quale provvedimento si riferisce ogni votazione, letto dal resoconto stenografico della seduta.

I dati aperti della Camera collegano la votazione solo alla seduta: per articoli ed emendamenti
la descrizione è del tipo "ARTICOLO 18" o "EM 17.4", senza il numero dell'atto.
Il resoconto stenografico (https://www.camera.it/leg19/410?idSeduta=NNNN&tipo=stenografico) invece
intesta ogni fase dell'esame con il link all'atto, es. "(Articolo 18 - A.C. 2789-A e abbinate)", e
chiude ogni votazione con un'ancora "#votazione.213". Leggendo il documento in ordine, ogni votazione
appartiene all'ultimo atto citato prima di lei.
"""
from __future__ import annotations

import re
import time
from datetime import date, timedelta
from pathlib import Path

import requests

from .sparql import HEADERS

CACHE = Path(__file__).resolve().parent.parent / "data" / "raw" / "resoconti_camera"
URL = "https://www.camera.it/leg19/410?idSeduta={:04d}&tipo=stenografico"

# link a un Atto Camera oppure ancora di una votazione, nell'ordine in cui compaiono
_TOKEN = re.compile(
    r"idDocumento=(\d+(?:-[A-Z]+)?)[^\"]*\"[^>]*title=\"Apri la scheda dei lavori preparatori dell'Atto Camera"
    r"|href=\"#votazione\.(\d+)\""
)
# tra due link di una serie ("A.C. 2360-2578-2969-A", testo unificato) ci sono solo tag e trattini
_SERIE = re.compile(r"^(?:\s|</?a\b[^>]*>|&#8203;|​|-|&nbsp;)*$")


def resoconto(seduta: int, data_seduta: str | None = None) -> str | None:
    """HTML del resoconto stenografico. In cache su disco, tranne le sedute degli ultimi giorni (resoconto provvisorio)."""
    f = CACHE / f"s{seduta:04d}.html"
    recente = data_seduta is None or data_seduta >= (date.today() - timedelta(days=3)).isoformat()
    if f.exists() and not recente:
        return f.read_text(encoding="utf-8")
    try:
        r = requests.get(URL.format(seduta), headers={"User-Agent": HEADERS["User-Agent"]}, timeout=90)
        r.raise_for_status()
    except requests.RequestException as e:
        print(f"  resoconto seduta {seduta} non disponibile: {e}")
        return f.read_text(encoding="utf-8") if f.exists() else None
    finally:
        time.sleep(0.4)
    r.encoding = "utf-8"
    if "#votazione." not in r.text:
        return None  # resoconto non ancora pubblicato o seduta senza votazioni
    CACHE.mkdir(parents=True, exist_ok=True)
    f.write_text(r.text, encoding="utf-8")
    return r.text


def atti_per_votazione(html: str) -> dict[int, str]:
    """{numero della votazione nella seduta: identificativo dell'atto come scritto nel resoconto, es. '2789-A'}."""
    out: dict[int, str] = {}
    corrente, fine_link = None, -1
    for m in _TOKEN.finditer(html):
        if m.group(1):
            # in una serie di atti abbinati vale il primo (quello che dà il nome al testo)
            if not (corrente and _SERIE.match(_tra_link(html, fine_link, m.start()))):
                corrente = m.group(1)
            fine_link = html.find("</a>", m.end()) + 4
        elif corrente:
            out.setdefault(int(m.group(2)), corrente)
    return out


def _tra_link(html: str, fine: int, inizio: int) -> str:
    """Testo tra la fine del link precedente e l'inizio del tag <a> che contiene il link corrente."""
    if fine < 0:
        return "x"
    apertura = html.rfind("<a", fine, inizio)
    return html[fine:apertura] if apertura >= 0 else html[fine:inizio]
