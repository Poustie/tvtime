/* Mon TV Time - application logic (vanilla JS, no build step) */
'use strict';

//////////////////////// Constants ////////////////////////
// Version de TEST (dossier /labo/ en ligne, ou ?labo=1) : données à part (copiées une fois depuis l'app normale),
// aucune connexion au compte en ligne, pas de service worker propre. L'app normale n'est jamais modifiée par le labo.
const LABO = location.pathname.includes('/labo/') || /[?&]labo=1(&|$)/.test(location.search);
const LS_NS = LABO ? 'montvtime-labo' : 'montvtime'; // préfixe des données locales (IndexedDB + localStorage)
const DATA = window.TVTIME_DATA || {};
const IMG = (p, size = 'w342') => p ? `https://image.tmdb.org/t/p/${size}${p}` : null;
const TMDB = 'https://api.themoviedb.org/3';
const APP_VERSION = '2'; // numéro de version affiché dans « À propos »
const DEFAULT_RUNTIME = 42; // minutes, fallback when unknown
const MOVIE_DEFAULT_RUNTIME = 115; // durée moyenne d'un film (min) quand inconnue

// Notes de version (les plus récentes en premier), affichées dans #/changelog.
const CHANGELOG = [
  { id: 69, date: '17 novembre 2026', title: 'Nouveau look', items: [
    'Barre du bas en « verre » transparent, avec des icônes dessinées à votre couleur. Les emojis des boutons, onglets et menus sont remplacés par des icônes dessinées.',
    'Fiches des séries et des films : grande image en haut, titre en gros, et une carte « Votre avis » avec vos 5 réactions et la note moyenne du public.',
    'Affiches : coins arrondis et note du public en doré (« ★ 8,1 »). Dans Personnalisation, vous choisissez où la placer, ou vous la masquez. Le badge « Favori » disparaît des affiches.',
    'Bouton ⋯ des affiches : trois points bien visibles, même sur une affiche claire. Vous pouvez le masquer dans Personnalisation ; un appui long sur l’affiche fait la même chose.',
    'Mon compte : grande photo, 4 chiffres clés, « Récemment vus » (une affiche par série) et un menu façon réglages.',
    'Amis : rangée de photos de vos amis et fil « Dernières notations » avec leurs avis.',
    'Séries : les séries arrêtées forment une catégorie « Arrêtées » que l’on peut réorganiser ou masquer, comme les autres.',
    'Zoom : on peut zoomer avec deux doigts puis se déplacer dans la page, de haut en bas et de gauche à droite.',
    'Écriture plus aérée, petites animations au toucher, et textes accordés (« 1 épisode vu », « 2 épisodes vus »).',
  ] },
  { id: 68, date: '16 novembre 2026', title: 'En-tête qui reste en place', items: [
    'En glissant d’une page à l’autre, tout le haut de la page reste en place (titre, nombre de films, « Réorganiser », « Arrêtées », tri…) : il se transforme en douceur en celui de la page suivante.',
    'Titres « Explorer » et « Amis » sans symbole, comme « Séries » et « Films ». Explorer : « Par genre » retiré (le bouton Genres suffit).',
  ] },
  { id: 67, date: '16 novembre 2026', title: 'Navigation plus fluide et tris plus simples', items: [
    'Barre du bas : le changement de page est instantané, sans animation ni pages qui se superposent.',
    'Glisser entre Séries, Films, Explorer et Amis : les deux pages restent collées, sans effet de zoom ; votre photo et la loupe restent en place et le titre se transforme en douceur.',
    'Explorer, Bibliothèque et Films : le tri et les genres s’ouvrent dans une fenêtre à cocher (plus besoin de faire défiler sur le côté).',
    'Bibliothèque : onglets En cours, Tout, Arrêtées, Favoris et Pas commencées. « À voir plus tard » est remplacé par « ＋ Ajouter à mes séries ».',
    'Bouton retour du téléphone : il ferme la fenêtre ouverte (⋯ Plus, tri, réaction…) au lieu de quitter la page.',
  ] },
  { id: 66, date: '16 novembre 2026', title: 'Petites corrections', items: [
    'Séries : les onglets « Mes séries », « Prochains » et « Calendrier » tiennent sur une seule ligne.',
    'Statistiques : les totaux par année sont les mêmes d’un bloc à l’autre (épisodes comptés une seule fois, fausses dates de TV Time ignorées).',
    'Explorer : « Animés de la saison » ne montre plus les séries sans fin (One Piece, Détective Conan…), seulement les vraies nouveautés de la saison.',
  ] },
  { id: 65, date: '16 novembre 2026', title: 'Calendrier, statistiques, badges et plus', items: [
    'Séries : nouvel onglet « 📅 Calendrier » avec les sorties des 30 prochains jours (et des 7 derniers), jour par jour.',
    'Statistiques : bilan de l’année, temps passé par mois et par année (films compris), records (plus long marathon, série la plus revue…) et badges (100ᵉ série, 10 000ᵉ épisode…), aussi visibles dans Mon compte.',
    'Explorer : rangée « 🌸 Animés de la saison ». Personnalisation : titres en français, en version originale, ou les deux.',
    '« Où regarder » : choisissez vos plateformes, elles passent en premier (les autres restent visibles).',
    '« 💌 Conseillé par… » sur les fiches, et « Recommander à un ami » : vos amis reçoivent la suggestion dans l’onglet Amis.',
    'Bibliothèque : tris par dernier épisode vu et par prochaine sortie. Un guide de démarrage pour les nouveaux utilisateurs (« Revoir le guide » dans Mon compte).',
  ] },
  { id: 64, date: '16 novembre 2026', title: 'Profil réservé à vos amis', items: [
    'Vos séries en cours, votre activité et vos favoris ne sont plus visibles que par vos amis (ceux que vous suivez et qui vous suivent). Votre pseudo et votre photo servent seulement à vous trouver : réglage « Me rendre trouvable par mon pseudo » dans Mon compte.',
    'Vos dernières actions sont enregistrées tout de suite quand vous quittez l’app.',
    'Réglages : la clé TMDB est masquée (bouton « Afficher »). Fiche d’un épisode vu : bouton « ✏️ Corriger » pour le nombre de visionnages.',
    'Ajouter un film qui porte le même nom qu’un autre (ex. un remake) fonctionne : l’année les distingue.',
  ] },
  { id: 63, date: '16 novembre 2026', title: 'Plus cohérent', items: [
    'Plus de doublons : une action visible sur la fiche n’est plus répétée dans « ⋯ Plus ». « Marquer une saison vue » disparaît : utilisez « Tout vu » sur chaque saison (correct aussi pour les animés redécoupés).',
    'Saisons : « Tout non vu » demande confirmation, « 🔁 Tout revu » quand la saison est déjà vue, et « Annuler » remet tout exactement (dates comprises). « Je l’ai revu » n’est possible qu’après avoir vu l’épisode.',
    'Animés redécoupés : « Ajouter un épisode » utilise la saison affichée (ex. saison 3, épisode 13). Les épisodes s’écrivent partout « 3×06 ».',
    'Une série arrêtée l’indique sur sa fiche, avec « ▶ Reprendre la série ». Le compteur d’épisodes vus de la fiche se met à jour tout de suite.',
    'Explorer : les étiquettes reprennent vos vraies catégories (En cours, Pas vu depuis longtemps, Terminée, Arrêtée, À voir plus tard). Une série ajoutée va dans « À voir plus tard ».',
    'Films : « Ajout récent » trie vraiment par date d’ajout ; « Remettre dans « À voir » » peut s’annuler. Statistiques plus claires, recherche sans doublons, listes importées lisibles et cliquables.',
  ] },
  { id: 62, date: '16 novembre 2026', title: 'Prochains épisodes et app plus simple', items: [
    '« Prochains épisodes » (l’ancien « À suivre ») ne montre plus que vos séries commencées, rangées en « Nouveaux épisodes », « À reprendre », « Bientôt » (avec la date : « jeudi », « dans 3 jours ») et « En pause » (replié). Le prochain épisode est celui qui suit votre dernier épisode vu.',
    'Sur la fiche d’une série en cours : « Prochain épisode : 3×06 · jeudi 20 nov. ». Les nouveaux épisodes des saisons en cours apparaissent maintenant (mise à jour chaque jour), et une coupure réseau ne rend plus une série « introuvable ».',
    'Les affiches restent disponibles sans connexion.',
    'Fiches plus simples : 3 boutons et « ⋯ Plus ». Un bouton « ⋯ » sur chaque affiche remplace l’appui long caché. Des mots plus clairs : « Mes séries », « Épingler », « Arrêter la série », « Je l’ai vu », « Je l’ai revu ».',
    'Boutons plus faciles à toucher, zoom autorisé, textes jamais trop petits, et une loupe 🔍 pour chercher dans Séries et Films. Dans la liste des épisodes, touchez la petite réaction pour la choisir.',
  ] },
  { id: 61, date: '16 novembre 2026', title: 'Vos données mieux protégées', items: [
    'Sauvegarde en ligne : elle ne peut plus être remplacée par une version moins complète (par exemple depuis un téléphone neuf). L’app garde aussi la version précédente et vous prévient s’il y a une différence (« Restaurer » ou « Remplacer quand même »).',
    'L’état de la sauvegarde est visible en haut de Mon compte (« ☁️ Sauvegardé en ligne aujourd’hui à … »). Le rappel de sauvegarde est plus clair, et les profils qui ne suivent que des films sont maintenant protégés eux aussi.',
    'Importer un fichier ou restaurer : une fenêtre montre d’abord ce qui va changer (date, épisodes et films). Une copie de votre état est gardée, et Réglages permet de revenir en arrière.',
    '« Marquer une saison vue » ne remplace plus la vraie date des épisodes déjà vus, et les dates déjà écrasées sont réparées automatiquement.',
  ] },
  { id: 60, date: '10 novembre 2026', title: 'Numéros d’épisodes des animés', items: [
    'Pour les animés que l’app redécoupe en saisons (ceux que la base range en une seule grande saison), les épisodes sont maintenant numérotés dans leur saison : « Saison 3 · Épisode 1 » au lieu de « Saison 1 · Épisode 40 ».',
    'C’est le cas partout : liste des épisodes, fiche de l’épisode, épisode suivant / précédent, « À suivre », historique des revisionnages et profil partagé avec les amis.',
  ] },
  { id: 59, date: '9 novembre 2026', title: 'Plusieurs genres à la fois + Animé', items: [
    'Explorer et Bibliothèque : on peut cocher plusieurs genres en même temps. Ex. Action + Comédie = les films qui sont à la fois des films d’action et des comédies.',
    'Nouveau choix « 🇯🇵 Animé » (animation japonaise) en tête des genres, dans Explorer comme dans la Bibliothèque.',
    'Dans la Bibliothèque, chaque genre affiche le nombre d’œuvres qu’il resterait, et « ✕ Effacer » enlève tous les genres cochés.',
  ] },
  { id: 58, date: '9 novembre 2026', title: 'Chercher par genre', items: [
    'Explorer : nouvelle rangée « 🎭 Par genre ». Choisissez Séries ou Films puis un genre (Comédie, Science-Fiction, Animation…) : les titres s’affichent en grille, du plus populaire, du mieux noté ou du plus récent, avec « Voir plus ».',
    'Bibliothèque : un menu « Genre » sous les onglets permet de n’afficher que les séries ou films d’un genre (avec le nombre d’œuvres). Pour les films, les genres sont récupérés une seule fois la première fois (quelques secondes).',
    'Anti-spoiler : quand on marque un épisode comme vu, son titre, son image et son résumé se défloutent tout de suite.',
  ] },
  { id: 57, date: '9 novembre 2026', title: 'La page ne remonte plus', items: [
    'Quand on touche une option (Personnalisation, réactions, vu / pas vu…), la page reste là où on était au lieu de remonter tout en haut. Partout dans l’app.',
    'Dans Explorer, les affiches ont les 4 coins arrondis et le cadre vert (vu) ou bleu (à voir) suit l’arrondi tout autour.',
  ] },
  { id: 56, date: '8 novembre 2026', title: 'Vu ou à voir dans Explorer', items: [
    'Dans Explorer (et les titres similaires, la filmographie des acteurs), « Dans ma liste » est remplacé par l’état réel : ✓ Vu (vert), ▶ En cours (série commencée) ou 🕒 À voir (bleu).',
  ] },
  { id: 55, date: '8 novembre 2026', title: 'Trier par réaction', items: [
    'Page Films et Bibliothèque (séries et films) : nouveau tri « Réaction », des 🤩 aux 👎 (retouchez pour l’inverse). Les œuvres sans réaction restent à la fin.',
    'Le tri alphabétique des films suit maintenant le titre français affiché.',
  ] },
  { id: 54, date: '8 novembre 2026', title: 'Plus de films en double', items: [
    'Les films présents plusieurs fois (dans l’historique TV Time lui-même, ajoutés deux fois, ou ajoutés avec exactement le même nom) sont maintenant regroupés en un seul au démarrage.',
    'Rien n’est perdu : vu, date, revisionnages, réaction, favori, progression, listes et avis sont gardés sur le film restant.',
  ] },
  { id: 53, date: '8 novembre 2026', title: 'Chances d’aimer plus justes', items: [
    'Vos réactions comptent ainsi : 👎 0 %, 😐 30 %, 👍 60 %, 😮 85 %, 🤩 100 %. Un film ou une série revu compte comme bien aimé.',
    'Les films ont maintenant leur propre calcul, réglé sur vos 764 films : il regarde surtout si vous avez aimé les films proches (la note du public ne prédit presque rien pour vous).',
    'Le calcul des séries est réajusté sur la nouvelle échelle (il était devenu trop optimiste).',
  ] },
  { id: 52, date: '8 novembre 2026', title: 'Réagir après avoir vu', items: [
    'On ne peut plus donner sa réaction à un épisode, un film ou une série qu’on n’a pas encore vu : elle reste grisée avec 🔒 jusqu’à « Marquer comme vu ».',
    'Les « chances d’aimer » utilisent la même échelle pour tout : 👍 Bien compte comme « aimé » partout (avant, une série à 3★ comptait comme mitigée).',
  ] },
  { id: 51, date: '8 novembre 2026', title: 'Une seule appréciation', items: [
    'Fini les étoiles en plus des réactions : chaque épisode, série ou film a une seule appréciation, « Ma réaction ».',
    'Les 5 réactions vont de 1 à 5 sur 5 : 👎 Pas aimé · 😐 Bof · 👍 Bien · 😮 Waouh · 🤩 Génial. La signification s’affiche à côté.',
    'Vos anciennes notes en étoiles s’affichent comme la réaction de même valeur. « Ma note » a disparu de « À propos ».',
    'Les séries ont aussi leur réaction (en haut de la fiche) et les affiches de films montrent la vôtre.',
  ] },
  { id: 50, date: '8 novembre 2026', title: 'Titres similaires', items: [
    'Dans « À propos » d’un film ou d’une série (et dans l’aperçu d’Explorer) : de nouvelles rangées en bas.',
    'Pour un film qui fait partie d’une saga : tous les autres films de la saga, dans l’ordre de sortie.',
    'Puis des films ou séries qui ressemblent. « ✓ Dans ma liste » si vous l’avez déjà, ＋ pour l’ajouter, toucher pour l’ouvrir.',
  ] },
  { id: 49, date: '8 novembre 2026', title: 'Avis entre amis', items: [
    'En bas de la fiche d’un épisode ou d’un film : « ✍️ Écrire un avis » (modifiable et supprimable).',
    'Votre avis est gardé dans vos données et, si vous êtes connecté, lisible par vos amis (et seulement eux).',
    'Juste en dessous : les avis de vos amis. Pour éviter les spoilers, ils ne s’affichent qu’une fois l’épisode ou le film vu.',
  ] },
  { id: 48, date: '8 novembre 2026', title: 'Personnalisation', items: [
    'Nouveau : Mon compte → 🎨 Personnalisation.',
    'Choisissez la couleur principale de l’application (8 couleurs), le thème (sombre, noir total ou clair), la taille du texte et la taille des affiches.',
    'Choisissez l’onglet qui s’ouvre au lancement (Séries, Films, Explorer ou Amis) et masquez les sections de la page Séries dont vous ne vous servez pas.',
    'Les durées de la règle « En cours » sont réglables (3 mois et 1 mois par défaut).',
    'Choisissez et ordonnez les rangées d’Explorer.',
    'Anti-spoiler : le titre, l’image et le résumé des épisodes pas encore vus sont floutés (touchez pour les afficher).',
  ] },
  { id: 47, date: '6 novembre 2026', title: 'Mot de passe oublié', items: [
    'Nouveau bouton « Mot de passe oublié ? » sous la connexion : vous recevez un e-mail, touchez le lien, puis choisissez un nouveau mot de passe.',
    'À la création d’un compte et quand vous changez de mot de passe, il faut maintenant le taper deux fois, pour éviter une faute de frappe.',
  ] },
  { id: 46, date: '30 octobre 2026', title: 'Progression des amis', items: [
    'Sur la fiche d’un ami, ses séries en cours affichent la même barre de progression que les vôtres sous l’affiche (orange en cours, bleu pour un revisionnage), au lieu du nombre d’épisodes.',
  ] },
  { id: 45, date: '30 octobre 2026', title: 'Corriger un revisionnage', items: [
    'Après chaque « 🔁 +1 visionnage », un message propose « Annuler » pendant quelques secondes.',
    'Fiche d’un épisode ou d’un film : un bouton « −1 » permet de retirer un visionnage en trop.',
    'Dans la liste des épisodes et sur les affiches de films : appui long sur 🔁 pour ouvrir une petite fenêtre − / + et corriger le nombre de visionnages.',
  ] },
  { id: 44, date: '30 octobre 2026', title: 'Dates de revisionnage', items: [
    'Chaque « +1 visionnage » enregistre maintenant sa date, pour les épisodes comme pour les films.',
    'Fiche d’un épisode ou d’un film → « Mon visionnage » : vu le…, revu le…. Fiche d’une série → « Revisionnages » : l’historique jour par jour (épisodes revus ce jour-là).',
    'Les revisionnages faits avant cette mise à jour n’ont pas de date : ils apparaissent comme « sans date ».',
  ] },
  { id: 43, date: '30 octobre 2026', title: 'Profil et sauvegarde', items: [
    'Les séries « en cours » visibles par vos amis sont maintenant exactement celles de votre page Séries → En cours : revisionnages (ex. une série déjà finie que vous revoyez), séries épinglées et séries avec un nouvel épisode comprises. Un 🔁 signale un revisionnage.',
    'Une fois connecté, votre sauvegarde en ligne se fait automatiquement une fois par jour, sans rien afficher.',
    'Règle « En cours » revue : une série y reste 3 mois après votre dernier épisode vu, pour toujours si elle est épinglée, 3 mois après le dernier épisode revu pendant un revisionnage, et 1 mois maximum après la sortie d’un nouvel épisode que vous n’avez pas encore regardé. Ensuite, elle passe dans « Pas vu depuis longtemps ».',
  ] },
  { id: 42, date: '29 octobre 2026', title: 'Demandes d’ami', items: [
    'Ajouter quelqu’un envoie maintenant une demande d’ami : elle apparaît chez lui dans l’onglet Amis avec « Accepter » ou « Refuser », et une pastille sur l’onglet le prévient.',
    'Une fois acceptée, vous êtes amis dans les deux sens et voyez chacun l’activité de l’autre. Vous pouvez annuler une demande envoyée, ou retirer un ami depuis sa fiche.',
  ] },
  { id: 41, date: '29 octobre 2026', title: 'Connexion par mot de passe', items: [
    'On se connecte maintenant avec son e-mail et un mot de passe, directement dans l’application : plus besoin d’attendre un e-mail, et ça marche aussi sur iPhone.',
    'Nouveau compte : touchez « Créer un compte ». Déjà connecté avec un lien ? Choisissez un mot de passe dans Mon compte → « Choisir ou changer mon mot de passe ».',
    'Le lien par e-mail reste disponible en secours (par exemple en cas d’oubli du mot de passe).',
  ] },
  { id: 40, date: '28 octobre 2026', title: 'Barre du bas et rotation', items: [
    'Sur iPhone, la barre des onglets reste collée en bas de l’écran, même sur une page presque vide.',
    'Téléphone tourné à l’horizontale : l’application affiche « Tournez votre téléphone » (l’iPhone ne permet pas à une app web de bloquer la rotation ; sur iPhone, vous pouvez la verrouiller depuis le Centre de contrôle).',
    'Message plus clair quand trop d’e-mails de connexion ont été demandés.',
  ] },
  { id: 39, date: '28 octobre 2026', title: 'Connexion sur iPhone', items: [
    'Sur iPhone, le lien reçu par e-mail ouvre Safari, qui ne partage pas la connexion avec l’app installée. Safari affiche maintenant un code à copier : collez-le dans l’app (Mon compte → Sauvegarde en ligne → « Le lien ne m’a pas connecté »).',
    'Les liens copiés depuis Gmail ou Outlook sont mieux reconnus, et le message d’erreur explique quand un lien a déjà servi.',
  ] },
  { id: 38, date: '28 octobre 2026', title: 'Nouvelle organisation', items: [
    'L’onglet Profil devient l’onglet Amis (fil d’activité, ajouter et retrouver vos amis).',
    'Votre compte (profil, pseudo, photo, connexion, sauvegarde en ligne, bibliothèque, statistiques, listes, réglages) s’ouvre en touchant votre avatar, en haut à droite des pages Séries, Films, Explorer et Amis.',
    'Le pseudo remplace l’ancien champ « Mon nom » des Réglages.',
  ] },
  { id: 37, date: '28 octobre 2026', title: 'Amis', items: [
    'Nouveau : l’onglet Amis. Choisissez un pseudo et une photo de profil, puis rendez votre profil visible si vous le souhaitez (il est invisible par défaut).',
    'Vos amis peuvent vous suivre en tapant votre pseudo, et vous voyez leurs séries en cours, leur activité récente et leurs favoris. Vous choisissez ce qui est partagé.',
    'Il faut être connecté (Mon compte). Le profil est mis à jour à chaque ouverture de l\'application.',
  ] },
  { id: 36, date: '28 octobre 2026', title: 'Sauvegarde en ligne', items: [
    'Nouveau dans Mon compte → « Sauvegarde en ligne » : connectez-vous avec votre e-mail (un lien vous est envoyé, pas de mot de passe) et votre historique est copié sur Internet, en privé.',
    'Une seule sauvegarde, remplacée à chaque fois : automatiquement une fois par semaine quand vous ouvrez l\'application, ou à la demande avec « Sauvegarder maintenant ».',
    'Le bouton « Restaurer » ramène vos données sur cet appareil ou sur un nouveau téléphone. L\'application reste utilisable sans connexion.',
  ] },
  { id: 35, date: '27 octobre 2026', title: 'Boutons des affiches plus sûrs', items: [
    'Sur téléphone, les boutons d’une affiche (arrêter, épingler, marquer vu, revisionner, supprimer) n’apparaissent plus qu’après un appui long sur l’affiche, et ne se déclenchent plus par erreur en touchant un coin. Valable pour les séries et les films.',
  ] },
  { id: 34, date: '27 octobre 2026', title: 'Glissement plus fiable', items: [
    'Le glissement entre les pages démarre maintenant de façon plus sûre et suit mieux le doigt dès les premiers millimètres (il pouvait parfois s\'interrompre ou sauter).',
    'Les pages voisines sont préparées dès que vous posez le doigt si elles ne sont pas déjà prêtes.',
  ] },
  { id: 33, date: '27 octobre 2026', title: 'Affiche en grand', items: [
    'Sur la fiche d\'une série ou d\'un film (y compris l\'aperçu avant ajout), touchez l\'affiche pour la voir en grand. Touchez l\'écran, la croix ou Échap pour fermer.',
  ] },
  { id: 32, date: '22 octobre 2026', title: 'Explorer : ajout plus simple', items: [
    'Après avoir ajouté un film ou une série avec le ＋ d\'une affiche, l\'affiche passe à « ✓ Dans ma liste » et l\'ouvrir mène directement à votre fiche (plus besoin de « Ajouter » une deuxième fois).',
    'Après « Ajouter » sur un aperçu, le bouton ← ramène à Explorer au lieu de l\'ancien aperçu. Les films de votre historique sont aussi mieux reconnus dans Explorer.',
  ] },
  { id: 31, date: '22 octobre 2026', title: 'Films en double & import plus sûr', items: [
    'Les films que vous avez rajoutés à la main alors qu\'ils étaient déjà dans votre historique (ex. Hunger Games en français et en anglais) sont fusionnés automatiquement : vu, revisionnages, note, réaction et favori sont conservés.',
    'Importer un fichier qui ne contient pas d\'historique (par exemple une liste partagée) n\'efface plus votre historique.',
    'La recherche de films trouve maintenant aussi les titres français (ex. « Âge de glace » trouve Ice Age), et ajouter un film déjà dans votre bibliothèque ouvre sa fiche au lieu de créer un doublon.',
    'Corrigé : Avengers (2012), Thor (2011) et L\'Empire contre-attaque s\'affichaient sous un mauvais film (date de sortie manquante dans l\'export TV Time).',
    'Vérification complète de vos 941 films : ceux qui s\'affichaient comme un autre film (ex. Harry Potter 7 partie 2 → partie 1, John Wick → John Wick 3, Fast & Furious → 2 Fast 2 Furious, Old → Oldboy) sont maintenant reconnus correctement.',
  ] },
  { id: 30, date: '6 octobre 2026', title: 'Glissement qui suit le doigt', items: [
    'Entre les catégories (Séries, Films, Explorer, Profil) et entre les épisodes, la page suit maintenant votre doigt : on voit la page suivante arriver pendant le geste. Relâchez avant la moitié et la page revient ; un geste rapide suffit pour passer.',
  ] },
  { id: 29, date: '6 octobre 2026', title: 'Chances d\'aimer (premier essai)', items: [
    'Sur une série ou un film que vous n\'avez pas vu (aperçu, série pas commencée, film à voir), un encadré estime vos chances de l\'aimer (ex. « 💚 82 % »), d\'après les œuvres proches que vous avez vues, vos genres préférés et la note du public.',
  ] },
  { id: 28, date: '6 octobre 2026', title: 'Explorer enrichi', items: [
    'Nouvelles lignes dans Explorer : 💡 séries et films « pour vous » (d\'après vos favoris et vos meilleures notes), 🍿 au cinéma en ce moment, 📅 bientôt au cinéma (avec la date de sortie), 🏆 les plus vus de tous les temps et ⭐ les mieux notés.',
  ] },
  { id: 27, date: '6 octobre 2026', title: 'Explorer : tendances', items: [
    'Explorer affiche maintenant les séries et les films du moment (tendances de la semaine). Faites défiler chaque ligne sur le côté ; ＋ pour ajouter, ✓ si vous l\'avez déjà.',
    'Le clavier ne s\'ouvre plus tout seul en arrivant dans Explorer : touchez la barre de recherche quand vous voulez chercher.',
  ] },
  { id: 26, date: '1er octobre 2026', title: 'Correction du défilement', items: [
    'La page Séries ne remonte plus toute seule quand on fait défiler : la mise à jour des séries en cours se fait en arrière-plan, une seule fois, sans bouger la page.',
  ] },
  { id: 25, date: '1er octobre 2026', title: 'Épisode suivant / précédent', items: [
    'Sur la fiche d\'un épisode, glissez vers la gauche pour passer à l\'épisode suivant, vers la droite pour le précédent (aussi avec les boutons ‹ ›). Le bouton « ← » ramène toujours directement à la série.',
  ] },
  { id: 24, date: '1er octobre 2026', title: 'Épisodes pas encore sortis', items: [
    'Une série dont vous avez vu tous les épisodes déjà diffusés passe bien dans « Terminée » (barre verte = suite prévue), même si une prochaine saison est déjà annoncée avec des épisodes (ex. Silo saison 4 en 2027). Elle revient dans « En cours » dès la sortie du nouvel épisode.',
    'La fiche série indique le nombre d\'épisodes « à venir ».',
  ] },
  { id: 23, date: '1er octobre 2026', title: 'Sauvegarde hebdomadaire', items: [
    'Une fois par semaine, l\'application vous propose d\'enregistrer une sauvegarde complète (fichier « tvtime-sauvegarde-hebdo.json » dans Téléchargements) : si les données du navigateur sont effacées, il suffit de la réimporter.',
    'Réglages → Sauvegarde affiche la date de la dernière sauvegarde, et permet de désactiver le rappel.',
  ] },
  { id: 22, date: '28 septembre 2026', title: 'Fiches épisodes & acteurs', items: [
    'Nouvelle fiche épisode : le titre et le numéro en haut, puis l\'image en grand qui se fond dans le noir jusqu\'au synopsis.',
    'Fiches films et séries (et aperçus) : le titre passe au-dessus de l\'affiche.',
    'Le bouton « ← » revient toujours à la page précédente (acteur → série → liste…) et indique où il mène.',
    'Touchez un acteur (distribution ou invités) pour ouvrir sa fiche : photo, âge, biographie, filmographie (vos séries et films en premier) et lien vers Wikipédia.',
  ] },
  { id: 21, date: '25 septembre 2026', title: 'Barre de revisionnage', items: [
    'Sur l\'affiche d\'une série en revisionnage, la barre « terminée » (violette ou verte) reste visible en fond, et la progression du nouveau visionnage s\'affiche par-dessus en bleu.',
  ] },
  { id: 20, date: '24 septembre 2026', title: 'Séries arrêtées', items: [
    'Regarder ou revoir un épisode d\'une série « Arrêtée » la reprend automatiquement : elle revient dans vos catégories (et dans « En cours » si vous la revoyez).',
    'Le bouton ⏹ sur une affiche demande maintenant confirmation avant d\'arrêter une série (fini les arrêts par erreur).',
    'Pareil pour le bouton 📌 : épingler (ou désépingler) une série depuis son affiche demande confirmation.',
  ] },
  { id: 19, date: '24 septembre 2026', title: 'Revisionnage plus fiable', items: [
    'Une série en revisionnage ne disparaît plus des « En cours » : si vous continuez à revoir les épisodes dans l\'ordre (par ex. l\'épisode 10 après les 9 premiers), elle y revient automatiquement.',
    'Les épisodes qui n\'avaient été vus qu\'une fois (par ex. une dernière saison jamais revue) comptent bien dans le revisionnage dès le premier « +1 ».',
  ] },
  { id: 18, date: '24 septembre 2026', title: 'Mieux voir où j\'en suis', items: [
    'Les épisodes vus dans votre visionnage actuel sont maintenant teintés en vert : on voit tout de suite où on en est (aussi pendant un revisionnage, où seuls les épisodes déjà revus sont teintés).',
    'Pendant un revisionnage, la fiche de la série s\'ouvre directement sur le prochain épisode à revoir.',
    'En revenant d\'une fiche épisode, vous retrouvez la page de la série exactement où vous étiez (même saison ouverte, même position).',
  ] },
  { id: 17, date: '21 septembre 2026', title: 'Reprises plus faciles', items: [
    'Reprise d\'un film : vous pouvez maintenant saisir où vous en êtes en heures ET minutes (par exemple 2h52), plus besoin de tout convertir en minutes.',
    'Revisionnage de séries : dès que vous remettez un visionnage sur le 1er épisode d\'une série déjà terminée, elle repasse dans « En cours » — quel que soit le nombre de fois où vous l\'aviez déjà vue. (Un visionnage sur le 2e épisode peu après celui du 1er la relance aussi.)',
  ] },
  { id: 16, date: '18 septembre 2026', title: 'Revisionnage de séries', items: [
    'Quand vous recommencez une série déjà terminée depuis le début (bouton « 🔁 +1 visionnage » sur le 1er épisode), elle repasse toute seule dans « En cours » avec une barre qui suit votre nouveau visionnage — et revient dans « Terminée » quand vous avez tout revu. (Revoir un épisode isolé au milieu ne la remet pas en cours.)',
  ] },
  { id: 15, date: '18 septembre 2026', title: 'Reprise des films', items: [
    'Vous avez mis un film en pause en plein milieu ? Indiquez sur sa fiche à quelle minute vous en êtes : une barre de progression apparaît sur son affiche pour reprendre exactement où vous vous étiez arrêté.',
  ] },
  { id: 14, date: '11 septembre 2026', title: 'Fiches épisodes & fond noir', items: [
    'Chaque épisode a maintenant sa fiche : touchez le nom d\'un épisode pour voir son synopsis, sa date de diffusion, sa durée, la note du public, ses invités — et le marquer vu / le noter / y réagir.',
    'Nouveau réglage « Fond totalement noir (AMOLED) » pour les écrans OLED (Réglages → Affichage).',
  ] },
  { id: 13, date: '3 septembre 2026', title: 'Saisons des animes', items: [
    'Les animes que la base TMDB range en une seule grande saison (numérotation continue) sont maintenant redécoupés en vraies saisons à l\'écran (ex. Rent-a-Girlfriend).',
  ] },
  { id: 12, date: '2 septembre 2026', title: 'Correction « Terminée »', items: [
    'Une série dont vous avez vu tous les épisodes passe maintenant bien dans « Terminée » — même si elle était épinglée « En cours » ou encore en diffusion.',
  ] },
  { id: 11, date: '25 août 2026', title: 'Partager sa liste', items: [
    'Partagez votre liste de séries et films à quelqu\'un, <b>sans votre historique</b> : rien n\'est marqué comme vu chez lui (Réglages → Partager ma liste).',
    'À la réception, la liste s\'ajoute à la sienne <b>sans doublon</b> (même s\'il a déjà vu l\'œuvre) et <b>sans écraser</b> ce qu\'il a déjà.',
    'Les séries et films reçus sont considérés comme <b>ajoutés par lui</b> : il peut les supprimer comme les autres.',
  ] },
  { id: 10, date: '25 août 2026', title: 'Glissement entre catégories', items: [
    'Le changement de catégorie joue une petite animation de glissement.',
  ] },
  { id: 9, date: '25 août 2026', title: 'Navigation & confort', items: [
    'Changez de catégorie d\'un simple glissement (swipe) : Séries · Films · Explorer · Profil.',
    'Le glissement suit votre doigt en direct : la page bouge avec vous, et revient en place si vous ne glissez pas assez.',
    'Une fenêtre « Nouveautés » vous résume les changements à la première ouverture après une mise à jour.',
    'Sur iPhone : le double-appui ne zoome plus par accident.',
    'Sur iPhone : la barre des catégories reste fixée tout en bas, sans à-coups.',
  ] },
  { id: 8, date: '24 août 2026', title: 'Affichage iPhone', items: [
    'Correction de la marge en haut de l\'écran : le contenu ne passe plus sous l\'encoche (Dynamic Island).',
  ] },
  { id: 7, date: '20 août 2026', title: 'Noms en français', items: [
    'Les séries et les films affichent désormais leur titre français sous les affiches (plus les titres anglais importés).',
    'La recherche dans la bibliothèque reconnaît aussi bien le titre français que le nom d\'origine.',
  ] },
  { id: 6, date: '14 août 2026', title: 'Fin de série & sauvegardes', items: [
    'Une petite célébration animée (confettis) apparaît quand vous terminez une série, avec vos statistiques de visionnage.',
    'Import de sauvegarde plus robuste : une sauvegarde un peu abîmée ne bloque plus l\'application.',
    'Dans Explorer, les œuvres déjà dans votre bibliothèque sont signalées « Dans ma liste » et ouvrent directement leur vraie fiche.',
  ] },
  { id: 5, date: '14 août 2026', title: 'Épisodes d\'animes', items: [
    'Correction de l\'alignement des épisodes pour les animes à numérotation continue (Naruto, Bleach, One Piece…) : les épisodes cochés correspondent enfin à la bonne saison.',
    'À l\'ouverture d\'une série, on vous emmène juste après le dernier épisode vu (les épisodes sautés ne bloquent plus).',
  ] },
  { id: 4, date: '11 août 2026', title: 'Nouvelle navigation', items: [
    'Barre de navigation en bas : Séries · Films · Explorer · Profil.',
    'La page Séries a deux onglets : « À voir » (par catégories) et « À suivre » (le prochain épisode de chaque série).',
    'Explorer : cherchez de nouvelles séries et films, avec un aperçu complet avant de les ajouter.',
    'Tri simplifié (alphabétique / ajout récent) et réorganisation des catégories de l\'accueil.',
    'Statuts de séries en français (En cours, Terminée, Annulée…).',
    'Sur une saison : boutons « Tout vu » / « Tout non vu ».',
    'Suivi automatique des séries dont vous avez vu au moins un épisode.',
  ] },
  { id: 3, date: '6 août 2026', title: 'Installation & sauvegarde', items: [
    'Installation sur téléphone à une adresse fixe : vos données restent d\'une mise à jour à l\'autre, sans ré-importer.',
    'Possibilité de retirer une note donnée par erreur (bouton ✕ sur les étoiles).',
  ] },
  { id: 2, date: '4 août 2026', title: 'Notes, réactions & profil', items: [
    'Nom de profil personnalisable.',
    'Réagissez aux films comme aux épisodes de série.',
    'Noter une œuvre ne vous fait plus changer d\'onglet ; les étoiles se remplissent simplement.',
    'Récupération des dates de visionnage des films et de vos films favoris.',
    'Export / Import : sauvegarde complète de tout votre historique, transférable sur un autre appareil.',
  ] },
  { id: 1, date: '3 août 2026', title: 'Fiches enrichies', items: [
    'Fiches détaillées « À propos » : casting, bande-annonce, plateformes de streaming, note du public, dates.',
    'Fiche complète pour les films.',
    'Listes personnalisées modifiables, favoris, statistiques films.',
    'Adaptation à l\'écran des iPhone (encoche).',
  ] },
];

// TV Time "star-meter" reaction ids -> label/emoji. The 5 first ids are the
// confirmed reactions (great=1, good=8, wow=3, ok=6, bad=7); the rest are older
// best-effort labels.
const EMOTIONS = [
  { id: '1', emoji: '🤩', label: 'Génial' },
  { id: '8', emoji: '👍', label: 'Bien' },
  { id: '3', emoji: '😮', label: 'Waouh' },
  { id: '6', emoji: '😐', label: 'Bof' },
  { id: '7', emoji: '👎', label: 'Pas aimé' },
  { id: '2', emoji: '😂', label: 'MDR' },
  { id: '4', emoji: '😢', label: 'Triste' },
  { id: '5', emoji: '😱', label: 'Choqué' },
];
const EMOTION_BY_ID = Object.fromEntries(EMOTIONS.map(e => [e.id, e]));
// Une seule appréciation par œuvre : 5 réactions rangées de 1 à 5 sur 5.
// Réaction et note restent enregistrées ensemble (synchronisées) : une ancienne note ★ s'affiche comme la réaction de même valeur.
const REACT_SCALE = ['7', '6', '8', '3', '1'].map((id, i) => Object.assign({}, EMOTION_BY_ID[id], { v: i + 1 }));
const SCORE_OF_EMO = Object.fromEntries(REACT_SCALE.map(r => [r.id, r.v]));
const reactOfScore = (v) => REACT_SCALE[v - 1] || null;
function reactScore(emo, stars) { const n = Math.round(Number(stars) || 0); return SCORE_OF_EMO[emo] || (n >= 1 && n <= 5 ? n : 0); }
const REACT_LOCKED_TXT = '🔒 Marquez-le comme vu pour donner votre réaction';
const reactCaption = (v, locked) => { if (locked) return REACT_LOCKED_TXT; const r = reactOfScore(v); return r ? `${r.emoji} ${esc(r.label)} · <b>${v}/5</b>` : 'De 👎 1/5 (pas aimé) à 🤩 5/5 (génial)'; };
const reactBadge = (v) => { const r = reactOfScore(v); return r ? r.emoji : ''; };
// locked = œuvre pas encore vue : réaction grisée et impossible à choisir.
function reactPickerHtml(v, cap = true, locked = false) {
  return `<span class="react react5${locked ? ' locked' : ''}">${REACT_SCALE.map(r => `<button type="button" data-v="${r.v}" title="${esc(r.label)} · ${r.v}/5" class="${v === r.v ? 'on' : ''}">${r.emoji}</button>`).join('')}</span>${cap ? `<span class="react-cap">${reactCaption(v, locked)}</span>` : ''}`;
}
// Appui sur une réaction : la choisir, ou l'enlever si c'était déjà elle.
function wireReactPicker(box, get, set, canReact) {
  if (!box) return;
  box.addEventListener('click', (ev) => {
    const b = ev.target.closest('.react5 button'); if (!b) return;
    ev.stopPropagation();
    if (canReact && !canReact()) { toast('Marquez-le comme vu pour donner votre réaction'); return; }
    const v = parseInt(b.dataset.v, 10);
    set(get() === v ? 0 : v);
    const now = get();
    box.querySelectorAll('.react5 button').forEach(x => x.classList.toggle('on', parseInt(x.dataset.v, 10) === now));
    const cap = box.querySelector('.react-cap'); if (cap) cap.innerHTML = reactCaption(now);
  });
}
// Après « Marquer comme vu » / « pas vu » sans recharger la page.
function setReactLocked(box, locked, v) {
  if (!box) return;
  const p = box.querySelector('.react5'); if (p) p.classList.toggle('locked', locked);
  if (box.classList.contains('avis-card')) box.classList.toggle('is-locked', locked);
  const cap = box.querySelector('.react-cap'); if (cap) cap.innerHTML = reactCaption(v, locked);
}


//////////////////////// Icônes dessinées (labo) ////////////////////////
// Tracés en ligne, trait fin arrondi, viewBox 24 — même style que la barre du bas. Couleur = currentColor.
const ICONS = {
  tv: '<rect x="3" y="6.5" width="18" height="13" rx="2.5"/><path d="M7 3.5h10"/>',
  film: '<path d="M4 10h16v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z"/><path d="M3.6 10 3 6.6l15.3-2.7.6 3.4z"/><path d="M7.6 6l1.9 2.9M12.2 5.2l1.9 2.9"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z"/>',
  users: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0"/><circle cx="16.8" cy="9.3" r="2.3"/><path d="M15.6 14.3a4.3 4.3 0 0 1 5 4.6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  star: '<path d="M12 3.8l2.4 5 5.4.7-4 3.8 1 5.4-4.8-2.7-4.8 2.7 1-5.4-4-3.8 5.4-.7z"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.2C19.5 15.4 12 20 12 20z"/>',
  pin: '<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  checkcircle: '<circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.4l2.7 2.7 5-5.4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.5-5.8L4 8.5"/><path d="M4 4v4.5h4.5M12 8v4l2.5 1.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
  chart: '<path d="M4 20V11M10 20V4.5M16 20v-6.5M21 20H3"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-1 1.5-2-.6-1.2.2-2.5 1.6-2.5H17a3.5 3.5 0 0 0 3.5-3.5C20.5 7 16.8 3.5 12 3.5z"/><path d="M7.8 11h.01M10.5 7.8h.01M14.5 7.8h.01"/>',
  gear: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  sparkle: '<path d="M11 3.5l1.9 5.4 5.4 1.9-5.4 1.9L11 18.1l-1.9-5.4-5.4-1.9 5.4-1.9z"/><path d="M18.5 15.5v4M16.5 17.5h4"/>',
  book: '<path d="M5 4.5h10.5A2.5 2.5 0 0 1 18 7v13H7.5A2.5 2.5 0 0 1 5 17.5z"/><path d="M5 17.5A2.5 2.5 0 0 1 7.5 15H18"/>',
  library: '<rect x="4" y="4" width="4" height="16" rx="1"/><rect x="10" y="4" width="4" height="16" rx="1"/><path d="M16.2 6l3.6-1 3 13.6-3.6 1z"/>',
  sort: '<path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/>',
  filter: '<path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/>',
  tag: '<path d="M3.5 12V4.5H11l9 9-6.5 6.5z"/><path d="M8 8.5h.01"/>',
  play: '<path d="M8 5.5v13l11-6.5z"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/>',
  share: '<path d="M12 15V4M8 8l4-4 4 4M5 13v6.5h14V13"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  repeat: '<path d="M4 11a8 8 0 0 1 14-4.5L20 9M20 4v5h-5M20 13a8 8 0 0 1-14 4.5L4 15M4 20v-5h5"/>',
  edit: '<path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z"/><path d="M14.5 6.5l3 3"/>',
  undo: '<path d="M9 6.5L4.5 11 9 15.5M5 11h9a5 5 0 0 1 0 9h-3"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8h.01"/>',
  flame: '<path d="M12 3c1 3.5 5.5 5.5 5.5 10.5a5.5 5.5 0 0 1-11 0c0-2 1-3.5 2-4.5.3 1.5 1 2.3 2 2.5C10.2 8.5 10.5 5.5 12 3z"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3.5a5.5 5.5 0 0 0-3.2 10c.8.6 1.2 1.4 1.2 2.5h4c0-1.1.4-1.9 1.2-2.5A5.5 5.5 0 0 0 12 3.5z"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5c0 3 1.5 4.5 3.7 4.8M16 6h3.5c0 3-1.5 4.5-3.7 4.8M12 13v4M8.5 20h7M9.5 17h5"/>',
  ticket: '<path d="M3.5 8.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2V10a2 2 0 0 0 0 4v1.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V14a2 2 0 0 0 0-4z"/><path d="M14 7.5v9"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z"/><path d="M5 19l7-7"/>',
  medal: '<circle cx="12" cy="14.5" r="5"/><path d="M8.5 10.5l-2-7h4L12 7M15.5 10.5l2-7h-4L12 7"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M4 7.5l8 6 8-6"/>',
  chat: '<path d="M4 5.5h16v10.5H10l-4.5 4v-4H4z"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
};
// icon('tv') → <svg class="ic …"> ; cls 'f' = rempli (cœur plein…).
function icon(name, cls = '') {
  const p = ICONS[name]; if (!p) return '';
  return `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
}
// Emoji décoratif → nom d'icône (l'échelle d'appréciation 👎…🤩 et les émotions ne sont JAMAIS dedans).
const EMOJI_ICON = {
  '📺': 'tv', '🎬': 'film', '🎞': 'film', '🧭': 'compass', '👥': 'users', '🔍': 'search', '⭐': 'star', '❤': 'heart:f', '♡': 'heart',
  '📌': 'pin', '＋': 'plus', '➕': 'plus', '➖': 'minus', '✓': 'check', '✅': 'checkcircle', '🕒': 'clock', '🕘': 'clock', '⏱': 'clock', '⏳': 'clock',
  '🕰': 'history', '📅': 'calendar', '🗓': 'calendar', '📃': 'list', '📊': 'chart', '🎨': 'palette', '⚙': 'gear', '🆕': 'sparkle', '📘': 'book',
  '📚': 'library', '↕': 'sort', '🎭': 'tag', '▶': 'play', '🗑': 'trash', '🔁': 'repeat', '✏': 'edit', '✍': 'edit', '⏹': 'stop', '⏸': 'pause',
  '💌': 'mail', '📩': 'mail', '🏆': 'trophy', '🔥': 'flame', '💡': 'bulb', '🍿': 'ticket', '🌸': 'leaf', '🏅': 'medal', '💬': 'chat', '↩': 'undo', 'ℹ': 'info', '🔜': 'play',
};
// emojiIcon('📌') → svg ; un emoji inconnu est rendu tel quel.
function emojiIcon(e, cls = '') {
  const k = String(e == null ? '' : e).replace(/️/g, '').trim(), n = EMOJI_ICON[k];
  if (!n) return e == null ? '' : e;
  const [name, f] = n.split(':');
  return icon(name, [cls, f].filter(Boolean).join(' '));
}
// leadIcon('🔥 Séries du moment') → svg + « Séries du moment » (seul le 1er emoji, s'il est connu).
// Accord singulier / pluriel : plural(n, 'épisode vu', 'épisodes vus') ; 0 et 1 → singulier.
function plural(n, un, plus) { return Math.abs(Number(n) || 0) >= 2 ? plus : un; }
function leadIcon(s) {
  const m = /^(\S+)\s+([\s\S]*)$/.exec(String(s)); if (!m) return s;
  const k = m[1].replace(/️/g, '');
  return EMOJI_ICON[k] ? emojiIcon(k) + ' ' + m[2] : s;
}
