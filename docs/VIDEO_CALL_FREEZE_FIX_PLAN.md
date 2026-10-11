# Video-call freeze investigation and implementation plan

## Scope and evidence (2026-10-11)

Investigated native Android 1:1 calls and the shared web/Electron 1:1 call
implementation, including signaling and TURN configuration. The initial
investigation made no production changes. On 2026-10-11 the user authorized
release creation and push: desktop 3.0.52 and Android 0.21.8 through the existing
release workflows. Railway credential/configuration changes remain out of scope.

- Railway production web/realtime/worker deployment: commit
  `4f48f405f084fd409e1782c9f7187fb459f10306`, matching the platform checkout.
- Android checkout: `c35c734` (0.21.7). The installed APK version is unknown.
- Railway web service has both Cloudflare TURN credential variables configured
  and `DISABLE_PUBLIC_TURN=true`. This establishes provisioning, **not** successful
  credential minting, relay allocation, or media connectivity on the affected call.
- Bounded deployment logs show recent video-call initiation and termination.
  They contain no selected ICE pair, RTP freeze counters, encoder failures, or
  Android ANR stack. Signaling logs alone cannot explain a mid-call media freeze:
  RTP travels between clients and/or TURN, not through the signaling service.
- No Android device is attached to ADB. A physical freeze/ANR reproduction and
  attribution of the user's specific incident are therefore still outstanding.

## Confirmed implementation defects

| Defect | Mechanism | Local correction |
| --- | --- | --- |
| Web/desktop receive/send feedback loop | `inbound-rtp` loss, freezes and jitter lower the **local outgoing** encoder. A bad remote stream thus causes unrelated local resolution changes, which can add encoder/keyframe stalls and degrade both directions. | Separate badge health from sender-cap decisions, as the Android controller already does. Feed video `remote-inbound-rtp.fractionLost` into sender adaptation; retain RTT-based adaptation and existing slow recovery. |
| Web rejected tier is not retried | The controller advances its desired tier before `setParameters` completes; the monitor discards the returned failure flag and waits for another tier change. Actual encoding can remain at the old setting indefinitely. | Retry unsuccessful writes on the next stats sample, even when the desired tier holds. Require all video senders to succeed; no video is a successful no-op. Keep the existing per-peer serialized writer and warnings. |
| Android video failure counted as success | `RtcPeer.applyQuality` returns the audio result, discarding the video result. The polling loop then believes the tier is applied. The video writer also considered any successful sender sufficient. | Require successful audio **and** video writes; require every video sender to accept the tier. No video sender is a successful no-op for voice calls. Log rejection and retain the existing next-sample retry. |

Before the directional correction, six updated quality regressions failed,
including a receive-only freeze increasing the outgoing tier index from 0 to 1.
That is a reproduced controller defect, not a physical-device freeze reproduction.
The old tests explicitly expected received freezes to lower the local sender;
those expectations have been replaced with directionally correct regressions.

`qualityLimitationReason=bandwidth` alone is not an independent packet-loss or
queueing measurement and must not drive a self-reinforcing reduction loop.
WebRTC still performs its own congestion control beneath the application cap.
CPU limitation retains its existing warning behavior; no unverified tuning of
capture resolution, codec choice, jitter buffers, or bandwidth limits is included.

## Signal comparison (reference only; no source copied)

References were examined through authenticated GitHub reads:

- [Android call manager](https://github.com/signalapp/Signal-Android/blob/92f5ccd3a52c4780a0c916566e26280f640ba1de/app/src/main/java/org/thoughtcrime/securesms/service/webrtc/SignalCallManager.java):
  serializes call-service work on a single-thread executor and delegates media
  to its calling engine. AINO currently creates/disposes native peers and camera
  resources from a main-dispatcher controller. This is a **device-trace follow-up**,
  not proof of an ANR and not a reason for an untested threading rewrite.
- [Server relay endpoint](https://github.com/signalapp/Signal-Server/blob/a15d5cdbb937fc5d078b73ec7b4a725ddf4e9473/service/src/main/java/org/whispersystems/textsecuregcm/grpc/CallingGrpcService.java)
  authenticates and rate-limits relay credential requests and returns credentials
  with a TTL.
- [Server credential manager](https://github.com/signalapp/Signal-Server/blob/a15d5cdbb937fc5d078b73ec7b4a725ddf4e9473/service/src/main/java/org/whispersystems/textsecuregcm/auth/CloudflareTurnCredentialsManager.java)
  obtains provisioned Cloudflare credentials and composes relay URLs.
  AINO also obtains private Cloudflare credentials through
  [its TURN helper](../server/utils/coturn.ts). Replacing the server with Signal's
  server would not fix client encoder-policy errors.

Signal's calling engine is not AINO's bare WebRTC implementation. These
architectural observations are not claims of identical media policy or copied
implementation. The iOS checkout has no native WebRTC call implementation to patch.

## Implementation sequence

1. **Completed locally:** directional web quality policy in
   [callQuality](../client/src/components/chat/call/callQuality.ts); preserve
   the badge, tier values, connect-time ramp, audio cap, and wire protocol.
2. **Completed locally:** wire peer-reported video loss and failed-write retries
   in [the monitor](../client/src/components/chat/call/useCallControls.ts).
   Web and Electron use the same exported call overlay; the unused legacy
   overlay is outside this fix.
3. **Completed locally in the Android checkout:** combined audio/video success
   accounting and native rejection logging, with unit coverage. Meeting mesh
   bitrate caps use a separate path and remain unchanged.
4. **Local verification:** quality-controller and hook regressions; signaling
   and transport tests; client type-check/build and repository guardrails;
   Android unit tests, lint, both debug flavor builds and guardrails.
5. **Approved for release:** commit/push the reviewed changes, merge through
   the platform pull-request checks, and tag desktop `v3.0.52` and Android
   `android-v0.21.8` through the existing publishing pipelines.
   No backend/database migration or dependency change is required.

## Local verification results

- Web: 39 call tests across six files passed, including controller direction,
  raw stats collection, failed-write retry, partial sender failure, voice-call
  no-op, ringing, signaling, transport configuration, and deduplication.
- Client TypeScript check, final production build, and SPA build verification
  passed. The existing large-chunk build warning remains.
- All platform repository guardrails and all five Android guardrails passed.
- Android full CI command passed in 7 minutes 50 seconds: Play unit tests
  (913 tests), Play lint, Play debug APK, Direct unit tests (917 tests), and
  Direct debug APK. Both unit suites reported zero failures and zero errors.
- Patch whitespace checks passed before release preparation.
- No physical call, ANR, or real-device network-handover acceptance test was run.

## Device/production acceptance gate

Before declaring the reported freeze resolved, reproduce the original scenario
with the affected device, peer type, app version, call time, and network path:

- Run a 10-minute Android-to-web video call on healthy Wi-Fi, then on cellular.
  Record logcat/ANR traces and a browser WebRTC stats dump; do not include SDP,
  credentials, private message content, or tokens in published diagnostics.
- Verify private TURN allocation and the selected candidate pair on each peer;
  variable presence is not enough. Repeat with UDP blocked and TCP/TLS TURN.
- Under a controlled 20-second receive-only degradation, assert **zero outgoing
  downshifts caused solely by inbound counters**, while the poor-quality badge
  still updates. Existing startup/upshift behavior is not an inbound downshift.
- Under sustained video uplink loss, verify the outgoing cap steps downward and
  recovers after clean samples. Audio-only feedback must not lower the video cap.
- Inject one rejected parameter write: verify retry at the next 2-second sample,
  without waiting for another tier transition. Verify voice calls do not retry
  endlessly because there is no video sender.
- Switch Wi-Fi/cellular and repeat camera-off/on, camera-switch, hangup, and
  reconnect. Capture any UI thread stall and correlate its stack with peer/camera
  lifecycle operations before changing their threading.
- Compare pre/post inbound freeze-count and total-freeze-duration deltas on the
  same device/network. Require no ANR and no increase in measured freeze duration;
  report the measured values rather than claiming a latency improvement from tests.

If a freeze persists, investigate selected-pair/RTCP freshness, network recovery,
capture/codec health, and main-thread blocking using that trace. None of these is
established as the cause of this user's incident by the available server logs.
