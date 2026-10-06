import React,{useEffect,useState} from 'react';
import {View,Text,TouchableOpacity,Platform} from 'react-native';
import DateTimePicker,{DateTimePickerAndroid} from '@react-native-community/datetimepicker';
import {Screen,BackHeader,FieldLabel,Input} from '../src/components/ui';
import PrimaryButton from '../src/components/PrimaryButton';
import {toIso,fromIso,apiMessage} from '../src/services/leave';
import {loadWeek,saveDay,submitWeek,Week} from '../src/services/timesheets';

export default function MyTimesheets(){
 const [day,setDay]=useState(toIso(new Date())),[week,setWeek]=useState<Week|null>(null),[start,setStart]=useState(''),[finish,setFinish]=useState(''),[breaks,setBreaks]=useState('0'),[notes,setNotes]=useState(''),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[message,setMessage]=useState(''),[picker,setPicker]=useState(false);
 function fields(data:Week,date:string){const row=data.entries.find(r=>r.date===date);setStart(row?.start||'');setFinish(row?.finish||'');setBreaks(String(row?.break_minutes||0));setNotes(row?.notes||'');setDirty(false);}
 async function load(date:string){setBusy(true);try{const data=await loadWeek(date);setWeek(data);fields(data,date);}catch(e){setWeek(null);setMessage(String(apiMessage(e)));}finally{setBusy(false);}}
 useEffect(()=>{load(day);},[day]);
 function edit(fn:(v:string)=>void,value:string){fn(value);setDirty(true);setMessage('Unsaved day — save before submitting the week.');}
 async function save(){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(finish)||!/^\d+$/.test(breaks)){setMessage('Enter times as HH:MM (24 hour) and break minutes as a whole number.');return;}setBusy(true);try{await saveDay(day,{start,finish,break_minutes:Number(breaks),notes});await load(day);setMessage('Day saved as draft. Submit the saved week when ready for payroll.');}catch(e){setMessage(String(apiMessage(e)));}finally{setBusy(false);}}
 async function submit(){if(!week)return;setBusy(true);try{const result=await submitWeek(week.period.id);await load(day);setMessage(`${result.submitted} day(s) submitted to the pay officer.`);}catch(e){setMessage(String(apiMessage(e)));}finally{setBusy(false);}}
 function calendar(){if(Platform.OS==='android')DateTimePickerAndroid.open({value:fromIso(day),mode:'date',onChange:(_,d)=>{if(d)setDay(toIso(d));}});else setPicker(!picker);}
 const current=week?.entries.find(r=>r.date===day),locked=current?.status==='approved'||current?.status==='locked';
 return <Screen testID="my-timesheets"><BackHeader title="My time entries"/><Text style={{color:'white',marginBottom:14}}>Your saved days are linked to your own Simpro employee record. Submit them here for payroll review.</Text>
 <FieldLabel>Working day</FieldLabel>{Platform.OS==='web'?React.createElement('input',{type:'date',value:day,disabled:busy||dirty,'aria-label':'Working day',style:{padding:14,borderRadius:10,fontSize:18},onChange:(e:any)=>{if(e.target.value)setDay(e.target.value);}}):<><PrimaryButton title={day+' · Choose date'} onPress={calendar} disabled={busy||dirty}/>{picker&&<DateTimePicker value={fromIso(day)} mode="date" display="inline" onChange={(_,d)=>{setPicker(false);if(d)setDay(toIso(d));}}/>}</>}
 {week&&<><Text style={{color:'white',marginVertical:12}}>Week: {week.period.start} to {week.period.end}</Text><View style={{gap:6}}>{week.days.map(date=>{const entry=week.entries.find(r=>r.date===date);return <TouchableOpacity key={date} disabled={busy||dirty} onPress={()=>setDay(date)} style={{backgroundColor:date===day?'#ff7900':'#edf2f7',padding:12,borderRadius:9}}><Text>{date} · {entry?`${entry.hours} h · ${entry.status}`:'Not entered'}</Text></TouchableOpacity>;})}</View>
 <FieldLabel>Start (24-hour HH:MM)</FieldLabel><Input value={start} editable={!busy&&!locked} onChangeText={v=>edit(setStart,v)} placeholder="07:00"/>
 <FieldLabel>Finish (24-hour HH:MM)</FieldLabel><Input value={finish} editable={!busy&&!locked} onChangeText={v=>edit(setFinish,v)} placeholder="15:06"/>
 <FieldLabel>Unpaid break (minutes)</FieldLabel><Input value={breaks} editable={!busy&&!locked} keyboardType="number-pad" onChangeText={v=>edit(setBreaks,v)}/>
 <FieldLabel>Notes / allowances to review</FieldLabel><Input value={notes} editable={!busy&&!locked} multiline maxLength={1000} onChangeText={v=>edit(setNotes,v)}/>
 {locked&&<Text style={{color:'white',marginVertical:12}}>This day is approved or locked. Contact your pay officer for a correction.</Text>}
 <PrimaryButton title="Save day" onPress={save} disabled={busy||locked} style={{marginTop:12}}/>
 <PrimaryButton title="Submit saved week to payroll" onPress={submit} disabled={busy||dirty||!week.entries.some(r=>['draft','rejected'].includes(r.status))} variant="green" style={{marginTop:12}}/></>}
 {!!message&&<Text accessibilityLiveRegion="polite" style={{color:'white',marginVertical:16}}>{message}</Text>}
 </Screen>;
}
