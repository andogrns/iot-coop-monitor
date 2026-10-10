import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const credentialPath=path.join(root,'.credentials.local.json');
let c;try{c=JSON.parse(await readFile(credentialPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;c={deviceId:'coop-monitor-01',deviceToken:randomBytes(32).toString('hex'),ownerKey:randomBytes(32).toString('hex'),sessionSecret:randomBytes(32).toString('hex')};}
const endpoint=process.argv[2];if(endpoint)c.workerUrl=new URL(endpoint).origin;
await mkdir(path.join(root,'.local'),{recursive:true});
await writeFile(credentialPath,JSON.stringify(c,null,2)+'\n');
await writeFile(path.join(root,'.secrets.production.json'),JSON.stringify({ADMIN_TOKEN:c.ownerKey,SESSION_SECRET:c.sessionSecret})+'\n');
await writeFile(path.join(root,'.dev.vars'),`ADMIN_TOKEN=${c.ownerKey}\nSESSION_SECRET=${c.sessionSecret}\n`);
const hash=createHash('sha256').update(c.deviceToken).digest('hex');
await writeFile(path.join(root,'.local/provision-device.sql'),`INSERT INTO devices(device_id,label,token_hash) VALUES ('${c.deviceId}','Coop monitor 01','${hash}') ON CONFLICT(device_id) DO NOTHING;\nINSERT INTO config_history(device_id,revision,settings_json,created_at) SELECT device_id,desired_config_revision,desired_config_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM devices WHERE device_id='${c.deviceId}' ON CONFLICT(device_id,revision) DO NOTHING;\n`);
if(c.workerUrl){await writeFile(path.resolve(root,'../../firmware/coop_monitor/dashboard.local.json'),JSON.stringify({backend:'cloudflare',protocolVersion:1,deviceId:c.deviceId,endpoint:c.workerUrl+'/api/device/exchange',token:c.deviceToken},null,2)+'\n');}
console.log(`Credentials prepared in ${credentialPath}. Secret values were not printed.`);
