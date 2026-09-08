export const AUDIO_MAX_BITRATE = 48_000;
export const HIGH_COUNT_VIDEO_THRESHOLD = 6;
export const RECENT_SPEAKER_WINDOW_MS = 12_000;
export const MAX_PRIORITY_VIDEO_PEERS = 4;

export function videoBitrateForPeerCount(peerCount: number): number {
  if (peerCount <= 3) return 500_000;
  if (peerCount <= 6) return 300_000;
  return 150_000;
}

interface PriorityVideoOptions {
  participantIds: Array<number | string>;
  localUserId?: number | string;
  presenterId: number | string | null;
  activeSpeakerId: number | string | null;
  recentSpeakers: Map<number | string, number>;
  maxPeers?: number;
}

export function selectPriorityVideoPeers({
  participantIds,
  localUserId,
  presenterId,
  activeSpeakerId,
  recentSpeakers,
  maxPeers = MAX_PRIORITY_VIDEO_PEERS,
}: PriorityVideoOptions): Set<number | string> {
  const available = new Set(participantIds.filter((id) => id !== localUserId));
  const priority = new Set<number | string>();
  if (presenterId != null && available.has(presenterId))
    priority.add(presenterId);
  if (
    activeSpeakerId != null &&
    available.has(activeSpeakerId) &&
    priority.size < maxPeers
  ) {
    priority.add(activeSpeakerId);
  }
  const recent = [...recentSpeakers].sort((a, b) => b[1] - a[1]);
  for (const [userId] of recent) {
    if (priority.size >= maxPeers) break;
    if (available.has(userId)) priority.add(userId);
  }
  return priority;
}
