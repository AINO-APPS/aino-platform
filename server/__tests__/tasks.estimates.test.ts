import { adjustRemaining } from '../modules/tasks/tasks.estimates';

// Worked examples: edits use the delta, deletion returns time; a missing forecast stays missing.
describe('remaining forecast after work changes', () => {
    test.each([
        ['auto', 120, 0, 30, undefined, 90], ['auto', 120, 30, 60, undefined, 90],
        ['auto', 120, 60, 30, undefined, 150], ['auto', 120, 30, 0, undefined, 150],
        ['auto', 10, 0, 30, undefined, 0], ['auto', 0, 30, 0, undefined, 30],
        ['auto', null, 0, 30, undefined, null], ['auto', null, 30, 60, undefined, null],
        ['auto', null, 60, 30, undefined, null], ['auto', null, 30, 0, undefined, null],
        ...[null, 120].flatMap(current => [[0, 30], [30, 60], [60, 30], [30, 0]].flatMap(([before, after]) => [
            ['leave', current, before, after, undefined, current], ['set', current, before, after, 45, 45],
            ['set', current, before, after, 0, 0], ['set', current, before, after, null, null],
        ])),
    ])('%s remaining %s, effort %s → %s, set %s gives %s', (mode, current, before, after, value, expected) => {
        expect(adjustRemaining(current as number | null, Number(before), Number(after),
            { mode: mode as 'auto' | 'set' | 'leave', value: value as number | null | undefined })).toBe(expected);
    });
});
