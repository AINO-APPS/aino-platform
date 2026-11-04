import { useState } from "react";
import { getOrgTeams } from "../../api/organization";
import { transferTask } from "../../api/tasks";
import { actionDecision, decisionProps, isReadOnlyTicket, writeError } from "./ticketCapabilities";

interface Props {
    task: any;
    onEdit: () => void;
    onCancel: () => void;
    onReplaced: (ticket: any) => void;
    onError: (message: string) => void;
}

export default function TicketDetailActions({ task, onEdit, onCancel, onReplaced, onError }: Props) {
    const [teams, setTeams] = useState<any[] | null>(null);
    const [pending, setPending] = useState(false);
    if (isReadOnlyTicket(task)) return null;
    return <>
        <button className="btn btn-secondary btn-sm" {...decisionProps(actionDecision(task, "edit"))} onClick={onEdit}>Edit</button>
        <button className="btn btn-danger btn-sm" {...decisionProps(actionDecision(task, "cancel"))} onClick={onCancel}>Cancel ticket</button>
        <button
            className="btn btn-secondary btn-sm"
            {...decisionProps(actionDecision(task, "transfer"))}
            onClick={async () => {
                try {
                    const { data } = await getOrgTeams();
                    setTeams(Array.isArray(data) ? data : data.teams || []);
                } catch (error) {
                    onError(writeError(error, "Failed to load teams"));
                }
            }}
        >Transfer to team</button>
        {teams && <label>Destination team
            <select
                aria-label="Destination team"
                defaultValue=""
                disabled={pending || !actionDecision(task, "transfer").allowed}
                onChange={async (event) => {
                    const teamId = event.target.value;
                    if (!teamId) return;
                    setPending(true);
                    try {
                        const { data } = await transferTask(task.id, teamId);
                        onReplaced(data.task);
                        setTeams(null);
                    } catch (error) {
                        onError(writeError(error, "Failed to transfer ticket"));
                    } finally {
                        setPending(false);
                    }
                }}
            >
                <option value="">Transfer to…</option>
                {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
        </label>}
    </>;
}
