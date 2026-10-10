import { readFile, writeFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
const urls=['https://letsencrypt.org/certs/isrgrootx1.pem','https://letsencrypt.org/certs/isrg-root-x2.pem'];
const expected=['96:BC:EC:06:26:49:76:F3:74:60:77:9A:CF:28:C5:A7:CF:E8:A3:C0:AA:E1:1A:8F:FC:EE:05:C0:BD:DF:08:C6','69:72:9B:8E:15:A8:6E:FC:17:7A:57:AF:B7:17:1D:FC:64:AD:D2:8C:2F:CA:8C:F1:50:7E:34:45:3C:CB:14:70'];
const roots=[];
for(let n=0;n<urls.length;n++) {
  const response=await fetch(urls[n]); if(!response.ok)throw Error('Public root retrieval failed');
  const pem=await response.text(),certificate=new X509Certificate(pem);
  if(certificate.fingerprint256!==expected[n])throw Error('Root certificate fingerprint changed; review the issuer before updating');
  roots.push(pem.trim());console.log(certificate.subject+' '+certificate.fingerprint256);
}
const legacy=await readFile(new URL('./google_roots.h',import.meta.url),'utf8');
const gts=legacy.split('R"PEM(')[1].split(')PEM"')[0];
const header='#pragma once\n// Public ISRG roots from letsencrypt.org/certificates/, retrieved '+new Date().toISOString().slice(0,10)+'.\n// GTS roots retained for Cloudflare issuer rotation; no leaf certificate pinning.\nstatic const char CLOUDFLARE_ROOTS[] = R"PEM(\n'+roots.join('\n')+'\n'+gts+'\n)PEM";\n';
await writeFile(new URL('./cloudflare_roots.h',import.meta.url),header);
