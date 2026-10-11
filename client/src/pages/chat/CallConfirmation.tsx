import ConfirmDialog from "../../components/common/ConfirmDialog";
import { getConvName } from "./chatUtils";
import type useCallActions from "./useCallActions";

type Props = Pick<ReturnType<typeof useCallActions>,
  "pendingCall" | "confirmPendingCall" | "cancelPendingCall">;

export default function CallConfirmation({ pendingCall, confirmPendingCall, cancelPendingCall }: Props) {
  return (
    <ConfirmDialog
      isOpen={!!pendingCall}
      title={`Start ${pendingCall?.callType === "video" ? "video" : "voice"} call?`}
      message={`Call ${pendingCall ? getConvName(pendingCall.conversation as Parameters<typeof getConvName>[0]) : ""}?`}
      confirmText="Call"
      isDanger={false}
      onConfirm={confirmPendingCall}
      onCancel={cancelPendingCall}
    />
  );
}
