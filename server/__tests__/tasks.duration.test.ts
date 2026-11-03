import { parseDuration } from "../modules/tasks/tasks.duration";

describe("time spent duration", () => {
    test.each([
        ["2h 30m", 8, 150], ["1w 2d 3h 30m", 8, 3570],
        ["1d", 7.5, 450], ["1w", 7.5, 2250], ["1.5h", 8, 90],
        ["  30m\t2h\n", 8, 150], ["1h30m", 8, 90], [".5d", 8, 240],
        ["1.5m", 8, 2], ["1h 1h", 8, 120],
    ])("%s with a %s-hour working day means %s whole minutes", (input, hours, expected) => {
        expect(parseDuration(input, hours)).toBe(expected);
    });
    test.each(["", " ", "0m", "-1h", "1h -2m", "abc", "2", "1h rubbish", "1h +2m", "NaNh", "Infinityh", "0.001m", "99999999999w"])("rejects %j with INVALID_DURATION", input => {
        expect(() => parseDuration(input, 8)).toThrow(expect.objectContaining({ code: "INVALID_DURATION" }));
    });
});
