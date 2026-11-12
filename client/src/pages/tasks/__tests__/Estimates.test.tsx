import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TaskTimePanel from '../TaskTimePanel';
const api=vi.hoisted(()=>({getTaskWorklogs:vi.fn(),logTaskWork:vi.fn(),editTaskWorklog:vi.fn(),deleteTaskWorklog:vi.fn(),setTaskEstimates:vi.fn()}));
vi.mock('../../../api/tasks',()=>api);
const ticket={id:1,original_estimate_minutes:120,remaining_estimate_minutes:75,time_spent_minutes:150,
    capabilities:{can:{logWork:{allowed:true},canEditEstimate:{allowed:true}}}};
beforeEach(()=>{vi.clearAllMocks();api.getTaskWorklogs.mockResolvedValue({data:{worklogs:[],time_spent_minutes:150}});
    api.setTaskEstimates.mockResolvedValue({data:{ticket:{...ticket,original_estimate_minutes:180,remaining_estimate_minutes:75}}});});
const worklog={id:4,task_id:1,author_id:1,logged_by_id:1,author:{id:1,full_name:'Alice'},logged_by:{id:1,full_name:'Alice'},
    day_worked:'2026-11-01',minutes:30,comment:'Effort',start_time:null,canEdit:true,canDelete:true};
test('parent effort names own and including-subtask totals separately', async () => {
    render(<TaskTimePanel task={{ ...ticket, subtask_summary: { total: 2, done: 1 }, effort: {
        own_time_spent_minutes: 150, total_time_spent_minutes: 210,
        own_remaining_estimate_minutes: 75, total_remaining_estimate_minutes: 105,
    } }} />);
    const totals = screen.getByRole('group', { name: 'Including subtasks' });
    expect(totals).toHaveTextContent('3h 30m spent');
    expect(totals).toHaveTextContent('1h 45m remaining');
    expect(screen.getByText('Own time spent')).toBeTruthy();
    await screen.findByText('No work logged yet');
});
test.each(['create','edit','delete'])('remaining choices send auto/set/leave payloads for %s',async(operation)=>{
    api.getTaskWorklogs.mockResolvedValue({data:{worklogs:operation==='create'?[]:[worklog],time_spent_minutes:30}});
    for(const mode of ['auto','set','leave']){
        const response={data:{worklog,ticket:{...ticket,time_spent_minutes:30},warnings:[]}};
        api.logTaskWork.mockResolvedValue(response);api.editTaskWorklog.mockResolvedValue(response);api.deleteTaskWorklog.mockResolvedValue(response);
        const {unmount}=render(<TaskTimePanel task={ticket}/>);
        fireEvent.click(await screen.findByRole('button',{name:operation==='create'?'Log work':operation==='edit'?'Edit worklog':'Delete worklog'}));
        const dialog=screen.getByRole('dialog');
        fireEvent.click(within(dialog).getByLabelText(mode==='auto'?'Adjust automatically':mode==='set'?'Set to':'Leave unchanged'));
        if(mode==='set')fireEvent.change(within(dialog).getByLabelText('New remaining estimate'),{target:{value:'45m'}});
        if(operation!=='delete')fireEvent.change(within(dialog).getByLabelText('Time spent'),{target:{value:'1h'}});
        fireEvent.click(within(dialog).getByRole('button',{name:operation==='delete'?'Delete worklog':'Save work'}));
        const method=operation==='create'?api.logTaskWork:operation==='edit'?api.editTaskWorklog:api.deleteTaskWorklog;
        await waitFor(()=>expect(method).toHaveBeenCalled());
        const args=method.mock.calls.at(-1)!;
        expect(args.at(-1)).toMatchObject(mode==='auto'?{}:{remaining_mode:mode,...(mode==='set'?{remaining_estimate:'45m'}:{})});
        if(mode==='auto')expect(args.at(-1)?.remaining_mode).toBeUndefined();
        unmount();
    }
});
test.each([[30,90,120,25],[150,75,120,67],[30,0,0,100],[0,0,0,0],[0,60,null,0]])(
    'effort bar uses spent %i and remaining %i rather than original %i', async(spent,remaining,original,percent)=>{
        api.getTaskWorklogs.mockResolvedValue({data:{worklogs:[],time_spent_minutes:spent,original_estimate_minutes:original,remaining_estimate_minutes:remaining}});
        render(<TaskTimePanel task={{...ticket,time_spent_minutes:spent,original_estimate_minutes:original,remaining_estimate_minutes:remaining}}/>);
        await screen.findByText('No work logged yet');
        expect(screen.getByRole('progressbar',{name:'Time spent and remaining'})).toHaveAttribute('aria-valuenow',String(percent));
        expect(screen.queryByText('Over estimate')!==null).toBe(original!==null && spent>original);
    });
test('no remaining forecast hides the effort bar without hiding the original estimate',async()=>{
    api.getTaskWorklogs.mockResolvedValue({data:{worklogs:[],time_spent_minutes:30,original_estimate_minutes:120,remaining_estimate_minutes:null}});
    render(<TaskTimePanel task={{...ticket,time_spent_minutes:30,remaining_estimate_minutes:null}}/>);
    await screen.findByText('No work logged yet');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByRole('button',{name:'Edit original estimate'})).toHaveTextContent('2h');
});

test('a late worklog list response cannot undo a saved estimate snapshot',async()=>{
    let release!: (value: unknown) => void;
    api.getTaskWorklogs.mockReturnValue(new Promise(resolve=>{ release=resolve; }));
    api.setTaskEstimates.mockResolvedValue({data:{ticket:{...ticket,time_spent_minutes:30,original_estimate_minutes:180,remaining_estimate_minutes:90}}});
    render(<TaskTimePanel task={ticket}/>);
    fireEvent.click(screen.getByRole('button',{name:'Edit original estimate'}));
    fireEvent.change(screen.getByLabelText('Original estimate'),{target:{value:'3h'}});
    fireEvent.click(screen.getByRole('button',{name:'Save original estimate'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Edit original estimate'})).toHaveTextContent('3h'));
    release({data:{worklogs:[],time_spent_minutes:150,original_estimate_minutes:120,remaining_estimate_minutes:75}});
    await screen.findByText('No work logged yet');
    expect(screen.getByRole('button',{name:'Edit original estimate'})).toHaveTextContent('3h');
    expect(screen.getByRole('button',{name:'Edit remaining estimate'})).toHaveTextContent('1h 30m');
    expect(screen.getByText('30m / 3h')).toBeTruthy();
});

test('worklog refresh publishes both estimates and time spent from the list envelope',async()=>{
    api.getTaskWorklogs.mockResolvedValue({data:{worklogs:[],time_spent_minutes:30,original_estimate_minutes:60,remaining_estimate_minutes:0}});
    render(<TaskTimePanel task={ticket}/>);
    await screen.findByText('No work logged yet');
    await waitFor(()=>expect(screen.getByRole('button',{name:'Edit original estimate'})).toHaveTextContent('1h'));
    expect(screen.getByRole('button',{name:'Edit remaining estimate'})).toHaveTextContent('0m');
    expect(screen.getByText('30m / 1h')).toBeTruthy();
});

test('zero original is an explicit estimate and any logged effort is an overrun',async()=>{
    render(<TaskTimePanel task={{...ticket,original_estimate_minutes:0,remaining_estimate_minutes:0,time_spent_minutes:30}}/>);
    expect(screen.getByText('Over estimate')).toBeTruthy();
    expect(screen.getByText('30m / 0m')).toBeTruthy();
    await screen.findByText('No work logged yet');
});
test('inline remaining clears explicitly, keeps rejected input and immediately renders saved values',async()=>{
    api.setTaskEstimates.mockRejectedValueOnce({response:{data:{error:'Invalid estimate'}}});
    api.setTaskEstimates.mockResolvedValueOnce({data:{ticket:{...ticket,remaining_estimate_minutes:null}}});
    render(<TaskTimePanel task={ticket}/>);
    fireEvent.click(screen.getByRole('button',{name:'Edit remaining estimate'}));
    fireEvent.change(screen.getByLabelText('Remaining estimate'),{target:{value:'bad'}});
    fireEvent.click(screen.getByRole('button',{name:'Save remaining estimate'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid estimate');
    expect(screen.getByLabelText('Remaining estimate')).toHaveValue('bad');
    fireEvent.change(screen.getByLabelText('Remaining estimate'),{target:{value:''}});
    fireEvent.click(screen.getByRole('button',{name:'Save remaining estimate'}));
    await waitFor(()=>expect(api.setTaskEstimates).toHaveBeenLastCalledWith(1,{remaining_estimate:''}));
    expect(await screen.findByRole('button',{name:'Edit remaining estimate'})).toHaveTextContent('—');
});
test('inline estimates use only the server capability and immediately show the new forecast and overrun',async()=>{
    const {rerender}=render(<TaskTimePanel task={{...ticket,capabilities:{can:{canEditEstimate:{allowed:false}}}}}/>);
    expect(screen.queryByRole('button',{name:'Edit original estimate'})).toBeNull();
    expect(screen.queryByRole('button',{name:'Edit remaining estimate'})).toBeNull();
    expect(screen.getByText('Over estimate')).toBeTruthy();
    rerender(<TaskTimePanel task={ticket}/>);
    fireEvent.click(screen.getByRole('button',{name:'Edit original estimate'}));
    fireEvent.change(screen.getByLabelText('Original estimate'),{target:{value:'3h'}});
    fireEvent.click(screen.getByRole('button',{name:'Save original estimate'}));
    await waitFor(()=>expect(api.setTaskEstimates).toHaveBeenCalledWith(1,{original_estimate:'3h'}));
    await waitFor(()=>expect(screen.queryByText('Over estimate')).toBeNull());
    expect(screen.getByRole('button',{name:'Edit remaining estimate'})).toHaveTextContent('1h 15m');
});
