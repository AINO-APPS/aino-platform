export function stopScreenStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}
