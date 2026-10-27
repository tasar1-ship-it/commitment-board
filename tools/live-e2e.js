// Live test: the local index.html against the REAL Firebase database and rules, served under the real
// github.io address (requests for it are answered from this folder), so nothing has to be deployed first.
// Creates one board named "LIVE TEST - delete me", runs the main flows, then deletes everything it wrote
// and the anonymous sign-ins it made. Needs tools/create-code.txt (the start code, not in the repo).
// ENGINE=webkit runs it in Safari's engine.
var fs = require('fs'), path = require('path');
var ENGINE = process.env.ENGINE || 'chromium';
var launcher = require('playwright')[ENGINE];

var SITE = path.join(__dirname, '..');
var ORIGIN = 'https://tasar1-ship-it.github.io';
var BASE = ORIGIN + '/commitment-board/';
var CODE = fs.readFileSync(path.join(__dirname, 'create-code.txt'), 'utf8').trim();
var results = [], errs = [], pages = [];
function ok(label, cond, detail) { results.push({ label: label, ok: !!cond, detail: detail }); }

(async function () {
  var browser = await launcher.launch(), P = '', M, A, X;
  async function user(name) {
    var ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    if (ENGINE === 'chromium') { await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN }); }
    else { await ctx.addInitScript('Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: function (t) { window.__clip = t; return Promise.resolve(); }, readText: function () { return Promise.resolve(window.__clip || ""); } } });'); }
    await ctx.route(BASE + '**', function (r) {
      var f = new URL(r.request().url()).pathname.replace('/commitment-board/', '') || 'index.html';
      var full = path.join(SITE, f);
      if (!/^(index\.html|firebase-(app|auth|database)-compat\.js)$/.test(f) || !fs.existsSync(full)) { r.fulfill({ status: 404, body: 'no' }); return; }
      r.fulfill({ contentType: /\.html$/.test(f) ? 'text/html; charset=utf-8' : 'application/javascript', body: fs.readFileSync(full) });
    });
    var pg = await ctx.newPage();
    pg.on('pageerror', function (e) { errs.push(name + ' pageerror ' + e.message); });
    pg.on('console', function (m) { if (m.type() === 'error') { errs.push(name + ' console ' + m.text()); } });
    pages.push(pg);
    return pg;
  }
  var nav = async function (pg, url) { await pg.goto('about:blank'); await pg.goto(url); };
  var txt = function (pg, sel) { return pg.$eval(sel, function (e) { return e.textContent; }); };
  var has = async function (pg, sel) { return (await pg.$(sel)) !== null; };
  var db = function (pg, kind, p, v) {
    return pg.evaluate(function (a) {
      var r = a.p ? window.firebase.database().ref(a.p) : window.firebase.database().ref(), pr = a.kind === 'get' ? r.once('value').then(function (s) { return s.val(); }) : a.kind === 'update' ? r.update(a.v) : r.set(a.v);
      return pr.then(function (val) { return { ok: true, val: val === undefined ? null : val }; }, function (e) { return { ok: false, code: e.code || String(e) }; });
    }, { kind: kind, p: p, v: v });
  };
  var uid = function (pg) { return pg.evaluate(function () { var u = window.firebase.auth().currentUser; return u ? u.uid : ''; }); };

  try {
    /* 1. create a board with the start code */
    M = await user('coordinator');
    await M.goto(BASE + '#new.' + CODE); await M.waitForSelector('#newboard', { timeout: 20000 });
    await M.fill('#nb-title', 'LIVE TEST - delete me'); await M.fill('#nb-coord', 'Test coordinator');
    await M.click('#newboard button[type=submit]');
    await M.waitForSelector('article.person, .banner.bad', { timeout: 30000 });
    var hashM = await M.evaluate(function () { return location.hash; });
    var mm = /^#([A-Za-z0-9]{22})\.c\.([A-Za-z0-9]{24})$/.exec(hashM);
    ok('live: start code accepted, board created', !!mm, (await has(M, '.banner.bad')) ? await txt(M, '.banner.bad') : hashM);
    if (!mm) { throw new Error('board not created'); }
    P = mm[1];
    console.log('board id ' + P + ' coordinator link ' + BASE + hashM);

    /* 2. coordinator fills in */
    await M.fill('#pn-p1', 'Test Person'); await M.locator('#pn-p1').blur(); await M.waitForTimeout(500);
    await M.click('article.t1 button[data-act="add"]'); await M.waitForTimeout(400);
    await M.keyboard.type('Live test task'); await M.keyboard.press('Enter'); await M.waitForTimeout(400);
    var d1 = await M.$eval('article.t1 input[type=date]', function (e) { return e.id; });
    await M.fill('#' + d1, '2030-01-07'); await M.locator('#' + d1).blur(); await M.waitForTimeout(800);
    var stored = await db(M, 'get', 'plans/' + P);
    ok('live: names and task stored', stored.ok && stored.val.people.p1.name === 'Test Person' && Object.keys(stored.val.tasks || {}).length === 1, JSON.stringify(stored));
    await M.click('button[data-act="link"][data-id="p1"]'); await M.waitForTimeout(500);
    var linkA = await M.evaluate(function () { return navigator.clipboard.readText(); });
    ok('live: personal link copied', new RegExp('^' + BASE.replace(/[.\/]/g, '\\$&') + '#' + P + '\\.p1\\.[A-Za-z0-9]{24}$').test(linkA), linkA);

    /* 3. the person moves the date, adds a task, signs */
    A = await user('person');
    await A.goto(linkA); await A.waitForSelector('article.person', { timeout: 30000 });
    ok('live: person greeted by name', /You are Test Person/.test(await txt(A, '.hint')));
    await A.fill('#' + d1, '2030-01-09'); await A.locator('#' + d1).blur(); await A.waitForTimeout(800);
    await A.click('article.t1 button[data-act="add"]'); await A.waitForTimeout(400);
    await A.keyboard.type('Second live task'); await A.keyboard.press('Enter'); await A.waitForTimeout(400);
    var nd = await A.$eval('article.t1', function (a) { var i = Array.prototype.filter.call(a.querySelectorAll('input[type=date]'), function (x) { return !x.value; })[0]; return i && i.id; });
    await A.fill('#' + nd, '2030-01-10'); await A.locator('#' + nd).blur(); await A.waitForTimeout(800);
    await A.fill('#sn-p1', 'Test Person'); await A.click('form[data-pid="p1"] button[type=submit]'); await A.waitForTimeout(1500);
    ok('live: person signs', (await txt(A, 'article.t1 .pill')) === 'Committed', await txt(A, 'article.t1 .pill'));
    var sig = await db(A, 'get', 'plans/' + P + '/sigs/p1');
    ok('live: sign-off stored with server time', sig.ok && sig.val && Math.abs(sig.val.at - Date.now()) < 120000 && sig.val.n === 2, JSON.stringify(sig));

    /* 4. coordinator sees it, with the changes card */
    await M.waitForFunction(function () { var c = document.querySelector('.changes'); return c && /Test Person<\/b> signed off|Test Person signed off/.test(c.textContent); }, null, { timeout: 15000 })
      .then(function () { ok('live: changes card shows the sign-off without reloading', true); }, function () { ok('live: changes card shows the sign-off without reloading', false); });
    var ch = await txt(M, '.changes').catch(function () { return ''; });
    ok('live: changes card shows the moved date and the new task', /moved from Mon,? 7 Jan 2030 to Wed,? 9 Jan 2030/.test(ch) && /new task “Second live task”/.test(ch), ch);

    /* 5. timeline */
    await M.click('button[data-act="view"][data-id="timeline"]'); await M.waitForTimeout(400);
    var tl = await M.$$eval('.tl-row .tl-date', function (a) { return a.map(function (x) { return x.textContent; }); });
    ok('live: timeline lists both tasks in date order', /^Wed,? 9 Jan 2030\|Thu,? 10 Jan 2030$/.test(tl.join('|')), tl.join('|'));
    await M.click('button[data-act="view"][data-id="people"]'); await M.waitForTimeout(300);

    /* 6. the real rules still refuse what they must */
    var fake = { name: 'Intruder', seal: 'AAAA-BBBB', n: 1, at: { '.sv': 'timestamp' } };
    ok('live rules: person cannot sign as the coordinator', (await db(A, 'set', 'plans/' + P + '/sigs/c', fake)).code === 'PERMISSION_DENIED');
    ok('live rules: person cannot read the links', (await db(A, 'get', 'keys/' + P)).code === 'PERMISSION_DENIED');
    ok('live rules: coordinator cannot sign for the person', (await db(M, 'set', 'plans/' + P + '/sigs/p2', fake)).code === 'PERMISSION_DENIED');

    /* 7. replace the person's link */
    await M.click('button[data-act="rl"][data-id="p1"]'); await M.waitForTimeout(300);
    await M.click('button[data-act="rl-yes"][data-id="p1"]');
    await M.waitForFunction(function () { return /New link ready/.test(document.querySelector('article.t1').textContent); }, null, { timeout: 15000 })
      .then(function () { ok('live: replace link accepted by the real rules', true); }, async function () { ok('live: replace link accepted by the real rules', false, (await has(M, '.banner.bad')) ? await txt(M, '.banner.bad') : ''); });
    var keys = await db(M, 'get', 'keys/' + P), oldTok = linkA.split('.').pop();
    var newToks = keys.ok ? Object.keys(keys.val).filter(function (k) { return keys.val[k] === 'p1'; }) : [];
    ok('live: old token gone, one new token', keys.ok && !keys.val[oldTok] && newToks.length === 1, JSON.stringify(keys.ok ? Object.keys(keys.val).length : keys));
    await M.click('button[data-act="link"][data-id="p1"]'); await M.waitForTimeout(500);
    var linkA2 = await M.evaluate(function () { return navigator.clipboard.readText(); });
    ok('live: copied link carries the new token', linkA2 === BASE + '#' + P + '.p1.' + newToks[0], linkA2);
    ok('live rules: the old link can no longer write', (await db(A, 'set', 'plans/' + P + '/tasks/tZZZZZZZZZZ', { pid: 'p1', title: 'x', due: '', baseTitle: '', baseDue: '', addedBy: 'p1', done: false, at: 1 })).code === 'PERMISSION_DENIED');
    X = await user('old-link holder');
    await X.goto(linkA); await X.waitForSelector('.top h1'); await X.waitForTimeout(2500);
    ok('live: the old link shows the dead-link page', (await txt(X, '.top h1')) === 'This link does not work', await txt(X, '.top h1'));
    await nav(A, linkA2); await A.waitForSelector('article.person', { timeout: 30000 });
    ok('live: the new link opens the board, sign-off intact', /You are Test Person/.test(await txt(A, '.hint')) && (await txt(A, 'article.t1 .pill')) === 'Committed');
  } catch (e) {
    ok('live: run completed without a harness error', false, e && e.message);
  } finally {
    /* 8. clean up: everything this run wrote, then the anonymous sign-ins */
    var left = [];
    try {
    if (P && M) {
      var snap = await db(M, 'get', 'keys/' + P), plan = await db(M, 'get', 'plans/' + P), u = {}, k, uM = await uid(M);
      var v = plan.ok && plan.val ? plan.val : {};
      ['sigs', 'tasks', 'people'].forEach(function (s) { for (k in (v[s] || {})) { u['plans/' + P + '/' + s + '/' + k] = null; } });
      u['plans/' + P + '/meta'] = null;
      if (snap.ok && snap.val) { for (k in snap.val) { u['keys/' + P + '/' + k] = null; } }
      u['claims/' + P + '/' + uM] = null; u['creators/' + uM] = null;
      var r = await db(M, 'update', '', u);
      if (!r.ok) { left.push('coordinator cleanup refused: ' + r.code); }
      var others = [A, X].filter(Boolean);
      for (var i = 0; i < others.length; i++) {
        var uo = await uid(others[i]);
        if (uo) { var r2 = await db(others[i], 'set', 'claims/' + P + '/' + uo, null); if (!r2.ok) { left.push('claims cleanup refused for ' + uo); } }
      }
      var gone = await db(others[0] || M, 'get', 'plans/' + P);
      ok('live cleanup: the test board is gone', gone.ok && gone.val === null, JSON.stringify(gone));
      var mineLeft = await db(M, 'get', 'claims/' + P + '/' + uM);
      ok('live cleanup: the coordinator\'s claim is gone', mineLeft.ok && mineLeft.val === null, JSON.stringify(mineLeft));
    }
    } catch (e2) { left.push('cleanup error: ' + (e2 && e2.message)); }
    for (var j = 0; j < pages.length; j++) {
      var del = await pages[j].evaluate(function () { var u = window.firebase && window.firebase.auth().currentUser; return u ? u.delete().then(function () { return 'deleted'; }, function (e) { return e.code; }) : 'none'; }).catch(function (e) { return 'error ' + e.message; });
      if (del !== 'deleted' && del !== 'none') { left.push('sign-in ' + j + ': ' + del); }
    }
    ok('live cleanup: all test sign-ins deleted', left.length === 0, JSON.stringify(left));
    if (left.length || !P) { console.log('CLEANUP NOTE board ' + (P || '(none)') + ': ' + JSON.stringify(left)); }
    var unexpected = errs.filter(function (e) { return !/PERMISSION_DENIED|permission_denied/i.test(e); });
    ok('live: no page errors', unexpected.length === 0, JSON.stringify(unexpected));
    var failed = results.filter(function (x) { return !x.ok; });
    console.log('[' + ENGINE + '] ' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed');
    failed.forEach(function (x) { console.log('FAIL: ' + x.label + (x.detail ? '\n      ' + x.detail : '')); });
    await browser.close();
    process.exit(failed.length ? 1 : 0);
  }
})();
