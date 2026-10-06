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
  'status.runs': 'Runs in this browser',
  'status.menu': 'Browser version: status and help',
  'status.menuWarn': 'Browser version: there are warnings',
  'status.ok': 'Everything works in this browser.',
  'project.deleteYes': 'Delete the book',
  'banner.private': 'Your books and keys stay in this browser.',
  'banner.privacy': 'Your data',
  'banner.guide': 'Start guide',
  'banner.desktop': 'Desktop version',
  'banner.test': 'Test mode: scripted model, no network',
  'banner.testShort': 'Test mode',
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
  'status.runs': 'Fonctionne dans ce navigateur',
  'status.menu': 'Version navigateur : état et aide',
  'status.menuWarn': 'Version navigateur : il y a des avertissements',
  'status.ok': 'Tout fonctionne dans ce navigateur.',
  'project.deleteYes': 'Supprimer le livre',
  'banner.private': 'Vos livres et vos clés restent dans ce navigateur.',
  'banner.privacy': 'Vos données',
  'banner.guide': 'Guide de démarrage',
  'banner.desktop': 'Version ordinateur',
  'banner.test': 'Mode test : modèle scripté, sans réseau',
  'banner.testShort': 'Mode test',
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
  'status.runs': 'يعمل في هذا المتصفح',
  'status.menu': 'نسخة المتصفح: الحالة والمساعدة',
  'status.menuWarn': 'نسخة المتصفح: توجد تنبيهات',
  'status.ok': 'كل شيء يعمل في هذا المتصفح.',
  'project.deleteYes': 'احذف الكتاب',
  'banner.private': 'كتبك ومفاتيحك تبقى في هذا المتصفح.',
  'banner.privacy': 'بياناتك',
  'banner.guide': 'دليل البدء',
  'banner.desktop': 'نسخة الحاسوب',
  'banner.test': 'وضع الاختبار: نموذج مبرمج مسبقًا، بلا شبكة',
  'banner.testShort': 'وضع الاختبار',
  'banner.notPersistent':
    'هذا المتصفح لا يسمح لورقة بالاحتفاظ بكتبك بعد إغلاق علامة التبويب. نزّل نسخة احتياطية من كل كتاب قبل المغادرة.',
  'banner.storage': 'تعذّر حفظ تعديلك الأخير في هذا المتصفح ({error}). أفرغ بعض المساحة أو نزّل نسخة احتياطية.',
  'banner.noSw':
    'يمنع هذا المتصفح عمّال الخدمة (service workers) هنا: لن يعمل صوت الدروس في المعاينة ولا فتح كتاب مُصدَّر في علامة تبويب جديدة. أما التنزيلات فتعمل.',

  'home.example': 'افتح الكتاب النموذجي',
  'home.import': 'استيراد نسخة احتياطية',
  'home.importing': 'جارٍ الاستيراد…',
  'home.importFailed': 'تعذّر استيراد هذه النسخة الاحتياطية: {error}',

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
};

export const WEB_CATALOGS: Record<string, Record<WebKey, string>> = { en, fr, ar };
