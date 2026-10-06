import axios from 'axios';
import {Platform} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {getStoredJwt} from './auth';
const base=`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/me/payroll/payslips`;
async function config(){const token=await getStoredJwt();if(!token)throw new Error('Please sign in again.');return {headers:{Authorization:`Bearer ${token}`},timeout:30000};}
export async function listPayslips(){return (await axios.get(base,await config())).data.payslips;}
export async function getPayslip(week:string,revision:number){return (await axios.get(`${base}/${week}/${revision}`,await config())).data;}
export async function downloadPayslip(week:string,revision:number){
 const url=`${base}/${week}/${revision}/pdf`,options=await config(),name=`Payslip-${week}-r${revision}.pdf`;
 if(Platform.OS==='web'){
  const response=await axios.get(url,{...options,responseType:'blob'});
  const link=URL.createObjectURL(response.data),a=document.createElement('a');a.href=link;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(link),30000);return;
 }
 if(!await Sharing.isAvailableAsync())throw new Error('PDF sharing is unavailable on this device.');
 const path=`${FileSystem.cacheDirectory}${Date.now()}-${name}`;
 try{const result=await FileSystem.downloadAsync(url,path,{headers:options.headers});if(result.status!==200)throw new Error('Could not download your payslip. Please try again.');await Sharing.shareAsync(path,{mimeType:'application/pdf',UTI:'com.adobe.pdf',dialogTitle:'Save your payslip'});}
 finally{await FileSystem.deleteAsync(path,{idempotent:true}).catch(()=>{});}
}
