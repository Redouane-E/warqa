# Commencer ici

**Pour les enseignants et les parents.** Aucune connaissance en programmation n’est nécessaire. [العربية](../ar/start-here.md) · [English](../en/start-here.md)

## Ce que fait Warqa

Vous donnez à Warqa un PDF : un chapitre de manuel, une fiche d’exercices, une histoire. Warqa s’appuie sur
un service d’IA pour en faire de **courtes leçons animées** : une voix explique pendant que l’image change,
exactement sur les mots qui l’expliquent, avec des questions rapides dans l’image elle-même. Les leçons
peuvent être en arabe, en français, en anglais et dans d’autres langues, et l’élève peut changer de langue
en pleine leçon.

Le résultat est un petit site que vous partagez sous la forme d’un seul fichier `.zip`. Il fonctionne
**sans Internet** et sans compte, sur ordinateur, tablette ou téléphone.

Envie d’en voir une d’abord ? Ouvrez la leçon d’exemple : <https://redouane-e.github.io/warqa/demo/>

## Trois façons d’utiliser Warqa

| | Ce qu’il faut | Idéal pour |
| --- | --- | --- |
| **1. Dans le navigateur** | rien à installer | essayer Warqa dès aujourd’hui |
| **2. Lanceur en un clic** | Docker Desktop ou Node.js (le lanceur vous le dit) | un usage régulier sur votre ordinateur, avec toutes les fonctions |
| **3. Docker** | Docker et un terminal | les personnes à l’aise avec les commandes, les serveurs d’établissement |

**1. Dans le navigateur.** Ouvrez <https://redouane-e.github.io/warqa/>. Tout se passe dans la page : vos livres
et votre clé restent dans ce navigateur, sur cet ordinateur. C’est la version la plus récente ; s’il vous
manque une fonction, passez à la solution 2.

**2. Lanceur en un clic.** Sur la page de Warqa sur GitHub, cliquez sur le bouton vert **Code** →
**Download ZIP** (ou prenez la dernière version dans *Releases*), puis décompressez le fichier. Ouvrez le
dossier `launchers` et double-cliquez sur :

- Windows : `Warqa-windows.bat`
- Mac : `Warqa-mac.command` (la première fois : clic droit → *Ouvrir* → *Ouvrir*)
- Linux : `warqa-linux.sh`

S’il manque quelque chose sur votre ordinateur, le lanceur vous indique quoi installer, avec les liens. Le
premier démarrage prend de 5 à 20 minutes ; ensuite, quelques secondes. Warqa s’ouvre alors dans votre
navigateur à l’adresse <http://127.0.0.1:5170/>. Vos livres sont enregistrés dans le dossier `books`.
Plus d’aide : [launchers/README.md](../../launchers/README.md).

**3. Docker.** Dans le dossier de Warqa, lancez `docker compose up -d`, puis ouvrez <http://localhost:5170/>.

## Obtenir une clé d’IA

Warqa utilise un service d’IA pour lire votre PDF et écrire les leçons. Une **clé** est un long mot de passe
qui permet à Warqa d’utiliser ce service avec votre compte. Gardez-la secrète : quiconque la possède peut
dépenser votre crédit.

Pour commencer, choisissez-en une :

- **Google Gemini : gratuit pour démarrer.** Rendez-vous sur <https://aistudio.google.com/apikey>,
  connectez-vous avec un compte Google et cliquez sur *Create API key*. L’offre gratuite a des limites
  quotidiennes. Avec l’offre gratuite, Google peut utiliser ce que vous envoyez pour améliorer ses
  produits : n’utilisez que des documents que vous avez le droit de partager. Dans Warqa, choisissez
  l’ensemble de modèles **Gemini only**.
- **DeepSeek : très bon marché.** Rendez-vous sur <https://platform.deepseek.com>, ajoutez un petit crédit
  (quelques dollars suffisent pour de nombreux chapitres), puis créez une clé dans *API keys*. Ajoutez aussi
  une clé Gemini et choisissez l’ensemble **Budget** : DeepSeek écrit, Gemini lit les pages.
- **OpenRouter : une seule clé pour des centaines de modèles.** Rendez-vous sur <https://openrouter.ai/keys>,
  achetez un peu de crédit et créez une clé. L’ensemble **OpenRouter (one key)** utilise un modèle
  d’écriture haut de gamme, plus cher que les deux options précédentes.

Ensuite, dans Warqa, ouvrez **Clés**, collez la clé et cliquez sur **Enregistrer les clés**.

> **À propos du coût.** En dehors des offres gratuites, les services d’IA facturent chaque utilisation.
> Avec les options bon marché, un chapitre coûte en général quelques centimes ; les meilleurs modèles
> coûtent plus cher. Avant de commencer, Warqa affiche une estimation (**Pour tout créer**) et ce que vous
> avez déjà dépensé (**Dépensé**). Par prudence :
>
> - fixez un **plafond de dépense** dans les réglages de votre livre : **Réglages → Budget et outils →
>   Plafond de dépense (USD)**, par exemple 1 ou 2. Warqa s’arrête avant de le dépasser ;
> - préférez un **crédit prépayé** sur le site du service, et fixez-y aussi une limite ;
> - refaire une étape est gratuit : Warqa garde en mémoire les réponses déjà payées.

Pour ne rien payer du tout, et que rien ne quitte votre ordinateur, Warqa peut aussi utiliser des modèles
qui tournent sur votre machine avec Ollama (il faut un ordinateur récent et puissant). Voir
[models.md](../en/models.md) (en anglais).

## Votre premier livre, pas à pas

Commencez petit : un chapitre de 10 à 20 pages.

1. **Ouvrez Warqa** et choisissez la **Langue de l’interface** en haut de la page.
2. Ouvrez **Clés**, collez votre clé, cliquez sur **Enregistrer les clés**.
3. Dans **Vos livres**, cliquez sur **Nouveau livre**. Déposez le PDF là où il est écrit **Déposez le PDF
   ici**, donnez un titre, cochez les **Langues des leçons**, choisissez la langue dans laquelle **Les leçons
   sont d’abord écrites**, et répondez à **Pour qui sont les leçons ?** (par exemple « collège, 1re année »).
   Cliquez sur **Créer le livre**.
4. Ouvrez les **Réglages** du livre. Dans **Modèles d’IA**, choisissez un **Ensemble de modèles** adapté à
   votre clé (ou laissez le choix automatique). Dans **Budget et outils**, fixez un **Plafond de dépense
   (USD)**. Cliquez sur **Enregistrer les réglages**.
5. **Lire le PDF.** Pour commencer petit, remplissez **Seulement ces pages** (par exemple `1-20`), puis
   cliquez sur **Lire le PDF**.
6. **Plan.** Cliquez sur **Proposer le plan**. Lisez les chapitres, décochez ceux dont vous ne voulez pas,
   puis cliquez sur **Valider le plan**.
7. **Créer les leçons.** Cliquez sur **Créer** à côté d’un seul chapitre. Suivez l’avancement dans
   **Activité** et surveillez le coût.
8. **Regarder et corriger.** Cliquez sur **Modifier** pour voir la leçon dans l’**Aperçu**. Changez une
   phrase, ou utilisez **Régénérer cette étape** avec une consigne courte comme « plus court, avec une
   balance ».
9. **Traduire et narrer** dans les autres langues.
10. **Exporter.** Cliquez sur **Exporter le livre**, puis **Ouvrir le livre** pour l’essayer ou
    **Télécharger le .zip** pour le partager. Le zip fonctionne hors ligne. Pour Moodle, le paquet SCORM
    transmet les scores (voir [exports.md](../en/exports.md)).

## En cas de problème

| Ce que vous voyez | Que faire |
| --- | --- |
| Mac : « Apple n’a pas pu vérifier… » | Clic droit sur le lanceur → *Ouvrir* → *Ouvrir*, ou *Réglages Système → Confidentialité et sécurité → Ouvrir quand même*. |
| Windows : « Windows a protégé votre ordinateur » | Cliquez sur *Informations complémentaires* → *Exécuter quand même*. |
| Le navigateur ne s’ouvre pas | Attendez la fin du premier démarrage, puis ouvrez vous-même <http://127.0.0.1:5170/>. |
| « Port 5170 is in use » | Warqa est déjà lancé : ouvrez <http://127.0.0.1:5170/>. |
| « Pas encore de modèle : ajoutez une clé » ou « needs …_API_KEY » | Ajoutez une clé dans **Clés** et choisissez un **Ensemble de modèles** qui utilise cette clé. |
| « budget reached » | Vous avez atteint votre plafond. Ne l’augmentez dans les **Réglages** que si vous êtes d’accord. |
| Une erreur avec 401 ou 403 | La clé est fausse ou a été supprimée. Créez-en une nouvelle et collez-la à nouveau. |
| Une erreur avec 429, « quota » ou « rate limit » | Trop de demandes à la fois (les offres gratuites sont limitées). Patientez un peu et relancez : le travail terminé est conservé. |
| Le texte arabe est abîmé, ou les pages sont des scans | Cliquez sur **Relire** en cochant **Pages scannées ou cassées**, avec un ensemble de modèles qui lit les images (Gemini). |
| Pas de son | Les voix gratuites ont besoin d’Internet. Avec le lanceur en mode Node.js, installez [uv](https://docs.astral.sh/uv/getting-started/installation/), ou utilisez Docker. |
| Une leçon n’est pas réussie | **Régénérer cette étape** avec une consigne, ou essayez un meilleur ensemble de modèles pour ce chapitre. |

Toujours bloqué ? Écrivez-nous avec le formulaire **« Mon PDF n’a pas marché »** :
<https://github.com/Redouane-E/warqa/issues/new/choose>. Aucun code n’est nécessaire, et vous pouvez écrire en
français. **Ne collez jamais votre clé.**

## Vos droits et vos élèves

Utilisez des PDF que vous avez le droit d’utiliser. Votre PDF reste sur votre ordinateur (ou dans votre
navigateur) ; des extraits sont envoyés au service d’IA que vous avez choisi, pour le lire et écrire les
leçons. Ne saisissez jamais d’informations personnelles sur vos élèves. Les livres que vous créez vous
appartiennent.
