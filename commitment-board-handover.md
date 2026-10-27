# Commitment Board - handover

A coordinator (Marco) lists the tasks and due dates of each person in a financial transaction. Each person opens a personal link, reviews and adjusts their own tasks, and signs off. The sign-off is a personal commitment, not a legal act.

## Current version
- App 1.1.0 (27 Oct 2026). Standalone version; 1.0.0 replaced the Claude artifact of 9 Oct 2026, which needed Claude accounts.
- 1.1.0 keeps the data layout, link format and rules of 1.0.x, so every board and link made before it keeps working and the memo to Marco of 9 Oct stays valid.
- Repo: tasar1-ship-it/commitment-board, live at https://tasar1-ship-it.github.io/commitment-board/
- Example view: https://tasar1-ship-it.github.io/commitment-board/?demo (in-memory sample, nothing saved, with a "View as" switch)
- Firebase project: commitment-board (ID commitment-board-290f6), Realtime Database commitment-board-290f6-default-rtdb in europe-west1, Anonymous sign-in on, web app "Commitment Board" registered. Gemini and Google Analytics switched off.

## Files
- index.html - the whole app (inline CSS and JS, own code is ES5 only). The Firebase web config is written into it; that config is public by design, access is decided by the rules.
- firebase-app-compat.js, firebase-auth-compat.js, firebase-database-compat.js - Firebase compat SDK 9.23.0, vendored from npm (no CDN), byte-identical to the copies in lukas-logbook.
- database.rules.json - the rules as published, except for the start code, which is replaced by a placeholder here.
- tools/ - make-rules.js builds the rules; test-rules.js checks them (100 cases); e2e.js runs the real page against the rules with a stand-in for Firebase (73 checks). check-es5.js parses the page's own script as ES5. `ENGINE=webkit node e2e.js` runs the same checks in WebKit (Safari's engine; needs `npx playwright install webkit`, 296 MB). live-e2e.js runs the local index.html against the REAL database and rules (22 checks), served under the github.io address by Playwright so nothing has to be deployed first; it creates one board "LIVE TEST - delete me", prints its coordinator link, and deletes everything it wrote plus its anonymous sign-ins at the end. It reads the start code from tools/create-code.txt (gitignored). Run `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install targaryen playwright@1.63 acorn` in tools/ first; Playwright 1.63 uses the Chromium 1243 already in ~/Library/Caches/ms-playwright, so nothing is downloaded or removed.
- No service worker and no manifest, on purpose: the board needs the network anyway, people open it from a link a few times, and a stale cache is the usual failure of this app family. Nothing to bump on deploy.

## Links
- Start link (coordinator only): `.../commitment-board/#new.<start code>`. Opening it stores the code on that device and shows "New board". The code is not in this repo. It lives in the published rules in the Firebase console (search for `creators`) and in the start link Ronald holds.
- Board link: `.../commitment-board/#<board id>.<person>.<token>`. Person is `c` for the coordinator or `p...` for a person. Whoever holds a link acts as that person.
- The coordinator copies each person's link from that person's box ("Copy personal link") and his own from the foot of the page.
- "Replace link" in a person's box (coordinator only) deletes that person's token and writes a new one in one update. The old link then shows "This link does not work" and can no longer change or sign anything; the person's tasks and sign-off stay. No rules change was needed: the coordinator could already write and delete keys.

## Data
- plans/<board id>/meta {title, coordinator, createdAt}
- plans/<board id>/people/<person> {name, role, tint 1-6, order}
- plans/<board id>/tasks/<task id> {pid, title, due YYYY-MM-DD or "", baseTitle, baseDue, addedBy, done, at}
  baseTitle and baseDue hold what the coordinator last set; a difference shows as "moved this from" or "Reworded by".
- plans/<board id>/sigs/<person> {name, at (server time), seal, n}
- keys/<board id>/<token> = person. Readable only by the coordinator, or by the holder of that token.
- claims/<board id>/<browser uid>/<person> = token. Private to that browser.
- creators/<browser uid> = start code. Private to that browser.
- Seal: 8 hex characters calculated from the sorted "title|due" lines of a person's tasks. A sign-off counts only while its seal matches the current tasks.
- localStorage prefix: cb1_ (code, boards, view, seen.<board id>.<person>)
- seen.<board id>.<person> is the snapshot behind "N changes since ...": {at, t: {task id: [pid, title, due, done]}, s: {pid: seal}, p: {pid: name}}. It is saved when the page is hidden or left, and by "Mark as seen". Your own edits are written into it as you make them, so only other people's changes are listed. It lives on one device only; a first visit on a device shows no changes.

## Security
- Anonymous sign-in gives each browser an id. A browser proves it holds a link by storing the token under its own claims path; the rules look the token up in keys.
- Only the holder of a person's link can sign for that person. The coordinator cannot sign for others; he can only clear a sign-off (used when removing a person).
- A person can change only their own tasks, cannot touch baseTitle/baseDue, and can delete only tasks they added.
- Anyone signed in who knows a board id can read that board (the id is in every link). Board ids are 22 random characters and boards cannot be listed.
- New boards need the start code. To change it: edit the quoted code in the rules in the console and publish; hand out the new start link.
- A browser cannot delete a whole board. To remove one, delete plans/<board id>, keys/<board id> and claims/<board id> in the Firebase console.

## Known limits
- No notifications: nobody is told when someone signs or changes a date. Since 1.1.0 the board lists what changed since your last visit on that device, but the coordinator still has to open it.
- The changes list compares two snapshots, so it says what changed, not who changed it (a person's date can be moved by that person or by the coordinator).
- If a person's link leaks, "Replace link" kills it (1.1.0). The board id inside the old link still allows reading the board through the raw database API, because any signed-in browser that knows a board id can read it; the page itself refuses the old link. The coordinator's own link cannot be replaced from the page.
- The coordinator's link is the master key of a board. Lost on all devices, it can only be read out of keys/<board id> in the console.
- English only. Dates are shown in day-month order.

## Tested (27 Oct 2026, 1.1.0)
- Local: rules 100 cases (rules unchanged), page against rules 73 checks (51 from 1.0.x plus 22 for the changes list, timeline and replace link), own script parses as ES5 with no modern-syntax hits. Screenshots in tools/shots (gitignored).
- WebKit (Playwright WebKit 26.6): the same 73 checks pass; the clipboard is a stand-in there because WebKit has no clipboard permission.
- Live database: live-e2e.js passed 22 of 22 in Chromium and in WebKit (create, fill, person moves a date, adds a task and signs, changes card, timeline, three rule refusals, Replace link, old link dead, new link works, full cleanup). A fresh sign-in afterwards confirmed those boards are gone.
- Leftover from a crashed run (board gYqxhLPoPHMadsfgeDpPAQ, its keys, claims, creators entry and three anonymous users) was removed by hand in the Firebase console on 27 Oct 2026. Checked afterwards: the database then held only board tHqQJMdPZ2zkgo9K4sNAvC (coordinator "Marco", untitled, created 9 Oct 2026) and its keys, claims and creators entry, and Authentication held only that board's anonymous user oP4anPawu5fLVArYMk5NaNITW6u2. None of that was touched.
- Not tested: real Safari (only its engine), an iPhone or iPad (Ronald: Mac only).

## Tested (9 Oct 2026)
- Local: rules 100 cases, page against rules 51 checks, own script parses as ES5.
- Live: 63 rule cases against the real database from three separate anonymous sign-ins; one board created, filled, signed and voided through the live page in two tabs. All test data and test sign-ins were removed afterwards.
- Not tested: a real iPhone or iPad, two people on different devices at the same moment, Safari.

## Last change
- 1.1.0: changes since your last visit (card at the top plus New / Updated tags on tasks), a Timeline view of all tasks in date order with Open / Overdue / Next 7 days / All filters, and Replace link for a leaked personal link. The example (?demo) shows a last visit two days ago with four changes.
- 1.0.1: the board title keeps its size on phones (a phone-only rule had shrunk it to 16 px).
- 1.0.0: first build.
