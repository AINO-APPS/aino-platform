/** Empty audio senders must never be reused for camera or screen video. */
export function findVideoSender(pc: RTCPeerConnection): RTCRtpSender | undefined {
  const transceiver = pc.getTransceivers().find(
    (t) => t.direction !== "stopped" && (t.sender.track?.kind === "video" || t.receiver.track?.kind === "video"),
  );
  if (transceiver) {
    // A receive-only voice-call video m-line must send after a local upgrade.
    if (transceiver.direction === "recvonly" || transceiver.direction === "inactive") {
      transceiver.direction = "sendrecv";
    }
    return transceiver.sender;
  }
  return pc.getSenders().find((s) => s.track?.kind === "video");
}
