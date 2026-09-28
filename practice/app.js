/* Yatra Demo Rail — shared helpers.

   This is a FICTIONAL demo site. Nothing here contacts a real booking system,
   there is no server, and no money can move. Every page is plain HTML plus
   this one script.

   All data is kept in this browser's localStorage under the "ydr:" prefix, so
   the booking you make really does persist and the PNR lookup really does find
   it. Clearing your browser data resets the whole demo.
*/

var YDR = (function () {
  'use strict';

  var PREFIX = 'ydr:';

  /* ------------------------------------------------------------------
     The invented timetable. Train names are made up. "Demo" is in every
     name on purpose, so nobody can mistake this for a real service.
     ------------------------------------------------------------------ */
  var TRAINS = [
    { no: '12711', name: 'Godavari Demo Express',   dep: '06:15', arr: '13:40', dur: '7h 25m', base: 320, avail: 'AVAILABLE 112' },
    { no: '17205', name: 'Kaleshwaram Demo Pass.',  dep: '09:30', arr: '19:05', dur: '9h 35m', base: 210, avail: 'AVAILABLE 240' },
    { no: '12759', name: 'Charminar Demo SF Exp',   dep: '14:50', arr: '21:10', dur: '6h 20m', base: 385, avail: 'FEW LEFT 14' },
    { no: '22691', name: 'Deccan Demo Rajdhani',    dep: '20:25', arr: '04:55', dur: '8h 30m', base: 640, avail: 'AVAILABLE 58' }
  ];

  /* Travel classes, with how much each multiplies the base fare by. */
  var CLASSES = [
    { code: '2S', name: 'Second Sitting (2S)',  mult: 0.6 },
    { code: 'SL', name: 'Sleeper (SL)',         mult: 1.0 },
    { code: '3A', name: 'AC 3 Tier (3A)',       mult: 2.6 },
    { code: '2A', name: 'AC 2 Tier (2A)',       mult: 3.8 },
    { code: '1A', name: 'AC First Class (1A)',  mult: 6.4 }
  ];

  function classByCode(code) {
    for (var i = 0; i < CLASSES.length; i++) {
      if (CLASSES[i].code === code) { return CLASSES[i]; }
    }
    return CLASSES[1]; // default to Sleeper
  }

  function trainByNo(no) {
    for (var i = 0; i < TRAINS.length; i++) {
      if (TRAINS[i].no === no) { return TRAINS[i]; }
    }
    return TRAINS[0];
  }

  /* Base fare for a train in a class, rounded to the nearest 5 rupees. */
  function fareFor(train, classCode) {
    var mult = classByCode(classCode).mult;
    return Math.round((train.base * mult) / 5) * 5;
  }

  /* Rupee amounts in Indian digit grouping, e.g. 1,245 */
  function money(amount) {
    return '₹' + Number(amount).toLocaleString('en-IN');
  }

  /* ------------------------------------------------------------------
     Storage. Wrapped in try/catch because localStorage can throw in a
     private window or when site data is blocked, and a demo site should
     never break outright because of that.
     ------------------------------------------------------------------ */
  function save(name, value) {
    try {
      localStorage.setItem(PREFIX + name, JSON.stringify(value));
    } catch (e) { /* ignore: the page still works, it just will not remember */ }
  }

  function load(name, fallback) {
    try {
      var raw = localStorage.getItem(PREFIX + name);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  /* Each getter has sensible defaults, so ANY page can be opened directly
     without walking the whole flow first. That matters for testing Daari:
     we can load payment.html on its own and it still renders properly. */
  function journey() {
    return load('journey', {
      from: 'Secunderabad', to: 'Kazipet', date: '', cls: 'SL', quota: 'General'
    });
  }

  function passenger() {
    return load('passenger', {
      name: '', age: '', gender: '', mobile: '', berth: 'No preference'
    });
  }

  function chosenTrain() {
    return trainByNo(load('trainNo', TRAINS[0].no));
  }

  /* ------------------------------------------------------------------
     PNR numbers and bookings
     ------------------------------------------------------------------ */
  function makePnr() {
    var digits = '';
    for (var i = 0; i < 10; i++) {
      digits += Math.floor(Math.random() * 10);
    }
    // Real PNRs do not start with 0, so nor do ours.
    if (digits.charAt(0) === '0') { digits = '1' + digits.slice(1); }
    return digits;
  }

  function saveBooking(booking) {
    var all = load('bookings', {});
    all[booking.pnr] = booking;
    save('bookings', all);
    save('lastPnr', booking.pnr);
  }

  function getBooking(pnr) {
    var all = load('bookings', {});
    return all[pnr] || null;
  }

  function lastPnr() {
    return load('lastPnr', '');
  }

  /* ------------------------------------------------------------------
     Small display helpers
     ------------------------------------------------------------------ */

  /* "2026-09-28" -> "Mon, 28 Sep 2026". Returns "Not selected" if empty. */
  function niceDate(iso) {
    if (!iso) { return 'Not selected'; }
    var parts = String(iso).split('-');
    if (parts.length !== 3) { return iso; }
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(d.getTime())) { return iso; }
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return days[d.getDay()] + ', ' + parts[2] + ' ' + months[d.getMonth()] + ' ' + parts[0];
  }

  /* Today as YYYY-MM-DD, for prefilling the date box. */
  function todayIso() {
    var d = new Date();
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    if (m.length === 1) { m = '0' + m; }
    if (day.length === 1) { day = '0' + day; }
    return d.getFullYear() + '-' + m + '-' + day;
  }

  /* Put a message into an element, or hide it when the text is empty. */
  function setMessage(el, kind, text) {
    if (!el) { return; }
    if (!text) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }
    el.className = 'msg msg-' + kind;
    el.textContent = text;
    el.style.display = 'block';
  }

  return {
    TRAINS: TRAINS,
    CLASSES: CLASSES,
    classByCode: classByCode,
    trainByNo: trainByNo,
    fareFor: fareFor,
    money: money,
    save: save,
    load: load,
    journey: journey,
    passenger: passenger,
    chosenTrain: chosenTrain,
    makePnr: makePnr,
    saveBooking: saveBooking,
    getBooking: getBooking,
    lastPnr: lastPnr,
    niceDate: niceDate,
    todayIso: todayIso,
    setMessage: setMessage
  };
}());
