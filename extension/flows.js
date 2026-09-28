/* Hardcoded flows -- a known route through a known website.

   Phase 4 has exactly one, for the practice portal, so that the whole
   cross-page machine can be proved with no AI in the way. In Phase 6 these
   become recipes in recipes/, loaded from JSON, and passed to the model as a
   hint rather than followed as a script.

   Three things every step needs:

   page       Which page of the site the step belongs to, as the basename with
              no .html ("index", "results", ...). This is what lets Daari
              notice the user pressed Back: a page report that matches an
              EARLIER step means go back, not forward.

   look_for   Labels to match against the accessible names on the page. Steps
              target elements BY NAME, never by index: the index of a button
              changes on every page, but "Send OTP" does not.

   done_when  How Daari knows, locally and for free, that the step is finished.
              One of:
                url_changed              the page went somewhere else
                field_filled[:name]      a box has something in it
                value_changed[:name]     a dropdown or box was changed
                clicked[:name]           the user clicked it themselves
                element_gone:name        it disappeared
                text_appears:some text   that text became VISIBLE on the page
              With no :name, the rule applies to the step's own element.

   sensitive  Daari says "type it yourself" and never reads the value. Values
              are never read anyway; this only changes the wording.

   Loaded by the service worker. Uses self, not window, because a service
   worker has no window. */

self.DAARI_FLOWS = {

  'practice-book-ticket': {
    label: 'Book a train ticket on Yatra Demo Rail',
    startsAt: 'practice/',

    steps: [
      /* ---- search page ---- */
      { page: 'index', sayKey: 'fromStation', look_for: ['from station'], done_when: 'field_filled' },
      { page: 'index', sayKey: 'toStation',   look_for: ['to station'],   done_when: 'field_filled' },

      /* The Class dropdown already says "Sleeper", so field_filled would be
         true before the user did anything and the step would complete
         instantly. value_changed waits for them to actually choose. Gender,
         further down, has an empty "-- Select --" option, so field_filled is
         right there. Same widget, opposite rule, purely because one has a
         default. */
      { page: 'index', sayKey: 'chooseClass', look_for: ['class'], done_when: 'value_changed' },

      { page: 'index', sayKey: 'pressSearch', look_for: ['search trains'], done_when: 'url_changed' },

      /* ---- results page ----
         There are four identical Book buttons. Daari rings the first and says
         "next to the train you want", because it genuinely cannot know which
         train was meant. Phase 6 needs a way to disambiguate. */
      { page: 'results', sayKey: 'pressBook', look_for: ['book'], done_when: 'url_changed' },

      /* ---- passenger page ---- */
      { page: 'passenger', sayKey: 'passengerName', look_for: ['passenger name'], done_when: 'field_filled' },
      { page: 'passenger', sayKey: 'age',           look_for: ['age'],            done_when: 'field_filled' },
      { page: 'passenger', sayKey: 'gender',        look_for: ['gender'],         done_when: 'field_filled' },
      { page: 'passenger', sayKey: 'mobile',        look_for: ['mobile number'],  done_when: 'field_filled' },

      /* Waiting for the code to actually become visible, rather than just for
         the button to be clicked, so Daari does not move on if nothing
         happened. The text is in the page from the start but hidden, which is
         why text_appears tests VISIBLE text. */
      { page: 'passenger', sayKey: 'sendOtp', look_for: ['send otp'],
        done_when: 'text_appears:demo one-time password' },

      { page: 'passenger', sayKey: 'typeOtp', look_for: ['enter otp'], done_when: 'field_filled',
        sensitive: true },

      /* This one trips the confirm gate too, on the word "payment". Left
         deliberately: see safety.js. */
      { page: 'passenger', sayKey: 'continuePay', look_for: ['continue to payment'],
        done_when: 'url_changed' },

      /* ---- payment page ---- */
      { page: 'payment', sayKey: 'cardNumber', look_for: ['card number'], done_when: 'field_filled',
        sensitive: true },

      { page: 'payment', sayKey: 'pressPay', look_for: ['pay'], done_when: 'url_changed' },

      /* ---- confirmation page ----
         No element to point at. Daari just says the PNR is on screen, and the
         caption STAYS -- no auto-clear, because this is the thing the user
         needs to write down. */
      { page: 'confirmation', sayKey: 'finished', final: true }
    ]
  }
};

/* Which page of a site is this URL?

   The basename with no extension, so ".../practice/results.html" is
   "results". A bare directory ".../practice/" is "index", because that is the
   file a web server hands back for it. */
self.DAARI_PAGE_OF = function (url) {
  var path = String(url || '').split('#')[0].split('?')[0];
  var last = path.slice(path.lastIndexOf('/') + 1);
  if (!last) { return 'index'; }
  return last.replace(/\.[a-z0-9]+$/i, '').toLowerCase();
};
