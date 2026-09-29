/* The confirm gate -- the one place that decides "stop and make them look".

   CLAUDE.md rule 3: safety rules are enforced in code, never delegated to the
   model, and never to a flag that whoever wrote a flow might forget to set. So
   this runs against the accessible name AND THE KIND of the element Daari is
   about to point at, every single time, wherever the step came from.

   THE ENTRY POINT IS DAARI_MUST_CONFIRM(element). It takes the whole element,
   not just its name, because what a control IS matters as much as what it says:
   a link called "Cancellations" goes to a page about cancelling, while a BUTTON
   called "Cancel" cancels something.

   Loaded by the service worker and the content script. Uses self, not window,
   because a service worker has no window.

   If you widen these lists you widen what Daari stops for. If you narrow them
   you remove a stop somebody was relying on. Do neither casually, and add a
   case to tests/offline.js either way. */

/* ---------------------------------------------------------------- vocabulary */

/* Money, and finality. Any one of these is enough, on a real control. */
self.DAARI_CONFIRM_WORDS = [
  'pay',
  'payment',
  'submit',
  'confirm',
  'checkout',
  'చెల్లించు',
  'भुगतान'
];

/* The subset that specifically means money changing hands. Used for the narrow
   link rule further down. */
self.DAARI_MONEY_WORDS = [
  'pay',
  'payment',
  'చెల్లించు',
  'भुगतान'
];

self.DAARI_CANCEL_WORDS = [
  'cancel',        /* covers cancel, cancels, cancelling, cancellation */
  'रद्द',
  'రద్దు'
];

self.DAARI_BOOKING_WORDS = [
  'ticket',
  'booking',
  'reservation',
  'pnr',
  'टिकट',
  'आरक्षण',
  'టికెట్',
  'రిజర్వేషన్'
];

/* ------------------------------------------------------------- what it IS */

/* Does this thing ACT, or does it just go somewhere?

   The distinction earns its place on the practice site alone: the menu tab
   "Cancellations" is a link to a help page and cancels nothing, while a button
   reading "Cancel booking" cancels a booking. Same words, opposite consequences.

   For anything that is not an input, serializePage puts the ARIA role in "type",
   so a link dressed as a button is treated as a button. */
self.DAARI_ACTIONABLE_INPUT_TYPES = ['submit', 'button', 'reset', 'image'];

self.DAARI_IS_ACTIONABLE = function (element) {
  if (!element) { return false; }
  var tag = String(element.tag || '').toLowerCase();
  var type = String(element.type || '').toLowerCase();

  if (tag === 'button') { return true; }
  if (tag === 'input') {
    return self.DAARI_ACTIONABLE_INPUT_TYPES.indexOf(type) !== -1;
  }
  return type === 'button';
};

function containsAny(name, words) {
  for (var i = 0; i < words.length; i++) {
    if (name.indexOf(String(words[i]).toLowerCase()) !== -1) { return true; }
  }
  return false;
}

/* Does the name carry a digit or a currency symbol? "Pay ₹378" does; "Payment
   options" does not. This is what separates a link that takes money from a link
   that explains how money is taken. */
function looksLikeAnAmount(name) {
  return /[0-9]/.test(name) ||
         /[₹$£€]/.test(name);
}

/* Is this name a payment ACTION, rather than a page ABOUT payment?

   The distinction is grammatical, and it is the whole rule: "Pay" is a verb,
   "Payment" is a noun. So "Pay now" takes money and "Payment options" explains
   how. English makes this easy to get wrong, because both begin with the same
   three letters -- which is why every pattern here is anchored on a word
   boundary. "Payment options" must never match /^pay/.

   This closes the gap where a bare "Pay Now" LINK, with no amount and no
   role="button", was not gated. Amount or no amount, a link that says it pays is
   a link Daari stops for. */
self.DAARI_PAYMENT_ACTION_PATTERNS = [
  /^pay\b/,                         /* Pay · Pay now · Pay ₹378 · Pay securely */
  /\bpay\s*$/,                      /* Proceed to pay · Continue to pay */
  /\band\s+pay\b/,                  /* Confirm and pay */
  /\bpay\s+(now|here|online|securely|balance|fare|amount|total)\b/,

  /* "payment" only counts with a verb attached to it, which is what keeps
     "Payment options" and "Payment methods" out. */
  /\b(make|complete|confirm|submit|finish|proceed\s+to|continue\s+to|go\s+to)\s+(the\s+|your\s+)?payment\b/,
  /\bpayment\s*$/,                  /* Proceed to payment */

  /* Telugu: చెల్లించు is the verb "pay". The noun is చెల్లింపు, a different
     stem, so matching the verb stem cannot catch "payment options". */
  /చెల్లించ/,

  /* Hindi: भुगतान is the noun, so it needs its verb (करें / करना / कीजिए) to be
     an action. "भुगतान विकल्प" -- payment options -- stays open. */
  /भुगतान\s*(कर|कीज)/
];

function isPaymentAction(name) {
  for (var i = 0; i < self.DAARI_PAYMENT_ACTION_PATTERNS.length; i++) {
    if (self.DAARI_PAYMENT_ACTION_PATTERNS[i].test(name)) { return true; }
  }
  return false;
}

/* --------------------------------------------------------- word matching only

   Kept separate so it can be tested on its own, and so the three rules below
   read clearly. This asks only "do the WORDS look dangerous", with no view on
   what kind of control it is. */
self.DAARI_NEEDS_CONFIRM = function (accessibleName) {
  var name = String(accessibleName || '').toLowerCase();
  if (!name) { return false; }

  if (containsAny(name, self.DAARI_CONFIRM_WORDS)) { return true; }

  /* Cancelling, on a link or a tab, needs a booking word as well. That is what
     keeps "Cancellations" and "Cancellation rules" from stopping somebody who
     just wants to read the rules. */
  if (containsAny(name, self.DAARI_CANCEL_WORDS) &&
      containsAny(name, self.DAARI_BOOKING_WORDS)) {
    return true;
  }

  return false;
};

/* ------------------------------------------------------------- THE DECISION */

/* Daari must stop before pointing at this if ANY of three rules fire.

   1. It ACTS and its words are dangerous -- including a bare "Cancel", which is
      safe to gate here precisely because we know it is a real control and not a
      menu tab. This is the rule that closes the bare-"Cancel" gap.

   2. It does not act, but it says it cancels something BOOKED. An anchor like
      "Cancel this booking" really does cancel a booking on plenty of sites.

   2. It does not act, but its name is a payment ACTION -- "Pay Now", "Make
      payment", "Proceed to pay", with or without an amount. Money can move on a
      link click, so these are stopped. The verb/noun distinction is what keeps
      "Payment options" and "Payment methods" open.

   3. It does not act, but it names money AND an amount -- "Pay ₹378" as a
      styled link.

   CANCELLING IS DELIBERATELY NOT IN THE LINK RULES. A link labelled "Cancel a
   ticket" or "Cancel this booking" almost always NAVIGATES to a cancellation
   page, where the real cancel button lives and gets gated on arrival. Stopping
   the user on the way there is a false stop, and a stop that fires on the way to
   a page is one people learn to dismiss without reading -- which makes every
   real stop worth less.

   Cancellation BUTTONS still stop, under rule 1. Payment links are treated
   differently on purpose: a payment link can move money on the click itself,
   where a cancellation link takes you to a form. */
self.DAARI_MUST_CONFIRM = function (element) {
  if (!element) { return false; }
  var name = String(element.name || '').toLowerCase();
  if (!name) { return false; }

  if (self.DAARI_IS_ACTIONABLE(element)) {
    /* 1 -- the word rules, plus a bare "Cancel", which is safe to stop on here
       precisely because we know this is a real control and not a menu tab. */
    return self.DAARI_NEEDS_CONFIRM(name) ||
           containsAny(name, self.DAARI_CANCEL_WORDS);
  }

  /* 2 */
  if (isPaymentAction(name)) { return true; }

  /* 3 */
  if (containsAny(name, self.DAARI_MONEY_WORDS) && looksLikeAnAmount(name)) {
    return true;
  }

  return false;
};
