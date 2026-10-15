import { ApiError, validateExchange, id, object, SAMPLE_FIELDS } from './protocol.js';
import { requireAdmin, requireDevice, makeSession, equal, sha256 } from './auth.js';
import { exchange, snapshot, history, logs, setConfig, enqueueCommand, commandHistory, registerDevice } from './storage.js';
import { maintenance, archiveList, archiveDownload } from './archive.js';
import { archiveFolders, archiveFiles } from './archive-folders.js';
import { archiveSelection, startManualArchive, continueManualArchive } from './manual-archive.js';
import { createLoginThrottle } from './login-throttle.js';
import { csvCell } from '../public/csv.js';
const headers = { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff' };
const json = (body,status=200,extra={}) => new Response(JSON.stringify(body), {status,headers:{...headers,...extra}});
async function body(request) {
  if (request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase() !== 'application/json') throw new ApiError(415,'json_required','Use application/json');
  if (Number(request.headers.get('content-length')) > 65536) throw new ApiError(413,'payload_too_large','Maximum body is 64 KiB');
  const reader = request.body?.getReader(); let size=0, chunks=[];
  if (reader) for (;;) { const part=await reader.read(); if(part.done) break; size+=part.value.length; if(size>65536){await reader.cancel();throw new ApiError(413,'payload_too_large','Maximum body is 64 KiB');} chunks.push(part.value); }
  const bytes=new Uint8Array(size); let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  let value;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ApiError(400,'invalid_json','Invalid JSON'); }
  return object(value, 'request body');
}
const throttleLogin = createLoginThrottle();
async function manualResponse(operation, status=200) {
  try { return json(await operation(),status); }
  catch(error) {
    if(error instanceof ApiError)throw error;
    console.error('manual_archive_failed');
    throw new ApiError(503,'manual_archive_failed','Manual archiving stopped. Saved chunks are preserved; continue to retry.');
  }
}
async function route(request,env) {
  const url=new URL(request.url), path=url.pathname, method=request.method;
  if(path==='/health' && method==='GET') { const row=await env.DB.prepare('SELECT 1 AS ok').first();return json({status:row?.ok===1?'ok':'degraded',service:'coop-monitor-worker',protocolVersion:1}); }
  if(path==='/auth/login' && method==='POST') {
    if(request.headers.get('origin')!==url.origin) throw new ApiError(403,'origin_rejected','Use this dashboard to sign in');
    throttleLogin(request.headers.get('cf-connecting-ip')??'local');
    const v=await body(request);
    if(typeof v?.key!=='string'||v.key.length>128||!env.ADMIN_TOKEN||!equal(await sha256(v.key),await sha256(env.ADMIN_TOKEN)))throw new ApiError(401,'invalid_owner_key','Invalid owner key');
    return json({signedIn:true},200,{'set-cookie':`coop_session=${await makeSession(env.SESSION_SECRET)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`});
  }
  if(path==='/auth/logout' && method==='POST'){await requireAdmin(request,env);return json({signedIn:false},200,{'set-cookie':'coop_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});}
  if(path==='/api/device/exchange' && method==='POST'){const payload=validateExchange(await body(request)),device=await requireDevice(request,env,payload.deviceId);return json(await exchange(env,device,payload));}
  if(path.startsWith('/api/')) {
    await requireAdmin(request,env);
    if(path==='/api/snapshot' && method==='GET'){
      const view=await snapshot(env), consoleDevice=url.searchParams.get('consoleDeviceId');
      if(consoleDevice){id(consoleDevice);const logUrl=new URL(url);logUrl.searchParams.set('deviceId',consoleDevice);view.console={...await logs(env,logUrl),commands:await commandHistory(env,consoleDevice)};}
      return json(view);
    }
    if(path==='/api/history' && method==='GET')return json(await history(env,url));
    if(path==='/api/export' && method==='GET') {
      const page=await history(env,url),fields=['deviceId','bootId',...SAMPLE_FIELDS,'estimatedAt'];
      const csv=[fields.join(','),...page.readings.map(r=>fields.map(f=>csvCell(r[f])).join(','))].join('\r\n');
      return new Response(csv,{headers:{'content-type':'text/csv; charset=utf-8','cache-control':'no-store','content-disposition':'attachment; filename="coop-readings-page.csv"','x-next-cursor':page.nextCursor??''}});
    }
    if(path==='/api/logs' && method==='GET')return json(await logs(env,url));
    if(path==='/api/archives' && method==='GET')return json(await archiveList(env,url));
    if(path==='/api/archive-folders' && method==='GET')return json(await archiveFolders(env,url));
    if(path==='/api/archive-files' && method==='GET')return json(await archiveFiles(env,url));
    if(path==='/api/archives/selection' && method==='GET')return json(await archiveSelection(env,url));
    if(path==='/api/archives/manual' && method==='POST'){const value=await body(request);return manualResponse(()=>startManualArchive(env,value),201);}
    const manualMatch=/^\/api\/archives\/manual\/([A-Za-z0-9_-]{1,64})$/.exec(path);
    if(manualMatch && method==='POST')return manualResponse(()=>continueManualArchive(env,manualMatch[1]));
    if(path==='/api/archive' && method==='GET')return archiveDownload(env,url.searchParams.get('key')??'');
    if(path==='/api/devices' && method==='POST')return json(await registerDevice(env,await body(request)),201);
    if(path==='/api/maintenance' && method==='POST')return json(await maintenance(env));
    const match=/^\/api\/devices\/([A-Za-z0-9_-]{1,64})\/(config|commands|uploads)$/.exec(path);
    if(match){const deviceId=id(match[1]);
      if(match[2]==='config' && method==='PUT')return json(await setConfig(env,deviceId,await body(request)));
      if(match[2]==='commands' && method==='POST')return json(await enqueueCommand(env,deviceId,await body(request)),201);
      if(match[2]==='commands' && method==='GET')return json({commands:await commandHistory(env,deviceId)});
      if(match[2]==='uploads' && method==='PUT'){const v=await body(request);if(typeof v.paused!=='boolean')throw new ApiError(400,'invalid_pause','paused must be boolean');const r=await env.DB.prepare('UPDATE devices SET writes_paused=? WHERE device_id=?').bind(v.paused?1:0,deviceId).run();if(!r.meta.changes)throw new ApiError(404,'device_not_found','Device is not registered');return json({paused:v.paused});}
    }
    throw new ApiError(404,'not_found','Unknown API route');
  }
  if(path.startsWith('/auth/'))throw new ApiError(405,'method_not_allowed','Unsupported authentication method');
  if(!['GET','HEAD'].includes(method))throw new ApiError(405,'method_not_allowed','Use GET');
  const asset=await env.ASSETS.fetch(request), result=new Response(asset.body,asset);
  result.headers.set('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  result.headers.set('x-content-type-options','nosniff');result.headers.set('referrer-policy','no-referrer');return result;
}
export default {
  async fetch(request,env){try{return await route(request,env);}catch(e){if(e instanceof ApiError)return json({error:e.code,message:e.message},e.status);console.error('request_failed');return json({error:'backend_unavailable',message:'Backend operation failed; retry with the same sample IDs'},503);}},
  scheduled(event,env,ctx){ctx.waitUntil(maintenance(env).catch(() => { console.error('scheduled_maintenance_failed'); throw new Error('Scheduled maintenance failed'); }));}
};
