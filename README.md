# Progetto: Emiciclo — il Parlamento italiano spiegato ai cittadini

## Obiettivo
Sito web che riproduce in 3D l'aula della Camera dei Deputati e del Senato.
Ogni seggio è cliccabile e apre la scheda del parlamentare con tutte le
informazioni pubbliche disponibili. Il sito include una sezione di statistiche
per aiutare i cittadini a capire la composizione e l'attività del Parlamento.


- Ogni dato mostrato deve avere un link alla fonte ufficiale da cui proviene.


## Fonti dei dati
1. Endpoint SPARQL della Camera: https://dati.camera.it/sparql
   (ontologia OCD, namespace http://dati.camera.it/ocd/)
2. Endpoint SPARQL del Senato: https://dati.senato.it/sparql
   (ontologia OSR, namespace http://dati.senato.it/osr/)
3. Pagine personali su camera.it e senato.it: dichiarazioni di cariche e
   professioni, PDF delle dichiarazioni patrimoniali e dei redditi.
4. Pagina ufficiale sul trattamento economico:
   https://www.camera.it/deputati/trattamento-economico
   (e l'equivalente del Senato). I valori vanno copiati da lì, non inventati.

Legislatura corrente: XIX. Camera: 400 deputati. Senato: 200 eletti più i
senatori a vita.

## Dati per ogni parlamentare
Un file JSON per parlamentare più un indice generale. Campi:

- Anagrafica: id, nome, cognome, foto (URL ufficiale), genere, data e luogo
  di nascita, titolo di studio, professione dichiarata.
- Elezione: camera (Camera/Senato), circoscrizione, collegio,
  uninominale o plurinominale, lista/coalizione, data di proclamazione.
- Politica: gruppo parlamentare attuale, storico dei cambi di gruppo con date,
  legislature precedenti.
- Ruoli: commissioni, incarichi (presidente, vicepresidente, capogruppo...).
- Attività: numero di votazioni, percentuale di presenze, assenze, missioni,
  numero di volte in cui ha votato in modo diverso dalla maggioranza del
  proprio gruppo.
- Atti: progetti di legge presentati come primo firmatario e come
  cofirmatario, interrogazioni, interpellanze, mozioni.
- Cariche e professioni: quelle dichiarate secondo il Codice di condotta.
- Redditi: reddito complessivo dichiarato per anno (dalla dichiarazione dei
  redditi allegata), con l'anno fiscale di riferimento.
- Patrimonio: elenco dei beni dichiarati (numero e tipo di immobili, beni
  mobili registrati, partecipazioni societarie). Nessun valore in euro,
  perché le dichiarazioni non lo riportano.
- Spese elettorali: se presenti nel bollettino.
- Fonti: per ogni sezione, l'URL della fonte ufficiale e la data di
  aggiornamento.

## Pipeline dei dati (fasi)
1. Anagrafica, gruppi, commissioni e incarichi via SPARQL (Camera e Senato).
2. Votazioni e presenze via SPARQL.
3. Atti parlamentari via SPARQL.
4. Download dei PDF delle dichiarazioni patrimoniali dalle pagine personali.
5. Estrazione del testo dai PDF; OCR per quelli scansionati.
6. Estrazione dei campi (reddito complessivo, elenco beni).
7. File di revisione manuale: ogni valore estratto dai PDF viene marcato
   come "da verificare" finché non è controllato a mano. Il sito mostra solo
   valori verificati.
8. Export finale dei JSON in `site/data/`.

### Come eseguire la fase 1
```bash
pip install -r requirements.txt
python3 -m pipeline.fase1_anagrafica            # --solo camera|senato, --no-cache
```
Output: `data/parlamentari/<id>.json` (uno per parlamentare), `data/index.json`
e `data/index.csv`. Le risposte SPARQL sono messe in cache in `data/raw/`.

Note sugli endpoint (verificate):
- Il Senato espone anche i mandati alla Camera (`ocd:mandatoCamera`): filtrare
  su `ocd:mandatoSenato`. Risponde 403 senza User-Agent da browser e il suo
  Virtuoso non supporta `BIND`.
- Il Senato non pubblica titolo di studio né lista; la Camera non pubblica la
  lista per gli eletti nell'uninominale.
- Il Senato espone già gli URL dei PDF delle dichiarazioni patrimoniali
  (`osr:documentoPatrimoniale`), salvati in `documenti_patrimoniali` (fase 4).

### Come eseguire la fase 2 (votazioni)
```bash
python3 -m pipeline.fase2_votazioni --n 40     # ultime 40 votazioni per camera; --solo camera|senato
```
Output: `data/votazioni/index.json` (elenco) e `data/votazioni/<id>.json` (una
votazione con il voto di ogni parlamentare: favorevole / contrario / astenuto /
in missione / assente; alla Camera, per gli scrutini segreti, solo "ha votato").
Note verificate:
- Camera: `ocd:votazione` con `ocd:voto` per deputato (`dc:type` = Favorevole,
  Contrario, Astensione, Non ha votato, Ha votato); la descrizione cita l'atto
  ("PDL 2822-B - VOTO FINALE") che viene risolto su `ocd:atto` per avere il
  titolo. Il suffisso "-A" (testo della commissione) non è un atto distinto:
  "3045-A" si cerca come "3045"; "-B", "-C" sono letture successive e restano.
  Per emendamenti e articoli ("EM 5.1000", "ARTICOLO 18") la votazione è
  collegata solo alla seduta (`ocd:rif_seduta`), e le `ocd:discussione` sono
  aggiornate con mesi di ritardo: l'atto si legge dal resoconto stenografico
  (`camera.it/leg19/410?idSeduta=NNNN&tipo=stenografico`), che intesta ogni
  fase con il link all'Atto Camera e chiude ogni voto con l'ancora
  `#votazione.N` (vedi `pipeline/resoconti_camera.py`, cache in
  `data/raw/resoconti_camera/`). Il campo `atto_fonte` dice da dove viene il
  collegamento: `descrizione`, `resoconto`, `dedotto` (votazione vicina della
  stessa seduta, solo se il resoconto manca) o `dati` (Senato).
- Senato: `osr:Votazione` con liste `osr:favorevole/contrario/astenuto/
  inCongedoMissione/presenteNonVotante`; l'atto è collegato via
  `osr:oggetto → osr:relativoA → osr:Ddl` (titolo e titolo breve). Una
  votazione è collegata anche a tutti gli atti abbinati (ddl, petizioni,
  documenti): si tiene il ddl numerato non "assorbito", cioè il testo votato.
  Il Virtuoso
  del Senato non supporta `BIND`, `SAMPLE` né confronti tra date tipizzate.

## Frontend
- Aula 3D a emiciclo con three.js, stile "intelligence": tema scuro, seggi
  olografici (ShaderMaterial con rim-light e scanline, animazione di reveal),
  pavimento radar con griglia polare e sweep, bloom (UnrealBloomPass),
  particelle, auto-rotazione finché l'utente non interagisce.
- Card "Ultime votazioni": riproduce una votazione reale, i seggi si colorano
  progressivamente con il voto espresso; esito, conteggi, maggioranza
  richiesta, voto per gruppo e link alle fonti. Il provvedimento è mostrato con
  titolo breve, titolo ufficiale, natura, iniziativa, primo firmatario e stato;
  l'oggetto del voto è tradotto in chiaro ("EM 17.4" → "Emendamento 17.4") e
  spiegato con un glossario. La scelta è in due passi: prima la legge (una voce
  per provvedimento, con numero di voti e giorni), poi la singola votazione;
  scegliendo la legge parte subito il voto finale, o il più recente.
- Layout a schermo fisso: la scena non scorre, la colonna laterale sì;
  pulsante "vista iniziale" (o Esc) per tornare all'inquadratura di partenza.
- Fascicolo: calendario delle presenze per seduta (una cella per seduta con
  votazioni elettroniche), link diretti ai PDF delle dichiarazioni patrimoniali
  per anno e alla dichiarazione di cariche, sia Camera che Senato.

### Come eseguire la fase 3 (presenze)
```bash
python3 -m pipeline.fase3_presenze            # ~1 s per parlamentare, tutta la legislatura
```
Una query aggregata per parlamentare (GROUP BY data della seduta) →
`data/presenze/<id>.json` con, per ogni seduta con votazioni elettroniche:
votazioni, votato, in missione, (Senato) presente non votante, assente;
`data/presenze/index.json` con i totali. "In missione" = assenza autorizzata
per incarichi istituzionali, conteggiata come presenza ai fini del numero legale;
i dati aperti non indicano destinazione né motivo (sono solo nel resoconto
stenografico). Nel sito: calendario presenze nel fascicolo e grafici nelle
statistiche.

### Come eseguire la fase 4 (Camera: link alle dichiarazioni)
```bash
python3 -m pipeline.fase4_dichiarazioni_camera
```
I dati aperti della Camera non espongono i PDF delle dichiarazioni: si leggono
dalla pagina personale pubblica `camera.it/deputati/elenco/19-<id>`
(robots.txt senza restrizioni, una richiesta ogni 0,4 s) →
`documenti_patrimoniali` (per anno) e `dichiarazione_cariche`. Il Senato li
espone già via SPARQL.

### Come eseguire il sito
```bash
python3 -m pipeline.export_site        # copia data/ -> site/data/
cd site && python3 -m http.server 8765 # http://localhost:8765
```
File: `site/index.html`, `site/js/hemicycle.js` (scena three.js, un
`InstancedMesh` per i seggi), `site/js/app.js` (stato, legenda, ricerca,
filtri), `site/js/card.js` (scheda), `site/js/groups.js` (colori e ordine dei
gruppi). I seggi sono raggruppati per gruppo da sinistra a destra e non
riproducono la posizione reale in aula.

Note: la foto dei deputati usa
`documenti.camera.it/_dati/leg19/schededeputatinuovosito/fotoDefinitivo/big/d<id>.jpg`
(l'URL esposto via SPARQL è rotto). Le foto su senato.it sono dietro un
challenge AWS WAF che blocca sia l'hotlinking sia il download automatico: per i
senatori si usa quindi Wikimedia Commons, collegando l'ID senato.it alla voce
Wikidata (proprietà P2549 → immagine P18). Copertura: 201 senatori su 205.
La fonte della foto è indicata nella scheda.

## Statistiche
Pagina dedicata con grafici (`site/statistiche.html`, Chart.js). Ogni grafico ha
una frase che spiega cosa mostra e da dove vengono i dati. Filtro
Parlamento / Camera / Senato.

Grafici implementati: seggi per gruppo, donne/uomini per gruppo, fasce d'età,
età media e mediana per gruppo, titolo di studio (solo Camera: il Senato non lo
pubblica), professioni più frequenti (dizioni normalizzate), provenienza per
regione della circoscrizione, sistema di elezione per gruppo, legislature
precedenti, prima legislatura per gruppo, cambi di gruppo, numero di
commissioni attive.
- Composizione: seggi per gruppo, genere, età media, titoli di studio,
  professioni più frequenti, provenienza regionale.
- Attività: distribuzione delle presenze, atti presentati per gruppo,
  frequenza del voto difforme dal proprio gruppo.
- Mobilità: cambi di gruppo durante la legislatura.
- Redditi dichiarati: distribuzione e mediana per gruppo (usare la mediana,
  non la media, perché pochi redditi altissimi la falsano). Indicare sempre
  l'anno fiscale.
- Pagina "Quanto costa un parlamentare": indennità, diaria, rimborsi, uguali
  per tutti, con i valori presi dalla pagina ufficiale.
