# Web Reader: ten improvement cycles

Scope: ten cycles, each with ten concrete improvements, tests, KB updates, a
pushed branch, a pull request, and a merge into main. Each cycle's proposal is
written before implementation. Existing audit work is preserved.

| Cycle | Focus | State | PR |
| --- | --- | --- | --- |
| 01 | Store lifecycle and asynchronous failures | Merged, 10/10 | #141 |
| 02 | Host bridge command lifecycle | Merged, 10/10 | #143 |
| 03 | Host frame navigation and save recovery | Merged, 10/10 | #144 |
| 04 | Assistant action history usability | Merged, 10/10 | #145 |
| 05 | Address entry and navigation feedback | Merged, 10/10 | #147 |
| 06 | Scenario editing | Merged, 10/10 | #149 |
| 07 | Scenario portability and export | Merged, 10/10 | #151 |
| 08 | Playback validation and lifecycle | Implemented, 10/10 | |
| 09 | Reader diagnostics and recovery | Planned | |
| 10 | Final integration and regression gaps | Planned | |

## Cycle 01 proposal

1. Separate list and activation generations.
2. Keep only the latest list response.
3. Handle conversation lookup rejection.
4. Handle project URL lookup rejection.
5. Skip project lookup for explicit conversation URLs.
6. Clear old activation errors.
7. Apply initial recorder state.
8. Unsubscribe from the old recorder before disposal.
9. Ignore late recorder events, including switching away and back to the same ID.
10. Contain rejected recorder actions and suppress results from old activations.

## Cycle 02 proposal

1. Validate incoming actions.
2. Snapshot queued actions.
3. Cap pending requests at 64.
4. Make request IDs unique even with repeated injected IDs.
5. Normalize invalid and excessive timeouts.
6. Suppress deferred navigation after open expires.
7. Ignore results for unsent commands.
8. Restore active diagnostics after reboot.
9. Do not advertise registration after mode restoration fails.
10. Keep unchanged approved URLs from restarting loading.

## Cycle 03 proposal

1. Catch synchronous preview preparation errors.
2. Bound host preview preparation.
3. Bound model preview preparation.
4. Cancel preparation on unmount.
5. Prevent stale model opens from saving over newer navigation.
6. Show pending address saves.
7. Suppress superseded save errors.
8. Clear retry state when a new save succeeds.
9. Reset save errors between conversations.
10. Make the unprepared iframe inert and remove its tab stop.

## Cycle 04 proposal

1. Collapsible history.
2. Total action count.
3. Action-label search.
4. Page-title and site search.
5. No-match feedback.
6. Clear search with button or Escape.
7. Recorded page titles.
8. Site labels without query/credentials.
9. Distinct accessible repeat controls.
10. Reset controls on conversation switch and wrap long labels.

## Cycle 05 proposal

1. Bare IPv4 loopback HTTP inference.
2. Private IPv4 HTTP inference.
3. Bracketed IPv6 loopback HTTP inference.
4. Localhost subdomain HTTP inference.
5. Scheme-relative URL inheritance.
6. Explicit 443 HTTPS inference.
7. Address-field validation feedback.
8. Escape restores the current URL.
9. Ctrl/Cmd+L selects the Reader address.
10. Clear-page action persists the cleared state.

## Cycle 06 proposal

1. Add click steps manually.
2. Add text steps manually.
3. Duplicate a step.
4. Switch action kind without incompatible fields.
5. Edit Enter submission.
6. Show step numbers and count.
7. Undo edits with bounded history.
8. Redo edits.
9. Flag missing selectors and disable invalid playback/export.
10. Clear temporary secrets when targets change.

## Cycle 07 proposal

1. Export versioned JSON scenario files.
2. Import JSON files.
3. Reject unsupported formats and versions.
4. Report the exact malformed step.
5. Limit file size by UTF-8 bytes.
6. Reject empty or oversized step lists.
7. Redact marked secret values during import and export.
8. Preview source URL and step count.
9. Apply imported steps explicitly to the current page.
10. Cancel import and retry the same file without mutation.

## Cycle 08 proposal

1. Validate the scenario list at runtime.
2. Reject malformed or unsupported steps.
3. Enforce the count limit before traversing steps.
4. Reject non-string secret values.
5. Keep request IDs unique with repeated ID factories.
6. Normalize invalid timeouts.
7. Cap excessive timeouts at two minutes.
8. Bound settling delays below the timeout.
9. Ignore malformed outcomes.
10. Contain progress-listener exceptions.
