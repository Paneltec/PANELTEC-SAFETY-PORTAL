import axios from 'axios';
import { getStoredJwt } from './auth';
const base = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/me/payroll`;
async function config() { return {headers:{Authorization:`Bearer ${await getStoredJwt()}`},timeout:15000}; }
export type DayEntry = {id:string;date:string;start?:string;finish?:string;break_minutes:number;hours:number;status:string;notes?:string;kind:string};
export type Week = {worker_id:string;period:{id:string;start:string;end:string};days:string[];entries:DayEntry[]};
export async function loadWeek(date:string):Promise<Week>{return (await axios.get(`${base}/timesheets`,{...await config(),params:{period_id:date}})).data;}
export async function saveDay(day:string,body:{start:string;finish:string;break_minutes:number;notes:string}) {
 return (await axios.put(`${base}/timesheets/${day}`,{...body,date:day},await config())).data;
}
export async function submitWeek(period:string){return (await axios.post(`${base}/submit`,null,{...await config(),params:{period_id:period}})).data;}
