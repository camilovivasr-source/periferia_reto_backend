import { cpSync } from 'node:fs';
for(const name of ['agent','fixtures'])cpSync(name,'dist/'+name,{recursive:true});
