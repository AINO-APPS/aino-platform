import { compareVersions } from "../modules/clientVersions/clientVersions.version";

test("hyphens inside prerelease identifiers retain their semantic precedence", () => {
    expect(compareVersions("3.0.80-alpha-one", "3.0.80-alpha-two")).toBe(-1);
    expect(compareVersions("3.0.80-alpha-one", "3.0.80-alpha")).toBe(1);
});

test.each([
    ["1.9.0", "1.10.0", -1],
    ["2.0.0", "1.99.99", 1],
    ["1.0.0-alpha", "1.0.0-alpha.1", -1],
    ["1.0.0-alpha.1", "1.0.0-alpha.beta", -1],
    ["1.0.0-beta.2", "1.0.0-beta.11", -1],
    ["1.0.0-rc.1", "1.0.0", -1],
    ["1.0.0+first", "1.0.0+second", 0],
    ["0", "0.0.0", 0],
    ["999999999999999999999.0.0", "999999999999999999998.0.0", 1],
])("semantic ordering of %s and %s", (left, right, expected) => {
    expect(compareVersions(String(left), String(right))).toBe(expected);
});

test.each(["invalid", "01.0.0", "1.0", "1.0.0-01", "v1.0.0", "1.0.0+", ""])(
    "malformed input %s cannot be compared", version => {
        expect(() => compareVersions(version, "1.0.0")).toThrow("invalid semantic versions");
    },
);
