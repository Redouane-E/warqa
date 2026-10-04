// Strings of the web app's own screens (start guide, banner, backups) in English, French and Arabic. The studio
// screens use the studio's catalogs (apps/studio/src/client/messages.ts). Every key exists in every language.

export const en = {
  'boot.loading': 'Opening Warqa…',
  'boot.failed': 'Warqa could not start in this browser.',
  'boot.failedHint':
    'Use an up-to-date Chrome, Edge, Firefox or Safari. Some private windows block the storage Warqa needs.',
  'boot.busy': 'Warqa is already open in another tab.',
  'boot.busyHint': 'Your books can be open in one tab at a time, so that no change is ever lost.',
  'boot.useHere': 'Use Warqa in this tab',
  'boot.released': 'Warqa is now open in another tab.',

  'banner.label': 'Browser version',
  'banner.private': 'Your books and keys stay in this browser.',
  'banner.privacy': 'Your data',
  'banner.guide': 'Start guide',
  'banner.desktop': 'Desktop version',
  'banner.test': 'Test mode: scripted model, no network',
  'banner.notPersistent':
    'This browser does not let Warqa keep your books after you close the tab. Download a backup of each book before you leave.',
  'banner.storage':
    'Your last change could not be saved in this browser ({error}). Free some space or download a backup.',
  'banner.noSw':
    'This browser blocks service workers here: lesson audio in the preview and opening an exported book in a new tab will not work. Downloads still do.',

  'home.example': 'Open the example book',
  'home.import': 'Import a backup',
  'home.importing': 'Importing…',
  'home.importFailed': 'This backup could not be imported: {error}',

  'project.backup': 'Download backup',
  'project.backupHint': 'The whole book project as a .zip: import it here later, or open it in the desktop version.',
  'project.delete': 'Delete',
  'project.deleteHint': 'Delete this book from this browser',
  'project.deleteConfirm': 'Delete this book from this browser? Download a backup first if you want to keep it.',

  'privacy.title': 'Your data',
  'privacy.p1':
    'Warqa runs entirely in this page: there is no Warqa server. Your PDFs, books and keys are stored in this browser, on this device.',
  'privacy.p2':
    'When you make lessons, the text of your PDF (and images of scanned pages) is sent with your key to the AI provider you chose, and to no one else. That provider’s terms and prices apply.',
  'privacy.p3': 'Clearing this browser’s data deletes your books: keep backups of the ones you care about.',
  'privacy.stored': 'Books stored here: {size}',
  'privacy.wipe': 'Delete all my books and keys',
  'privacy.wipeConfirm': 'Delete every book and every key from this browser? This cannot be undone.',
  'privacy.wiped': 'Everything was deleted from this browser.',

  'ob.title': 'Welcome to Warqa',
  'ob.lede':
    'Warqa turns a PDF into animated, narrated lessons that ask questions, in Arabic, French and English. Everything happens in this page.',
  'ob.step': 'Step {n} of {total}',
  'ob.next': 'Next',
  'ob.back': 'Back',
  'ob.skip': 'Skip the guide',
  'ob.example': 'See a finished book first',
  'ob.exampleHint': 'No key needed.',

  'ob.lang.title': 'Choose your language',
  'ob.lang.hint': 'You can change it at any time, at the top of the page.',

  'ob.provider.title': 'Connect an AI model',
  'ob.provider.lede':
    'Warqa uses an AI model to read your PDF and write the lessons. Choose a provider, create a key on its site, and paste it here.',
  'ob.provider.recommended': 'Good choices to start',
  'ob.provider.more': 'Other providers',
  'ob.p.google':
    'Free to start: a Google AI Studio key costs nothing (with daily limits). Good Arabic; reads scanned pages.',
  'ob.p.openrouter':
    'One key for hundreds of models (Claude, Gemini, Qwen…). Pay as you go, after adding a few dollars of credit.',
  'ob.p.deepseek': 'Very cheap: a few cents per chapter. Add a small credit to your account first.',
  'ob.p.anthropic': 'Claude: excellent writing, at a higher price.',
  'ob.p.openai': 'GPT models, pay as you go.',
  'ob.p.mistral': 'European provider, strong in French.',
  'ob.p.groq': 'Open models, very fast.',
  'ob.p.xai': 'Grok models.',
  'ob.p.ollama':
    'Models on your own computer, no key. For experienced users: start Ollama with OLLAMA_ORIGINS set to this site’s address.',
  'ob.p.fake': 'Scripted answers for tests. No network, no cost.',
  'ob.howto': 'How to get a key',
  'ob.howto.1': 'Open {site} and sign in (or create an account).',
  'ob.howto.2': 'Create a new API key and copy it.',
  'ob.howto.3': 'Paste it below and check it.',
  'ob.key': 'Your {provider} key',
  'ob.address': 'Address of Ollama',
  'ob.check': 'Check the key',
  'ob.checking': 'Checking…',
  'ob.check.ok': 'The key works. It is saved in this browser.',
  'ob.check.rate': 'The key works (the provider asks to slow down for a moment). It is saved in this browser.',
  'ob.check.key': '{provider} refused this key. Check that you copied all of it.',
  'ob.check.credits': 'The key works, but the account has no credit left.',
  'ob.check.network':
    'Could not reach {provider}. Check your connection (for a server on your computer: that it is running and allows this site).',
  'ob.check.http': '{provider} answered with an error ({status}).',
  'ob.keyPrivacy': 'Your key stays in this browser. It is sent only to {provider}, never to Warqa.',
  'ob.keyNeeded': 'Check a key first, or open the example book.',
  'ob.keyExisting': 'A {provider} key is already saved in this browser.',

  'ob.pdf.title': 'Add your PDF',
  'ob.pdf.lede': 'A textbook chapter, a course handout… Scanned pages are read too.',
  'ob.pdf.big': 'This PDF is large ({size}): reading it in the browser can take a while.',
  'ob.pdf.need': 'Choose a PDF first.',
  'ob.pdf.privacy': 'The PDF is stored in this browser. Its text is sent only to the AI provider you chose.',

  'ob.langs.title': 'Languages of the book',
  'ob.langs.lede': 'The lessons are written in one language, then translated into the others.',

  'ob.budget.title': 'Spending limit',
  'ob.budget.lede':
    'Warqa stops before your key spends more than this. A book usually costs from a few cents to a few dollars, depending on the model and its length.',
  'ob.budget.label': 'Limit in US dollars',
  'ob.budget.hint': 'You can raise it later in the book’s settings.',
  'ob.create': 'Create the book',
  'ob.creating': 'Creating…',
  'ob.summary': '{file} · {langs} · up to {budget}',
} as const;

export type WebKey = keyof typeof en;

export const fr: Record<WebKey, string> = {
  'boot.loading': 'Ouverture de Warqa…',
  'boot.failed': 'Warqa n’a pas pu démarrer dans ce navigateur.',
  'boot.failedHint':
    'Utilisez un Chrome, Edge, Firefox ou Safari à jour. Certaines fenêtres privées bloquent le stockage dont Warqa a besoin.',
  'boot.busy': 'Warqa est déjà ouvert dans un autre onglet.',
  'boot.busyHint': 'Vos livres ne s’ouvrent que dans un onglet à la fois, pour qu’aucune modification ne se perde.',
  'boot.useHere': 'Utiliser Warqa dans cet onglet',
  'boot.released': 'Warqa est maintenant ouvert dans un autre onglet.',

  'banner.label': 'Version navigateur',
  'banner.private': 'Vos livres et vos clés restent dans ce navigateur.',
  'banner.privacy': 'Vos données',
  'banner.guide': 'Guide de démarrage',
  'banner.desktop': 'Version ordinateur',
  'banner.test': 'Mode test : modèle scripté, sans réseau',
  'banner.notPersistent':
    'Ce navigateur ne permet pas à Warqa de garder vos livres après la fermeture de l’onglet. Téléchargez une sauvegarde de chaque livre avant de partir.',
  'banner.storage':
    'Votre dernière modification n’a pas pu être enregistrée dans ce navigateur ({error}). Libérez de la place ou téléchargez une sauvegarde.',
  'banner.noSw':
    'Ce navigateur bloque ici les service workers : le son des leçons dans l’aperçu et l’ouverture d’un livre exporté dans un nouvel onglet ne marcheront pas. Les téléchargements, si.',

  'home.example': 'Ouvrir le livre d’exemple',
  'home.import': 'Importer une sauvegarde',
  'home.importing': 'Importation…',
  'home.importFailed': 'Cette sauvegarde n’a pas pu être importée : {error}',

  'project.backup': 'Télécharger une sauvegarde',
  'project.backupHint':
    'Tout le projet du livre en .zip : à réimporter ici plus tard, ou à ouvrir dans la version ordinateur.',
  'project.delete': 'Supprimer',
  'project.deleteHint': 'Supprimer ce livre de ce navigateur',
  'project.deleteConfirm':
    'Supprimer ce livre de ce navigateur ? Téléchargez d’abord une sauvegarde si vous voulez le garder.',

  'privacy.title': 'Vos données',
  'privacy.p1':
    'Warqa fonctionne entièrement dans cette page : il n’y a pas de serveur Warqa. Vos PDF, vos livres et vos clés sont enregistrés dans ce navigateur, sur cet appareil.',
  'privacy.p2':
    'Quand vous créez des leçons, le texte de votre PDF (et l’image des pages scannées) est envoyé avec votre clé au fournisseur d’IA que vous avez choisi, et à personne d’autre. Ses conditions et ses tarifs s’appliquent.',
  'privacy.p3':
    'Effacer les données de ce navigateur supprime vos livres : gardez une sauvegarde de ceux qui comptent.',
  'privacy.stored': 'Livres enregistrés ici : {size}',
  'privacy.wipe': 'Supprimer tous mes livres et mes clés',
  'privacy.wipeConfirm': 'Supprimer tous les livres et toutes les clés de ce navigateur ? C’est définitif.',
  'privacy.wiped': 'Tout a été supprimé de ce navigateur.',

  'ob.title': 'Bienvenue dans Warqa',
  'ob.lede':
    'Warqa transforme un PDF en leçons animées et narrées qui posent des questions, en arabe, en français et en anglais. Tout se passe dans cette page.',
  'ob.step': 'Étape {n} sur {total}',
  'ob.next': 'Suivant',
  'ob.back': 'Retour',
  'ob.skip': 'Passer le guide',
  'ob.example': 'Voir d’abord un livre terminé',
  'ob.exampleHint': 'Aucune clé nécessaire.',

  'ob.lang.title': 'Choisissez votre langue',
  'ob.lang.hint': 'Vous pourrez la changer à tout moment, en haut de la page.',

  'ob.provider.title': 'Connecter un modèle d’IA',
  'ob.provider.lede':
    'Warqa utilise un modèle d’IA pour lire votre PDF et écrire les leçons. Choisissez un fournisseur, créez une clé sur son site et collez-la ici.',
  'ob.provider.recommended': 'Bons choix pour commencer',
  'ob.provider.more': 'Autres fournisseurs',
  'ob.p.google':
    'Gratuit pour commencer : une clé Google AI Studio ne coûte rien (avec des limites par jour). Bon en arabe ; lit les pages scannées.',
  'ob.p.openrouter':
    'Une seule clé pour des centaines de modèles (Claude, Gemini, Qwen…). Paiement à l’usage, après quelques dollars de crédit.',
  'ob.p.deepseek': 'Très bon marché : quelques centimes par chapitre. Ajoutez d’abord un petit crédit à votre compte.',
  'ob.p.anthropic': 'Claude : excellente écriture, à un prix plus élevé.',
  'ob.p.openai': 'Modèles GPT, paiement à l’usage.',
  'ob.p.mistral': 'Fournisseur européen, très bon en français.',
  'ob.p.groq': 'Modèles ouverts, très rapides.',
  'ob.p.xai': 'Modèles Grok.',
  'ob.p.ollama':
    'Des modèles sur votre propre ordinateur, sans clé. Pour utilisateurs avertis : lancez Ollama avec OLLAMA_ORIGINS réglé sur l’adresse de ce site.',
  'ob.p.fake': 'Réponses scriptées pour les tests. Sans réseau, sans coût.',
  'ob.howto': 'Comment obtenir une clé',
  'ob.howto.1': 'Ouvrez {site} et connectez-vous (ou créez un compte).',
  'ob.howto.2': 'Créez une nouvelle clé d’API et copiez-la.',
  'ob.howto.3': 'Collez-la ci-dessous et vérifiez-la.',
  'ob.key': 'Votre clé {provider}',
  'ob.address': 'Adresse d’Ollama',
  'ob.check': 'Vérifier la clé',
  'ob.checking': 'Vérification…',
  'ob.check.ok': 'La clé fonctionne. Elle est enregistrée dans ce navigateur.',
  'ob.check.rate':
    'La clé fonctionne (le fournisseur demande de ralentir un instant). Elle est enregistrée dans ce navigateur.',
  'ob.check.key': '{provider} a refusé cette clé. Vérifiez que vous l’avez copiée en entier.',
  'ob.check.credits': 'La clé fonctionne, mais le compte n’a plus de crédit.',
  'ob.check.network':
    'Impossible de joindre {provider}. Vérifiez votre connexion (pour un serveur sur votre ordinateur : qu’il tourne et qu’il autorise ce site).',
  'ob.check.http': '{provider} a répondu par une erreur ({status}).',
  'ob.keyPrivacy': 'Votre clé reste dans ce navigateur. Elle n’est envoyée qu’à {provider}, jamais à Warqa.',
  'ob.keyNeeded': 'Vérifiez d’abord une clé, ou ouvrez le livre d’exemple.',
  'ob.keyExisting': 'Une clé {provider} est déjà enregistrée dans ce navigateur.',

  'ob.pdf.title': 'Ajoutez votre PDF',
  'ob.pdf.lede': 'Un chapitre de manuel, un polycopié… Les pages scannées sont lues aussi.',
  'ob.pdf.big': 'Ce PDF est volumineux ({size}) : sa lecture dans le navigateur peut prendre un moment.',
  'ob.pdf.need': 'Choisissez d’abord un PDF.',
  'ob.pdf.privacy':
    'Le PDF est enregistré dans ce navigateur. Son texte n’est envoyé qu’au fournisseur d’IA que vous avez choisi.',

  'ob.langs.title': 'Langues du livre',
  'ob.langs.lede': 'Les leçons sont écrites dans une langue, puis traduites dans les autres.',

  'ob.budget.title': 'Limite de dépense',
  'ob.budget.lede':
    'Warqa s’arrête avant que votre clé ne dépense plus que cela. Un livre coûte en général de quelques centimes à quelques dollars, selon le modèle et sa longueur.',
  'ob.budget.label': 'Limite en dollars américains',
  'ob.budget.hint': 'Vous pourrez l’augmenter plus tard dans les réglages du livre.',
  'ob.create': 'Créer le livre',
  'ob.creating': 'Création…',
  'ob.summary': '{file} · {langs} · jusqu’à {budget}',
};

export const ar: Record<WebKey, string> = {
  'boot.loading': 'جارٍ فتح ورقة…',
  'boot.failed': 'تعذّر تشغيل ورقة في هذا المتصفح.',
  'boot.failedHint':
    'استعمل نسخة حديثة من Chrome أو Edge أو Firefox أو Safari. بعض النوافذ الخاصة تمنع التخزين الذي تحتاجه ورقة.',
  'boot.busy': 'ورقة مفتوحة مسبقًا في علامة تبويب أخرى.',
  'boot.busyHint': 'تُفتح كتبك في علامة تبويب واحدة في كل مرة، حتى لا يضيع أي تعديل.',
  'boot.useHere': 'استعمل ورقة في علامة التبويب هذه',
  'boot.released': 'ورقة مفتوحة الآن في علامة تبويب أخرى.',

  'banner.label': 'نسخة المتصفح',
  'banner.private': 'كتبك ومفاتيحك تبقى في هذا المتصفح.',
  'banner.privacy': 'بياناتك',
  'banner.guide': 'دليل البدء',
  'banner.desktop': 'نسخة الحاسوب',
  'banner.test': 'وضع الاختبار: نموذج مبرمج مسبقًا، بلا شبكة',
  'banner.notPersistent':
    'هذا المتصفح لا يسمح لورقة بالاحتفاظ بكتبك بعد إغلاق علامة التبويب. نزّل نسخة احتياطية من كل كتاب قبل المغادرة.',
  'banner.storage': 'تعذّر حفظ تعديلك الأخير في هذا المتصفح ({error}). أفرغ بعض المساحة أو نزّل نسخة احتياطية.',
  'banner.noSw':
    'يمنع هذا المتصفح عمّال الخدمة (service workers) هنا: لن يعمل صوت الدروس في المعاينة ولا فتح كتاب مُصدَّر في علامة تبويب جديدة. أما التنزيلات فتعمل.',

  'home.example': 'افتح الكتاب النموذجي',
  'home.import': 'استيراد نسخة احتياطية',
  'home.importing': 'جارٍ الاستيراد…',
  'home.importFailed': 'تعذّر استيراد هذه النسخة الاحتياطية: {error}',

  'project.backup': 'تنزيل نسخة احتياطية',
  'project.backupHint': 'مشروع الكتاب كاملًا في ملف ‎.zip: استورده هنا لاحقًا، أو افتحه في نسخة الحاسوب.',
  'project.delete': 'حذف',
  'project.deleteHint': 'حذف هذا الكتاب من هذا المتصفح',
  'project.deleteConfirm': 'هل تحذف هذا الكتاب من هذا المتصفح؟ نزّل نسخة احتياطية أولًا إن أردت الاحتفاظ به.',

  'privacy.title': 'بياناتك',
  'privacy.p1':
    'تعمل ورقة كلها داخل هذه الصفحة: لا يوجد خادم لورقة. ملفات PDF وكتبك ومفاتيحك محفوظة في هذا المتصفح، على هذا الجهاز.',
  'privacy.p2':
    'عند إنشاء الدروس يُرسَل نص ملف PDF (وصور الصفحات الممسوحة) مع مفتاحك إلى مزوّد الذكاء الاصطناعي الذي اخترته، ولا يُرسَل إلى أي جهة أخرى. وتسري عليك شروط هذا المزوّد وأسعاره.',
  'privacy.p3': 'مسح بيانات هذا المتصفح يحذف كتبك: احتفظ بنسخ احتياطية من الكتب التي تهمّك.',
  'privacy.stored': 'الكتب المحفوظة هنا: {size}',
  'privacy.wipe': 'احذف كل كتبي ومفاتيحي',
  'privacy.wipeConfirm': 'هل تحذف كل الكتب وكل المفاتيح من هذا المتصفح؟ لا يمكن التراجع عن ذلك.',
  'privacy.wiped': 'حُذف كل شيء من هذا المتصفح.',

  'ob.title': 'مرحبًا بك في ورقة',
  'ob.lede':
    'تحوّل ورقة ملف PDF إلى دروس متحركة ومسموعة تطرح الأسئلة، بالعربية والفرنسية والإنجليزية. ويجري كل شيء داخل هذه الصفحة.',
  'ob.step': 'الخطوة {n} من {total}',
  'ob.next': 'التالي',
  'ob.back': 'رجوع',
  'ob.skip': 'تخطَّ الدليل',
  'ob.example': 'شاهد كتابًا جاهزًا أولًا',
  'ob.exampleHint': 'لا يحتاج إلى مفتاح.',

  'ob.lang.title': 'اختر لغتك',
  'ob.lang.hint': 'يمكنك تغييرها في أي وقت من أعلى الصفحة.',

  'ob.provider.title': 'اربط نموذج ذكاء اصطناعي',
  'ob.provider.lede':
    'تستعمل ورقة نموذج ذكاء اصطناعي لقراءة ملف PDF وكتابة الدروس. اختر مزوّدًا، وأنشئ مفتاحًا على موقعه، ثم الصقه هنا.',
  'ob.provider.recommended': 'اختيارات جيدة للبداية',
  'ob.provider.more': 'مزوّدون آخرون',
  'ob.p.google':
    'مجاني للبداية: مفتاح Google AI Studio لا يكلّف شيئًا (مع حدود يومية). جيد في العربية، ويقرأ الصفحات الممسوحة.',
  'ob.p.openrouter':
    'مفتاح واحد لمئات النماذج (Claude وGemini وQwen…). الدفع حسب الاستعمال، بعد إضافة بضعة دولارات من الرصيد.',
  'ob.p.deepseek': 'رخيص جدًا: بضعة سنتات لكل فصل. أضف رصيدًا صغيرًا إلى حسابك أولًا.',
  'ob.p.anthropic': 'Claude: كتابة ممتازة، بسعر أعلى.',
  'ob.p.openai': 'نماذج GPT، الدفع حسب الاستعمال.',
  'ob.p.mistral': 'مزوّد أوروبي، قوي في الفرنسية.',
  'ob.p.groq': 'نماذج مفتوحة، سريعة جدًا.',
  'ob.p.xai': 'نماذج Grok.',
  'ob.p.ollama':
    'نماذج تعمل على حاسوبك، بلا مفتاح. للمستخدمين المتمرّسين: شغّل Ollama مع ضبط OLLAMA_ORIGINS على عنوان هذا الموقع.',
  'ob.p.fake': 'إجابات مبرمجة مسبقًا للاختبارات. بلا شبكة ولا تكلفة.',
  'ob.howto': 'كيف تحصل على مفتاح',
  'ob.howto.1': 'افتح {site} وسجّل الدخول (أو أنشئ حسابًا).',
  'ob.howto.2': 'أنشئ مفتاح API جديدًا وانسخه.',
  'ob.howto.3': 'الصقه أدناه وتحقّق منه.',
  'ob.key': 'مفتاحك لدى {provider}',
  'ob.address': 'عنوان Ollama',
  'ob.check': 'تحقّق من المفتاح',
  'ob.checking': 'جارٍ التحقق…',
  'ob.check.ok': 'المفتاح يعمل، وقد حُفظ في هذا المتصفح.',
  'ob.check.rate': 'المفتاح يعمل (يطلب المزوّد التمهّل قليلًا)، وقد حُفظ في هذا المتصفح.',
  'ob.check.key': 'رفض {provider} هذا المفتاح. تأكّد من أنك نسخته كاملًا.',
  'ob.check.credits': 'المفتاح يعمل، لكن رصيد الحساب نفد.',
  'ob.check.network':
    'تعذّر الوصول إلى {provider}. تحقّق من اتصالك (وبالنسبة لخادم على حاسوبك: أنه يعمل ويسمح لهذا الموقع).',
  'ob.check.http': 'ردّ {provider} بخطأ ({status}).',
  'ob.keyPrivacy': 'مفتاحك يبقى في هذا المتصفح. لا يُرسَل إلا إلى {provider}، ولا يُرسَل أبدًا إلى ورقة.',
  'ob.keyNeeded': 'تحقّق من مفتاح أولًا، أو افتح الكتاب النموذجي.',
  'ob.keyExisting': 'يوجد مفتاح {provider} محفوظ مسبقًا في هذا المتصفح.',

  'ob.pdf.title': 'أضف ملف PDF',
  'ob.pdf.lede': 'فصل من كتاب مدرسي، أو مطبوعة درس… وتُقرأ الصفحات الممسوحة أيضًا.',
  'ob.pdf.big': 'ملف PDF هذا كبير ({size}): قد تستغرق قراءته في المتصفح بعض الوقت.',
  'ob.pdf.need': 'اختر ملف PDF أولًا.',
  'ob.pdf.privacy': 'يُحفظ ملف PDF في هذا المتصفح، ولا يُرسَل نصه إلا إلى مزوّد الذكاء الاصطناعي الذي اخترته.',

  'ob.langs.title': 'لغات الكتاب',
  'ob.langs.lede': 'تُكتب الدروس بلغة واحدة، ثم تُترجَم إلى اللغات الأخرى.',

  'ob.budget.title': 'حدّ الإنفاق',
  'ob.budget.lede':
    'تتوقف ورقة قبل أن ينفق مفتاحك أكثر من هذا المبلغ. يكلّف الكتاب عادةً من بضعة سنتات إلى بضعة دولارات، حسب النموذج وطول الكتاب.',
  'ob.budget.label': 'الحدّ بالدولار الأمريكي',
  'ob.budget.hint': 'يمكنك رفعه لاحقًا من إعدادات الكتاب.',
  'ob.create': 'أنشئ الكتاب',
  'ob.creating': 'جارٍ الإنشاء…',
  'ob.summary': '{file} · {langs} · حتى {budget}',
};

export const WEB_CATALOGS: Record<string, Record<WebKey, string>> = { en, fr, ar };
