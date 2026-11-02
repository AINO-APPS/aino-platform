const { snapshotBurndown: snapshot } = require("../../modules/tasks/tasks.sprintRepository");

export async function snapshotBurndown(db: any, sprintId: number): Promise<void> {
    await snapshot(db, sprintId);
}
