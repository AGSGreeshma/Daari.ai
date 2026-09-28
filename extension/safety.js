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

self.DAARI_CONFIRM_WORDS = [
  'pay',
  'payment',
  'submit',
  'confirm',
  'cancel ticket',
  'చెల్లించు',
  'भुगतान'
];

/* Does Daari have to stop before pointing at this?

   Substring matching on purpose. "Pay ₹378", "Proceed to payment" and
   "Submit application" must all trip it. A false stop costs the user three
   seconds; a missed stop can cost them money. */
self.DAARI_NEEDS_CONFIRM = function (accessibleName) {
  var name = String(accessibleName || '').toLowerCase();
  if (!name) { return false; }
  for (var i = 0; i < self.DAARI_CONFIRM_WORDS.length; i++) {
    if (name.indexOf(self.DAARI_CONFIRM_WORDS[i].toLowerCase()) !== -1) {
      return true;
    }
  }
  return false;
};
