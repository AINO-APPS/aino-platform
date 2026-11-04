import { useId, useState } from 'react';
import type { RemainingInput } from '../../api/tasks';
import s from './LogWorkDialog.module.css';

export function useRemainingChoice() {
    const [mode,setMode]=useState<'auto'|'set'|'leave'>('auto');
    const [value,setValue]=useState('');
    const payload: RemainingInput=mode==='auto'?{}:{remaining_mode:mode,...(mode==='set'?{remaining_estimate:value}:{})};
    return {mode,setMode,value,setValue,payload};
}
export default function RemainingEstimateChoice({choice,disabled=false}:{choice:ReturnType<typeof useRemainingChoice>;disabled?:boolean}) {
    const id=useId();
    return <fieldset disabled={disabled} className={s.remaining}>
        <legend>Remaining estimate</legend>
        {([['auto','Adjust automatically'],['set','Set to'],['leave','Leave unchanged']] as const).map(([mode,label])=>
            <label key={mode}><input type="radio" name={`${id}-mode`} value={mode} checked={choice.mode===mode} onChange={()=>choice.setMode(mode)}/>{label}</label>)}
        {choice.mode==='set'&&<label>New remaining estimate<input placeholder="2h 30m" value={choice.value} onChange={e=>choice.setValue(e.target.value)}/></label>}
        <p className={s.hint}>{choice.mode==='auto'?'Adjust by the time added, corrected or removed. An empty forecast stays empty.':choice.mode==='set'?'Use 0m for zero, or empty text to clear the forecast.':'Keep the current forecast.'}</p>
    </fieldset>;
}
