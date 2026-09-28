/* Matching a step's words to an element on the page.

   This lives in its own file because BOTH sides need it and they must agree
   exactly. The validation gate compares the index the model chose against the
   index the recipe resolves to -- so if the worker and the page each had their
   own copy of this logic, the gate would start rejecting correct answers the
   moment the two drifted apart.

   Loaded by the service worker and by the content script. Uses self, not
   window, because a service worker has no window. */

/* "Age *" and "Age:" both become "age". */
self.DAARI_NORMALIZE_NAME = function (text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[*:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

function escapeForRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* How well does this element's name match what we are looking for?

   Plain substring matching is not enough, and the practice site proves it:
   looking for "age" on the passenger page, an indexOf would match "Tourism
   Packages" up in the menu long before reaching the Age box. So an exact match
   wins, then a match at the start, then a whole word, and only then a
   substring. */
self.DAARI_NAME_SCORE = function (name, want) {
  var have = self.DAARI_NORMALIZE_NAME(name);
  var need = self.DAARI_NORMALIZE_NAME(want);
  if (!have || !need) { return 0; }
  if (have === need) { return 100; }
  if (have.indexOf(need) === 0) { return 80; }
  if (new RegExp('(^|\\s)' + escapeForRegExp(need) + '($|\\s)').test(have)) { return 60; }
  if (have.indexOf(need) !== -1) { return 30; }
  return 0;
};

/* Which element is this step talking about? -1 when nothing matches, and Daari
   then says it is not sure rather than pointing at a guess.

   Labels are tried in priority order: if the first one matches anything at all,
   later ones are not consulted. Within a label the best score wins, and ties go
   to whatever comes first -- which, after serializePage, means whatever is on
   screen. */
self.DAARI_RESOLVE_BY_NAME = function (list, labels) {
  if (!list || !labels) { return -1; }
  for (var l = 0; l < labels.length; l++) {
    var bestIndex = -1;
    var bestScore = 0;
    for (var i = 0; i < list.length; i++) {
      var score = self.DAARI_NAME_SCORE(list[i].name, labels[l]);
      if (score > bestScore) { bestScore = score; bestIndex = i; }
    }
    if (bestIndex !== -1) { return bestIndex; }
  }
  return -1;
};

/* Which page of a site is this URL?

   The basename with no extension, so ".../practice/results.html" is "results".
   A bare directory ".../practice/" is "index", because that is the file a web
   server hands back for it.

   This is what lets Daari notice the user pressed Back: a page report matching
   an EARLIER step means go back, not forward. */
self.DAARI_PAGE_OF = function (url) {
  var path = String(url || '').split('#')[0].split('?')[0];
  var last = path.slice(path.lastIndexOf('/') + 1);
  if (!last) { return 'index'; }
  return last.replace(/\.[a-z0-9]+$/i, '').toLowerCase();
};

/* The five fields an element may have, and nothing else.

   Rule 2 in one function. Called on the way out of the page AND again in the
   worker before anything is sent over the network, because a rule this
   important should not depend on one place remembering to check. */
self.DAARI_ELEMENT_FIELDS = ['i', 'tag', 'type', 'name', 'filled'];

self.DAARI_FIND_FORBIDDEN_FIELDS = function (elements) {
  var allowed = {};
  self.DAARI_ELEMENT_FIELDS.forEach(function (f) { allowed[f] = true; });

  var found = {};
  (elements || []).forEach(function (element) {
    Object.keys(element).forEach(function (key) {
      if (!allowed[key]) { found[key] = true; }
    });
  });
  return Object.keys(found);
};
