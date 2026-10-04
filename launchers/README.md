# Launchers · ملفات التشغيل · Lanceurs

[English](#english) · [العربية](#العربية) · [Français](#français)

## English

Double-click a launcher to open the Warqa studio in your browser, with no commands to type.

| Your computer | File to double-click |
| --- | --- |
| Windows | `Warqa-windows.bat` |
| Mac | `Warqa-mac.command` |
| Linux | `warqa-linux.sh` (right-click → *Run as a Program*, or run `./launchers/warqa-linux.sh` in a terminal) |

**What it does**

1. If **Docker Desktop** is running, it starts Warqa in Docker and opens <http://127.0.0.1:5170/>.
2. Otherwise, if **Node.js 22** or newer is installed, it installs and builds Warqa, starts the studio and opens the same address. Keep the window open while you work; close it to stop Warqa.
3. Otherwise, it explains what to install and opens a help page. You can also use the **web version**, which needs no installation (see [Start here](../docs/en/start-here.md)).

The first start takes a while (5 to 20 minutes) because Warqa is downloaded and prepared. Later starts are quick. Your books are saved in the `books` folder next to this one.

**The first time**

- **Mac:** macOS may say it cannot check the file. Right-click `Warqa-mac.command` → *Open* → *Open*. On recent macOS, go to *System Settings → Privacy & Security* and click *Open Anyway*.
- **Windows:** if SmartScreen shows "Windows protected your PC", click *More info* → *Run anyway*.
- The launcher must stay in this `launchers` folder, inside the Warqa folder.

**If something goes wrong**

- *"Docker is installed but not running"*: open Docker Desktop, wait until it says it is running, then double-click again.
- *"Port 5170 is in use"*: Warqa is probably already running. Open <http://127.0.0.1:5170/>.
- *Linux, "permission denied" with Docker*: add yourself to the `docker` group (`sudo usermod -aG docker $USER`, then log out and in).
- *Mac, "permission denied"*: open Terminal, type `bash ` (with a space), drag `Warqa-mac.command` into the window and press Enter.
- To update Warqa after downloading a new version with Docker: `docker compose up -d --build studio`.

For the curious: every launcher accepts `--check` (prints what it would do and changes nothing), `--docker`, `--node` and `--help`.

<div dir="rtl" lang="ar">

## العربية

انقر نقرًا مزدوجًا على ملف التشغيل ليُفتح استوديو «ورقة» في متصفحك، دون كتابة أي أمر.

| حاسوبك | الملف الذي تنقر عليه |
| --- | --- |
| ويندوز | `Warqa-windows.bat` |
| ماك | `Warqa-mac.command` |
| لينكس | `warqa-linux.sh` (انقر بالزر الأيمن ← «تشغيل كبرنامج»، أو نفّذ ‎`./launchers/warqa-linux.sh`‎ في الطرفية) |

**ماذا يفعل؟**

1. إذا كان **Docker Desktop** يعمل، يشغّل «ورقة» داخل Docker ويفتح العنوان ‎<http://127.0.0.1:5170/>‎.
2. وإلا، وإذا كان **Node.js 22** أو أحدث مثبّتًا، فإنه يثبّت «ورقة» ويبنيه ثم يشغّل الاستوديو ويفتح العنوان نفسه. اترك النافذة مفتوحة أثناء العمل، وأغلقها لإيقاف البرنامج.
3. وإلا، يشرح لك ما يجب تثبيته ويفتح صفحة مساعدة. ويمكنك أيضًا استعمال **نسخة الويب** التي لا تحتاج إلى أي تثبيت (راجع [دليل البداية](../docs/ar/start-here.md)).

التشغيل الأول يستغرق وقتًا (من 5 إلى 20 دقيقة) لأن «ورقة» يُنزَّل ويُجهَّز، أما المرّات التالية فسريعة. تُحفظ كتبك في مجلد `books` المجاور لهذا المجلد.

**في المرة الأولى**

- **ماك:** قد يقول النظام إنه لا يستطيع التحقق من الملف. انقر بالزر الأيمن على `Warqa-mac.command` ← «فتح» ← «فتح». وفي الإصدارات الحديثة افتح «إعدادات النظام ← الخصوصية والأمان» واضغط «فتح على أي حال».
- **ويندوز:** إذا ظهرت رسالة «Windows protected your PC» فاضغط «More info» ثم «Run anyway».
- يجب أن يبقى ملف التشغيل داخل مجلد `launchers` هذا، ضمن مجلد «ورقة».

**إذا حدثت مشكلة**

- «Docker مثبّت لكنه متوقف»: افتح Docker Desktop وانتظر حتى يصبح جاهزًا، ثم انقر من جديد.
- «Port 5170 is in use»: غالبًا «ورقة» يعمل أصلًا. افتح ‎<http://127.0.0.1:5170/>‎.
- لتحديث «ورقة» بعد تنزيل نسخة جديدة مع Docker: ‎`docker compose up -d --build studio`‎.

</div>

## Français

Double-cliquez sur un lanceur pour ouvrir le studio Warqa dans votre navigateur, sans taper de commande.

| Votre ordinateur | Fichier à double-cliquer |
| --- | --- |
| Windows | `Warqa-windows.bat` |
| Mac | `Warqa-mac.command` |
| Linux | `warqa-linux.sh` (clic droit → *Exécuter comme un programme*, ou `./launchers/warqa-linux.sh` dans un terminal) |

**Ce qu’il fait**

1. Si **Docker Desktop** est lancé, il démarre Warqa dans Docker et ouvre <http://127.0.0.1:5170/>.
2. Sinon, si **Node.js 22** ou plus récent est installé, il installe et construit Warqa, démarre le studio et ouvre la même adresse. Gardez la fenêtre ouverte pendant votre travail ; fermez-la pour arrêter Warqa.
3. Sinon, il explique quoi installer et ouvre une page d’aide. Vous pouvez aussi utiliser la **version web**, sans aucune installation (voir le [guide de démarrage](../docs/fr/start-here.md)).

Le premier démarrage prend du temps (5 à 20 minutes), car Warqa est téléchargé et préparé. Les suivants sont rapides. Vos livres sont enregistrés dans le dossier `books`, à côté de celui-ci.

**La première fois**

- **Mac :** macOS peut indiquer qu’il ne peut pas vérifier le fichier. Clic droit sur `Warqa-mac.command` → *Ouvrir* → *Ouvrir*. Sur les versions récentes : *Réglages Système → Confidentialité et sécurité* → *Ouvrir quand même*.
- **Windows :** si SmartScreen affiche « Windows a protégé votre ordinateur », cliquez sur *Informations complémentaires* → *Exécuter quand même*.
- Le lanceur doit rester dans ce dossier `launchers`, à l’intérieur du dossier Warqa.

**En cas de problème**

- « Docker est installé mais arrêté » : ouvrez Docker Desktop, attendez qu’il soit prêt, puis double-cliquez à nouveau.
- « Port 5170 is in use » : Warqa est sans doute déjà lancé. Ouvrez <http://127.0.0.1:5170/>.
- Pour mettre Warqa à jour avec Docker après avoir téléchargé une nouvelle version : `docker compose up -d --build studio`.
