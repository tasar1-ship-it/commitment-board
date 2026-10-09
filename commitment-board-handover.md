# Commitment Board - handover

A coordinator (Marco) lists the tasks and due dates of each person in a financial transaction. Each person opens a personal link, reviews and adjusts their own tasks, and signs off. The sign-off is a personal commitment, not a legal act.

## Current version
- App 1.0.0 (9 Oct 2026). First build of the standalone version. It replaces the Claude artifact of the same day, which needed Claude accounts.
- Repo: tasar1-ship-it/commitment-board, live at https://tasar1-ship-it.github.io/commitment-board/
- Example view: https://tasar1-ship-it.github.io/commitment-board/?demo (in-memory sample, nothing saved, with a "View as" switch)
- Firebase project: commitment-board (ID commitment-board-290f6), Realtime Database commitment-board-290f6-default-rtdb in europe-west1, Anonymous sign-in on, web app "Commitment Board" registered. Gemini and Google Analytics switched off.

## Files
- index.html - the whole app (inline CSS and JS, own code is ES5 only). The Firebase web config is written into it; that config is public by design, access is decided by the rules.
- firebase-app-compat.js, firebase-auth-compat.js, firebase-database-compat.js - Firebase compat SDK 9.23.0, vendored from npm (no CDN), byte-identical to the copies in lukas-logbook.
- database.rules.json - the rules as published, except for the start code, which is replaced by a placeholder here.
- tools/ - make-rules.js builds the rules; test-rules.js checks them (100 cases); e2e.js runs the real page against the rules with a stand-in for Firebase (51 checks). Run `npm install targaryen playwright` in tools/ first.
- No service worker and no manifest, on purpose: the board needs the network anyway, people open it from a link a few times, and a stale cache is the usual failure of this app family. Nothing to bump on deploy.

## Links
- Start link (coordinator only): `.../commitment-board/#new.<start code>`. Opening it stores the code on that device and shows "New board". The code is not in this repo. It lives in the published rules in the Firebase console (search for `creators`) and in the start link Ronald holds.
- Board link: `.../commitment-board/#<board id>.<person>.<token>`. Person is `c` for the coordinator or `p...` for a person. Whoever holds a link acts as that person.
- The coordinator copies each person's link from that person's box ("Copy personal link") and his own from the foot of the page.

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
- localStorage prefix: cb1_ (code, boards)

## Security
- Anonymous sign-in gives each browser an id. A browser proves it holds a link by storing the token under its own claims path; the rules look the token up in keys.
- Only the holder of a person's link can sign for that person. The coordinator cannot sign for others; he can only clear a sign-off (used when removing a person).
- A person can change only their own tasks, cannot touch baseTitle/baseDue, and can delete only tasks they added.
- Anyone signed in who knows a board id can read that board (the id is in every link). Board ids are 22 random characters and boards cannot be listed.
- New boards need the start code. To change it: edit the quoted code in the rules in the console and publish; hand out the new start link.
- A browser cannot delete a whole board. To remove one, delete plans/<board id>, keys/<board id> and claims/<board id> in the Firebase console.

## Known limits
- No notifications: nobody is told when someone signs or changes a date; the coordinator has to look.
- If a person's link leaks, the only remedy is to remove that person and add them again (new link).
- The coordinator's link is the master key of a board. Lost on all devices, it can only be read out of keys/<board id> in the console.
- English only. Dates are shown in day-month order.

## Last change
- 1.0.0: first build.
