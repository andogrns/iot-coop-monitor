// Read only deployment metadata. Wrangler OAuth credentials never leave the local process except as an API header.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const account='7865a0c25fe350bb4395009c91eb83d1';
const config=await readFile(path.join(process.env.APPDATA,'xdg.config/.wrangler/config/default.toml'),'utf8');
const token=/oauth_token\s*=\s*"([^"]+)"/.exec(config)?.[1];if(!token)throw Error('Wrangler OAuth token unavailable');
for(const route of ['workers/subdomain','workers/scripts/coop-monitor-worker/subdomain','workers/account-settings','r2/buckets/coop-monitor-archives/domains/custom']){
 const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${route}`,{headers:{authorization:'Bearer '+token}}),value=await response.json();
 console.log(JSON.stringify({route,status:response.status,success:value.success,result:value.result,errors:value.errors}));
}
