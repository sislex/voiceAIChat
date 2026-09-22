# Account usage report isolation

Date: 2026-09-22.

Production acceptance of the completed owner extraction exposed the remaining
26-second account usage report. Its shared database lane delayed login and tool
RPCs even while readiness checks were green. PostgreSQL now materializes messages
filtered by user and period before decoding metadata for price/usage aggregates.
The four report views retain their existing output and conversation selector rules.

The regression covers foreign accounts, inclusive dates, empty accounts, selected
conversations, price completeness and interrupted turns on SQLite and PostgreSQL.
Read-only production probes measured all four empty-account queries in 15 ms total
and the largest account's monthly queries in 3,438 ms total. Source checks and
release acceptance are recorded with the follow-up release in deploy.md.
