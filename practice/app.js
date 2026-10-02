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
  /* From and To start EMPTY on purpose.

     They used to default to Secunderabad and Kazipet, which made the search page
     render pre-filled every time. That quietly broke the guided walk: the first
     two steps wait for a box to be filled, the boxes were already filled, so both
     steps completed instantly and Daari jumped straight to the Class dropdown.
     Two steps of the demo disappeared, and it looked like Daari skipping rather
     than the page having lied about its state.

     The other defaults stay, because a class and a quota genuinely do have
     sensible starting values and nothing waits on them being empty. */
  function journey() {
    return load('journey', {
      from: '', to: '', date: '', cls: 'SL', quota: 'General'
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

  /* ------------------------------------------------------------------
     Stations, and the suggestion list on the From and To boxes

     Real booking sites do not take a typed station name. They want one CHOSEN
     from a suggestion list, and silently ignore anything else -- which is one
     of the places a first-time user gets quietly stuck. The demo site has to
     behave the same way or the demo is not showing the real problem.

     Built to the standard ARIA combobox pattern (role=combobox on the box,
     role=listbox with role=option inside it), because that is what a screen
     reader expects and what Daari's overlay reads to know the list is open.
     Keyboard and mouse both work.
     ------------------------------------------------------------------ */
  var STATIONS = [
    { name: 'VIJAYAWADA',      code: 'BZA' },
    { name: 'SECUNDERABAD',    code: 'SC' },
    { name: 'HYDERABAD',       code: 'HYB' },
    { name: 'KAZIPET',         code: 'KZJ' },
    { name: 'WARANGAL',        code: 'WL' },
    { name: 'GUNTUR',          code: 'GNT' },
    { name: 'TIRUPATI',        code: 'TPTY' },
    { name: 'VISAKHAPATNAM',   code: 'VSKP' },
    { name: 'RAJAHMUNDRY',     code: 'RJY' },
    { name: 'NELLORE',         code: 'NLR' },
    { name: 'KURNOOL CITY',    code: 'KRNT' },
    { name: 'NIZAMABAD',       code: 'NZB' },
    { name: 'KHAMMAM',         code: 'KMT' },
    { name: 'ELURU',           code: 'EE' },
    { name: 'NEW DELHI',       code: 'NDLS' },
    { name: 'CHENNAI CENTRAL', code: 'MAS' },
    { name: 'KSR BENGALURU',   code: 'SBC' },
    { name: 'MUMBAI CSMT',     code: 'CSMT' }
  ];

  /* Which stations match what has been typed so far. Name first, then code,
     and a name that STARTS with what was typed comes before one that merely
     contains it. */
  function matchStations(typed) {
    var want = String(typed || '').trim().toUpperCase();
    if (!want) { return []; }

    var starts = [];
    var inside = [];
    STATIONS.forEach(function (station) {
      if (station.name.indexOf(want) === 0 || station.code.indexOf(want) === 0) {
        starts.push(station);
      } else if (station.name.indexOf(want) !== -1) {
        inside.push(station);
      }
    });
    return starts.concat(inside).slice(0, 8);
  }

  /* Turn a text box into a station autocomplete. */
  function attachAutocomplete(input) {
    if (!input || !input.parentNode) { return; }

    var listId = input.id + '-suggestions';
    var list = document.createElement('ul');
    list.id = listId;
    list.className = 'ac-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Station suggestions');
    list.hidden = true;

    /* The list is positioned against a wrapper around the box, not against the
       whole row -- the row also holds the label and the hint, and a list
       stretched across all of it would start under the label. */
    var wrap = document.createElement('span');
    wrap.className = 'ac-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    wrap.appendChild(list);

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');

    var shown = [];
    var active = -1;

    function close() {
      list.hidden = true;
      list.textContent = '';
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      shown = [];
      active = -1;
    }

    function highlight() {
      var items = list.children;
      for (var i = 0; i < items.length; i++) {
        var on = (i === active);
        items[i].className = on ? 'ac-option ac-on' : 'ac-option';
        items[i].setAttribute('aria-selected', on ? 'true' : 'false');
      }
      if (active >= 0 && items[active]) {
        input.setAttribute('aria-activedescendant', items[active].id);
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    /* Put the chosen station in the box. The page does this to itself, which is
       what any website does -- Daari never does it for the user. */
    function choose(index) {
      if (index < 0 || index >= shown.length) { return; }
      input.value = shown[index].name;
      close();
      input.focus();
    }

    function open() {
      var matches = matchStations(input.value);

      /* An exact name already in the box needs no list. Without this the list
         re-opens the moment a chosen station is clicked. */
      if (matches.length === 1 &&
          matches[0].name === String(input.value).trim().toUpperCase()) {
        close();
        return;
      }
      if (!matches.length) { close(); return; }

      shown = matches;
      active = -1;
      list.textContent = '';

      matches.forEach(function (station, i) {
        var item = document.createElement('li');
        item.id = listId + '-' + i;
        item.className = 'ac-option';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', 'false');
        item.textContent = station.name + '  (' + station.code + ')';
        /* mousedown, not click: the box blurs before a click completes. */
        item.addEventListener('mousedown', function (event) {
          event.preventDefault();
          choose(i);
        });
        list.appendChild(item);
      });

      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      highlight();
    }

    input.addEventListener('input', open);

    input.addEventListener('keydown', function (event) {
      if (list.hidden) {
        if (event.key === 'ArrowDown') { open(); }
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        active = (active + 1) % shown.length;
        highlight();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        active = (active <= 0 ? shown.length : active) - 1;
        highlight();
      } else if (event.key === 'Enter') {
        /* Only swallow Enter when a suggestion is actually picked out, so Enter
           on its own still submits the form. */
        if (active >= 0) { event.preventDefault(); choose(active); }
      } else if (event.key === 'Escape') {
        close();
      }
    });

    /* Leaving the box closes the list. Delayed, or it would close before a
       mousedown on an option is handled on some browsers. */
    input.addEventListener('blur', function () {
      window.setTimeout(close, 120);
    });
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
    STATIONS: STATIONS,
    matchStations: matchStations,
    attachAutocomplete: attachAutocomplete,
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
