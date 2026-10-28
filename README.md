# n8n 2.45.4 — hardening immagine e gestione CVE strutturata

Toolkit per il problema: la scansione Trivy dell'immagine n8n esce con decine di
CVE. Questo documento è il piano: cosa chiudere, come, e come non tornare nella
situazione di partenza. Baseline precedente su 2.44.7 conservata in `reports/`
per il confronto.

## 1. Baseline misurata su `n8nio/n8n:2.45.4` (trivy 0.76.0, DB 2026-10-27)

Immagine ufficiale, push su Docker Hub il 2026-10-26 (digest `sha256:80e23ced…`).

| Livello | CVE | CRIT | HIGH | MED | LOW | Con fix |
|---|---|---|---|---|---|---|
| OS (alpine 3.24, `n8nio/base` pinnato) | 32 | 0 | 2 | 8 | 22 | 32/32 |
| Bundle node (`./compiled`) | 63 | 0 | 20 | 38 | 5 | 63/63 |
| **Totale** | **95** | **0** | **22** | **46** | **27** | **95/95** |

Delta vs 2.44.7 (113 CVE: 4 CRIT, 29 HIGH): l'upgrade ha **azzerato i CRITICAL**
e chiuso 7 HIGH. Già fissati upstream: `handlebars` 4.7.10 (override), `simple-git`
4.0.2 (+`@simple-git/argv-parser`), `nodemailer` 10.0.14, `toml` 4.2.0 (6→4 HIGH).

Le **22 HIGH** residue, tutte con fix disponibile:

| Pacchetto | Installato | Fix | Dove si corregge |
|---|---|---|---|
| follow-redirects | 1.16.0 | 1.16.1 | override `pnpm-workspace.yaml` (Fase 3) |
| @modelcontextprotocol/sdk | 1.31.0 | 1.32.0 | catalog `pnpm-workspace.yaml` (Fase 3) |
| @modelcontextprotocol/server | 2.0.0 | 2.3.0 | catalog `pnpm-workspace.yaml` (Fase 3) |
| @modelcontextprotocol/node | 2.0.0 | 2.1.0 | catalog `pnpm-workspace.yaml` (Fase 3; finding DB 28/10) |
| undici | 6.29.0 / 7.29.1 | 6.29.1 / 7.30.1 | catalog `pnpm-workspace.yaml` (Fase 3) |
| multer | 2.3.0 | 2.5.0 | override (Fase 3) |
| body-parser | 2.3.0 | 2.4.0 | override (Fase 3) |
| toml | 4.2.0 | 5.0.1 | override `pnpm-workspace.yaml` (Fase 3; major, API compatibile — vedi nota) |
| markdown-it | 13.0.2 | 14.3.3 / 15.0.3 | **major**, upgrade validato (test/typecheck/Trivy) → Fase 3b |
| @azure/msal-node | 5.1.5 / 5.6.0 | 7.1.0 | override `pnpm-workspace.yaml` (Fase 3, major — vedi nota) |
| zod | 3.25.76 | 4.6.6 | **NO override**: triage VEX |
| libcurl, brotli-libs (OS) | 8.22.0-r0 / 1.2.0-r1 | 8.23.0-r0 / 1.2.1-r0 | Dockerfile (Fase 1) |

Wiz, sulla stessa immagine, aggiunge 3 HIGH che il DB Trivy non riporta:
`tedious` 20.0.5, `samlify` 2.13.0 e l'`undici` 6.28.1 bundled in npm.
Sono coperti in Fase 1/3 (per questo non compaiono nella tabella sopra).
Il DB aggiornato del 28/10 aggiunge anche `@modelcontextprotocol/node` 2.0.0
(GHSA-f897-62hf-6gxq → 2.1.0), chiuso in Fase 3.

Due fatti strutturali che spiegano tutto:

1. **La base non è stata aggiornata con la 2.45.4**: il Dockerfile di
   `release/2.45.4` è identico a quello di `release/2.44.7` e pina ancora
   `n8nio/base:26.12.1@sha256:435e5310…` (build del 22/10, contiene `libde265`).
   Fase 1 serve quindi anche per la 2.45.4.
2. **Upstream congela alcune versioni con pin esatti in `pnpm-workspace.yaml`**:
   `follow-redirects: 1.16.0`, `body-parser: 2.3.0`, `multer: ^2.3.0`, `undici`
   via cataloghi `undici-v6`/`undici-v7`, `zod: 3.25.76` repo-wide. È una scelta
   di stabilità: quei pin **tengono indietro** i fix di sicurezza. La strategia
   corretta è sollevarli al minimo incremento sicuro, non aggiungere override
   paralleli nel `package.json`.

## 2. Struttura del toolkit

```
docker/images/n8n/Dockerfile          # Fase 1: base bump + upgrade libcurl/brotli (marcato # HARDENING)
pnpm/safe-overrides.diff              # Fase 3: 9 modifiche a pnpm-workspace.yaml (validato con git apply)
pnpm/majors-test-first.diff           # Fase 3b: markdown-it ^14.3.3 (validato)
security/vex.openvex.json             # triage delle CVE accettate (OpenVEX, formato upstream)
security/vex-statement-template.json  # template di statement da compilare
security/trivy-ignore-policy.rego     # policy di ignore (copia upstream)
scripts/scan.sh                       # gate: DB fresco, VEX+policy, exit code su CRIT/HIGH, SBOM opzionale
scripts/summarize.mjs                 # riepilogo leggibile di un report Trivy JSON
ci/trivy-gate.yml                     # GitHub Actions: scan + gate + artifact
.github/workflows/publish.yml         # build multi-arch (amd64+arm64) + push GHCR
reports/                              # baseline 2.44.7 (113), baseline 2.45.4 (95), base image (25)
```

## 2b. Pubblicazione immagini (GHCR)

Il workflow `.github/workflows/publish.yml` (manuale o su tag `v*`) clona n8n
al tag `n8n@<version>`, applica i due diff, copia il Dockerfile hardening e
pubblica via buildx/QEMU:

```
ghcr.io/<owner>/n8n-container:<tag>
ghcr.io/<owner>/n8n-container-runners:<tag>
```

Esempio: `n8n_version=2.45.4`, `image_tag=2.45.4-r1` → tag `2.45.4-r1`.
Per un tag git: `git tag v2.45.4-r1 && git push origin v2.45.4-r1`.
Il workflow usa `GITHUB_TOKEN` con `packages: write`; non servono altri secret.
Per un'organizzazione, verifica che i package GHCR siano abilitati alla
scrittura da Actions.

## 3. Le fasi

### Fase 1 — Runtime base image (OS 0)

Copia `docker/images/n8n/Dockerfile` nel checkout al posto di quello upstream.
Contiene tre modifiche marcate `# HARDENING`:
- `RUNTIME_IMAGE` bumpata al digest del 23/10 (`sha256:4f98092c…`): la base
  rebuildata elimina `libde265` (misurato: 32 → 25 CVE OS). Il `BUILDER_IMAGE`
  è irrilevante per l'immagine finale (multi-stage: solo i `.node` vengono copiati).
- `libcurl`/`brotli-libs`: la base DHI **non ha `apk`** (exit 127), quindi il
  Dockerfile aggiunge uno stage `libcurl-fix` (`FROM alpine:3.24`) che installa
  `libcurl>=8.23.0-r0` e `brotli-libs>=1.2.1-r0`, copia le librerie nel runtime
  e aggiorna le entry `P:`/`V:` di `/lib/apk/db/installed` (Trivy legge quelle).
  Chiude le 2 HIGH OS (+ ~22 LOW). Sono sostituzioni patch-level, ABI
  compatibili; vecchi file brotli rimossi e symlink aggiornati. Verifica con
  `n8n --version` e lo smoke test dell'immagine. Se in futuro `n8nio/base`
  pubblica un digest con i fix, preferiscilo e rimuovi lo stage.
- `undici` di **npm**: la base include npm 11.21.1 con `undici 6.28.1`
  (CVE-2026-109869) in `/usr/lib/node_modules/npm`; il Dockerfile crea
  `undici@6.29.1` in uno stage e sostituisce solo la copia interna di npm.
  Il copy di n8n era già a 6.29.1/7.30.1 via catalog.

Rebuild e verifica con `./scripts/scan.sh <registry>/n8n:2.45.4-r1`. Atteso: livello OS a 0.
Misurato sull'immagine locale: **OS 0 HIGH** (libcurl/brotli chiusi, base senza
libde265), **node 1 HIGH** (solo `zod`, vedi Fase 4).
Versiona `2.45.4-r1` (o schema tuo): non muovere il tag originale.

Nota sul meccanismo: se buildi con `pnpm build:docker`, bake non sovrascrive i
digest — in `docker-bake.hcl` le variabili `BUILDER_IMAGE`/`RUNTIME_IMAGE`
di default sono vuote e vengono passate come build-arg *solo* se le setti;
non settandole vale l'`ARG` del Dockerfile hardening (verificato). Se la tua
CI passa `RUNTIME_IMAGE` come environment, aggiornalo lì.

### Fase 2 — Upgrade 2.45.4 ✓ COMPLETATA

Esito misurato: 113 → 95 CVE, CRITICAL 4 → 0. Il contatore attivo è ora la minor:
riguardo all'upgrade cadenziale (Fase 4), mantieniti entro 2 minor dalla corrente.

### Fase 3 — Sollevare i pin (chiude 18 delle 20 HIGH node Trivy + 2 HIGH Wiz)

Dal checkout `release/2.45.4` (o del tuo fork sopra di esso):

```bash
cd <checkout-n8n>
git apply /Users/luca/dev/n8n/n8n-container/pnpm/safe-overrides.diff
pnpm install                # 1) aggiorna pnpm-lock.yaml con i pin sollevati
pnpm build:docker           # 2) crea ./compiled e poi l'immagine (dettagli sotto)
./scripts/scan.sh n8nio/n8n:local
```

Perché i due passi in quest'ordine:
- `pnpm install` è ciò che **applica gli override al lockfile**. Il bundle
  `./compiled` viene generato *dal lockfile* (closure derivata, non re-resoluta),
  quindi senza questo passo le versioni sollevate non entrano nell'immagine.
- `pnpm build:docker` è lo script `package.json` che esegue
  `node scripts/build-n8n.mjs && node scripts/dockerize-n8n.mjs`:
  - `build-n8n.mjs` pulisce `./compiled`, fa `pnpm install --frozen-lockfile`
    (fallirebbe con un lockfile non aggiornato → ecco perché il punto 1 viene
    prima), builda i package del monorepo (`pnpm build --summarize`) e crea la
    closure di produzione pruned in `./compiled` (più i task runner in
    `dist/task-runner-javascript`);
  - `dockerize-n8n.mjs` lancia `docker buildx bake -f docker/docker-bake.hcl` e
    di default produce `n8nio/n8n:local` + `n8nio/runners:local`.

Tag/registry: o tagghi dopo (`docker tag n8nio/n8n:local <registry>/n8n:2.45.4-r1`
e `docker push`), oppure fai pushare bake direttamente settando
`IMAGE_BASE_NAME=<registry>/n8n IMAGE_TAG=2.45.4-r1 pnpm build:docker` — in quel
caso lo script richiede anche `RUNNERS_IMAGE_BASE_NAME` sullo stesso registry,
altrimenti si ferma con errore (evita push accidentale sul repo ufficiale).

Le 12 modifiche del diff (i selettori non usati da upstream restano no-op quando
n8n bumpa da solo):

| Sezione | Voce | Da | A |
|---|---|---|---|
| catalog | `@modelcontextprotocol/node` | 2.0.0 | 2.1.0 |
| catalog | `@modelcontextprotocol/sdk` | 1.31.0 | 1.32.0 |
| catalog | `@modelcontextprotocol/server` | 2.0.0 | 2.3.0 |
| catalog | `undici-v6` | ^6.28.1 | ^6.29.1 |
| catalog | `undici-v7` | ^7.29.1 | ^7.30.1 |
| overrides | `multer` | ^2.3.0 | ^2.5.0 |
| overrides | `body-parser` | 2.3.0 | 2.4.0 |
| overrides | `follow-redirects` | 1.16.0 (pin esatto) | 1.16.1 |
| overrides | `toml` (selettore `toml@<5.0.1`) | 4.2.0 | 5.0.1 |
| overrides | `@azure/msal-node` (aggiunto) | 5.1.5 / 5.6.0 | ^7.1.0 |
| overrides | `'mssql@12.7.0>tedious'` | 20.0.5 | 20.3.7 |
| overrides | `samlify` (aggiunto) | 2.13.0 | 2.15.0 |

ℹ️ **Wiz aggiunge 3 HIGH che Trivy non vede**: `tedious` 20.0.5
(GHSA-wj7m-ffj3-574h), `samlify` 2.13.0 (GHSA-wr2x-fh6q-q243) e l'`undici`
6.28.1 **bundled in npm** (`/usr/lib/node_modules/npm`), non il copy di n8n.
I primi due sono chiusi da questo diff; il terzo dal Dockerfile. `zod` resta
l'unico HIGH residuo.

⚠️ **Nota su `tedious`/`samlify`**: bump minor (20.0.5 → 20.3.7, 2.13.0 →
2.15.0). Testare il nodo Microsoft SQL e il login SAML SSO dopo il rebuild;
se qualcosa si rompe, spostare la voce in majors/VEX.

ℹ️ **Nota su `toml`**: è un salto **major** (4 → 5), ma l'unico breaking change
riguarda gli interi fuori dal range sicuro di JavaScript (`> 2^53-1`): 5.0.1 li
rifiuta invece di arrotondarli. L'unico consumer in n8n è `snowflake-sdk`, che
usa solo `toml.parse()` per `~/.snowflake/connections.toml`; il nodo Snowflake
passa sempre le opzioni di connessione, quindi quel path non è esercitato.
Verificati: suite 4.2.0 → 5.0.1 (56/56) e parse di un `connections.toml`
realistico con output identico. Test consigliato: suite
`packages/nodes-base/nodes/Snowflake/__tests__` + smoke del parser.

⚠️ **Nota su `@azure/msal-node`**: è un altro salto **major** (5 → 7) del diff
"safe", incluso su richiesta esplicita. Upstream pinna `@azure/identity` 4.13.0,
che contratto semver si aspetta msal-node ^5: dopo il rebuild, testare i flussi
Azure (nodi Microsoft/Azure con credenziali configurate) prima del push. Se lo
smoke fallisce, spostare la voce in majors/VEX.

`handlebars` non serve: upstream lo pinna già a 4.7.10.

**Hai già applicato una versione precedente del diff?** Non ri-applicare il
diff aggiornato: i contesti degli hunk sarebbero già cambiati e `git apply`
fallirebbe.

- Se `@azure/msal-node` è già in `overrides`, cambia solo il selettore toml:

  ```yaml
  'toml@<4.2.0': 4.2.0   →   'toml@<5.0.1': 5.0.1
  ```

- Se manca, aggiungi anche la riga msal dopo
  `'@langchain/langgraph-checkpoint': 'catalog:'`:

  ```yaml
  '@azure/msal-node': ^7.1.0
  ```

Poi `pnpm install && pnpm build:docker` come al punto precedente.

**`libcurl` e `brotli-libs` NON sono pacchetti npm**: sono librerie alpine della
base image `n8nio/base`, quindi pnpm override non può toccarle. Le chiude la
Fase 1 (Dockerfile: bump digest base + `apk add --no-cache 'libcurl>=8.23.0-r0'
'brotli-libs>=1.2.1-r0'` nel runtime stage).

Diff rigenerati e verificati su una copia del file upstream (applicazione in
catena safe → majors: tutte le modifiche atterrano).

### Fase 3b — I major: markdown-it 14.3.3 (validato)

```bash
cd <checkout-n8n>
git apply /Users/luca/dev/n8n/n8n-container/pnpm/majors-test-first.diff
pnpm install          # aggiorna il lockfile (stesso motivo della Fase 3)
pnpm build:docker     # rigenera ./compiled + immagine
pnpm build:docker:smoke   # smoke test dell'immagine (rebuild già fatto, parte da ./compiled)
```

Se il bump è già nel checkout (catalogo a `^14.3.3`), **salta `git apply`**:
il contesto non matcha più e il diff fallisce. Verifica solo che lock e
immagine siano stati rigenerati con `pnpm install && pnpm build:docker`.

- `markdown-it` → `^14.3.3`: chiude 1 HIGH, 3 MEDIUM e 1 LOW (la LOW è fissata
  solo in 14.3.3, per questo il diff non si ferma a 14.3.2). Validato: suite
  `@n8n/design-system` (1871 test) e `@n8n/chat` (147) verdi, test markdown di
  editor-ui e typecheck di entrambi i package verdi; l'immagine contiene solo
  14.3.3 e Trivy non riporta più finding markdown-it.
- **Attenzione al falso negativo dei test**: la suite editor-ui completa
  (1400 file, 22.110 test) passa con `LC_ALL=en_US.UTF-8`; senza quel locale
  10 test di `evaluation.ee` falliscono perché formattano numeri assumendo
  en-US (`0.004` vs `0,004`, `3,912t` vs `3912t`). Non c'entra markdown-it:
  usa quel locale in CI o correggi i test separatamente.

  ```bash
  LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 pnpm --filter n8n-editor-ui test
  ```
- `@types/markdown-it` resta a 13: il typecheck passa. Se lo porti a 14, i due
  import `markdown-it/lib/*` (`useChatHubMarkdownOptions.ts`, `youtube.ts`)
  vanno sostituiti con `import type { StateCore, StateInline } from 'markdown-it'`.
- `vue-markdown-render@2.2.1` (usato da `RunDataMarkdown`,
  `RunDataParsedAiContent`, `SessionDetailPanel` e `@n8n/chat`) pinna
  `markdown-it@^13.0.2`: la 13.0.2 resta nel **bundle frontend** (verificato:
  `editor-ui/dist` contiene sia 13.0.2 sia 14.3.3) ma non nella closure server
  pruned. Le opzioni passate da n8n (`highlight` soltanto) non attivano
  `typographer`/`linkify`/`html`, quindi questa copia non è nel path delle 5
  CVE; per eliminarla del tutto serve un override
  `'vue-markdown-render>markdown-it': 14.3.3` (non testato) o un wrapper
  aggiornato.
- `toml` è stato spostato in Fase 3 (safe): 5.0.1 chiude 4 HIGH e il breaking
  change sugli interi non tocca il path usato da n8n. Vedi la nota in Fase 3.
- **`zod`: NON toccare.** Upstream pinna 3.25.76 repo-wide apposta (solo `knip`
  riceve zod 4 via scoped override). Forzarlo a 4 romperebbe la validazione di
  tutta la codebase dei nodi → candidato VEX, da dichiarare con la procedura
  descritta in Fase 4.
- (`@azure/msal-node` è stato spostato in safe-overrides su richiesta: resta
  comunque un major, vedi la nota in Fase 3.)

### Fase 4 — Governance (il pezzo che rende sostenibile il processo)

1. **Gate CI** (`ci/trivy-gate.yml` o nel tuo pipeline): `scan.sh` esce 1 se
   restano CRITICAL/HIGH con fix disponibile dopo VEX e policy. Push solo a gate verde.
2. **VEX con scadenza**: ogni CVE accettata entra in `security/vex.openvex.json`
   con `expiration` (es. +90 giorni): gli accettati decadono da soli e riesplodono
   alla scan successiva se non rivalutati. Template pronto:
   `security/vex-statement-template.json`. Regola ferrea: `not_affected` solo
   dopo verifica di reachability reale (import chain, path eseguito, esposto via HTTP/UI).
   Stato attuale: nessuno statement markdown-it (upgrade 14.3.3 adottato in
   Fase 3b); `zod@3.25.76` resta il candidato VEX, da aggiungere quando si
   farà il triage.
3. **Cadenza**: ri-scan a ogni rebuild (il DB si aggiorna in `scan.sh`) + scan
   mensile della flotta + upgrade entro 2 minor dalla release corrente.
4. **Tracciabilità**: SBOM CycloneDX insieme all'immagine (`SBOM=1 ./scripts/scan.sh …`)
   e diff dei report dopo ogni fase:
   ```bash
   node scripts/summarize.mjs reports/scan-<nuovo>.json
   ```

## 4. Esito atteso

| Stato | Tot | CRIT | HIGH | MED | LOW |
|---|---|---|---|---|---|
| 2.44.7 (prima) | 113 | 4 | 29 | 53 | 27 |
| 2.45.4 (oggi) | 95 | 0 | 22 | 46 | 27 |
| dopo Fase 1 + 3 | ~45 | 0 | 2 | 38 | 5 |
| dopo Fase 3b (markdown-it 14.3.3) | ~44 | 0 | 1 | 38 | 5 |
| **misurato su ghcr.io/modalsource/n8n-container:2.45.4-r3** | **30** | **0** | **1** | **25** | **4** |

L'unico HIGH residuo è `zod` (candidato VEX); `markdown-it` è chiuso
dall'upgrade. La copia 13.0.2 di `vue-markdown-render` resta nel bundle
frontend ma non nella closure server e non è nel path delle CVE. Il livello
OS è a **0 CVE** in tutte le severità; le 30 residue sono tutte nel bundle node.
Il MED in più rispetto alla r2 è `qs` CVE-2026-110816, emerso con il DB del
28/10 sullo stesso `qs 6.15.2` (non è una regressione dell'immagine).

Wiz sulla r1 mostrava 4 HIGH: `tedious`, `samlify`, `undici` di npm e `zod`.
La r2 ha chiuso i primi tre; la r3 chiude anche `@modelcontextprotocol/node`
2.0.0 → 2.1.0. Resta `zod`.

Il residuo MED/LOW (~43) non si chiude a uno a uno: si gestisce con fix
opportunistici quando upstream bumpa, e VEX con scadenza per il resto.
Il fattore che tiene basso il numero nel tempo è la cadenza di upgrade (Fase 4),
non la pulizia una tantum.
