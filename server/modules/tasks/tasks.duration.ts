export class InvalidDuration extends Error {
    readonly code = "INVALID_DURATION";
    constructor() { super("Enter a positive duration using w, d, h or m (for example, 2h 30m)."); }
}

/** Whole minutes; days follow the org's working day and weeks are five days. */
export function parseDuration(input: string, workingHoursPerDay: number): number {
    if (typeof input !== "string" || !Number.isFinite(workingHoursPerDay) || workingHoursPerDay <= 0) throw new InvalidDuration();
    const units: Record<string, number> = { w: workingHoursPerDay * 300, d: workingHoursPerDay * 60, h: 60, m: 1 };
    let rest = input.trim();
    let total = 0;
    while (rest) {
        const token = /^(\d+(?:\.\d+)?|\.\d+)\s*([wdhm])/.exec(rest);
        if (!token) throw new InvalidDuration();
        total += Number(token[1]) * units[token[2]];
        rest = rest.slice(token[0].length).trimStart();
    }
    const minutes = Math.round(total);
    if (!Number.isSafeInteger(minutes) || minutes <= 0 || minutes > 2_147_483_647) throw new InvalidDuration();
    return minutes;
}
