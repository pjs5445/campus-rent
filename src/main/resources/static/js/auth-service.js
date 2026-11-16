import { validateAuth } from './auth-validation.js';
import { api, getSession, resetSession } from './api-client.js';
export class AuthFailure extends Error { constructor(message,field='form'){super(message);this.field=field;} }
export async function authenticate(fields,signup){
 const errors=validateAuth(fields,signup); const first=Object.keys(errors)[0];
 if(first) throw new AuthFailure(errors[first],first);
 return api(signup?'/auth/signup':'/auth/login',{method:'POST',body:fields});
}
export async function currentUser(){return (await getSession()).user;}
export async function logout(){await api('/auth/logout',{method:'POST',body:{}});resetSession();}
