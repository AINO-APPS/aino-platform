import { useState } from "react";
import { actionDecision, decisionProps, isReadOnlyTicket } from "./ticketCapabilities";
import MoveProjectDialog from "./MoveProjectDialog";

interface Props {
    task: any;
    onEdit: () => void;
    onCancel: () => void;
    onReplaced: (ticket: any) => void;
    onError: (message: string) => void;
}

export default function TicketDetailActions({ task, onEdit, onCancel, onReplaced }: Props) {
    const [moving, setMoving] = useState(false);
    const canMoveProject = actionDecision(task, "canMoveProject").allowed;
    if (isReadOnlyTicket(task)) return null;
    return <>
        <button className="btn btn-secondary btn-sm" {...decisionProps(actionDecision(task, "edit"))} onClick={onEdit}>Edit</button>
        <button className="btn btn-danger btn-sm" {...decisionProps(actionDecision(task, "cancel"))} onClick={onCancel}>Cancel ticket</button>
        {canMoveProject && <button className="btn btn-secondary btn-sm" onClick={() => setMoving(true)}>Move to project</button>}
        {moving && canMoveProject && <MoveProjectDialog task={task} onClose={() => setMoving(false)} onMoved={onReplaced} />}
    </>;
}
