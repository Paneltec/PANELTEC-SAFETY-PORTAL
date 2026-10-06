import axios from 'axios';
import { getStoredJwt } from './auth';
const base = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/me/payroll`;
async function config() { return {headers:{Authorization:`Bearer ${await getStoredJwt()}`},timeout:15000}; }
export type TimeSegment = {id:string;category:string;client_key:string;client_name:string;job_id:string;job_ref?:string;start:string;finish:string;break_minutes:number;notes:string;hours?:number;needs_matching?:boolean};
export type Client = {key:string;name:string;jobs:{id:string;number:string;name:string;site:string}[]};
export type Catalog = {clients:Client[];recent:string[]};
export type DayEntry = {id:string;date:string;start?:string;finish?:string;break_minutes:number;hours:number;status:string;notes?:string;kind:string;segments?:TimeSegment[];revision?:number;site_name?:string;job_ref?:string;rejected_reason?:string};
export type Week = {worker_id:string;period:{id:string;start:string;end:string};days:string[];entries:DayEntry[]};
export async function loadWeek(date:string):Promise<Week>{return (await axios.get(`${base}/timesheets`,{...await config(),params:{period_id:date}})).data;}
export async function saveDay(day:string,body:{start:string;finish:string;break_minutes:number;notes:string}) {
 return (await axios.put(`${base}/timesheets/${day}`,{...body,date:day},await config())).data;
}
export async function submitWeek(period:string){return (await axios.post(`${base}/submit`,null,{...await config(),params:{period_id:period}})).data;}
export async function loadCatalog():Promise<Catalog>{return (await axios.get(`${base}/time-catalog`,await config())).data;}
export async function saveSegments(day:string,segments:TimeSegment[],revision:number){return (await axios.put(`${base}/timesheets/${day}/segments`,{segments,revision},await config())).data;}
