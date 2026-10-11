import { CamIcon, CamOffIcon } from "./CallIcons";
import s from "../CallOverlay.module.css";

interface CameraControlProps {
  connected: boolean;
  videoOff: boolean;
  cameraError: string | null;
  toggleVideo: () => Promise<void>;
}

export default function CameraControl({ connected, videoOff, cameraError, toggleVideo }: CameraControlProps) {
  return (
    <>
      {connected && (
        <button
          className={`${s.controlBtn} ${videoOff ? s.active : ""}`}
          onClick={toggleVideo}
          title={videoOff ? "Turn on camera (V)" : "Turn off camera (V)"}
        >
          {videoOff ? <CamOffIcon /> : <CamIcon />}
        </button>
      )}
      {cameraError && <span role="alert">{cameraError}</span>}
    </>
  );
}
