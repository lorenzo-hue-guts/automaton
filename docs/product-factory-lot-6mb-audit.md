# Lot 6M-B — Phase 1 : audit des environnements interactifs réels

## Conclusion

**Aucune navigation Playwright utilisable et aucune exécution Android n'ont été
démontrées dans cet audit.** Les essais Chromium réels reproduisent le blocage du
sandbox. Aucun émulateur ou appareil autorisé n'est disponible. Ce sont des
blocages d'exécution, pas une raison de modifier le choix stratégique de surface.

La voie recommandée est un **runner navigateur isolé dédié**, avec le sandbox
Chromium réellement actif, puis un **runner Android autorisé avec virtualisation
ou un appareil de test dédié**. Ces runners doivent être des backends bornés des
workers/harnesses existants, sans nouvel ordonnanceur. Il faut aussi produire des
APK signés avec une clé de test éphémère avant leur installation Android standard.

Ce document est un audit et une expérimentation minimale. Il n'implémente pas les
runners et ne promeut aucune capacité. Aucun composant de production, contrat de
sécurité, configuration d'agent ou base de données n'a été modifié.

Relevés du **8 octobre 2026, vers 19 h 53, Europe/Paris**. Les horodatages bruts des
preuves locales restent en UTC. Branche : `feature/product-factory`.
HEAD : `d8f816881fd24b6f5e3d616e59edec387a447667`.

## 1. Sources et méthode

Les documents et interfaces consultés sont notamment :

- `docs/product-factory-lot-6m.md` et
  `docs/product-factory-lot-6m-integration-map.md` ; le texte initial de la carte
  d'intégration est historique, sa note de fin renvoie au résultat du Lot 6M.
- `src/product-factory/docker-product-sandbox.ts` : environnement réel, ouverture,
  commandes Node bornées, destruction et reprise des conteneurs.
- `surface-browser.ts`, `surface-adapters.ts`, `surface-acceptance.ts`,
  `surface-builder-types.ts`, `surface-mobile.ts` : lancement Chromium, plans,
  actions, preuves, profils et statuts.
- `model-builder.ts`, `model-build-resume.ts`, `build-engine.ts`,
  `company-guards.ts`, `resource-manager.ts`, `harness-types.ts` et les interfaces
  des workers : admission, approbations, tâches, budgets, leases et reprise.
- `scripts/product-factory/android-build.cjs` et
  `prepare-surface-toolchains.py` : composition des images, compilation et APK.
- Les JSON de preuve du Lot 6M encore présents dans `/tmp/lot-6m/`.

Un inventaire SHA-256 de 300 fichiers existants a été conservé dans
`/tmp/lot-6mb/baseline.json` avant les expériences. Il inclut sources, scripts,
documents, constitution, manifeste et lockfile. Les modifications non commitées
préexistantes sont conservées.

Le skill `cloud-environment-onboarding:setup` a guidé les vérifications. Aucun
changement de draft d'environnement, installation système ou changement de
permissions n'a été appliqué. Les helpers d'audit se trouvent uniquement sous
`/tmp/lot-6mb/` ; le seul ajout au dépôt est ce rapport.

## 2. État réel de l'environnement

| Élément | Observation | Portée |
| --- | --- | --- |
| Hôte | Linux x86_64, noyau 6.18.44 ; utilisateur agent UID 1000 | Environnement de développement, pas runner produit accepté |
| CPU visible / quota | 5 processeurs logiques visibles ; `cpu.max=400000 100000`, soit quota de 4 CPU | Capacité partagée, pas réservation disponible garantie |
| Mémoire | Limite cgroup 32 GiB ; environ 15,6 GiB utilisés au relevé | Les autres processus partagent cette limite |
| Stockage | `/workspace` : environ 21 GiB libres ; `/tmp` : environ 14 GiB libres | Valeurs instantanées ; non réservées |
| Docker | 28.4.0, runtime runc, profil seccomp builtin, stockage vfs | Le contexte Docker n'est pas identique au sandbox de la commande hôte |
| Chromium | 151.0.7922.173, Debian 13 | Présent ; lancement sandboxé non fonctionnel |
| Playwright Core | 1.57.0 dans l'image existante ; également présent dans le runtime hôte | Présence de package, pas preuve d'interaction |
| Java | OpenJDK 21.0.12.1 | Compiler module utilisé au Lot 6M |
| SDK Android | Plateforme API 35 révision 2 ; Build Tools 35.0.0 | Compilation/packaging déjà démontrés au Lot 6M |
| ADB / emulator / sdkmanager / avdmanager | Non trouvés sur PATH et dans les racines SDK vérifiées | Aucun chemin d'installation ou de démarrage opérationnel |
| Images système / AVD | Absents dans le SDK installé | Pas d'Android bootable préprovisionné |
| `/dev/kvm` | Absent | Pas d'accélération KVM accessible |
| Flags CPU vmx/svm | Absents des flags exposés | Pas de virtualisation imbriquée démontrée ; ne prouve pas une impossibilité permanente |
| USB / appareil autorisé | `/dev/bus/usb` absent ; aucun runner/device autorisé fourni | Aucune connexion à un appareil personnel ou service ADB tentée |
| Variables SDK | ANDROID_HOME, ANDROID_SDK_ROOT et JAVA_HOME non définies | Le SDK local reste accessible par son chemin connu |
| Runners distants | Aucun outil runner/browser autorisé exposé dans la session | Il faut fournir une infrastructure/connexion explicite |

Le sandbox produit existant est plus étroit que l'hôte : UID/GID 10000,
`network=none`, racine read-only, `cap-drop=ALL`, `no-new-privileges`, seccomp,
**1 CPU, 256 MiB, 64 PIDs**, tmpfs `/work` 64 MiB et `/tmp` 16 MiB.
Pas de montage hôte, port publié, mode privilégié ou image téléchargée au runtime.
La quantité de RAM de l'hôte ne relève pas automatiquement ces limites.

## 3. Chromium : diagnostic précis et expériences

### 3.1 Deux backends de sandbox indisponibles

Le helper `/usr/lib/chromium/chrome-sandbox` présente deux états distincts :

| Emplacement | Propriétaire et mode observés | Conséquence |
| --- | --- | --- |
| Hôte | UID 65534/nobody, mode 4755 | Chromium attend un helper root-owned ; l'état est invalide |
| Image du Lot 6M | UID 0/root, mode 755 | Le bit setuid manque ; l'état est invalide |

L'image a été assemblée avec `COPY --chmod=755 . /` dans le script du Lot 6M,
ce qui explique la perte du mode 4755 du fichier copié. **C'est un défaut de
composition observable, mais sa correction seule ne résout pas le lancement.**
Le contrat `no-new-privileges` empêche une élévation par setuid ; les capabilities
sont aussi supprimées. Aucun chown/chmod sensible du helper n'a été effectué et
le contrat n'a pas été changé pour autoriser ce backend.

Le backend alternatif utilise des user namespaces sans élévation setuid. Il doit
pouvoir créer les namespaces et écrire les mappings privés nécessaires. Ici :

- **Hôte** : `unshare --user --map-root-user /usr/bin/true` termine avec code 1 :
  `cannot open /proc/self/uid_map: Read-only file system`. Le `/proc` visible par
  l'agent est monté en lecture seule. La création/mapping requis n'est donc pas
  fonctionnelle dans ce contexte.
- **Conteneur produit** : `unshare --user ...` et
  `unshare --user --map-root-user ...` terminent chacun avec code 1 :
  `unshare failed: Operation not permitted`. Son `/proc` est writable, mais la
  création de user namespace est refusée. `max_user_namespaces=136275`, donc
  la valeur observée n'est pas simplement zéro.
- Le conteneur a `Seccomp: 2`, le profil Docker builtin, aucune capability et
  `NoNewPrivs: 1`. Le refus est compatible avec les restrictions du profil Docker
  sur ces syscalls. **La contribution exacte de seccomp versus une restriction
  supplémentaire du noyau/runtime n'a pas été isolée** : cela demanderait de
  changer le contexte de permissions. Aucun tel changement n'a été tenté.

Le blocage effectif est établi sans attribuer à tort toute la responsabilité à
une seule couche : aucun des deux mécanismes de sandbox Chromium ne fonctionne
dans le contexte testé.

### 3.2 Lancements réels via Playwright

Les appels utilisent `chromiumSandbox: true`, le binaire explicite et une durée
de lancement bornée. Chaque essai a un profil temporaire, sans credentials.

| Essai | Résultat réel | Navigation / interaction |
| --- | --- | --- |
| Hôte, backend par défaut | FATAL `setuid_sandbox_host.cc:166`, helper invalide | Non exécutées |
| Hôte, backend user namespaces | `No usable sandbox!` | Non exécutées |
| Image existante, protections Docker exactes | FATAL helper invalide, SIGABRT | Non exécutées |
| Même image, backend user namespaces | `No usable sandbox!`, exit 1 du Chromium enfant | Non exécutées |

Le test du backend user namespaces ajoute **uniquement**
`--disable-setuid-sandbox` : il exclut le helper déjà inutilisable et exige que
le sandbox par namespaces prenne le relais. Ce n'est pas `--no-sandbox` ;
`chromiumSandbox: true` reste activé, et Chromium s'arrête quand aucun sandbox
n'est disponible. Aucune option de désactivation globale ou du filtre seccomp
Chromium n'a été utilisée.

Les suggestions automatiques de Playwright/Chromium contenant `--no-sandbox`
ou `chromiumSandbox: false` apparaissent dans certains diagnostics. **Elles n'ont
pas été exécutées.** Aucun port, réseau ou privilège n'a été élargi.

Un HOME/XDG_CONFIG_HOME temporaire writable a été fourni pour éviter que des
erreurs de profil/crashpad masquent la cause. Le blocage du sandbox persiste.
Les messages crashpad/cpufreq accessoires ne sont pas la cause principale établie.
La mémoire pourrait nécessiter un dimensionnement ultérieur, mais ces échecs
précis sont des aborts de sandbox, pas une preuve d'OOM.

**Il n'existe donc pas de preuve minimale de navigation réussie dans cette
configuration actuelle.** Les probes prévoyaient un bouton local en `data:` et
un clic avec assertion ; ils n'ont jamais atteint ces étapes. Ce n'est ni un
test interactif de produit généré ni une preuve de capacité à promouvoir.

### 3.3 Reproduction minimale dans le sandbox existant

L'image est locale et inchangée :
`sha256:6aeb276613be88d3a52e646b0de631036e91de9a390ba0b8170a68dd35efdf20`.
Le build TypeScript existant fournit le provider ; aucun daemon Automaton n'est
lancé par la commande ci-dessous. À exécuter depuis le dépôt, avec le Node de
l'environnement activé :

```sh
node --input-type=module <<'JS'
import { DockerProductSandbox } from './dist/product-factory/docker-product-sandbox.js';
const image = 'sha256:6aeb276613be88d3a52e646b0de631036e91de9a390ba0b8170a68dd35efdf20';
const id = '01' + Date.now().toString(36).toUpperCase().padStart(24, '0');
const session = await new DockerProductSandbox(image, 30000).open(id);
try {
  const code = String.raw`(async () => {
    const fs = require('fs');
    const { chromium } = require('/toolchain/playwright-core');
    fs.mkdirSync('/tmp/browser-audit', {recursive: true});
    for (const args of [[], ['--disable-setuid-sandbox']]) {
      let browser;
      try {
        browser = await chromium.launch({
          executablePath: '/usr/lib/chromium/chromium',
          chromiumSandbox: true, headless: true, timeout: 7000,
          env: {PATH:'/usr/local/bin:/usr/bin', HOME:'/tmp/browser-audit'},
          args: ['--disable-dev-shm-usage', ...args]
        });
        const context = await browser.newContext();
        await context.route('**/*', route => route.abort());
        const page = await context.newPage();
        await page.goto('data:text/html,<title>Audit</title><button onclick="this.textContent=\x27Done\x27">Go</button>');
        await page.getByRole('button', {name:'Go'}).click();
        if (await page.getByRole('button').innerText() !== 'Done') throw Error('Click failed');
        console.log(JSON.stringify({status:'PASS', version:browser.version(), args}));
        await context.close();
      } catch (error) {
        console.log(JSON.stringify({status:'BLOCKED', args, error:error.message}));
      } finally { if (browser) await browser.close(); }
    }
  })().catch(e => { console.error(e); process.exit(1); });`;
  const result = await session.exec(['node', '-e', code], 25000);
  console.log(result.stdout);
  console.log({probeExit:result.exitCode, stderr:result.stderr});
} finally { await session.close(); }
JS
```

Le code de sortie zéro du collecteur signifie seulement que les diagnostics ont
été collectés. Les résultats internes `BLOCKED` et les exits Chromium déterminent
le résultat navigateur. Il ne faut jamais convertir le premier en PASS.

Pour isoler le diagnostic namespace, une image temporaire ajoutant seulement le
binaire système `unshare` et ses bibliothèques a été construite hors du dépôt.
Elle a été lancée via **le même DockerProductSandbox**, sans nouvelle option de
sécurité. Son inspect confirme UID 10000, network none, read-only, cap-drop ALL,
no-new-privileges, 256 MiB, 64 PIDs, aucun port ou montage hôte. L'image et tous
ses conteneurs ont été supprimés après capture. Les scripts complets restent dans
`/tmp/lot-6mb/namespace-probe.mjs` et `browser-probe.mjs` pour cette session.

La construction initiale a rencontré un répertoire Docker buildx hôte read-only,
puis BuildKit a interprété le digest nu comme une référence de registre et échoué
à la résoudre. Aucun pull n'a abouti. Le diagnostic a utilisé une configuration
Docker temporaire sous `/tmp`, le builder local legacy hors réseau et le tag
local dont le digest avait été vérifié. Aucun profil Docker global n'a été modifié.

### 3.4 Options Web et recommandation

| Option | Faisabilité et risque | Décision |
| --- | --- | --- |
| Corriger uniquement propriétaire/mode du helper | Défauts observables ; NP/cap-drop et namespaces restent bloquants | Insuffisant ; pas de changement sensible dans l'audit |
| Modifier les limites CPU/RAM seulement | Peut améliorer la stabilité après lancement ; ne corrige pas les permissions namespace | Pas un correctif du blocage actuel |
| Image Playwright standard utilisée telle quelle | Peut utiliser root, sandbox désactivé ou des recommandations incompatibles | Pas une preuve ni une solution automatique |
| Autoriser des syscalls namespace dans le conteneur actuel | Nécessite revue/autorisation d'un autre profil de sécurité et vérification de la couche hôte | Hors périmètre ; non appliqué, pas recommandé comme modification silencieuse |
| Exécution directement sur l'hôte actuel | Mapping `/proc` read-only ; ne reproduit pas la frontière produit | Bloquée, aucun fallback |
| Runner navigateur dédié dans une VM/zone de test isolée | OS avec user namespaces non privilégiés fonctionnels ; Chromium non-root et sandbox actif ; confinement extérieur fort | **Recommandé**, infrastructure autorisée à fournir |

Le runner recommandé dispose d'un noyau et d'un `/proc` propres à sa VM, où le
mapping de **ses propres** user namespaces peut fonctionner, sans montage du
`/proc` de l'orchestrateur. L'isolement extérieur VM et les permissions internes
font l'objet d'un profil approuvé séparé, pas d'un relâchement du sandbox Builder.

Le produit et le navigateur communiquent seulement par loopback privé **dans le
job isolé**, ou un chemin inter-sandbox strictement autorisé. Par défaut, tout
egress est refusé. Aucune URL publique, port CDP public, profil utilisateur,
extension, cookie de production, montage sensible ou credential créateur.

La documentation officielle Playwright consultée décrit le besoin de user
namespaces pour son mode sandboxé avec utilisateur séparé. Elle propose aussi
des configurations `--ipc=host`, root ou SYS_ADMIN pour d'autres contextes :
**nous ne les avons ni exécutées ni retenues pour du code généré non fiable**.
Un profil seccomp externe doit être revu, pas copié aveuglément depuis internet.

## 4. Android : ce qui manque réellement

### 4.1 Compilation n'est pas installation

Les preuves historiques du Lot 6M confirment trois compilations et APK unsigned.
Le helper assemble manifest + classes.dex avec javac/d8/aapt2/jar ; il ne signe pas.
L'image SDK inchangée est
`sha256:69ba837fc91ded23dd170b31ab0865dbbdea80af6a0b0a8b16a573e2c1fae8ff`.

| Artefact historique | SHA-256 | Signature |
| --- | --- | --- |
| Field calibration log | `54e2bf3ef967c7f52c2b40437a2fe7e49fbbfc8e522748ba5c66b8c872af7751` | NOT_CONFIGURED |
| Museum collection intake | `a8d6dfe2692d0ebfd0994ee819bf7887d85c90196cbbb77d320873807b0a6a59` | NOT_CONFIGURED |
| Private shift handover | `3b5b168b5fa32ddd55a4959e2f514ff24434a1eafbc5935978b282afb5827c25` | NOT_CONFIGURED |

Les binaires ont été supprimés par les teardowns du Lot 6M : aucun `.apk` retenu
n'a été trouvé dans le dépôt ou `/tmp/lot-6m/`. Il faudra régénérer/conserver un
artefact pour l'expérience d'installation. Les hashes historiques ne prouvent pas
que des octets correspondants sont encore disponibles.

**Un APK non signé ne peut pas être installé normalement par Android.** Le refus
attendu d'un package sans certificat n'est pas un résultat d'ADB observé ici :
aucun appareil ne l'a reçu. Une signature debug/de test isolée est nécessaire.
Le SDK contient `lib/apksigner.jar` et zipalign ; keytool est présent dans le JDK.
Les wrappers SDK du cache hôte sont en mode 600 et non sur PATH, tandis que les
outils de l'image de compilation ont été rendus exécutables. Leur présence ne
constitue pas une démonstration de signature.

La phase suivante pourra créer une clé **de test**, locale au job, sans identité
de production, puis vérifier la signature. L'APK signé aura un **nouveau hash** :
catalogue dérivé, provenance vers l'APK unsigned/source et plan d'acceptation
figé sur l'APK installé. Ne jamais réutiliser le hash unsigned pour certifier le
runtime du package signé. Pour un test de mise à jour/persistence, la même clé de
test doit être conservée uniquement dans le périmètre éphémère de ce job.

### 4.2 Tooling et téléchargement

Manquent : platform-tools/ADB, l'émulateur, son image système appropriée, un AVD
provisionné, son état privé writable et un backend d'automatisation UI. Il manque
aussi un profil d'exécution disposant de ressources suffisantes et une admission
de ce profil par la politique/ResourceManager.

Les HEAD HTTPS effectués pendant l'audit ont renvoyé 200, sans télécharger ou
installer les archives :

| Archive Google vérifiée par HEAD | Taille annoncée | Ce que cela prouve |
| --- | ---: | --- |
| platform-tools_r37.0.1-linux.zip | 9 054 187 octets | URL accessible ; pas d'ADB installé |
| emulator-linux_x64-16489710.zip | 353 959 232 octets | URL accessible ; pas d'émulateur installé ou fonctionnel |

Les URLs viennent du XML officiel Google conservé au Lot 6M. C'est une indication
de setup possible, pas un choix éternel de version. Une installation future doit
figer version/canal, checksums, provenance, image/API/ABI et licences applicables.
L'image système nécessite un téléchargement distinct, non effectué ni mesuré ici.
ADB seul ne crée pas de device. Le réseau de setup autorisé ne donne aucun réseau
aux applications générées pendant leur acceptation.

### 4.3 Runtime, ressources et options

| Option | État / limites | Décision |
| --- | --- | --- |
| Émulateur dans le sandbox actuel | Pas de KVM/SDK runtime/AVD ; 256 MiB, 64 PIDs, 16 MiB tmp, 64 MiB work inadaptés au chemin envisagé | **BLOCKED**, aucune tentative de lancement fictive |
| Émulation logicielle sans KVM sur l'hôte | Peut exister théoriquement ; QEMU/emulator/image absents, vitesse et contraintes kernel non vérifiées | Non démontrée ; pas d'installation lourde pour l'audit |
| Runner Linux dédié avec KVM autorisé | Device KVM accessible uniquement au runner, nested virtualization si nécessaire, ressources et egress bornés | **Recommandé** si disponible |
| Appareil physique dédié de laboratoire | Alternative sans KVM ; nécessite autorisation, reset/wipe, identité/device exclusif et transport privé | Possible ; aucun appareil connecté ou testé ici |
| Service cloud de device testing | Selon disponibilité/contrats ; données, coûts, credentials et vérification des receipts à examiner | Future option uniquement, aucune création/transaction |

KVM absent ne prouve pas que tout émulateur est impossible sur tout environnement.
Mais nous n'avons aucun runtime compatible provisionné ici. L'accès KVM ou USB
ne doit pas être ajouté à DockerProductSandbox ; il relève d'un **runner spécialisé
autorisé**, sans accès aux secrets de l'orchestrateur. Aucun conteneur privilégié
ou montage de device n'a été tenté.

L'AVD doit être reset pour chaque job ou restauré depuis un snapshot propre vérifié,
sans compte Google, Play Store ou données personnelles. Une image AOSP adaptée
peut suffire. Le niveau API/ABI doit correspondre au contrat : le compilateur actuel
vise target SDK 35 et min API 26 ; ces deux nombres ne sont pas interchangeables.
ADB, son serveur et les transports emulator/device restent privés au job ; aucun
port 5037/5555 exposé publiquement. Le réseau Android est refusé au niveau runner,
pas seulement via une préférence applicative.

## 5. Ressources et coûts prévisionnels

Les valeurs suivantes sont des **enveloppes initiales d'ingénierie à mesurer**, pas
des minima officiels, une garantie de passage ou des constantes à coder en dur.
Les scénarios et le nombre de viewports/devices déterminent le profil réel.

| Runner, un job à la fois | CPU envisagé | RAM envisagée | Stockage/état envisagé | Temps/plafond initial à calibrer |
| --- | --- | --- | --- | --- |
| Web Chromium + petit runtime Node | 2 vCPU | 1–2 GiB par job ; VM avec marge système | Image ~724 MB actuelle ; 0,5–2 GiB privé writable, shm privé borné | Lancement 10–30 s ; acceptation 1–3 min |
| Android KVM + app simple | 2–4 vCPU | AVD 2–4 GiB ; runner 8–16 GiB incluant OS/outils/marge | 10–20 GiB préprovisionnés/cache/outils ; état AVD privé de plusieurs GiB | Boot borné 2–5 min ; journey 1–5 min |
| Android software emulation | CPU et temps potentiellement élevés | À mesurer avec image choisie | Même besoin d'outils/image/état | Inconnu ; pas de promesse de débit |
| Appareil de test dédié | Hôte contrôleur ADB plus léger | À mesurer | Reset, logs/artifacts bornés | Disponibilité et nettoyage de l'appareil déterminants |

Ces profils ne doivent pas modifier les valeurs par défaut des builds Node/API.
Ils exigent une réservation spécifique via les ressources existantes. Les montants
monétaires sont **UNKNOWN** : aucun tarif fournisseur, consommation facturée ou
devis n'a été obtenu. Le coût inclut VM/device, stockage, démarrages, travail de
setup/maintenance et échecs, pas seulement les tests réussis.

Risques : escape navigateur/kernel, APK hostile, egress caché, fuite par CDP/ADB,
pollution entre jobs, quotas épuisés, artefact signé différent du testé, reprise
en double, signatures de receipts forgées et preuves devenues obsolètes.
Le confinement extérieur, l'identité de job, les refus réseau, les bornes de
ressources et les bindings exacts sont obligatoires avant toute utilisation produit.

## 6. Architecture d'intégration minimale proposée

**Aucune architecture ci-dessous n'est implémentée dans cet audit.**

1. Company OS et Lot 6R gardent la décision, le Contract/surface et l'autorisation.
   La faisabilité du runner ne remplace jamais Android par Web implicitement.
2. Le Task Graph existant porte la tâche d'acceptation et ses dépendances. Le
   worker/harness existant obtient la lease et passe l'admission PolicyEngine.
   Un backend runner doit être branché derrière le harness/SurfaceBuilderAdapter,
   pas devenir un second moteur de tâches.
3. Le job transmet seulement les octets/hash autorisés et une enveloppe bornée :
   creator/product/build, Contract et surface ref/revision/hash, architecture,
   source et **artefact final** hashes, profile/plan ref/hash, task/attempt/run ID,
   lease/expiration, approbations pertinentes, budget/timeout, environnement et
   interdiction réseau/signature de production/publication. Aucun shell arbitraire
   du modèle ni credential créateur n'est accepté comme action UI.
4. Le runner vérifie l'enveloppe et l'artefact, ouvre une instance privée par job,
   démarre le runtime et exécute les actions structurées existantes. Chromium
   utilise le sandbox actif ; Android utilise l'APK de test signé exact. Transport
   de contrôle privé/authentifié, egress borné aux canaux explicitement autorisés.
   Le retour d'artifacts au contrôleur doit lui aussi être borné et authentifié.
5. Le plan et ses critères sont figés **avant** l'exécution. Les tests capturent
   assertions, snapshots sémantiques, screenshots hashés, version moteur/device,
   erreurs/runtime/network, persistence exacte, durée/ressources et cleanup.
6. Une attestation/receipt vérifiable lie l'identité du runner à toute l'enveloppe,
   au résultat et aux artifacts. Le contrôleur vérifie ces bindings et l'état
   courant via les garde-fous existants, puis persiste dans CompanyStore.
   `surfaceReceipt`, `surfaceArtifact`, `surfaceRun`, `surfaceCapability` et les
   profils/plans du Lot 6M sont réutilisés. Pas de moteur de persistence parallèle.
7. Expiration/annulation et retry suivent Task Graph/ResourceManager/worker hooks.
   Le job est tué/nettoyé ; l'échec reste immutable. La reprise doit vérifier l'état
   distant d'un run déjà dispatché pour empêcher une seconde exécution. Pas de
   heartbeat général supplémentaire ; utiliser les mécanismes existants.
8. Une receipt PASS ne vaut que pour son plan/artefact/surface. Les quality gates
   et approbations Company OS restent nécessaires ; la dérivation conservatrice
   du registre n'est pas remplacée par un drapeau `supported=true`.

Point d'extension à traiter dans la phase d'implémentation : le
`ProductSandboxSession` actuel ne transporte que des commandes Node locales et
le `WebSurfaceAdapter` attend cette session. Un backend distant devra porter le
job complet et le runtime privé, ou une communication privée expressément
autorisée. Un browser server distant pointant simplement sur `127.0.0.1` du
contrôleur **ne voit pas** le produit du contrôleur. Ne pas résoudre cela par un
port public ou un montage hôte.

De même, `AndroidSurfaceAdapter.interact` retourne actuellement 125 BLOCKED ; il
faudra le connecter au runner autorisé. `SurfaceEnvironment` et les receipts
permettent les identités d'environnement ; toute extension nécessaire pour la
lease, la signature d'attestation ou le lineage unsigned→signed doit rester
additive et bornée. La validation cryptographique du runner distant est à
implémenter ; une interface ou une chaîne `signature` seule n'est pas une preuve.

## 7. Critères d'acceptation de la prochaine phase

### Web : prérequis puis preuve interactive

- Runner identifié, versionné, autorisé, limité ; Chromium non-root, sandbox actif
  et user namespaces réellement fonctionnels. Aucun `--no-sandbox`, root avec
  sandbox désactivé, SYS_ADMIN, conteneur privilégié, IPC hôte ou seccomp unconfined.
- Tests négatifs du confinement : accès réseau externe et fichier non autorisé
  refusés, absence de credentials et de profil partagé ; contrôles du transport.
- Un artefact généré exact démarre en privé, reçoit une vraie navigation Playwright,
  réalise une action utile, une assertion sémantique et un error/recovery path.
- Si requis, persistence vérifiée après la bonne couche de reload/restart ;
  responsive/accessibilité/visuel seulement quand réellement exécutés.
- Défaut réel de browser détecté puis transmis au repair/replan existant ; nouvel
  artefact et nouveau run, ancien FAIL conservé, critères inchangés.
- Versions navigateur/Playwright, bindings et evidence hashes persistés ; coût
  inconnu conservé comme inconnu ; aucun client/demande économique inféré.

### Android : étapes séparées

- Installer hors produit les versions/checksums/licences approuvés de tools/image ;
  vérifier KVM ou le device exclusif réel, puis le boot et l'état ADB autorisé.
- Régénérer/conserver l'APK, signer de test et vérifier sa signature ; enregistrer
  SHA-256 unsigned et signed liés, sans clé de production.
- Installer le **signed APK hashé exact**, vérifier package/version/digest/provenance
  du package installé et launch/activity/process. Aucune preuve d'installation
  simplement déduite de l'existence de l'APK.
- Journey avec tap/type/assertions via identifiants sémantiques, persistence après
  restart, error/recovery et permissions seulement si pertinentes au Contract.
- Crash/ANR/hang et réseau observés ; captures/UI hierarchy hashées et bornées.
- Démontrer isolation inter-produit, wipe/reset, cancel/lease expiry, idempotence et
  cleanup. Boot seul ne certifie pas interaction ; Android ne certifie pas iOS.

### Gouvernance commune

- Job rejeté si Contract/surface/build/artifact/plan/lease sont incohérents ou expirés.
- Les criteria/steps obligatoires ne peuvent être changés après début du run.
- Un replay de receipt valide est idempotent ; une receipt d'un autre artefact,
  un screenshot d'un autre run ou une attestation invérifiable sont rejetés.
- PASS/FAIL/BLOCKED/INCOMPLETE séparés ; le résultat ne contourne aucune approval.
- Une perte de runner ne libère pas silencieusement une autorisation de seconde
  exécution pendant que le premier job pourrait encore tourner : état à réconcilier.
- Promotion dérivée seulement après preuves possédées et reproduction suffisante
  selon les profils existants. Aucun statut SUPPORTED établi dans cette phase 1.
- Les tests précédents de Builder/Company OS/analytics/optimisation restent verts
  après toute implémentation future, avec context-hardening traité séparément.

## 8. Demandes d'infrastructure et arrêt à la frontière

Pour la phase suivante, il faut fournir ou autoriser :

1. **Web** : un runner privé dont le kernel/proc/user namespaces permettent un
   Chromium sandboxé ; image/browser versionnés, enveloppe ressources, transport
   et modèle d'attestation approuvés. Une plateforme équivalente déjà autorisée
   peut convenir si ses garanties sont vérifiées.
2. **Android** : un runner KVM Linux ou device de test dédié, outils/image système,
   licences, stockage/ressources et réseau de setup approuvés ; signature de test
   éphémère et autorisation du transport ADB interne. Aucun compte store requis.
3. Un accès privé authentifié aux runners depuis les workers, avec transfert borné
   des artifacts et cancellation. Aucun secret à saisir dans le chat.

Ni configuration seccomp, sysctl, montage `/proc`, accès KVM/USB, grosse installation
SDK runtime, runner cloud payant ni infrastructure externe n'ont été modifiés ou
créés. L'audit s'arrête à cette frontière et documente les prérequis ; il n'a pas
demandé une escalation pour contourner les refus.

Les pages directes playwright.dev et developer.android.com ont retourné un refus
proxy 403 lors de la consultation. Les documents officiels Playwright ont pu être
lus sur leur dépôt GitHub et les HEAD des archives Google ont réussi. Aucun
allowlist réseau n'a été élargi pour lire les pages bloquées.

## 9. Preuves, sources et validation de l'audit

| Preuve locale | Contenu |
| --- | --- |
| `/tmp/lot-6mb/environment.json` | Quotas, outils trouvés, états SDK/device, provenance des APK historiques |
| `/tmp/lot-6mb/browser-private.json` | Inspect de l'environnement interne et deux vrais appels de lancement Chromium |
| `/tmp/lot-6mb/browser-host.json` | Deux lancements réels via Playwright sur l'hôte, tous deux BLOCKED |
| `/tmp/lot-6mb/namespaces-private.json` | Configuration de sécurité du conteneur diagnostic et refus unshare |
| `/tmp/lot-6mb/download-readiness.json` | HEAD 200 et tailles annoncées, aucun téléchargement des archives |
| `/tmp/lot-6mb/baseline.json` | Hashes de préservation pré-audit |

Ces fichiers sont locaux à la session et ne garantissent pas une rétention
indéfinie. Les commandes et résultats déterminants sont inclus dans ce rapport.
Les URL officielles consultées ou identifiées pour la phase suivante :

- [Documentation Docker Playwright, source officielle consultée](https://github.com/microsoft/playwright/blob/main/docs/src/docker.md).
- [Profil seccomp Playwright, consulté mais non appliqué](https://github.com/microsoft/playwright/blob/main/utils/docker/seccomp_profile.json).
- [Accélération Android Emulator](https://developer.android.com/studio/run/emulator-acceleration) — consultation directe bloquée dans la session.
- [Signature des applications Android](https://developer.android.com/studio/publish/app-signing) — consultation directe bloquée dans la session.
- Archives Google : `https://dl.google.com/android/repository/platform-tools_r37.0.1-linux.zip`
  et `https://dl.google.com/android/repository/emulator-linux_x64-16489710.zip`.

Résultats audit : quatre essais Playwright réels BLOCKED, puis les deux essais
du snippet de reproduction publiés ci-dessus également BLOCKED, deux essais
namespaces en conteneur refusés, mapping user namespace hôte refusé, deux HEAD 200. Aucun
test de navigation, clic, installation APK, launch Android ou interaction device
n'a PASS. Aucun benchmark produit/régression large n'a été relancé : cet audit
ne modifie pas le code de production et ne prétend pas revalider le Lot 6M.

Contrôles finaux effectués : 300/300 fichiers du baseline inchangés, aucun fichier
préexistant supprimé, un seul ajout (`docs/product-factory-lot-6mb-audit.md`).
`git diff --check` passe ; la commande de reproduction du rapport a été exécutée
et reproduit les deux BLOCKED. Aucun conteneur ne reste et l’image diagnostic
temporaire a été supprimée ; les images du Lot 6M restent inchangées. Rien de staged.
Constitution SHA-256 attendu et conservé :
`d69f71832ab7c8ba6a827fd2fe988db5f76ff253d727906a95c064fe53408d8e`.
Schéma inchangé V16, aucune migration, aucune écriture CompanyStore/capability.
Aucun commit, push, merge, PR, déploiement public, action commerciale, paiement,
campagne ou soumission store ; Lots 7R/8R non commencés.
