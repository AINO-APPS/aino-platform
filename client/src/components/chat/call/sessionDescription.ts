import { preferOpusFec } from "./callQuality";

/** Keep the locally applied and remotely signalled SDP byte-identical. */
export function withOpusFec(
  description: RTCSessionDescriptionInit,
): RTCSessionDescriptionInit {
  if (!description?.sdp) return description;
  return { type: description.type, sdp: preferOpusFec(description.sdp) };
}