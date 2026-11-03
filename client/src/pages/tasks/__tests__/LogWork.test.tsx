import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TaskTimePanel from '../TaskTimePanel';

const api = vi.hoisted(() => ({ logTaskWork: vi.fn(), getTaskWorklogs: vi.fn() }));
vi.mock('../../../api/tasks', () => api);
const ticket = { id: 1, time_spent_minutes: 0, capabilities: { can: { logWork: { allowed: true } } } };
const worklog = { id: 4, task_id: 1, author_id: 1, logged_by_id: 1,
    author: { id: 1, full_name: 'Alice', username: 'alice', avatar: null }, logged_by: { id: 1, full_name: 'Alice' },
    day_worked: '2026-11-01', start_time: '09:30:00', minutes: 150, comment: 'Review work' };
beforeEach(() => {
    api.getTaskWorklogs.mockReset().mockResolvedValue({ data: { worklogs: [], time_spent_minutes: 0 } });
    api.logTaskWork.mockReset().mockResolvedValue({ data: { worklog, ticket: { id: 1, time_spent_minutes: 150, logged_minutes: 150 }, warnings: [] } });
});
describe('Log work on a ticket', () => {
    test('shows an invalid-duration error beside time spent and saves no worklog', async () => {
        api.logTaskWork.mockRejectedValue({ response: { data: { code: 'INVALID_DURATION', error: 'Enter a positive duration.' } } });
        render(<TaskTimePanel task={ticket} />);
        fireEvent.click(screen.getByRole('button', { name: 'Log work' }));
        fireEvent.change(screen.getByLabelText('Time spent'), { target: { value: 'abc' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save work' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Enter a positive duration.');
        expect(screen.getByLabelText('Time spent')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('dialog', { name: 'Log work' })).toBeTruthy();
        expect(screen.queryByText('Review work')).toBeNull();
    });
    test.each([undefined, { allowed: false, reason: 'WORKLOG_CANCELLED' }])('hides Log work without a granted server capability (%j)', async decision => {
        render(<TaskTimePanel task={{ ...ticket, capabilities: { can: { logWork: decision } } }} />);
        await screen.findByText('No work logged yet');
        expect(screen.queryByRole('button', { name: 'Log work' })).toBeNull();
        expect(screen.queryByRole('dialog')).toBeNull();
    });
    test('refreshes worklogs and totals in another open view on task_updated without timer polling', async () => {
        render(<TaskTimePanel task={ticket} />);
        await screen.findByText('No work logged yet');
        api.getTaskWorklogs.mockResolvedValue({ data: { worklogs: [worklog], time_spent_minutes: 150 } });
        act(() => { window.dispatchEvent(new CustomEvent('aino-realtime', { detail: { type: 'task_updated', data: { taskId: 1 } } })); });
        expect(await screen.findByText('Review work')).toBeTruthy();
        expect(screen.getByText('2h 30m / —')).toBeTruthy();
    });
    test('successive saves keep both worklogs visible without waiting for realtime', async () => {
        render(<TaskTimePanel task={ticket} />);
        await screen.findByText('No work logged yet');
        for (const [id, comment] of [[4, 'First log'], [5, 'Second log']] as const) {
            api.logTaskWork.mockResolvedValue({ data: { worklog: { ...worklog, id, comment }, ticket: { time_spent_minutes: 150 }, warnings: [] } });
            fireEvent.click(screen.getByRole('button', { name: 'Log work' }));
            fireEvent.change(screen.getByLabelText('Time spent'), { target: { value: '1h' } });
            fireEvent.click(screen.getByRole('button', { name: 'Save work' }));
            await screen.findByText(comment);
        }
        expect(screen.getByText('First log')).toBeTruthy();
        expect(screen.getByText('Second log')).toBeTruthy();
    });
    test('defaults day to today, submits entered fields, and immediately shows the saved worklog and server total', async () => {
        render(<TaskTimePanel task={ticket} />);
        fireEvent.click(screen.getByRole('button', { name: 'Log work' }));
        const dialog = screen.getByRole('dialog', { name: 'Log work' });
        const today = new Date();
        const localDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        expect(within(dialog).getByLabelText('Day worked')).toHaveValue(localDay);
        fireEvent.change(within(dialog).getByLabelText('Day worked'), { target: { value: '2026-11-01' } });
        fireEvent.change(within(dialog).getByLabelText('Time spent'), { target: { value: '2h 30m' } });
        fireEvent.change(within(dialog).getByLabelText('Start time (optional)'), { target: { value: '09:30' } });
        fireEvent.change(within(dialog).getByLabelText('Comment (optional)'), { target: { value: 'Review work' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save work' }));
        await waitFor(() => expect(api.logTaskWork).toHaveBeenCalledWith(1, {
            day_worked: '2026-11-01', time_spent: '2h 30m', start_time: '09:30', comment: 'Review work',
        }));
        expect(await screen.findByText('Review work')).toBeTruthy();
        expect(screen.getByText('2h 30m / —')).toBeTruthy();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByRole('button', { name: /Start timer|Stop timer/ })).toBeNull();
    });
});
