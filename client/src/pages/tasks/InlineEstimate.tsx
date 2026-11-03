import { useState } from 'react';
import { setTaskEstimates, type WorklogTicketSummary } from '../../api/tasks';
import { formatMinutes } from './time';
import s from './TaskTimePanel.module.css';

export default function InlineEstimate({taskId,kind,value,editable,onSaved}:{taskId:number;kind:'original'|'remaining';value:number|null;
    editable:boolean;onSaved:(ticket:WorklogTicketSummary)=>void}) {
    const [editing,setEditing]=useState(false);
    const [draft,setDraft]=useState('');
    const [busy,setBusy]=useState(false);
    const [error,setError]=useState('');
    const label=kind==='original'?'Original estimate':'Remaining estimate';
    const display=value==null?'—':formatMinutes(value);
    const save=async(event:React.FormEvent)=>{
        event.preventDefault(); if(busy)return;
        setBusy(true);setError('');
        try {const {data}=await setTaskEstimates(taskId,{[`${kind}_estimate`]:draft});onSaved(data.ticket);setEditing(false);}
        catch(err){setError((err as {response?:{data?:{error?:string}}}).response?.data?.error || 'Could not save estimate.');}
        finally{setBusy(false);}
    };
    return <div className={s['time-row']}>
        <span className={s['time-label']}>{label}</span>
        {editing&&editable?<form onSubmit={save} className={s['estimate-form']}>
            <input aria-label={label} autoFocus value={draft} disabled={busy} placeholder="2h 30m" onChange={e=>setDraft(e.target.value)}/>
            <button type="submit" disabled={busy} aria-label={`Save ${kind} estimate`}>{busy?'Saving…':'Save'}</button>
            <button type="button" disabled={busy} onClick={()=>{setEditing(false);setError('');}}>Cancel</button>
            <small>Empty clears · 0m sets zero</small>
            {error&&<p role="alert" className={s['time-error']}>{error}</p>}
        </form>:editable?<button type="button" className={s['estimate-value']} aria-label={`Edit ${kind} estimate`}
            onClick={()=>{setDraft(value==null?'':formatMinutes(value));setEditing(true);}}>{display}</button>:<span className={s['time-value']}>{display}</span>}
    </div>;
}
