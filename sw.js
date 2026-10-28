/*
 * Service worker de la PWA (hors-ligne). Non utilisé par flashcards_hebreu.html
 * (le standalone est déjà autonome) : l'enregistrement vit dans le bloc
 * BUILD:ONLINE-ONLY d'app.html, et dans le portail (index.html).
 *
 * Stratégie : stale-while-revalidate sur les fichiers de l'app — démarrage
 * instantané depuis le cache, mise à jour en arrière-plan (le nouveau
 * vocabulaire apparaît au lancement suivant). Les polices Google sont servies
 * cache-first (immuables) ; les polices locales (polices/), du même origine,
 * en stale-while-revalidate.
 * Le cache HTTP : docs/ARCHITECTURE.md § La couche PWA.
 *
 * ⚠️ VERSION NE S'INCRÉMENTE PAS À LA MAIN. La ligne est
 * ESTAMPILLÉE par `hebreu build` : un hash des entrées `hache` de
 * servis.txt (artefacts, manifeste, polices). Tout build qui change une de
 * ces entrées change la version ;
 * un build qui ne change rien la laisse stable. `hebreu build --check`
 * recalcule le hash et échoue si la ligne ne correspond pas — le hook pre-commit
 * s'en remet à lui. Éditer la valeur à la main ne sert
 * donc à rien : le build la réécrit, et --check refuse la version éditée.
 *
 * Trois corollaires, assumés :
 *  - sw.js n'entre PAS dans son propre hash (la version y est écrite : l'y inclure
 *    ferait courir le hash après sa propre queue) ; icons/ non plus. Une icône
 *    changée n'incrémente pas la version — sans grande conséquence, tout le
 *    même-origine étant en stale-while-revalidate : elle arrive avec un lancement
 *    de retard.
 *  - le bloc ASSETS, entre les marqueurs BUILD:ASSETS, est ÉCRIT par `hebreu build` depuis
 *    flashcards/servis.txt (les entrées `precache`) : l'éditer à la main ne sert à rien,
 *    le build le réécrit et --check le refuse.
 *  - pour forcer une VRAIE purge de cache (changement de stratégie qui rendrait les
 *    entrées gardées nuisibles), changer le préfixe de `CACHE` ci-dessous à la main —
 *    c'est le seul geste manuel qui reste sur ce fichier.
 */
/* ligne estampillée par le build — ne pas éditer la valeur (cf. en-tête) */
const VERSION = 'v-23a7ef94';
const CACHE = 'flashcards-hebreu-' + VERSION;

const ASSETS = [
  // BUILD:ASSETS début : écrit par `hebreu build` depuis flashcards/servis.txt (rôle precache)
  './',
  'app.html',
  'vocabulaire_hebreu.html',
  'cards.json',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-16.png',
  'icons/favicon-32.png',
  'icons/favicon-48.png',
  'polices/telaviv-modernistregular.ttf',
  'polices/telaviv-modernistbold.ttf',
  // BUILD:ASSETS fin
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    // cache:'no-cache' revalide auprès du serveur malgré le max-age que sert Pages
    // (requête conditionnelle) : sans lui, un cache neuf peut se remplir de copies
    // encore fraîches pour le cache HTTP mais déjà périmées.
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'no-cache' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !isFont) return;

  // Seules les navigations vers la racine (/ ou /index.html) sont normalisées
  // sur la coquille './' — c'est le PORTAIL. Les autres pages
  // (app.html, vocabulaire_hebreu.html) doivent être servies telles quelles —
  // les rabattre sur './' casserait l'appli et le carnet.
  const isRootNav = req.mode === 'navigate' &&
    (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'));
  const cacheKey = isRootNav ? './' : req.url;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(cacheKey);

    // Polices Google : immuables, pas besoin de revalider.
    if (cached && isFont) return cached;

    // Refetch par URL (et non par Request) : l'app demande le vocabulaire en
    // cache:'no-store', qu'on ne peut pas réutiliser tel quel pour cache.put ;
    // cache:'no-cache' pour la même raison qu'à l'installation. Une requête par URL
    // part en mode cors : le statut d'une police se lit, et une erreur n'est jamais
    // mise en cache.
    const refresh = fetch(cacheKey === './' ? './' : req.url, { cache: 'no-cache' })
      .then((res) => {
        if (res && res.ok) cache.put(cacheKey, res.clone());
        return res;
      })
      .catch(() => null);

    if (cached) {
      e.waitUntil(refresh);
      return cached;
    }
    const fresh = await refresh;
    if (fresh) return fresh;
    return new Response('Hors ligne — ressource absente du cache.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  })());
});
