// Builds the Realtime Database rules for Commitment Board.
// Usage: node make-rules.js <startCode>   -> writes rules.private.json (real code, paste into the Firebase console, never commit)
//        and ../database.rules.json (placeholder instead of the code, safe to commit)
var fs = require('fs');
var path = require('path');

// Only the plainest regular-expression features are used (no {m,n} counts), with lengths checked separately.
function isId(x) { return "(" + x + ".length >= 20 && " + x + ".length <= 40 && " + x + ".matches(/^[A-Za-z0-9]+$/))"; }   // plan ids and link tokens
function isPid(x) { return "(" + x + " === 'c' || (" + x + ".length <= 13 && " + x + ".matches(/^p[A-Za-z0-9]+$/)))"; }      // 'c' = coordinator, p... = a person
var DATE = "/^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$/";
var SEAL = "/^[0-9A-F][0-9A-F][0-9A-F][0-9A-F]-[0-9A-F][0-9A-F][0-9A-F][0-9A-F]$/";
function blank(x) { return "(!" + x + ".exists() || " + x + ".val() === '')"; }

// The signed-in browser's stored link token for a person slot of this plan.
function claim(pidExpr) { return "root.child('claims').child($plan).child(auth.uid).child(" + pidExpr + ")"; }
// True when the signed-in browser holds a valid personal link for that person.
function holds(pidExpr) {
  return "(" + claim(pidExpr) + ".exists() && root.child('keys').child($plan).child(" + claim(pidExpr) + ".val()).val() === " + pidExpr + ")";
}
var COORD = holds("'c'");

var personTask = "(" +
  // a person adds a task to their own list
  "(!data.exists() && newData.exists() && " + holds("newData.child('pid').val()") +
    " && newData.child('addedBy').val() === newData.child('pid').val() && " + blank("newData.child('baseTitle')") + " && " + blank("newData.child('baseDue')") + ")" +
  " || " +
  // a person changes one of their own tasks, but not who it belongs to or what the coordinator originally set
  "(data.exists() && newData.exists() && " + holds("data.child('pid').val()") +
    " && newData.child('pid').val() === data.child('pid').val() && newData.child('addedBy').val() === data.child('addedBy').val()" +
    " && newData.child('baseTitle').val() === data.child('baseTitle').val() && newData.child('baseDue').val() === data.child('baseDue').val())" +
  " || " +
  // a person removes a task they added themselves
  "(data.exists() && !newData.exists() && " + holds("data.child('pid').val()") + " && data.child('addedBy').val() === data.child('pid').val())" +
")";

function build(createCode) {
  var text = { ".validate": "newData.isString() && newData.val().length <= 300" };
  var date = { ".validate": "newData.isString() && (newData.val() === '' || newData.val().matches(" + DATE + "))" };
  var short = { ".validate": "newData.isString() && newData.val().length <= 80" };
  return { rules: {
    ".read": false,
    ".write": false,
    creators: { "$uid": {
      ".read": "auth != null && auth.uid === $uid",
      ".write": "auth != null && auth.uid === $uid",
      ".validate": "newData.isString() && newData.val().length <= 64"
    } },
    claims: { "$plan": { "$uid": {
      ".read": "auth != null && auth.uid === $uid",
      ".write": "auth != null && auth.uid === $uid",
      "$pid": { ".validate": "newData.isString() && " + isId("newData.val()") + " && " + isPid("$pid") }
    } } },
    keys: { "$plan": {
      ".read": "auth != null && " + COORD,
      "$token": {
        ".read": "auth != null && data.exists() && root.child('claims').child($plan).child(auth.uid).child(data.val()).val() === $token",
        ".write": "auth != null && " + isId("$plan") + " && " + isId("$token") + " && (" + COORD +
          " || (!root.child('plans').child($plan).child('meta').exists() && newData.val() === 'c'" +
          " && root.child('claims').child($plan).child(auth.uid).child('c').val() === $token" +
          " && root.child('creators').child(auth.uid).val() === '" + createCode + "'))",
        ".validate": "newData.isString() && " + isPid("newData.val()")
      }
    } },
    plans: { "$plan": {
      ".read": "auth != null && " + isId("$plan"),
      meta: {
        ".write": "auth != null && " + COORD,
        ".validate": "newData.hasChildren(['coordinator', 'createdAt'])",
        title: { ".validate": "newData.isString() && newData.val().length <= 200" },
        coordinator: { ".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 80" },
        createdAt: { ".validate": "newData.isNumber()" },
        "$other": { ".validate": false }
      },
      people: { "$pid": {
        ".write": "auth != null && " + COORD,
        ".validate": "$pid.length <= 13 && $pid.matches(/^p[A-Za-z0-9]+$/) && newData.hasChildren(['tint', 'order'])",
        name: short,
        role: short,
        tint: { ".validate": "newData.isNumber() && newData.val() >= 1 && newData.val() <= 6" },
        order: { ".validate": "newData.isNumber()" },
        "$other": { ".validate": false }
      } },
      tasks: { "$tid": {
        ".write": "auth != null && (" + COORD + " || " + personTask + ")",
        ".validate": "$tid.length <= 17 && $tid.matches(/^t[A-Za-z0-9]+$/) && newData.hasChildren(['pid', 'addedBy', 'done', 'at'])",
        pid: { ".validate": "newData.isString() && (newData.val() === 'c' || root.child('plans').child($plan).child('people').child(newData.val()).exists())" },
        title: text,
        due: date,
        baseTitle: text,
        baseDue: date,
        addedBy: { ".validate": "newData.isString() && " + isPid("newData.val()") },
        done: { ".validate": "newData.isBoolean()" },
        at: { ".validate": "newData.isNumber()" },
        "$other": { ".validate": false }
      } },
      sigs: { "$pid": {
        // only the holder of that person's link can sign; the coordinator may only clear a sign-off
        ".write": "auth != null && (" + holds("$pid") + " || (" + COORD + " && !newData.exists()))",
        ".validate": "($pid === 'c' || root.child('plans').child($plan).child('people').child($pid).exists()) && newData.hasChildren(['name', 'at', 'seal', 'n'])",
        name: { ".validate": "newData.isString() && newData.val().length >= 2 && newData.val().length <= 80" },
        at: { ".validate": "newData.isNumber() && newData.val() <= now && newData.val() > now - 120000" },
        seal: { ".validate": "newData.isString() && newData.val().matches(" + SEAL + ")" },
        n: { ".validate": "newData.isNumber() && newData.val() >= 1 && newData.val() <= 200" },
        "$other": { ".validate": false }
      } },
      "$other": { ".validate": false }
    } }
  } };
}

module.exports = build;

if (require.main === module) {
  var code = process.argv[2];
  if (!code) { console.error('usage: node make-rules.js <createCode>'); process.exit(1); }
  fs.writeFileSync(path.join(__dirname, 'rules.private.json'), JSON.stringify(build(code), null, 2) + '\n');
  fs.writeFileSync(path.join(__dirname, '..', 'database.rules.json'), JSON.stringify(build('CREATE_CODE_IS_SET_ONLY_IN_THE_FIREBASE_CONSOLE'), null, 2) + '\n');
  console.log('rules written');
}
