import React,{useEffect,useRef,useState} from 'react';
import {View,Text,TouchableOpacity,Pressable,Modal,ScrollView,StyleSheet} from 'react-native';
import {Screen,BackHeader,FieldLabel,Input} from '../src/components/ui';
import {toIso,fromIso,apiMessage} from '../src/services/leave';
import {loadWeek,loadCatalog,saveSegments,submitWeek,Week,TimeSegment,Client,Catalog,DayEntry} from '../src/services/timesheets';

const orange='#ff790b',white='#f4f6f9',muted='#aec3da';
const categories=[['yard','Yard / Workshop'],['travel','Travel'],['training','Training'],['office','Office']];
const mins=(v:string)=>Number(v.split(':')[0])*60+Number(v.split(':')[1]);
const hhmm=(n:number)=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const clock=(v:string)=>{const n=mins(v),h=Math.floor(n/60);return `${h%12||12}:${String(n%60).padStart(2,'0')} ${h>=12?'pm':'am'}`;};
const hours=(s:TimeSegment)=>Math.max(0,(mins(s.finish)-mins(s.start)-s.break_minutes)/60);
const fmt=(v:number)=>Number(v.toFixed(2)).toString();
const shift=(v:string,n:number)=>{const d=fromIso(v);d.setDate(d.getDate()+n);return toIso(d);};
const label=(v:string,opts:any)=>fromIso(v).toLocaleDateString('en-AU',opts);

function segmentsOf(row?:DayEntry):TimeSegment[]{
 if(row?.segments)return row.segments;
 if(row?.kind==='work'&&row.start&&row.finish)return [{id:`legacy-${row.id}`,category:'unmatched',client_key:'',client_name:row.site_name||'Previous time entry',job_id:'',start:row.start,finish:row.finish,break_minutes:row.break_minutes||0,notes:[row.notes,row.job_ref?`Previous job: ${row.job_ref}`:''].filter(Boolean).join(' · ')}];
 return [];
}
function Stepper({title,value,onChange}:{title:string;value:string;onChange:(v:string)=>void}){
 const held=useRef(false);
 function move(n:number){onChange(hhmm(Math.max(0,Math.min(1439,mins(value)+n))));}
 return <View style={s.timeCard}><Text style={s.small}>{title}</Text><Text style={s.time}>{clock(value)}</Text><View style={s.row}>{[-1,1].map(sign=><Pressable key={sign} accessibilityRole="button" accessibilityLabel={`${title} ${sign<0?'earlier':'later'} 15 minutes; hold for one hour`} onPressIn={()=>{held.current=false;}} onLongPress={()=>{held.current=true;move(sign*60);}} delayLongPress={500} onPress={()=>{if(!held.current)move(sign*15);}} style={s.step}><Text style={s.stepText}>{sign<0?'−':'+'}</Text></Pressable>)}</View><Text style={s.hint}>hold for 1 hour</Text></View>;
}
export default function MyTimesheets(){
 const [day,setDay]=useState(toIso(new Date())),[week,setWeek]=useState<Week|null>(null),[catalog,setCatalog]=useState<Catalog>({clients:[],recent:[]}),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [stage,setStage]=useState<'week'|'client'|'job'|'time'>('week'),[draft,setDraft]=useState<TimeSegment|null>(null),[client,setClient]=useState<Client|null>(null),[search,setSearch]=useState(''),[unknown,setUnknown]=useState(''),[limit,setLimit]=useState(40);
 const [clientOpen,setClientOpen]=useState(false);
 const [confirmation,setConfirmation]=useState<{message:string;action:()=>void}|null>(null);
 function confirmAction(message:string,action:()=>void){setConfirmation({message,action});}
 const request=useRef(0),saving=useRef(false);
 async function load(date:string){const token=++request.current;setBusy(true);try{const data=await loadWeek(date);if(token===request.current)setWeek(data);}catch(e){if(token===request.current){setWeek(null);setMessage(String(apiMessage(e)));}}finally{if(token===request.current)setBusy(false);}}
 useEffect(()=>{load(day);},[day]);
 useEffect(()=>{loadCatalog().then(setCatalog).catch(()=>setMessage('Client list is unavailable. You can still record a client name for the office to match.'));},[]);
 const current=week?.entries.find(r=>r.date===day),entries=segmentsOf(current),locked=!!current&&!['draft','rejected'].includes(current.status),legacyBlocked=!!current&&!current.segments&&(!current.start||!current.finish||current.kind!=='work');
 function navigate(date:string){setMessage('');setDay(date);}
 function begin(){const last=entries.length?entries.reduce((n,e)=>Math.max(n,mins(e.finish)),0):420;setDraft({id:`time-${Date.now()}-${Math.random().toString(36).slice(2,10)}`,category:'client',client_key:'',client_name:'',job_id:'',start:hhmm(last),finish:hhmm(Math.min(1439,last+60)),break_minutes:0,notes:''});setSearch('');setUnknown('');setClient(null);setStage('time');setClientOpen(false);setMessage('');}
 function choose(c:Client){setClient(c);setDraft(d=>d?{...d,category:'client',client_key:c.key,client_name:c.name,job_id:'',job_ref:''}:d);setClientOpen(false);setStage(c.jobs.length?'job':'time');}
 function nonClient(category:string,name:string){setDraft(d=>d?{...d,category,client_key:'',client_name:name,job_id:'',job_ref:''}:d);setClientOpen(false);setStage('time');}
 async function persist(next:TimeSegment[]){if(saving.current)return;saving.current=true;setBusy(true);setMessage('');try{await saveSegments(day,next,current?.revision||0);setStage('week');setDraft(null);await load(day);loadCatalog().then(setCatalog).catch(()=>{});setMessage('Time saved. Send the week when it is complete.');}catch(e){setMessage(String(apiMessage(e)));}finally{setBusy(false);saving.current=false;}}
 function save(){if(!draft)return;if(!draft.client_name.trim()){setMessage('Choose a client or non-client time before saving.');return;}const start=mins(draft.start),end=mins(draft.finish);if(end<=start){setMessage('Finish must be later than start on the same day.');return;}if(end-start<=draft.break_minutes){setMessage('Break must be shorter than the time worked.');return;}if(entries.some(e=>e.id!==draft.id&&start<mins(e.finish)&&end>mins(e.start))){setMessage('Times overlap. Adjust the start or finish before saving.');return;}persist([...entries.filter(e=>e.id!==draft.id),draft]);}
 async function send(){if(!week||saving.current)return;saving.current=true;setBusy(true);try{const result=await submitWeek(week.period.id);await load(day);setMessage(`${result.submitted} day(s) sent to the office. Sent days are now locked.`);}catch(e){setMessage(String(apiMessage(e)));}finally{setBusy(false);saving.current=false;}}
 function leaveEditor(){confirmAction('Discard this unsaved time entry?',()=>{setStage('week');setDraft(null);setMessage('');});}
 const button=(title:string,action:()=>void,color=orange,disabled=false)=><TouchableOpacity accessibilityRole="button" disabled={busy||disabled} onPress={action} style={[s.button,{backgroundColor:color,opacity:busy||disabled?0.45:1}]}><Text style={s.buttonText}>{title}</Text></TouchableOpacity>;
 const tile=(title:string,sub:string,action:()=>void,key:string)=><TouchableOpacity key={key} accessibilityRole="button" onPress={action} disabled={busy} style={s.tile}><View style={{flex:1}}><Text style={s.tileTitle}>{title}</Text>{!!sub&&<Text style={s.subtitle}>{sub}</Text>}</View><Text style={s.chevron}>›</Text></TouchableOpacity>;
 const query=search.trim().toLowerCase();
 const filtered=catalog.clients.filter(c=>!query||c.name.toLowerCase().includes(query)||c.jobs.some(j=>`${j.number} ${j.name} ${j.site}`.toLowerCase().includes(query)));
 const recent=filtered.filter(c=>catalog.recent.includes(c.key));
 const pending=week?.entries.filter(r=>['draft','rejected'].includes(r.status)&&r.hours>0).length||0;
 return <Screen testID="my-timesheets">
 {stage==='week'?<BackHeader title="My Timesheet"/>:<View style={[s.row,{marginBottom:10}]}><TouchableOpacity accessibilityLabel="Cancel time entry" onPress={leaveEditor} style={s.nav}><Text style={s.navText}>‹</Text></TouchableOpacity><Text style={s.heading}>{stage==='time'?'Add time':'Select client'}</Text></View>}
 {confirmation&&<Modal transparent visible onRequestClose={()=>setConfirmation(null)}><View style={{flex:1,backgroundColor:"rgba(0,0,0,0.6)",justifyContent:"center",padding:24}}><View accessibilityRole="alert" style={s.notice}><Text style={{color:'white',fontSize:18}}>{confirmation.message}</Text>{button('Confirm',()=>{const action=confirmation.action;setConfirmation(null);action();},'#19c45c')}{button('Cancel',()=>setConfirmation(null),'#b4c5d8')}</View></View></Modal>}
 {!!message&&<View style={s.notice}><Text accessibilityLiveRegion="polite" style={{color:'white'}}>{message}</Text>{message.toLowerCase().includes('reload')&&button('Reload week',()=>{setStage('week');setDraft(null);load(day);})}</View>}
 {stage==='week'?<>
 <View style={[s.row,s.week]}><TouchableOpacity accessibilityLabel="Previous week" disabled={busy} onPress={()=>navigate(shift(day,-7))} style={s.nav}><Text style={s.navText}>‹</Text></TouchableOpacity><View style={{flex:1,alignItems:'center'}}><Text style={s.weekTitle}>{week?`${label(week.period.start,{day:'numeric',month:'short'})} – ${label(week.period.end,{day:'numeric',month:'short'})}`:'Loading week…'}</Text><Text style={s.light}>{fmt(week?.entries.reduce((n,e)=>n+e.hours,0)||0)} h this week</Text></View><TouchableOpacity accessibilityLabel="Next week" disabled={busy} onPress={()=>navigate(shift(day,7))} style={s.nav}><Text style={s.navText}>›</Text></TouchableOpacity></View>
 <View style={[s.row,{gap:4,marginBottom:16}]}>{week?.days.map(date=>{const row=week.entries.find(e=>e.date===date);return <TouchableOpacity key={date} accessibilityLabel={`${label(date,{weekday:'long',day:'numeric'})}, ${row?.hours||0} hours`} disabled={busy} onPress={()=>navigate(date)} style={[s.day,{backgroundColor:date===day?orange:white}]}><Text style={s.dayLabel}>{label(date,{weekday:'short'})}</Text><Text style={s.dayNum}>{fromIso(date).getDate()}</Text><Text style={s.dayLabel}>{row?.hours?`${fmt(row.hours)}h`:'—'}</Text></TouchableOpacity>;})}</View>
 <View style={[s.row,{justifyContent:'space-between',marginBottom:12}]}><Text style={[s.heading,{fontSize:18,flex:1}]}>{label(day,{weekday:'long',day:'numeric',month:'long'})}</Text><Text style={s.badge}>{locked?'SENT':current?.status==='rejected'?'RETURNED':'NOT SENT'}</Text></View>
 {!!current?.rejected_reason&&<Text style={s.light}>Office: {current.rejected_reason}</Text>}
 {entries.map(e=><View key={e.id} style={s.tile}><TouchableOpacity accessibilityRole="button" accessibilityLabel={`Edit ${e.client_name} ${e.start} to ${e.finish}`} disabled={busy||locked||legacyBlocked} style={{flex:1}} onPress={()=>{setDraft({...e});setStage('time');setMessage('');}}><Text style={s.tileTitle}>{e.client_name}</Text>{!!e.job_ref&&<Text style={s.subtitle}>Job {e.job_ref}</Text>}<Text style={s.subtitle}>{clock(e.start)} – {clock(e.finish)}{e.break_minutes?` · ${e.break_minutes} min break`:''}</Text>{!!e.notes&&<Text style={s.hint}>{e.notes}</Text>}{e.category==='unmatched'&&<Text style={s.hint}>Office to match client</Text>}</TouchableOpacity><Text style={s.tileTitle}>{fmt(hours(e))} h</Text>{!locked&&!legacyBlocked&&<TouchableOpacity accessibilityLabel={`Remove ${e.client_name} time entry`} disabled={busy} style={s.nav} onPress={()=>confirmAction('Remove this time entry?',()=>persist(entries.filter(v=>v.id!==e.id)))}><Text style={{fontSize:24,color:'#738091'}}>×</Text></TouchableOpacity>}</View>)}
 {!entries.length&&<Text style={[s.light,{marginVertical:20}]}>{legacyBlocked?'This day was entered by the office. Contact your pay officer to change it.':'No time entered for this day.'}</Text>}
 <View style={[s.row,{justifyContent:'space-between',margin:6}]}><Text style={s.light}>Day total</Text><Text style={s.weekTitle}>{fmt(current?.hours||0)} h</Text></View>
 {locked?<Text style={[s.light,{marginVertical:16}]}>Sent days are locked. Ask the office to send this day back if it needs changing.</Text>:button('+ ADD TIME',begin,orange,!week||legacyBlocked)}
 <FieldLabel>This week</FieldLabel>{button(`SEND WEEK TO OFFICE (${pending} DAYS)`,()=>confirmAction('Send all saved days this week? They will be locked until the office sends them back.',send),'#19c45c',!pending)}<Text style={[s.light,{textAlign:'center',marginTop:12}]}>Send once your week is complete. The office approves it and it goes through to pay.</Text>
 </>:<>
 {draft&&<>
 <FieldLabel>Client / activity</FieldLabel>
 <TouchableOpacity accessibilityRole="button" accessibilityLabel="Select Simpro client" accessibilityState={{expanded:clientOpen}} onPress={()=>{setClientOpen(!clientOpen);setSearch('');setLimit(40);setStage('time');}} style={s.select}>
 <Text style={[s.tileTitle,{flex:1}]}>{draft.client_name||'Choose a client…'}</Text><Text style={s.chevron}>{clientOpen?'⌃':'⌄'}</Text>
 </TouchableOpacity>
 {clientOpen&&<View style={s.dropdown}>
 <Input style={s.search} accessibilityLabel="Search Simpro clients or jobs" placeholder="Search clients or jobs…" value={search} onChangeText={v=>{setSearch(v);setLimit(40);}}/>
 <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{maxHeight:240}}>
 {!!recent.length&&<><Text style={s.group}>Recent clients</Text>{recent.map(c=>tile(c.name,c.jobs.length?`${c.jobs.length} open jobs`:'',()=>choose(c),c.key))}</>}
 <Text style={s.group}>Simpro clients</Text>
 {filtered.filter(c=>!recent.includes(c)).slice(0,limit).map(c=>tile(c.name,c.jobs.length?`${c.jobs.length} open jobs`:'',()=>choose(c),c.key))}
 {!filtered.length&&<Text style={s.subtitle}>No matching clients.</Text>}
 {filtered.filter(c=>!recent.includes(c)).length>limit&&button('Show more clients',()=>setLimit(limit+40))}
 <Text style={s.group}>Not for a client</Text>{categories.filter(([,name])=>!query||name.toLowerCase().includes(query)).map(([key,name])=>tile(name,'',()=>nonClient(key,name),key))}
 </ScrollView>
 <Input style={[s.search,{marginTop:8}]} accessibilityLabel="Unlisted client name" placeholder="Client not listed? Enter name" maxLength={160} value={unknown} onChangeText={setUnknown}/>
 {!!unknown.trim()&&button('Use name · office to match',()=>nonClient('unmatched',unknown.trim()))}
 </View>}
 {stage==='job'&&<View style={s.dropdown}><Text style={s.group}>Choose a job (optional)</Text>{tile('No particular job','',()=>setStage('time'),'none')}{client?.jobs.map(j=>tile(`Job ${j.number} · ${j.name}`,j.site,()=>{setDraft({...draft,job_id:j.id,job_ref:j.number});setStage('time');},j.id))}</View>}
 {!!draft.job_ref&&<TouchableOpacity accessibilityRole="button" onPress={()=>{setClient(catalog.clients.find(c=>c.key===draft.client_key)||null);setStage('job');}}><Text style={s.light}>Job {draft.job_ref} · Change</Text></TouchableOpacity>}
 <FieldLabel>Day</FieldLabel><View style={s.tile}><Text style={[s.tileTitle,{textAlign:'center',flex:1}]}>{label(day,{weekday:'long',day:'numeric',month:'long'})}</Text></View>
 <View style={[s.row,{alignItems:'stretch',gap:10}]}><Stepper title="Start" value={draft.start} onChange={start=>setDraft({...draft,start})}/><Stepper title="Finish" value={draft.finish} onChange={finish=>setDraft({...draft,finish})}/></View>
 <FieldLabel>Break</FieldLabel><View style={[s.row,{flexWrap:'wrap',gap:8}]}>{[0,15,30,45,60].map(n=><TouchableOpacity key={n} accessibilityRole="button" accessibilityLabel={`${n} minute break`} onPress={()=>setDraft({...draft,break_minutes:n})} style={[s.break,{backgroundColor:draft.break_minutes===n?orange:white}]}><Text style={s.tileTitle}>{n?`${n} min`:'None'}</Text></TouchableOpacity>)}</View>
 <FieldLabel>Notes (optional)</FieldLabel><Input accessibilityLabel="Time entry notes" style={{minHeight:64,paddingVertical:10,fontSize:14}} placeholder="What you did, plant used…" multiline maxLength={1000} value={draft.notes} onChangeText={notes=>setDraft({...draft,notes})}/><View style={[s.row,{justifyContent:'space-between',marginVertical:12}]}><Text style={s.light}>Hours</Text><Text style={s.heading}>{fmt(hours(draft))} h</Text></View>{button('SAVE TIME',save,'#19c45c')}
 </>}
 </>}
 </Screen>;
}
const s=StyleSheet.create({select:{backgroundColor:white,borderRadius:10,paddingHorizontal:12,minHeight:46,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:orange},dropdown:{backgroundColor:white,borderRadius:10,padding:10,marginTop:4,marginBottom:8},search:{minHeight:44,paddingVertical:9,fontSize:14},group:{color:'#49586b',fontSize:11,fontWeight:'700',marginTop:10,marginBottom:6},row:{flexDirection:'row',alignItems:'center'},heading:{color:white,fontSize:22,fontWeight:'700'},week:{backgroundColor:'#2a4b70',borderRadius:16,paddingVertical:8,marginBottom:12},weekTitle:{color:white,fontSize:18,fontWeight:'700'},light:{color:muted,fontSize:14},nav:{minWidth:40,minHeight:48,alignItems:'center',justifyContent:'center'},navText:{color:white,fontSize:38},day:{flex:1,borderRadius:12,paddingVertical:8,alignItems:'center',minHeight:68},dayLabel:{fontSize:12,fontWeight:'600',color:'#34475b'},dayNum:{fontSize:19,fontWeight:'700',marginVertical:3},badge:{backgroundColor:'#355678',padding:7,borderRadius:20,color:muted,fontSize:10,fontWeight:'700'},tile:{backgroundColor:white,borderRadius:12,padding:12,marginBottom:8,flexDirection:'row',alignItems:'center',gap:8},tileTitle:{fontSize:15,fontWeight:'700',color:'#142333'},subtitle:{fontSize:13,color:'#49586b',marginTop:3},chevron:{fontSize:30,color:'#8694a1'},button:{borderRadius:12,padding:12,alignItems:'center',marginTop:10,minHeight:48},buttonText:{fontSize:15,fontWeight:'800',color:'#10271b',textAlign:'center'},notice:{backgroundColor:'#355678',borderRadius:12,padding:12,marginBottom:12},timeCard:{backgroundColor:white,borderRadius:14,padding:10,flex:1,alignItems:'center'},small:{textTransform:'uppercase',color:'#7a8796',fontWeight:'700',letterSpacing:2,fontSize:13},time:{fontSize:22,fontWeight:'700',marginVertical:10},step:{backgroundColor:'#e2e6eb',borderRadius:14,minWidth:48,minHeight:44,alignItems:'center',justifyContent:'center',marginHorizontal:3},stepText:{fontSize:30},hint:{fontSize:12,color:'#758498',marginTop:5},break:{padding:10,borderRadius:10,minHeight:44}});
