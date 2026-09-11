# Web Reader: ten improvement cycles

Scope: ten cycles, each with ten concrete improvements, tests, KB updates, a
pushed branch, a pull request, and a merge into main. Each cycle's proposal is
written before implementation. Existing audit work is preserved.

| Cycle | Focus | State | PR |
| --- | --- | --- | --- |
| 01 | Store lifecycle and asynchronous failures | Merged, 10/10 | #141 |
| 02 | Host bridge command lifecycle | Implemented, 10/10 | |
| 03 | Host frame navigation and save recovery | Planned | |
| 04 | Assistant action history usability | Planned | |
| 05 | Address entry and navigation feedback | Planned | |
| 06 | Recorder scenario editing | Planned | |
| 07 | Scenario portability and export | Planned | |
| 08 | Recorder status and keyboard interaction | Planned | |
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
