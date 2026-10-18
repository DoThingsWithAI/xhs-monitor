import {db,uuid} from '../packages/db';
import {passwordHash,newSalt} from '../packages/core/auth';
import {createInterface} from 'node:readline/promises';
import {stdin as input,stdout as output} from 'node:process';
import {stdin} from 'node:process';
async function main(){
 const database=db();
 if((database.prepare('SELECT count(*) AS n FROM admin_users').get() as {n:number}).n>0)
   throw new Error('Administrator already configured. Refusing to overwrite.');
 if(!stdin.isTTY) throw new Error('Interactive terminal required; no plaintext password CLI arguments.');
 const rl=createInterface({input,output});
 try{
  const username=(await rl.question('Admin username [admin]: ')).trim()||'admin';
  const password=await rl.question('Admin password (input visible; run from private terminal, 12+ chars): ');
  if(password.length<12)throw new Error('Password must be at least 12 characters');
  const salt=newSalt();
  database.prepare('INSERT INTO admin_users VALUES (?,?,?,?,?)').run(uuid(),username,salt,passwordHash(password,salt),Date.now());
  console.log('Administrator account created. Never put the password in Git or .env.');
 }finally{rl.close();}
}
main().catch(e=>{console.error(e instanceof Error?e.message:e);process.exitCode=1});
