# Warqa (ورقة)

**Pour les enseignants et les parents :** pas besoin de programmer. Commencez par le [guide de démarrage](start-here.md), ou essayez [l'application dans le navigateur](https://redouane-e.github.io/warqa/) sans rien installer.

**Transformez un PDF en livre interactif animé et narré — en arabe, en français et en anglais, avec le modèle d'IA de votre choix.**

Warqa lit un livre, planifie une série de courtes leçons et écrit chacune comme une suite de **séquences** : une narration accompagnée de changements visuels qui surviennent exactement sur les mots qui les expliquent, avec des vérifications rapides et des exercices **dans l'image**. On regarde, on écoute, on met en pause, on répond, et on change de langue en pleine leçon. Le résultat est un site statique qui fonctionne hors ligne, sans serveur ni compte.

## Points forts

- **N'importe quel modèle** : Claude, GPT, Gemini, Mistral, DeepSeek, Grok, tout OpenRouter, ou **entièrement en local** avec Ollama, LM Studio, llama.cpp ou vLLM. Un modèle par rôle (planification, écriture, traduction, lecture des pages…). Les modèles n'écrivent ni code ni coordonnées : ils remplissent un format de leçon validé ; les erreurs leur sont renvoyées pour correction ; les petits modèles reçoivent un format simplifié.
- **L'arabe d'abord** : mise en page de droite à gauche, mathématiques en notation latine de gauche à droite dans le texte arabe (comme dans les manuels marocains), chiffres arabo-indiens et virgule décimale acceptés, réparation des PDF arabes mal encodés, voix arabes (dont marocaines) avec synchronisation.
- **Traduction de n'importe quelle langue vers n'importe quelle autre**, en conservant marques de narration, cases de réponse et formules.
- **De la pédagogie, pas des diapositives** : la scène persiste, les composants sont vivants (équations qui se transforment, sauts sur la droite graduée, balance qui penche) et des règles de rythme sont vérifiées.
- **Libre et portable** : Apache-2.0 ; exports site statique, zip, **SCORM 1.2** (Moodle), cartes **Anki**, CSV, **vidéo MP4**.

## Nouveautés

- **Darija** (`ary`) comme langue de livre à part entière : le modèle écrit comme un enseignant marocain en classe, en lettres arabes, et le lecteur a une interface en darija.
- **Lecture accompagnée** : le mot lu est surligné dans les albums illustrés et les sous-titres.
- **Cartes** : pays et **régions de n'importe quel pays** (`warqa geo add MAR` pour les 12 régions du Maroc), avec des questions « clique sur la région ».
- **Mathématiques** : tout ce que TeX sait écrire (fractions imbriquées, racines, matrices, chimie, résolution pas à pas), composé avec MathJax.
- **Mémoire de traduction et relecture** : même formulation d'un chapitre à l'autre, contrôle du glossaire, relecture par l'enseignant dans le studio ou dans un tableur ; une formulation validée n'est jamais remplacée par le modèle.
- **Qualité** : un modèle de vision juge l'image de chaque étape et les étapes faibles sont réécrites (`warqa improve`) ; **jurys d'enseignants** en aveugle, dont les notes rejoignent le classement des modèles.
- **Paquets de composants** écrits par n'importe qui (par exemple une horloge pour apprendre l'heure).
- **Application dans le navigateur** sans installation (les clés restent dans votre navigateur) et **lanceurs en un clic** pour Windows, Mac et Linux.

## Essayer

```bash
git clone https://github.com/Redouane-E/warqa && cd warqa
pnpm install && pnpm build
pnpm warqa preview examples/integers.warqa
```

## Créer son livre

```bash
pnpm warqa init mon-livre --pdf manuel.pdf --langs fr,ar --audience "collège, 5e"
cd mon-livre
warqa ingest && warqa plan          # puis relire plan.json
warqa plan --approve
warqa build --chapter ch01
warqa preview
warqa export --zip --scorm --anki fr
```

Ou le **studio** dans le navigateur : `pnpm studio` (livres dans `books/`), `pnpm warqa studio examples` pour l'exemple, ou `docker compose up`.

## Licence

Apache-2.0. S'appuie sur des idées et du code de [Papermorph](https://github.com/DozenTwelve/Papermorph) (MIT). Les livres que vous créez vous appartiennent ; respectez les droits des PDF utilisés.
