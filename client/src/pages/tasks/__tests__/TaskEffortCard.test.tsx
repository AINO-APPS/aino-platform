import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CardBody } from '../TaskCardParts';

test.each([true, false])('shared ticket card shows accessible effort at compact=%s', compact => {
    render(<CardBody keySlot={null} task={{ id: 1, title: 'Effort', time_spent_minutes: 30, original_estimate_minutes: 120, remaining_estimate_minutes: 90 }} compact={compact} blockersEnabled={false} status={{ key: 'todo', label: 'New', color: '#333', ink: '#fff' }} />);
    const summary = screen.getByLabelText('Time spent 30m; original estimate 2h; remaining estimate 1h 30m');
    expect(summary).toBeVisible();
    expect(summary).toHaveTextContent('Spent 30m · Original 2h · Remaining 1h 30m');
});
test('shared ticket card distinguishes unset estimates from explicit zero and supports legacy effort aliases', () => {
    render(<CardBody keySlot={null} task={{ id: 1, title: 'Effort', logged_minutes: 30, estimated_minutes: 0, remaining_estimate_minutes: null }} compact blockersEnabled={false} status={{ key: 'todo', label: 'New', color: '#333', ink: '#fff' }} />);
    expect(screen.getByLabelText('Time spent 30m; original estimate 0m; remaining estimate —')).toHaveTextContent('Spent 30m · Original 0m · Remaining —');
});
