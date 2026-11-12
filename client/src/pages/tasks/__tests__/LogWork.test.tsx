import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TaskTimePanel from '../TaskTimePanel';

const api = vi.hoisted(() => ({ logTaskWork: vi.fn(), getTaskWorklogs: vi.fn(), editTaskWorklog: vi.fn(), deleteTaskWorklog: vi.fn(), getAssignableUsers: vi.fn() }));
vi.mock('../../../api/tasks', () => api);
const ticket = { id: 1, time_spent_minutes: 0, capabilities: { can: { logWork: { allowed: true } } } };
const worklog = { id: 4, task_id: 1, author_id: 1, logged_by_id: 1,
    author: { id: 1, full_name: 'Alice', username: 'alice', avatar: null }, logged_by: { id: 1, full_name: 'Alice' },
    day_worked: '2026-11-01', start_time: '09:30:00', minutes: 150, comment: 'Review work' };
beforeEach(() => {
    api.getTaskWorklogs.mockReset().mockResolvedValue({ data: { worklogs: [], time_spent_minutes: 0 } });
    api.getAssignableUsers.mockReset().mockResolvedValue({ data: [{ id: 1, full_name: 'Alice', username: 'alice' }, { id: 2, full_name: 'Bob', username: 'bob' }] });
    api.editTaskWorklog.mockReset();
    api.deleteTaskWorklog.mockReset();
    api.logTaskWork.mockReset().mockResolvedValue({ data: { worklog, ticket: { id: 1, time_spent_minutes: 150 }, warnings: [] } });
});
describe('Log work on a ticket', () => {
    test('shows both returned attendance warnings after the worklog saves and the dialog closes', async () => {
        api.logTaskWork.mockResolvedValue({ data: { worklog, ticket: { time_spent_minutes: 150 }, warnings: ['ON_LEAVE', 'EXCEEDS_ATTENDANCE'] } });
        render(<TaskTimePanel task={ticket} />);
        fireEvent.click(screen.getByRole('button', { name: 'Log work' }));
        fireEvent.change(screen.getByLabelText('Time spent'), { target: { value: '2h 30m' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save work' }));
        expect(await screen.findByText('Review work')).toBeTruthy();
        expect(screen.queryByRole('dialog')).toBeNull();
        const warning = screen.getByRole('status');
        expect(warning).toHaveTextContent('Work saved');
        expect(warning).toHaveTextContent('The author has approved leave on this day.');
        expect(warning).toHaveTextContent('The author’s total work logged for this day exceeds their clocked-in working time.');
    });

    test('clears stale warnings after another clean save or switching tickets', async () => {
        api.logTaskWork.mockResolvedValue({ data: { worklog, ticket: { time_spent_minutes: 150 }, warnings: ['ON_LEAVE'] } });
        const view = render(<TaskTimePanel task={ticket} />);
        fireEvent.click(screen.getByRole('button', { name: 'Log work' }));
        fireEvent.change(screen.getByLabelText('Time spent'), { target: { value: '1h' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save work' }));
        await screen.findByRole('status');
        api.logTaskWork.mockResolvedValue({ data: { worklog: { ...worklog, id: 5 }, ticket: { time_spent_minutes: 180 }, warnings: [] } });
        fireEvent.click(screen.getByRole('button', { name: 'Log work' }));
        fireEvent.change(screen.getByLabelText('Time spent'), { target: { value: '30m' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save work' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(screen.queryByRole('status')).toBeNull();
        api.logTaskWork.mockResolvedValue({ data: { worklog, ticket: { time_spent_minutes: 150 }, warnings: ['ON_LEAVE'] } });
        fireEvent.click(screen.getByRole('button', { name: 'Log work' }));
        fireEvent.change(screen.getByLabelText('Time spent'), { target: { value: '1h' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save work' }));
        await screen.findByRole('status');
        view.rerender(<TaskTimePanel task={{ ...ticket, id: 2 }} />);
        await screen.findByText('No work logged yet');
        expect(screen.queryByRole('status')).toBeNull();
    });

    test('changing the worked day and duration shows edit warnings after save, then clears them after a clean correction', async () => {
        const own = { ...worklog, canEdit: true, canDelete: true };
        const corrected = { ...own, day_worked: '2020-01-15', minutes: 180 };
        api.getTaskWorklogs.mockResolvedValue({ data: { worklogs: [own], time_spent_minutes: 150 } });
        api.editTaskWorklog.mockResolvedValue({ data: { worklog: corrected, ticket: { time_spent_minutes: 180 }, warnings: ['ON_LEAVE', 'EXCEEDS_ATTENDANCE'] } });
        render(<TaskTimePanel task={ticket} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Edit worklog' }));
        fireEvent.change(screen.getByLabelText('Day worked'), { target: { value: '2020-01-15' } });
        fireEvent.change(screen.getByLabelText('Time spent'), { target: { value: '3h' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save work' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(api.editTaskWorklog).toHaveBeenCalledWith(1, 4, { day_worked: '2020-01-15', time_spent: '3h' });
        expect(screen.getByText('3h / —')).toBeTruthy();
        expect(screen.getByRole('status')).toHaveTextContent('The author has approved leave on this day.');
        expect(screen.getByRole('status')).toHaveTextContent('The author’s total work logged for this day exceeds their clocked-in working time.');
        api.editTaskWorklog.mockResolvedValue({ data: { worklog: { ...corrected, day_worked: '2020-01-14' }, ticket: { time_spent_minutes: 180 }, warnings: [] } });
        fireEvent.click(screen.getByRole('button', { name: 'Edit worklog' }));
        fireEvent.change(screen.getByLabelText('Day worked'), { target: { value: '2020-01-14' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save work' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.getByText('Review work')).toBeTruthy();
    });

    test.each([undefined, { allowed: false }, { allowed: true }])('person picker follows only the server capability (%j)', async decision => {
        render(<TaskTimePanel task={{ ...ticket, capabilities: { can: { ...ticket.capabilities.can, logWorkForOthers: decision } } }} />);
        fireEvent.click(screen.getByRole('button', { name: 'Log work' }));
        if (decision?.allowed) {
            const picker = await screen.findByRole('combobox', { name: 'Person' });
            await screen.findByRole('option', { name: 'Bob' });
            fireEvent.change(picker, { target: { value: '2' } });
            fireEvent.change(screen.getByLabelText('Time spent'), { target: { value: '1h' } });
            fireEvent.click(screen.getByRole('button', { name: 'Save work' }));
            await waitFor(() => expect(api.logTaskWork).toHaveBeenCalledWith(1, expect.objectContaining({ author_id: 2, time_spent: '1h' })));
        } else {
            expect(screen.queryByRole('combobox', { name: 'Person' })).toBeNull();
            expect(api.getAssignableUsers).not.toHaveBeenCalled();
            await screen.findByText('No work logged yet');
        }
    });
    test('admin editing can select another author and submits only the changed author', async () => {
        api.getTaskWorklogs.mockResolvedValue({ data: { worklogs: [{ ...worklog, canEdit: true, canDelete: true }], time_spent_minutes: 150 } });
        api.editTaskWorklog.mockResolvedValue({ data: { worklog: { ...worklog, author_id: 2, author: { id: 2, full_name: 'Bob' } }, ticket: { time_spent_minutes: 150 }, warnings: [] } });
        render(<TaskTimePanel task={{ ...ticket, capabilities: { can: { ...ticket.capabilities.can, logWorkForOthers: { allowed: true } } } }} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Edit worklog' }));
        const picker = screen.getByRole('combobox', { name: 'Person' });
        expect(picker).toHaveValue('1');
        await screen.findByRole('option', { name: 'Bob' });
        expect(screen.getByRole('button', { name: 'Save work' })).toBeDisabled();
        fireEvent.change(picker, { target: { value: '2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save work' }));
        await waitFor(() => expect(api.editTaskWorklog).toHaveBeenCalledWith(1, 4, { author_id: 2 }));
        expect(await screen.findByText(/Logged by Alice/)).toBeTruthy();
    });

    test.each(['auto', 'set', 'leave'])('admin picker and %s remaining choice submit together on create and edit', async mode => {
        for (const operation of ['create', 'edit']) {
            api.getTaskWorklogs.mockResolvedValue({ data: { worklogs: operation === 'create' ? [] : [{ ...worklog, canEdit: true }], time_spent_minutes: 150 } });
            const response = { data: { worklog: { ...worklog, author_id: 2, author: { id: 2, full_name: 'Bob' } }, ticket: { time_spent_minutes: 150 }, warnings: ['ON_LEAVE'] } };
            api.logTaskWork.mockResolvedValue(response);
            api.editTaskWorklog.mockResolvedValue(response);
            const { unmount } = render(<TaskTimePanel task={{ ...ticket, capabilities: { can: { ...ticket.capabilities.can, logWorkForOthers: { allowed: true } } } }} />);
            fireEvent.click(await screen.findByRole('button', { name: operation === 'create' ? 'Log work' : 'Edit worklog' }));
            await screen.findByRole('option', { name: 'Bob' });
            fireEvent.change(screen.getByRole('combobox', { name: 'Person' }), { target: { value: '2' } });
            fireEvent.click(screen.getByLabelText(mode === 'auto' ? 'Adjust automatically' : mode === 'set' ? 'Set to' : 'Leave unchanged'));
            if (mode === 'set') fireEvent.change(screen.getByLabelText('New remaining estimate'), { target: { value: '45m' } });
            if (operation === 'create') fireEvent.change(screen.getByLabelText('Time spent'), { target: { value: '1h' } });
            fireEvent.click(screen.getByRole('button', { name: 'Save work' }));
            await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
            const method = operation === 'create' ? api.logTaskWork : api.editTaskWorklog;
            expect(method.mock.calls.at(-1)?.at(-1)).toMatchObject({ author_id: 2,
                ...(mode === 'auto' ? {} : { remaining_mode: mode }), ...(mode === 'set' ? { remaining_estimate: '45m' } : {}) });
            expect(screen.getByRole('status')).toHaveTextContent('approved leave');
            unmount();
        }
    });

    test('list shows logged-by attribution only when someone else logged the author’s time', async () => {
        api.getTaskWorklogs.mockResolvedValue({ data: { worklogs: [
            { ...worklog, author_id: 2, author: { id: 2, full_name: 'Bob', username: 'bob' }, comment: 'On behalf' },
            { ...worklog, id: 5, comment: 'Own time' },
        ], time_spent_minutes: 300 } });
        render(<TaskTimePanel task={ticket} />);
        const list = await screen.findByRole('list', { name: 'Worklogs' });
        const behalf = within(list).getByText('On behalf').closest('li')!;
        expect(within(behalf).getByText('Bob')).toBeTruthy();
        expect(within(behalf).getByText(/Logged by Alice/)).toBeTruthy();
        const own = within(list).getByText('Own time').closest('li')!;
        expect(within(own).getByText('Alice')).toBeTruthy();
        expect(within(own).queryByText(/Logged by/)).toBeNull();
    });

    test('shows edit/delete solely from each server capability, not ticket capability or authorship', async () => {
        api.getTaskWorklogs.mockResolvedValue({ data: { worklogs: [
            { ...worklog, canEdit: true, canDelete: false, author_id: 99, comment: 'Edit allowed' },
            { ...worklog, id: 5, canEdit: false, canDelete: true, comment: 'Delete allowed' },
            { ...worklog, id: 6, canEdit: false, canDelete: false, comment: 'Not allowed' },
        ], time_spent_minutes: 450 } });
        render(<TaskTimePanel task={{ ...ticket, capabilities: { can: { logWork: { allowed: false } } } }} />);
        const list = await screen.findByRole('list', { name: 'Worklogs' });
        const rows = ['Edit allowed', 'Delete allowed', 'Not allowed'].map(comment => within(list).getByText(comment).closest('li')!);
        expect(within(rows[0]).getByRole('button', { name: 'Edit worklog' })).toBeTruthy();
        expect(within(rows[0]).queryByRole('button', { name: 'Delete worklog' })).toBeNull();
        expect(within(rows[1]).queryByRole('button', { name: 'Edit worklog' })).toBeNull();
        expect(within(rows[1]).getByRole('button', { name: 'Delete worklog' })).toBeTruthy();
        expect(within(rows[2]).queryByRole('button')).toBeNull();
    });
    test('edit reuses the prefilled Log work dialog, sends only changed fields and replaces a stale list row immediately', async () => {
        const own = { ...worklog, canEdit: true, canDelete: true };
        api.getTaskWorklogs.mockResolvedValue({ data: { worklogs: [own], time_spent_minutes: 150 } });
        api.editTaskWorklog.mockResolvedValue({ data: { worklog: { ...own, comment: 'Corrected comment' }, ticket: { time_spent_minutes: 150 }, warnings: [] } });
        render(<TaskTimePanel task={{ ...ticket, time_spent_minutes: 150 }} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Edit worklog' }));
        const dialog = screen.getByRole('dialog', { name: 'Edit worklog' });
        expect(within(dialog).getByLabelText('Day worked')).toHaveValue('2026-11-01');
        expect(within(dialog).getByLabelText('Time spent')).toHaveValue('2h 30m');
        expect(within(dialog).getByLabelText('Start time (optional)')).toHaveValue('09:30');
        expect(within(dialog).getByLabelText('Comment (optional)')).toHaveValue('Review work');
        expect(within(dialog).getByRole('button', { name: 'Save work' })).toBeDisabled();
        fireEvent.change(within(dialog).getByLabelText('Comment (optional)'), { target: { value: 'Corrected comment' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save work' }));
        await waitFor(() => expect(api.editTaskWorklog).toHaveBeenCalledWith(1, 4, { comment: 'Corrected comment' }));
        expect(api.logTaskWork).not.toHaveBeenCalled();
        expect(await screen.findByText('Corrected comment')).toBeTruthy();
        expect(screen.queryByText('Review work')).toBeNull();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    test('delete asks for confirmation, cancel preserves work, and success immediately removes the row and time', async () => {
        const own = { ...worklog, canEdit: true, canDelete: true };
        api.getTaskWorklogs.mockResolvedValue({ data: { worklogs: [own], time_spent_minutes: 150 } });
        api.deleteTaskWorklog.mockReset().mockResolvedValue({ data: { ticket: { id: 1, time_spent_minutes: 0 } } });
        render(<TaskTimePanel task={{ ...ticket, time_spent_minutes: 150 }} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Delete worklog' }));
        let dialog = screen.getByRole('dialog', { name: 'Delete worklog?' });
        expect(within(dialog).getByText(/history/i)).toBeTruthy();
        expect(api.deleteTaskWorklog).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        expect(screen.getByText('Review work')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Delete worklog' }));
        dialog = screen.getByRole('dialog', { name: 'Delete worklog?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete worklog' }));
        await waitFor(() => expect(api.deleteTaskWorklog).toHaveBeenCalledWith(1, 4, {}));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(screen.queryByText('Review work')).toBeNull();
        expect(screen.getByText('No work logged yet')).toBeTruthy();
        expect(screen.getByText('0m / —')).toBeTruthy();
    });

    test('edit clears optional fields explicitly and keeps errors and submitted fields visible', async () => {
        api.getTaskWorklogs.mockResolvedValue({ data: { worklogs: [{ ...worklog, canEdit: true, canDelete: true }], time_spent_minutes: 150 } });
        api.editTaskWorklog.mockRejectedValue({ response: { data: { code: 'INVALID_DURATION', error: 'Enter a positive duration.' } } });
        render(<TaskTimePanel task={ticket} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Edit worklog' }));
        fireEvent.change(screen.getByLabelText('Start time (optional)'), { target: { value: '' } });
        fireEvent.change(screen.getByLabelText('Comment (optional)'), { target: { value: '' } });
        fireEvent.change(screen.getByLabelText('Time spent'), { target: { value: 'abc' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save work' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Enter a positive duration.');
        expect(api.editTaskWorklog).toHaveBeenCalledWith(1, 4, { start_time: null, comment: null, time_spent: 'abc' });
        expect(screen.getByLabelText('Time spent')).toHaveValue('abc');
        expect(screen.getByText('Review work')).toBeTruthy();
    });

    test('failed deletion retains work and total; duplicate confirm cannot submit twice', async () => {
        api.getTaskWorklogs.mockResolvedValue({ data: { worklogs: [{ ...worklog, canEdit: true, canDelete: true }], time_spent_minutes: 150 } });
        let reject!: (reason: unknown) => void;
        api.deleteTaskWorklog.mockReturnValue(new Promise((_resolve, failure) => { reject = failure; }));
        render(<TaskTimePanel task={{ ...ticket, time_spent_minutes: 150 }} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Delete worklog' }));
        const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete worklog' });
        fireEvent.click(confirm);
        fireEvent.click(confirm);
        expect(api.deleteTaskWorklog).toHaveBeenCalledTimes(1);
        await act(async () => { reject({ response: { data: { error: 'Access denied' } } }); });
        expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
        expect(screen.getByText('Review work')).toBeTruthy();
        expect(screen.getByText('2h 30m / —')).toBeTruthy();
    });

    test('later realtime replaces locally saved edits with the latest server worklog', async () => {
        const own = { ...worklog, canEdit: true, canDelete: true };
        api.getTaskWorklogs.mockResolvedValue({ data: { worklogs: [own], time_spent_minutes: 150 } });
        api.editTaskWorklog.mockResolvedValue({ data: { worklog: { ...own, comment: 'My edit' }, ticket: { time_spent_minutes: 150 }, warnings: [] } });
        render(<TaskTimePanel task={ticket} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Edit worklog' }));
        fireEvent.change(screen.getByLabelText('Comment (optional)'), { target: { value: 'My edit' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save work' }));
        await screen.findByText('My edit');
        api.getTaskWorklogs.mockResolvedValue({ data: { worklogs: [{ ...own, comment: 'Newer edit from another tab' }], time_spent_minutes: 150 } });
        act(() => { window.dispatchEvent(new CustomEvent('aino-realtime', { detail: { type: 'task_updated', data: { taskId: 1 } } })); });
        expect(await screen.findByText('Newer edit from another tab')).toBeTruthy();
        expect(screen.queryByText('My edit')).toBeNull();
    });

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
