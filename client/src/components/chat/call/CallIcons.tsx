import { Mic as MaterialMic, MicOff as MaterialMicOff, Video as MaterialVideo, VideoOff as MaterialVideoOff, Phone as MaterialPhone, MonitorUp as MaterialMonitorUp, ScreenShareOff as MaterialScreenShareOff, Maximize as MaterialMaximize, Minimize as MaterialMinimize, Pause as MaterialPause, Play as MaterialPlay, SwitchCamera as MaterialSwitchCamera, PictureInPicture2 as MaterialPictureInPicture2, UserPlus as MaterialUserPlus, MessageCircle as MaterialMessageCircle, Send as MaterialSend, Record as MaterialRecord, NoiseSuppression as MaterialNoiseSuppression, Smile as MaterialSmile, Keyboard as MaterialKeyboard } from "../../../constants/icons";
/* ── SVG Icon components for Call Overlay ── */

export const MicIcon = () => <MaterialMic size="20" width="20" height="20" />;
export const MicOffIcon = () => <MaterialMicOff size="20" width="20" height="20" />;
export const CamIcon = () => <MaterialVideo size="20" width="20" height="20" />;
export const CamOffIcon = () => <MaterialVideoOff size="20" width="20" height="20" />;
export const PhoneIcon = ({ rotate }: { rotate?: boolean }) => <MaterialPhone size="24" width="24" height="24" style={rotate ? { transform: "rotate(135deg)" } : undefined} />;
export const ScreenShareIcon = () => <MaterialMonitorUp size="20" width="20" height="20" />;
export const ScreenShareOffIcon = () => <MaterialScreenShareOff size="20" width="20" height="20" />;
export const FullscreenIcon = () => <MaterialMaximize size="18" width="18" height="18" />;
export const ExitFullscreenIcon = () => <MaterialMinimize size="18" width="18" height="18" />;
export const HoldIcon = () => <MaterialPause size="18" width="18" height="18" />;
export const ResumeIcon = () => <MaterialPlay size="18" width="18" height="18" />;
export const SwitchCamIcon = () => <MaterialSwitchCamera size="18" width="18" height="18" />;
export const PipIcon = () => <MaterialPictureInPicture2 size="18" width="18" height="18" />;
export const AddParticipantIcon = () => <MaterialUserPlus size="18" width="18" height="18" />;
export const ChatIcon = () => <MaterialMessageCircle size="20" width="20" height="20" />;
export const SendIcon = () => <MaterialSend size="16" width="16" height="16" />;
export const RecordIcon = () => <MaterialRecord size="18" width="18" height="18" />;
export const NoiseSuppressionIcon = () => <MaterialNoiseSuppression size="18" width="18" height="18" />;
export const EmojiIcon = () => <MaterialSmile size="18" width="18" height="18" />;
export const KeyboardIcon = () => <MaterialKeyboard size="16" width="16" height="16" />;