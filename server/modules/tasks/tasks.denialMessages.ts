import type { CapabilityReason } from "./tasks.capabilities";
export const CAPABILITY_DENIAL_MESSAGES: Record<CapabilityReason, string> = {
    ACCESS_DENIED: "Access denied",
    READ_ONLY_ROLE: "Your project role allows reading and commenting only.",
    PROJECT_ARCHIVED: "This project is archived and its tickets are read-only.",
    SUBTASK_FOLLOWS_PARENT: "A subtask follows its parent's project and sprint and cannot move independently.",
    INVALID_HIERARCHY: "Only a Story, Task or Bug may have subtasks.",
    WORKLOG_CANCELLED: "Work cannot be logged on a cancelled ticket.",
    WORKLOG_FOR_OTHERS_DENIED: "Only an org admin can log work for another person.",
    SPRINT_FROZEN: "This sprint is completed and no longer accepts task changes.",
    CANCELLED_TERMINAL: "This ticket is cancelled and cannot change state.",
    INVALID_TRANSITION: "This ticket cannot perform that action in its current state.",
    PROJECT_HAS_NO_SPRINTS: "Sprints are only available in Scrum projects.",
    SPRINT_PROJECT_MISMATCH: "A ticket may only join a sprint in its own project.",
};
