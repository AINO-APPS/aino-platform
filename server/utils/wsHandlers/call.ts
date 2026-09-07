/** Compatibility barrel for the bounded 1:1 call handlers. */
export { handleCallInitiate, handleCallAccept } from "./callLifecycle";
export { handleCallCancel, handleCallReject, handleCallEnd } from "./callTermination";
export {
  handleCallSignal,
  handleCallSubscribe,
  handleCallReady,
  handleCallReconnect,
  handleCallReaction,
  handleCallAddParticipant,
} from "./callSignaling";
