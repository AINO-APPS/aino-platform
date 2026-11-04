import type { CapabilityReason } from "./tasks.capabilities";
import { sprintTeamMismatchBody } from "./tasks.ownership";

export const CAPABILITY_DENIAL_MESSAGES: Record<CapabilityReason, string> = {
    ACCESS_DENIED: "Access denied",
    READ_ONLY_ROLE: "Your project role allows reading and commenting only.",
    PROJECT_ARCHIVED: "This project is archived and its tickets are read-only.",
    WORKLOG_CANCELLED: "Work cannot be logged on a cancelled ticket.",
    WORKLOG_FOR_OTHERS_DENIED: "Only an org admin can log work for another person.",
    SPRINT_FROZEN: "This sprint is completed and no longer accepts task changes.",
    CANCELLED_TERMINAL: "This ticket is cancelled and cannot change state.",
    INVALID_TRANSITION: "This ticket cannot perform that action in its current state.",
    IN_SPRINT: "This ticket is in a sprint. Take it out of the sprint before planning it onto a day.",
    SPRINT_TEAM_MISMATCH: String(sprintTeamMismatchBody().error),
    SPRINT_PROJECT_MISMATCH: "This ticket and sprint belong to different projects.",
};
