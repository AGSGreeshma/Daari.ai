/* The confirm gate -- the one place that decides "stop and make them look".

   CLAUDE.md rule 3: safety rules are enforced in code, never delegated to the
   model, and never to a flag that whoever wrote a flow might forget to set.
   So this check runs against the accessible name of the element Daari is
   ABOUT to point at, every single time, no matter where the step came from --
   a hardcoded flow today, a recipe in Phase 6, a model's answer in Phase 5.

   Consequence worth knowing: the practice site's "Continue to Payment" button
   trips this as well as "Pay". That is the gate working, not misfiring. It
   caught a button no flow author marked as dangerous.

   Loaded by both the service worker and the content script. Uses self, not
   window, because a service worker has no window.

   If you widen this list, you are widening what Daari will stop for. If you
   narrow it, you are removing a stop the user was relying on. Do neither
   casually. */

/* RULE ONE: any of these words on its own is enough to stop.

   Substring matching on purpose. "Pay ₹378", "Proceed to payment" and "Submit
   application" must all trip it. A false stop costs the user three seconds; a
   missed stop can cost them money. */
self.DAARI_CONFIRM_WORDS = [
  'pay',
  'payment',
  'submit',
  'confirm',
  'చెల్లించు',
  'भुगतान'
];

/* RULE TWO: cancelling something booked.

   "cancel ticket" used to be a single entry in the list above, and it had a
   hole you could drive through: "Cancel a ticket" did not match, because of the
   "a". So do "Cancel this booking", "Ticket cancellation" and every other
   natural phrasing.

   So cancelling now needs a word from EACH list, in any order, with anything in
   between. That catches the real phrasings while leaving the "Cancellations"
   menu tab alone -- a tab that merely lists the rules has no booking word in
   it, and stopping the user from reading a help page would be a false stop for
   no gain.

   The trade is deliberate: "Cancellations" not stopping is correct, and a bare
   "Cancel" button somewhere with no booking word in its label would still slip
   through. If that turns up on a real site, add its wording here. */
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

/* Is this something that ACTS, rather than something that goes somewhere?

   The gate fires only on actionable controls. A link or a tab labelled
   "Cancellations" navigates to a page about cancelling; it does not cancel
   anything, and stopping the user from reading it is a false stop. A BUTTON
   labelled "Cancel booking" does cancel something.

   The trade, stated plainly: a site where "Pay Now" is a styled <a> rather than
   a button would not be gated. That is a real risk on real sites, and the
   mitigation is that such a link almost always carries role="button", which
   counts below. If a site is found where it does not, this is the function to
   revisit -- not the word list. */
self.DAARI_ACTIONABLE_INPUT_TYPES = ['submit', 'button', 'reset', 'image'];

self.DAARI_IS_ACTIONABLE = function (element) {
  if (!element) { return false; }
  var tag = String(element.tag || '').toLowerCase();
  var type = String(element.type || '').toLowerCase();

  if (tag === 'button') { return true; }
  if (tag === 'input') {
    return self.DAARI_ACTIONABLE_INPUT_TYPES.indexOf(type) !== -1;
  }
  /* For anything that is not an input, serializePage puts the ARIA role in
     "type". A link dressed as a button is treated as a button. */
  return type === 'button';
};

function containsAny(name, words) {
  for (var i = 0; i < words.length; i++) {
    if (name.indexOf(String(words[i]).toLowerCase()) !== -1) { return true; }
  }
  return false;
}

/* Does Daari have to stop before pointing at this? */
self.DAARI_NEEDS_CONFIRM = function (accessibleName) {
  var name = String(accessibleName || '').toLowerCase();
  if (!name) { return false; }

  if (containsAny(name, self.DAARI_CONFIRM_WORDS)) { return true; }

  /* Both halves needed, which is what keeps "Cancellations" out. */
  if (containsAny(name, self.DAARI_CANCEL_WORDS) &&
      containsAny(name, self.DAARI_BOOKING_WORDS)) {
    return true;
  }

  return false;
};
