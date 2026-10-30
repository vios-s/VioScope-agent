/** Local wall time for a datetime-local input, independent of the browser's timezone. */
export function localDateTime(instant:string,timeZone:string) {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant));
 const part=(name:string)=>parts.find(p=>p.type===name)!.value;
 return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
export function utcFromLocal(value:string,timeZone:string) {
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new Error('Enter a date and time.');
 const wall=Date.parse(value+'Z');
 if(!Number.isFinite(wall)||new Date(wall).toISOString().slice(0,16)!==value)throw new Error('Enter a valid date and time.');
 const offsets=new Set<number>();
 for(const hours of [-36,0,36]){const instant=wall+hours*3600000;offsets.add(Date.parse(localDateTime(new Date(instant).toISOString(),timeZone)+'Z')-instant);}
 const matches=[...offsets].map(offset=>new Date(wall-offset).toISOString()).filter(instant=>localDateTime(instant,timeZone)===value);
 if(matches.length!==1)throw new Error(matches.length?'This time occurs twice when the clocks change. Select UTC and enter the exact UTC time.':'This local time does not exist when the clocks change. Choose another time.');
 return matches[0];
}
