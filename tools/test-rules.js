// Scenario tests for the Commitment Board database rules (run: node test-rules.js)
var targaryen = require('targaryen');
var build = require('./make-rules.js');

var CODE = 'TestCreateCode1234567890';
var rules = build(CODE);
var NOW = 1791540000000;
var P = 'PLANplanPLANplanPLAN12', P2 = 'OTHERplanOTHERplan1234';
var TC = 'TOKcoordTOKcoordTOKcoord', T1 = 'TOKp1TOKp1TOKp1TOKp1TOK1', T2 = 'TOKp2TOKp2TOKp2TOKp2TOK2', TX = 'TOKpxTOKpxTOKpxTOKpxTOKx';
var M = { uid: 'uM' }, A = { uid: 'uA' }, B = { uid: 'uB' }, X = { uid: 'uX' }, N = { uid: 'uN' }, Z = { uid: 'uZ' };

var db = targaryen.database(rules, {}, NOW);
var pass = 0, fail = 0, failures = [];

function check(label, res, want) {
  if (res.allowed === want) { pass++; }
  else { fail++; failures.push(label + ' -> expected ' + (want ? 'ALLOW' : 'DENY') + ', got ' + (res.allowed ? 'ALLOW' : 'DENY') + '\n' + String(res.info).split('\n').slice(0, 14).join('\n')); }
  if (res.allowed && want && res.newDatabase) { db = res.newDatabase; }
}
function actor(auth) { return (auth ? db.as(auth) : targaryen.database(rules, db.root, NOW)).with({ debug: true }); }
function W(label, auth, path, value, want) { check(label, actor(auth).write(path, value, { now: NOW }), want); }
function U(label, auth, patch, want) { check(label, actor(auth).update('/', patch, { now: NOW }), want); }
function R(label, auth, path, want) { check(label, actor(auth).read(path, { now: NOW }), want); }
function task(pid, addedBy, o) {
  var t = { pid: pid, title: 'Send the KYC pack', due: '2026-10-14', baseTitle: 'Send the KYC pack', baseDue: '2026-10-14', addedBy: addedBy, done: false, at: 1 };
  if (addedBy !== 'c') { t.baseTitle = ''; t.baseDue = ''; }
  for (var k in (o || {})) { t[k] = o[k]; }
  return t;
}
function sig(o) { var s = { name: 'Anna Weber', at: NOW, seal: '1B56-7FBB', n: 2 }; for (var k in (o || {})) { s[k] = o[k]; } return s; }

/* ---- 1. creating a board ---- */
W('creator stores the start code', M, 'creators/uM', CODE, true);
W('creator cannot store a code for someone else', M, 'creators/uA', CODE, false);
W('coordinator claims their link', M, 'claims/' + P + '/uM/c', TC, true);
W('no person key before the coordinator key exists', M, 'keys/' + P + '/' + T1, 'p1', false);
W('wrong start code: stored', N, 'creators/uN', 'wrong-code', true);
W('wrong start code: claim', N, 'claims/' + P2 + '/uN/c', TX, true);
W('wrong start code: cannot open a board', N, 'keys/' + P2 + '/' + TX, 'c', false);
W('no start code at all: cannot open a board', X, 'keys/' + P2 + '/' + TX, 'c', false);
W('coordinator key must match the claimed token', M, 'keys/' + P + '/' + T2, 'c', false);
W('short plan id refused', M, 'keys/short/' + TC, 'c', false);
W('coordinator key created with the right code', M, 'keys/' + P + '/' + TC, 'c', true);
var boot = {};
boot['plans/' + P + '/meta'] = { title: '', coordinator: 'Marco', createdAt: NOW };
boot['plans/' + P + '/people/p1'] = { name: '', role: '', tint: 1, order: 1 };
boot['plans/' + P + '/people/p2'] = { name: '', role: '', tint: 2, order: 2 };
boot['keys/' + P + '/' + T1] = 'p1';
boot['keys/' + P + '/' + T2] = 'p2';
U('coordinator sets up the board, people and links', M, boot, true);
W('second creator: code', Z, 'creators/uZ', CODE, true);
W('second creator: claim on an existing board', Z, 'claims/' + P + '/uZ/c', TX, true);
W('second creator cannot take over an existing board', Z, 'keys/' + P + '/' + TX, 'c', false);

/* ---- 2. reading ---- */
R('signed-out cannot read a board', null, 'plans/' + P, false);
W('signed-out cannot write a task', null, 'plans/' + P + '/tasks/t8', task('p1', 'p1'), false);
W('signed-out cannot store a claim', null, 'claims/' + P + '/uA/p1', T1, false);
R('anyone signed in with the board id can read the board', X, 'plans/' + P, true);
R('nobody can list all boards', X, 'plans', false);
R('nobody can list all boards (coordinator)', M, 'plans', false);
R('outsider cannot list the links', X, 'keys/' + P, false);
R('outsider cannot read a link', X, 'keys/' + P + '/' + T1, false);
R('outsider cannot read someone else\'s claim', X, 'claims/' + P + '/uM', false);
R('coordinator can list the links', M, 'keys/' + P, true);
W('person claims their link', A, 'claims/' + P + '/uA/p1', T1, true);
W('person cannot write a claim for another browser', A, 'claims/' + P + '/uB/p1', T1, false);
W('claim must look like a token', A, 'claims/' + P + '/uA/p9', 'x', false);
R('person can check their own link', A, 'keys/' + P + '/' + T1, true);
R('person cannot read another person\'s link', A, 'keys/' + P + '/' + T2, false);
R('person cannot list the links', A, 'keys/' + P, false);
R('root is closed', M, '/', false);
W('second person claims their link', B, 'claims/' + P + '/uB/p2', T2, true);

/* ---- 3. coordinator edits ---- */
W('coordinator renames the board', M, 'plans/' + P + '/meta/title', 'Share purchase closing', true);
W('person cannot rename the board', A, 'plans/' + P + '/meta/title', 'Hacked', false);
W('outsider cannot rename the board', X, 'plans/' + P + '/meta/title', 'Hacked', false);
W('coordinator names a person', M, 'plans/' + P + '/people/p1/name', 'Anna Weber', true);
W('person cannot rename people', A, 'plans/' + P + '/people/p1/name', 'Someone', false);
W('coordinator adds a task for p1', M, 'plans/' + P + '/tasks/t1', task('p1', 'c'), true);
W('coordinator adds a task for p2', M, 'plans/' + P + '/tasks/t3', task('p2', 'c'), true);
W('coordinator adds their own task', M, 'plans/' + P + '/tasks/tc1', task('c', 'c'), true);
W('task for a person who does not exist', M, 'plans/' + P + '/tasks/t9', task('p7', 'c'), false);
W('title too long', M, 'plans/' + P + '/tasks/t9', task('p1', 'c', { title: new Array(302).join('x') }), false);
W('bad date', M, 'plans/' + P + '/tasks/t9', task('p1', 'c', { due: '14.10.2026' }), false);
W('done must be true or false', M, 'plans/' + P + '/tasks/t9', task('p1', 'c', { done: 'yes' }), false);
W('unknown field refused', M, 'plans/' + P + '/tasks/t9', task('p1', 'c', { extra: 1 }), false);
W('empty date allowed', M, 'plans/' + P + '/tasks/t4', task('p1', 'c', { due: '', baseDue: '' }), true);

/* ---- 4. a person edits ---- */
W('person moves their own date', A, 'plans/' + P + '/tasks/t1/due', '2026-10-16', true);
W('person rewords their own task', A, 'plans/' + P + '/tasks/t1/title', 'Send the signed KYC pack', true);
W('person ticks their own task', A, 'plans/' + P + '/tasks/t1/done', true, true);
W('person cannot rewrite the coordinator\'s original date', A, 'plans/' + P + '/tasks/t1/baseDue', '2026-10-16', false);
W('person cannot rewrite the coordinator\'s original wording', A, 'plans/' + P + '/tasks/t1/baseTitle', 'x', false);
W('person cannot hand their task to someone else', A, 'plans/' + P + '/tasks/t1/pid', 'p2', false);
W('person cannot delete a task the coordinator set', A, 'plans/' + P + '/tasks/t1', null, false);
W('person adds their own task', A, 'plans/' + P + '/tasks/t2', task('p1', 'p1'), true);
W('person removes a task they added', A, 'plans/' + P + '/tasks/t2', null, true);
W('person adds their own task again', A, 'plans/' + P + '/tasks/t2', task('p1', 'p1'), true);
W('person cannot add a task marked as the coordinator\'s', A, 'plans/' + P + '/tasks/t5', task('p1', 'c'), false);
W('person cannot add a task for someone else', A, 'plans/' + P + '/tasks/t5', task('p2', 'p2'), false);
W('person cannot add a task for the coordinator', A, 'plans/' + P + '/tasks/t5', task('c', 'c'), false);
W('person cannot change another person\'s task', A, 'plans/' + P + '/tasks/t3/due', '2027-01-01', false);
W('person cannot tick another person\'s task', A, 'plans/' + P + '/tasks/t3/done', true, false);
W('person cannot change the coordinator\'s task', A, 'plans/' + P + '/tasks/tc1/due', '2027-01-01', false);
W('outsider cannot add a task', X, 'plans/' + P + '/tasks/t6', task('p1', 'p1'), false);
W('outsider cannot change a task', X, 'plans/' + P + '/tasks/t1/done', false, false);
W('made-up claim: stored', X, 'claims/' + P + '/uX/p2', 'WRONGtokenWRONGtoken12', true);
W('made-up claim does not let anyone edit', X, 'plans/' + P + '/tasks/t3/due', '2027-01-01', false);
W('claiming p2 with p1\'s token: stored', A, 'claims/' + P + '/uA/p2', T1, true);
W('p1\'s token does not work for p2', A, 'plans/' + P + '/tasks/t3/due', '2027-01-01', false);
W('coordinator can still change any task', M, 'plans/' + P + '/tasks/t1/baseDue', '2026-10-16', true);

/* ---- 5. sign-offs ---- */
W('person signs their own commitment', A, 'plans/' + P + '/sigs/p1', sig(), true);
W('person cannot sign for someone else', A, 'plans/' + P + '/sigs/p2', sig({ name: 'Jonas Keller' }), false);
W('coordinator cannot sign for a person', M, 'plans/' + P + '/sigs/p2', sig({ name: 'Jonas Keller' }), false);
W('coordinator cannot overwrite a person\'s sign-off', M, 'plans/' + P + '/sigs/p1', sig({ name: 'Anna Weber', seal: 'AAAA-BBBB' }), false);
W('outsider cannot sign', X, 'plans/' + P + '/sigs/p1', sig(), false);
W('coordinator signs their own commitment', M, 'plans/' + P + '/sigs/c', sig({ name: 'Marco' }), true);
W('second person signs', B, 'plans/' + P + '/sigs/p2', sig({ name: 'Jonas Keller' }), true);
W('back-dated sign-off refused', A, 'plans/' + P + '/sigs/p1', sig({ at: NOW - 600000 }), false);
W('future-dated sign-off refused', A, 'plans/' + P + '/sigs/p1', sig({ at: NOW + 600000 }), false);
W('bad seal refused', A, 'plans/' + P + '/sigs/p1', sig({ seal: 'nope' }), false);
W('one-letter name refused', A, 'plans/' + P + '/sigs/p1', sig({ name: 'A' }), false);
W('extra field refused', A, 'plans/' + P + '/sigs/p1', sig({ note: 'x' }), false);
W('sign-off for a person who does not exist', M, 'plans/' + P + '/sigs/p7', sig(), false);
W('another person cannot clear a sign-off', B, 'plans/' + P + '/sigs/p1', null, false);
W('person withdraws their own sign-off', A, 'plans/' + P + '/sigs/p1', null, true);
W('person signs again', A, 'plans/' + P + '/sigs/p1', sig(), true);
W('coordinator may clear a sign-off', M, 'plans/' + P + '/sigs/p1', null, true);
W('person signs once more', A, 'plans/' + P + '/sigs/p1', sig(), true);

/* ---- 6. adding and removing people ---- */
var add = {};
add['plans/' + P + '/people/pNew1'] = { name: 'Peter Lang', role: 'Tax adviser', tint: 3, order: 3 };
add['keys/' + P + '/' + TX] = 'pNew1';
U('coordinator adds a person and their link', M, add, true);
W('person cannot create links', A, 'keys/' + P + '/NEWtokenNEWtokenNEWtok1', 'p2', false);
W('person cannot add people', A, 'plans/' + P + '/people/pEvil', { name: 'x', role: '', tint: 1, order: 9 }, false);
var rm = {};
rm['plans/' + P + '/people/p2'] = null;
rm['plans/' + P + '/sigs/p2'] = null;
rm['plans/' + P + '/tasks/t3'] = null;
rm['keys/' + P + '/' + T2] = null;
U('person cannot remove people', A, rm, false);
U('coordinator removes a person, their tasks, sign-off and link', M, rm, true);
W('a removed person\'s link no longer works', B, 'plans/' + P + '/tasks/t7', task('p2', 'p2'), false);
R('a removed person\'s link no longer checks out', B, 'keys/' + P + '/' + T2, false);

/* ---- 7. structure ---- */
W('nothing else can be stored under a board', M, 'plans/' + P + '/notes', 'x', false);
W('a board cannot be deleted from a browser', M, 'plans/' + P, null, false);
W('root cannot be written', M, '/', { x: 1 }, false);
W('the start code area is closed', M, 'config/createCode', 'x', false);
R('a browser cannot read another browser\'s start code', A, 'creators/uM', false);

console.log(pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\n' + failures.join('\n\n')); process.exit(1); }
