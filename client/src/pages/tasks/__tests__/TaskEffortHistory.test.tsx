import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import TaskHistoryList from '../TaskHistoryList';
const before = { id: 7, author_id: 2, logged_by_id: 1, day_worked: '2026-11-01', minutes: 30, start_time: '09:00:00', comment: 'Before' };
const after = { ...before, author_id: 3, author: { full_name: 'Carol' }, logged_by: { full_name: 'Alice' }, minutes: 60, day_worked: '2026-11-02', comment: 'Corrected' };
const entry = { id: 1, created_at: '2026-11-03T09:00:00Z', full_name: 'Alice' };
test.each(['worklog_added', 'worklog_updated', 'worklog_deleted'])('%s renders accountable worklog identity and stored effort details', action => {
    const { container } = render(<TaskHistoryList history={[{ ...entry, action, old_value: action === 'worklog_added' ? null : JSON.stringify(before), new_value: JSON.stringify(after) }]} />);
    expect(container).toHaveTextContent(action === 'worklog_added' ? 'added worklog' : action === 'worklog_updated' ? 'updated worklog' : 'deleted worklog');
    expect(container).toHaveTextContent('#7');
    expect(container).toHaveTextContent('Carol');
    expect(container).toHaveTextContent('logged by Alice');
    expect(container).toHaveTextContent('2026-11-02');
    expect(container).toHaveTextContent('1h');
    expect(container).toHaveTextContent('Corrected');
    if (action !== 'worklog_added') {
        expect(container).toHaveTextContent('author #2');
        expect(container).toHaveTextContent('30m');
        expect(container).toHaveTextContent('Before');
    }
});
test('estimate history renders both old and new estimates distinguishing null from zero', () => {
    render(<TaskHistoryList history={[{ ...entry, action: 'estimate_changed', old_value: JSON.stringify({ original_estimate_minutes: null, remaining_estimate_minutes: 0 }), new_value: JSON.stringify({ original_estimate_minutes: 120, remaining_estimate_minutes: 90 }) }]} />);
    expect(screen.getByText(/changed estimates/)).toHaveTextContent('changed estimates: Original —, remaining 0m → Original 2h, remaining 1h 30m');
});
test('malformed legacy metadata has a readable action instead of crashing or exposing the action code', () => {
    render(<TaskHistoryList history={[{ ...entry, action: 'worklog_deleted', old_value: 'invalid', new_value: null }]} />);
    expect(screen.getByText(/deleted worklog/)).toHaveTextContent('deleted worklog: invalid');
});
