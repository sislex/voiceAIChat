# Voice and Image Studio repository extraction

The owner requested `sislex/voice` and `sislex/image-studio` to follow the independent
Make/Reader release model. Work takes place in an isolated checkout, preserving the
existing diagnostics branch and its uncommitted changes.

## Ownership

- Voice owns STT and TTS services, their model/voice stores, tests, images and the
  portable browser microphone, PCM, VAD and playback library. Chat orchestration,
  message composition and user authentication remain host responsibilities.
- Image Studio owns its API, gallery data, UI panel, tests, images and service ports.
  Core supplies remote identity, conversation access and generation through versioned RPC.
- Pure public speech/image wire contracts remain in the versioned shared library.
  Common packages are immutable source snapshots with integrity/provenance records.
- Core retains compatibility adapters and pins released source archives. Applications
  install, test and build without a neighboring checkout. STT and TTS retain separate
  process identities and grants within the Voice repository.

## Managed access

Each provider owns a private token registry with scopes, TTL and revocation. Speech
separates read, run and model/voice management. Image Studio accepts service RPC grants
and forwards user credentials to Core for every user API operation. Existing legacy
configuration is retained during migration. Fresh managed installations create eleven
separate directional grants across seven providers. Metadata never requires recursively
checking dependency readiness. STT verifies compatibility before opening its WebSocket;
image generation retains its longer operation timeout and abort propagation.

The component runtime advances to 1.0.1. Older tool distributions need a compatible
1.x peer range; their standalone lockfiles remain immutable. No peer checks are disabled.

## Acceptance

- Independent full typecheck, tests and builds; protected routes reject missing and
  insufficient grants and observe revocation immediately.
- Core canonical gate, including bridges and browser integration.
- Source archives record full source commits; releases and deployment inputs pin them.
- Production rollout uses the installed voicechat-deploy flow, preserving data and
  rollback artifacts. Deployment status must be recorded separately from implementation.
