# U10 candidate preflight — blocked

The assigned delivery-control input set is recorded in `u10-owner-inputs.json`.
These are candidate input pins, not installed dependencies or acceptance evidence.
The active package pins have deliberately not been replaced with an incomplete
composition. U10 implementation and host/resource/transport acceptance are not complete.

Run `npm run verify:shared-chat-inputs -- <assigned-artifact-directory>` after
`npm ci`. Without an argument it uses
`$DELIVERY_ATTEMPT_ROOT/dependencies/s2-artifacts`. The read-only preflight checks
archive SHA-256, package identity, release provenance, all nine required inputs,
Desktop's embedded Core UI identity and declared first-party peer compatibility.
It never downloads dependencies, installs candidates, starts services or deploys.
Passing this preflight is necessary but insufficient for acceptance.

## Missing compatible inputs

The supplied Make 1.2.1 and Web Reader 1.2.1 both declare:

| Dependency | Required | Assigned checkout |
| --- | --- | --- |
| `@sislexa/chat-ui` | `0.2.0` | No artifact or package pin |
| `@voicechat/chat-app` | `0.2.0` | No artifact or package pin |
| `@voicechat/ui-foundation` | `>=0.1.8 <0.2.0` | Vendored `0.1.6` |
| `@voicechat/shared` | `>=0.1.10 <0.2.0` | Workspace declares `0.1.3` |

Their archives do not include the missing vendor tarballs. Make's embedded
dependency snapshot identifies chat-ui 0.2.0 with SHA-256
`a36f5106684ee73afedfba2d38b2536f11331462113ed6cb338596f261d07f9e`
and UI Foundation 0.1.8 with SHA-256
`fcfeefb8a48533d5d06ebdc12a55a0971445e7989a78df08035a9047f00adf5c`.
Do not substitute another same-version archive or bump Shared's version without
verifying the required public contract implementation.

## Remaining work

1. Supply the missing immutable foundation/chat artifacts and reconcile Core's
   Shared contract with the required 0.1.10 API.
2. Validate the complete transitive owner composition, vendor exact archives,
   update all consumer pins, lockfile and owner inventory together.
3. Execute real installed-build host/resource/transport scenarios for Make,
   Web Reader, Playwright Reader, main chat, Console, kanban and Desktop. Cover
   settings across hosts, simultaneous instances, resource isolation, streaming,
   cancellation and reconnect/active-turn recovery; retain build identities with
   results. Current `system-tests/owners.json` is an older three-owner matrix and
   is not evidence for this candidate set.
4. Run the required `npm ci` and `npm run gate:release` under the supervisor with
   assigned runtime resources. This sandbox's installation attempt failed with
   `spawn EPERM`; gate commands exited 255. The new preflight tests also remain
   unverified because the interrupted install removed `semver`.

Operator deployment and observed-production commissioning are subsequent work,
separate from code completion. Neither has been performed or claimed here.
