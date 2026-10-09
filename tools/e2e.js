// End-to-end test of the real page against the real rules, with a stand-in for the Firebase SDK.
// Three browsers (coordinator, a person, an outsider) share one in-memory database guarded by the rules.
var http = require('http'), fs = require('fs'), path = require('path');
var targaryen = require('targaryen');
var chromium = require('playwright').chromium;
var build = require('./make-rules.js');

var SITE = path.join(__dirname, '..');
var SHOTS = path.join(__dirname, 'shots');
var CODE = 'TestStartCode1234567890ab';   // any code works here: the test builds its own copy of the rules with it
var rules = build(CODE);
var MOCK = fs.readFileSync(path.join(__dirname, 'mock-firebase.js'), 'utf8');
var db = targaryen.database(rules, {}, Date.now());
var pages = [], deniedLog = [], results = [], expectDenied = false;

function sv(v, now) { var o, k; if (v && typeof v === 'object') { if (v['.sv'] === 'timestamp') { return now; } o = {}; for (k in v) { o[k] = sv(v[k], now); } return o; } return v; }
function rtdb(uid, kind, p, value) {
  var now = Date.now(), actor = db.as({ uid: uid }), res;
  if (kind === 'get') { res = actor.read('/' + p, { now: now }); return res.allowed ? { ok: true, value: db.snapshot('/' + p).val() } : { ok: false }; }
  res = kind === 'update' ? actor.update('/' + p, sv(value, now), { now: now }) : actor.write('/' + p, sv(value, now), { now: now });
  if (!res.allowed) { deniedLog.push({ uid: uid, kind: kind, path: p, expected: expectDenied }); return { ok: false }; }
  db = res.newDatabase;
  pages.forEach(function (pg) { pg.evaluate(function () { if (window.__rtdbChanged) { window.__rtdbChanged(); } }).catch(function () {}); });
  return { ok: true };
}
function ok(label, cond, detail) { results.push({ label: label, ok: !!cond, detail: detail }); }

(async function () {
  if (!fs.existsSync(SHOTS)) { fs.mkdirSync(SHOTS); }
  var server = http.createServer(function (req, res) {
    var f = req.url.split('?')[0]; if (f === '/') { f = '/index.html'; }
    var full = path.join(SITE, f);
    if (!fs.existsSync(full)) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'Content-Type': /\.html$/.test(f) ? 'text/html; charset=utf-8' : /\.js$/.test(f) ? 'application/javascript' : 'application/json' });
    res.end(fs.readFileSync(full));
  });
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  var BASE = 'http://127.0.0.1:' + server.address().port + '/';
  var browser; try { browser = await chromium.launch(); } catch (e) { browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }
  var errs = [];
  async function user(uid, opts) {
    var ctx = await browser.newContext(opts || { viewport: { width: 1200, height: 900 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE.slice(0, -1) });
    await ctx.addInitScript('window.__uid = ' + JSON.stringify(uid) + ';');
    await ctx.exposeFunction('__rtdb', rtdb);
    await ctx.route('**/firebase-app-compat.js', function (r) { r.fulfill({ contentType: 'application/javascript', body: MOCK }); });
    await ctx.route('**/firebase-auth-compat.js', function (r) { r.fulfill({ contentType: 'application/javascript', body: '' }); });
    await ctx.route('**/firebase-database-compat.js', function (r) { r.fulfill({ contentType: 'application/javascript', body: '' }); });
    var pg = await ctx.newPage();
    pg.on('pageerror', function (e) { errs.push(uid + ' pageerror ' + e.message); });
    pg.on('console', function (m) { if (m.type() === 'error') { errs.push(uid + ' console ' + m.text()); } });
    pages.push(pg);
    return pg;
  }
  var nav = async function (pg, url) { await pg.goto('about:blank'); await pg.goto(url); };
  var txt = function (pg, sel) { return pg.$eval(sel, function (e) { return e.textContent; }); };
  var has = async function (pg, sel) { return (await pg.$(sel)) !== null; };
  var tryWrite = function (pg, kind, p, v) {
    return pg.evaluate(function (a) {
      var r = window.firebase.database().ref(a.p), pr = a.kind === 'get' ? r.once('value') : a.kind === 'update' ? r.update(a.v) : r.set(a.v);
      return pr.then(function () { return 'ALLOWED'; }, function (e) { return e.code; });
    }, { kind: kind, p: p, v: v });
  };

  /* 1. no link, no start code */
  var X = await user('uX');
  await X.goto(BASE); await X.waitForSelector('.top h1');
  ok('start page without a link explains itself', (await txt(X, '.top h1')) === 'Open your personal link' && !(await has(X, '#newboard')));

  /* 2. coordinator start link creates a board */
  var M = await user('uM');
  await M.goto(BASE + '#new.' + CODE); await M.waitForSelector('#newboard');
  ok('start link shows the new-board form and hides the code', (await M.evaluate(function () { return location.hash; })) === '');
  ok('coordinator defaults to Marco', (await M.inputValue('#nb-coord')) === 'Marco');
  await M.fill('#nb-title', 'Share purchase closing');
  await M.click('#newboard button[type=submit]');
  await M.waitForSelector('article.person', { timeout: 15000 });
  var hashM = await M.evaluate(function () { return location.hash; });
  var mm = /^#([A-Za-z0-9]{22})\.c\.([A-Za-z0-9]{24})$/.exec(hashM);
  ok('board opens on the coordinator link', !!mm, hashM);
  var P = mm ? mm[1] : '';
  ok('board has Marco plus four people', (await M.$$eval('article.person', function (a) { return a.length; })) === 5);
  ok('title carried over', (await M.inputValue('#plan-title')) === 'Share purchase closing');
  ok('coordinator hint shown', /You are the coordinator/.test(await txt(M, '.hint')));

  /* 3. coordinator fills in */
  await M.fill('#pn-p1', 'Anna Weber'); await M.locator('#pn-p1').blur();
  await M.fill('#pr-p1', 'Buyer'); await M.locator('#pr-p1').blur();
  await M.fill('#pn-p2', 'Jonas Keller'); await M.locator('#pn-p2').blur();
  await M.waitForTimeout(300);
  await M.click('article.t1 button[data-act="add"]'); await M.waitForTimeout(300);
  await M.keyboard.type('Send the signed KYC pack'); await M.keyboard.press('Enter'); await M.waitForTimeout(300);
  var d1 = await M.$eval('article.t1 input[type=date]', function (e) { return e.id; });
  await M.fill('#' + d1, '2026-11-03'); await M.locator('#' + d1).blur(); await M.waitForTimeout(300);
  await M.click('article.t2 button[data-act="add"]'); await M.waitForTimeout(300);
  await M.keyboard.type('Deliver the share transfer form'); await M.keyboard.press('Enter'); await M.waitForTimeout(300);
  var d2 = await M.$eval('article.t2 input[type=date]', function (e) { return e.id; });
  await M.fill('#' + d2, '2026-11-05'); await M.locator('#' + d2).blur(); await M.waitForTimeout(300);
  await M.click('article.t0 button[data-act="add"]'); await M.waitForTimeout(300);
  await M.keyboard.type('Circulate the closing checklist'); await M.keyboard.press('Enter'); await M.waitForTimeout(300);
  var d0 = await M.$eval('article.t0 input[type=date]', function (e) { return e.id; });
  await M.fill('#' + d0, '2026-11-02'); await M.locator('#' + d0).blur(); await M.waitForTimeout(400);
  var stored = db.snapshot('/plans/' + P).val();
  var taskIds = Object.keys(stored.tasks || {});
  ok('three tasks stored with the right owners', taskIds.length === 3 && ['c', 'p1', 'p2'].every(function (o) { return taskIds.some(function (k) { return stored.tasks[k].pid === o; }); }), JSON.stringify(stored.tasks));
  ok('names stored', stored.people.p1.name === 'Anna Weber' && stored.people.p1.role === 'Buyer');
  ok('status counts people with tasks', (await txt(M, '.status h2')) === '0 of 3 committed', await txt(M, '.status h2'));

  /* 4. personal link for Anna */
  await M.click('button[data-act="link"][data-id="p1"]'); await M.waitForTimeout(400);
  var linkA = await M.evaluate(function () { return navigator.clipboard.readText(); });
  var la = new RegExp('^' + BASE.replace(/[.\/]/g, '\\$&') + '#' + P + '\\.p1\\.[A-Za-z0-9]{24}$').test(linkA);
  ok('personal link copied', la, linkA);
  ok('button confirms the copy', /Link copied/.test(await txt(M, 'button[data-act="link"][data-id="p1"]')));
  await M.click('button[data-act="link"][data-id="c"]'); await M.waitForTimeout(300);
  ok('coordinator link copied', (await M.evaluate(function () { return navigator.clipboard.readText(); })) === BASE + hashM);

  /* 5. Anna opens her link, adjusts, signs */
  var A = await user('uA');
  await A.goto(linkA); await A.waitForSelector('article.person', { timeout: 15000 });
  ok('person is greeted by name', /You are Anna Weber/.test(await txt(A, '.hint')), await txt(A, '.hint'));
  ok('person can edit only their own box', (await has(A, 'article.t1 textarea')) && !(await has(A, 'article.t0 textarea')) && !(await has(A, 'article.t2 textarea')) && !(await has(A, '#plan-title')));
  ok('person sees no links or remove buttons', !(await has(A, 'button[data-act="link"]')) && !(await has(A, 'button[data-act="rm"]')) && !(await has(A, 'button[data-act="addp"]')));
  await A.fill('#' + d1, '2026-11-06'); await A.locator('#' + d1).blur(); await A.waitForTimeout(400);
  ok('moved date is flagged', /Anna Weber moved this from/.test(await txt(A, 'article.t1 .when')), await txt(A, 'article.t1 .when'));
  await A.click('article.t1 button[data-act="add"]'); await A.waitForTimeout(300);
  await A.keyboard.type('Provide the source-of-funds letter'); await A.keyboard.press('Enter'); await A.waitForTimeout(300);
  var newDate = await A.$eval('article.t1', function (a) { var i = Array.prototype.filter.call(a.querySelectorAll('input[type=date]'), function (x) { return !x.value; })[0]; return i && i.id; });
  await A.fill('#' + newDate, '2026-11-04'); await A.locator('#' + newDate).blur(); await A.waitForTimeout(400);
  ok('own task is marked as added by the person', /Added by Anna Weber/.test(await txt(A, 'article.t1')));
  await A.fill('#sn-p1', 'Anna Weber'); await A.click('form[data-pid="p1"] button[type=submit]'); await A.waitForTimeout(500);
  ok('person signs', (await txt(A, 'article.t1 .pill')) === 'Committed', await txt(A, 'article.t1 .pill'));
  var sigStored = db.snapshot('/plans/' + P + '/sigs/p1').val();
  ok('sign-off stored with server time', sigStored && sigStored.name === 'Anna Weber' && Math.abs(sigStored.at - Date.now()) < 60000 && sigStored.n === 2, JSON.stringify(sigStored));
  ok('signed box is locked for the person', !(await has(A, 'article.t1 textarea')) && (await has(A, 'button[data-act="withdraw"]')));

  /* 6. coordinator sees it live; a later change voids the sign-off on both screens */
  await M.waitForFunction(function () { var c = document.querySelector('.chip.signed b'); return c && c.textContent === 'Anna Weber'; }, null, { timeout: 5000 }).then(function () { ok('coordinator sees the sign-off without reloading', true); }, function () { ok('coordinator sees the sign-off without reloading', false); });
  ok('coordinator sees the moved date', /Anna Weber moved this from/.test(await txt(M, 'article.t1')));
  await M.fill('#' + d1, '2026-11-09'); await M.locator('#' + d1).blur();
  await A.waitForFunction(function () { var p = document.querySelector('article.t1 .pill'); return p && p.textContent === 'Changed after sign-off'; }, null, { timeout: 5000 }).then(function () { ok('person sees the sign-off voided after the coordinator changed a date', true); }, function () { ok('person sees the sign-off voided after the coordinator changed a date', false); });
  await A.fill('#sn-p1', 'Anna Weber'); await A.click('form[data-pid="p1"] button[type=submit]'); await A.waitForTimeout(500);
  ok('person signs again', (await txt(A, 'article.t1 .pill')) === 'Committed');
  ok('no legitimate write was refused so far', deniedLog.length === 0, JSON.stringify(deniedLog));

  /* 7. attempts that must fail */
  expectDenied = true;
  var fakeSig = { name: 'Jonas Keller', seal: 'AAAA-BBBB', n: 1, at: { '.sv': 'timestamp' } };
  var marcoTask = taskIds.filter(function (k) { return stored.tasks[k].pid === 'c'; })[0], jonasTask = taskIds.filter(function (k) { return stored.tasks[k].pid === 'p2'; })[0];
  ok('person cannot sign for someone else', (await tryWrite(A, 'set', 'plans/' + P + '/sigs/p2', fakeSig)) === 'PERMISSION_DENIED');
  ok('person cannot sign as the coordinator', (await tryWrite(A, 'set', 'plans/' + P + '/sigs/c', fakeSig)) === 'PERMISSION_DENIED');
  ok('person cannot change another person\'s date', (await tryWrite(A, 'set', 'plans/' + P + '/tasks/' + jonasTask + '/due', '2030-01-01')) === 'PERMISSION_DENIED');
  ok('person cannot change the coordinator\'s task', (await tryWrite(A, 'update', 'plans/' + P + '/tasks/' + marcoTask, { title: 'x' })) === 'PERMISSION_DENIED');
  ok('person cannot rename the board', (await tryWrite(A, 'set', 'plans/' + P + '/meta/title', 'x')) === 'PERMISSION_DENIED');
  ok('person cannot read the other links', (await tryWrite(A, 'get', 'keys/' + P)) === 'PERMISSION_DENIED');
  ok('coordinator cannot sign for a person', (await tryWrite(M, 'set', 'plans/' + P + '/sigs/p2', fakeSig)) === 'PERMISSION_DENIED');
  ok('outsider with the board id cannot write', (await tryWrite(X, 'set', 'plans/' + P + '/tasks/' + jonasTask + '/done', true)) === 'PERMISSION_DENIED');
  ok('outsider cannot read the links', (await tryWrite(X, 'get', 'keys/' + P)) === 'PERMISSION_DENIED');
  await nav(X, BASE + '#' + P + '.p2.WRONGtokenWRONGtokenWRONG1'); await X.waitForSelector('.top h1'); await X.waitForTimeout(600);
  ok('a wrong token shows a dead-link page', (await txt(X, '.top h1')) === 'This link does not work', await txt(X, '.top h1'));
  await nav(X, BASE + '#nonsense'); await X.waitForSelector('.top h1');
  ok('a malformed link shows a dead-link page', (await txt(X, '.top h1')) === 'This link does not work');
  expectDenied = false;

  /* 8. coordinator signs, removes a person, adds one */
  await M.fill('#sn-c', 'Marco'); await M.click('form[data-pid="c"] button[type=submit]'); await M.waitForTimeout(500);
  ok('coordinator signs his own box', (await txt(M, 'article.t0 .pill')) === 'Committed');
  await M.click('button[data-act="link"][data-id="p2"]'); await M.waitForTimeout(300);
  var linkB = await M.evaluate(function () { return navigator.clipboard.readText(); });
  await M.click('button[data-act="rm"][data-id="p2"]'); await M.waitForTimeout(200);
  ok('removal asks first', /Remove Jonas Keller and 1 task\?/.test(await txt(M, 'article.t2')));
  await M.click('button[data-act="rm-yes"][data-id="p2"]'); await M.waitForTimeout(500);
  var after = db.snapshot('/plans/' + P).val();
  ok('removed person, their task and link are gone', !after.people.p2 && Object.keys(after.tasks).length === 3 && Object.keys(db.snapshot('/keys/' + P).val()).length === 4, JSON.stringify(Object.keys(after.tasks)));
  expectDenied = true;
  var B = await user('uB');
  await B.goto(linkB); await B.waitForSelector('.top h1'); await B.waitForTimeout(600);
  ok('a removed person\'s link is dead', (await txt(B, '.top h1')) === 'This link does not work', await txt(B, '.top h1'));
  expectDenied = false;
  await M.click('button[data-act="addp"]'); await M.waitForTimeout(500);
  var after2 = db.snapshot('/plans/' + P).val();
  var newPid = Object.keys(after2.people).filter(function (k) { return !/^p[1-4]$/.test(k); })[0];
  ok('added person stored with a link and a free colour', !!newPid && after2.people[newPid].tint === 2 && Object.keys(db.snapshot('/keys/' + P).val()).length === 5, JSON.stringify(after2.people[newPid] || null));
  ok('status headline', (await txt(M, '.status h2')) === 'All 2 committed', await txt(M, '.status h2'));

  /* 9. reload and the board list */
  await M.reload(); await M.waitForSelector('article.person');
  ok('board survives a reload', (await M.inputValue('#plan-title')) === 'Share purchase closing' && (await txt(M, 'article.t0 .pill')) === 'Committed');
  await nav(M, BASE); await M.waitForSelector('.boards');
  ok('start page lists the board for the coordinator', /Share purchase closing/.test(await txt(M, '.boards')));
  await M.click('.boards a'); await M.waitForSelector('article.person', { timeout: 15000 });
  ok('board opens from the list', (await M.$$eval('article.person', function (a) { return a.length; })) === 5);
  await M.screenshot({ path: path.join(SHOTS, 'live-coordinator.png'), fullPage: true });
  await A.screenshot({ path: path.join(SHOTS, 'live-person.png'), fullPage: true });

  /* 10. example view and phone width */
  var E = await user('uE', { viewport: { width: 390, height: 800 }, colorScheme: 'dark' });
  await E.goto(BASE + '?demo'); await E.waitForSelector('article.person');
  ok('example opens with five boxes', (await E.$$eval('article.person', function (a) { return a.length; })) === 5 && /Example data/.test(await txt(E, '.banner')));
  ok('no sideways scrolling on a phone', !(await E.evaluate(function () { return document.documentElement.scrollWidth > window.innerWidth; })));
  await E.screenshot({ path: path.join(SHOTS, 'demo-phone-dark.png'), fullPage: true });
  await A.setViewportSize({ width: 390, height: 800 });
  ok('no sideways scrolling on a phone (live board)', !(await A.evaluate(function () { return document.documentElement.scrollWidth > window.innerWidth; })));

  var unexpected = deniedLog.filter(function (d) { return !d.expected; });
  ok('no legitimate write was refused', unexpected.length === 0, JSON.stringify(unexpected));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));

  var failed = results.filter(function (r) { return !r.ok; });
  console.log((results.length - failed.length) + ' passed, ' + failed.length + ' failed');
  failed.forEach(function (r) { console.log('FAIL: ' + r.label + (r.detail ? '\n      ' + r.detail : '')); });
  await browser.close(); server.close();
  process.exit(failed.length ? 1 : 0);
})().catch(function (e) { console.log('HARNESS ERROR ' + (e && e.stack || e)); results.filter(function (r) { return !r.ok; }).forEach(function (r) { console.log('FAIL: ' + r.label + ' ' + (r.detail || '')); }); console.log('passed so far: ' + results.filter(function (r) { return r.ok; }).length); process.exit(2); });
