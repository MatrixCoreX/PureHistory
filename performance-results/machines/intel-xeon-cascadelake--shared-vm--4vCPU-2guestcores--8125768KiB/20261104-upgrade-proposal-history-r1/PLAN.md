# Native proposal history in explorer — 2026-11-04

User explicitly requires historical proposals. Preserve latest native state panel, add actual prior proposals from irreversible canonical native devpropose/devveto/devexec/devcancel actions in the current chain. Derive IDs only with complete native counter/index coverage or independent canonical proof; verify chain identity, root action ordering, uniqueness and status. Never infer execution from code-hash matching or invent old frozen electorates/deadlines. Historical executed/cancelled states require actual successful native action receipts; latest effective veto state remains native RPC. Missing/incomplete/failed index reads remain labeled unknown/errors, without browser-local persistence pretending to be chain history.

Use existing history backend/index and read-only static frontend, bounded queries/pagination and bilingual/theme/mobile UI. Test/build/browser only on owned remote host, no chain pause/reset/new server/TPS or keys in artifacts. Preserve public core/private explorer repository visibility; full frontend sources remain private. Complete source/evidence/Git and inactive-work cleanup. Initial status: source/API discovery; no history code edits yet.


Completed: remotebackend21/frontend257+translation9/build; actual3canonicalproposals/24vetoes/2executions; publicAPI/pagination/4preview+4publicChrome; staticpublication/36pxnav/protected26nodeaudit and verifiedcleanup. No chain/node/indexer reset/restart, newserver orTPS. Source/evidence archives verified and visibility scoped.
