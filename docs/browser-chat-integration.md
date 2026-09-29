# Core browser integration (E07)

Core accepts independent browser hosts without loading the Sislexa shell. The
consumer checkpoint uses SDK E02 commit `7f45178ee7375c53782b5d3e1747e84edd286dbd`,
Identity E03 contract `3a4207b7249da48a3ec17665534e79ad5e0cc812`, and the session
flow required by UI E06 `b62d55496911c4f0511b92be1716a81839c1e8a9`.

## Browser boundary

Set `VC_CORS_ORIGINS` to comma-separated exact external origins (scheme, host,
optional port; no path, wildcard or trailing slash). Configure `VC_PUBLIC_URL`
to Core's public URL behind a reverse proxy. The same origin and configured
origins are accepted; an unlisted or opaque Origin is rejected before REST or
WebSocket authentication. Requests without Origin still require credentials.
CORS preflight precedes authentication and permits Authorization, Content-Type,
the tenant header and `x-sislexa-delegation`. Responses vary on Origin. Origin
permission does not replace user, tenant, conversation or grant authorization.

`POST /api/chat/session` exchanges an existing Identity cookie or bearer for a
opaque handle valid for at most five minutes (and never past the delegated
access token's expiry). The SDK E02 `createBrowserChatSession` consumes its
version, sessionId, accessToken, expiresAt and socketUrl. Handles are held in
memory, indexed by hash, bounded in number, and lost on restart. Responses are
no-store. An exact accepted Origin protects the cookie exchange, so E06 does
not need to read a CSRF cookie from a different origin. Other cookie mutations
retain Identity's CSRF checks. Bearer callers can acquire without Origin.

The handle works as a bearer only on chat REST routes and uploads, and as the
`session` parameter on `/ws`. It cannot mint another handle or call unrelated
APIs. Its origin and selected tenant cannot change. The server rechecks the
original Identity authority on every REST call, socket command and delivered
chat event. A socket also has a periodic authority check; expiry closes with
4401 (refresh and resynchronize), revocation with 4403 (sign in again). No
mutation is automatically replayed. Keep proxy access logs free of socket query
strings. Never use an Identity or long-lived application credential in a URL.

`chat.connect` v1 receives `chat.ready` with verified context, settings and a
resync-required cursor. The client fetches history from
`GET /api/conversations/:id`, which returns both conversation and messages.
Standalone sockets subscribe only to chat events and accept chat commands;
they do not start account-wide shell subscriptions or resume unrelated queues.
Account sessions retain ordinary chat settings and upload support; uploads must
name an owned conversation in the selected tenant. Before browser turn dispatch,
attachment IDs are checked against the uploading user, tenant and conversation. Voice is not advertised by
this text transport.

## Delegated public clients

Delegated access stays disabled unless `VC_DELEGATED_CHAT_ENABLED=true` and a
managed Identity introspection client is available. No new signing key or
fallback Identity authority is introduced. A public client first obtains the
short access token through Identity E03's registered redirect, consent and PKCE
flow. It sends that access token as Bearer authorization (SDK E02), or in
`x-sislexa-delegation`, to
`POST /api/chat/session?conversationId=<authorized-id>` with credentials omitted.
If the grant contains exactly one readable conversation, the ID can be omitted.
An ambiguous or project-only grant requires an explicit conversation ID.
Core verifies the live grant and resource before issuing a browser handle.
Server-only application credentials must stay in a trusted backend.

SDK E02's backend handler may send `x-app-credential` with Bearer user-session
authorization. Core introspects the application grant, requires the same live
user/tenant on both credentials and applies the grant's resource restrictions.
An invalid application credential cannot fall back to ordinary user authority.
This server-to-server exchange binds a handle without a browser Origin; the
host must proxy all chat REST/WS requests and omit upstream Origin consistently.
Do not return that handle for direct browser-to-Core use. A trusted host can
instead forward its exact allowlisted Origin on both exchange and proxy
requests. Core's CORS preflight does not permit long-lived x-app-credential
headers from browsers.

The delegated handle keeps the grant's application attribution and tenant and
is bound to the selected conversation. SDK's `chat.connect` need not repeat the
conversation ID. REST reads, conversation settings reads, output events, turn
execution and queue controls retain live grant checks. Account settings are
removed from delegated settings responses. Settings mutations, attachments,
voice and unrelated APIs remain unsupported for delegated grants and fail
closed; the handshake does not advertise those capabilities. Paid delegated
text execution still requires configured Billing admission. Revoked, expired
or rotated grants do not become ordinary user sessions.

## Reproducible external host

`scripts/external-chat-sample.mjs` serves a minimal consumer host and the exact
SDK E02 archive from `vendor/sislexa-sdk-e02-7f45178ee737.tgz`. Its SHA-256 is
`629530a3a2a4256502b8e8c6b5b43d8fba01e412b5430690da6e82e75a027ab4` and is checked
before serving. This is an isolated browser fixture, not an upgrade of Core's
installed SDK or UI dependencies. No workspace aliases, global bridges,
persistent credential storage or shell assets are used.

During operator commissioning, with Core already configured on the first
allocated port and this host allowed on the second, run:

```sh
node scripts/external-chat-sample.mjs
```

The CLI requires `DELIVERY_PORTS` and binds its second port on loopback. It does
not start Core, Identity, Billing or a runner. Open its printed URL with the
non-secret `?core=<Core-origin>` parameter, sign in, and connect two existing
conversation IDs. Each view has independent session, socket, draft and disposal.
The host exposes `connectExternalChat(coreOrigin, conversationId, accessToken)`
from `/client.mjs`; its optional callback can use Identity E03's memory-only
`PublicClientBrowser.accessToken(signal)` to refresh a public-client connection.
It is called only for session acquisition, never to put the Identity credential
on a socket URL. E06's published page/widget host can use the same exchange.

Cross-site cookie login requires HTTPS (`SameSite=None; Secure`) and a browser
policy allowing those cookies. If third-party cookies are disabled, use the
delegated public-client flow. The sample's ordinary login does not circumvent
browser cookie policy.

## Verification and commissioning

`server.browserChat.test.ts` exercises the real Core/Identity repository and
in-process WebSockets, including revocation and upload isolation.
`auth/browserChat.test.ts` checks expiry and origin/tenant/resource binding.
`e2e/externalChat.e2e.test.ts` runs the external host and pinned SDK in Chromium,
with real CORS, two clients, REST history/settings, uploads and delegated reads.
It uses allocated delivery ports/profile when provided, and closes all runtime
resources. The application gate selects it as Core browser integration.

Code verification is separate from operator commissioning. The sandbox cannot
bind the allocated loopback port, and nested npm exits 255 before the required
gate executes. The supervisor must run `STORYBOOK_DISABLE_TELEMETRY=1 npm run
gate` outside that boundary. Deployed-origin HTTPS/cookie policy, real E03 PKCE
consent, E06 published skins, Billing/runner execution and reconnect after an
actual rollout require operator acceptance before enabling public enrollment.
No deployment, credential change or production acceptance is implied here.
