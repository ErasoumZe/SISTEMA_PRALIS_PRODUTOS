import 'reflect-metadata';
import 'dotenv/config';
const NOVA='1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const ABA=process.argv[2] ?? '(TNP) GRUPO MERCADORIAS';
async function main(){
  const { env } = await import('@/config/env');
  env.GOOGLE_SHEETS_SPREADSHEET_ID=NOVA;
  const { GoogleSheetsClient, a1 } = await import('@/modules/google-sheets/google-sheets.client');
  const c=new GoogleSheetsClient();
  const [vals]=await c.batchGetValues(NOVA,[a1(ABA,'A1:Z24')],'FORMATTED_VALUE');
  (vals??[]).forEach((linha:any[],i:number)=>{
    const cels=(linha??[]).map((x,j)=>({j,v:String(x??'').trim()})).filter(x=>x.v);
    if(cels.length) console.log(`  L${String(i+1).padStart(2)}: ${cels.map(x=>`${String.fromCharCode(65+x.j)}="${x.v.slice(0,26)}"`).join('  ')}`);
  });
  process.exit(0);
}
main().catch(e=>{console.error('FALHOU:',e?.message??e);process.exit(1);});
