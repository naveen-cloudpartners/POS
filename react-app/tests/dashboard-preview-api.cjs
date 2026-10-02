/* Read-only loopback visual fixture. Never connects to Catalyst or accepts writes.
 * node tests/dashboard-preview-api.cjs [--empty] with Vite on port 5173. */
const http = require('node:http');
const empty = process.argv.includes('--empty');
const dateKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const orders = [];
for (let i = 59; i >= 0 && !empty; i--) {
  const date = new Date(); date.setDate(date.getDate() - i);
  for (let j = 0; j < 2 + i % 3; j++) {
    const total = 1700 + (i * 713 + j * 891) % 6500;
    const paid = j === 0 && i % 4 === 0 ? total / 2 : total;
    orders.push({ ROWID: `${i}-${j}`, CREATEDTIME: `${dateKey(date)} 12:00:00`, total, paid_total: paid, customer_name: ['Amara','Nimal','Walk-in'][j % 3], invoice_number: `INV-${2100+i*3+j}`, status: 'Synced' });
  }
}
orders.reverse();
const products = empty ? [] : ['Signature burger','Garden salad','Fresh espresso','Seasonal juice','Vegetable pizza','Artisan bread'].map((name,i)=>({ROWID:String(i+1), name, sku:`PREVIEW-${i+1}`, rate:450+i*200,stock:i===3?3:35+i*8,category:'Food & beverages',reorder_level:5,status:'Active'}));
const revenue = orders.reduce((s,o)=>s+o.paid_total,0);
const summary = {revenue:{today:orders.filter(o=>o.CREATEDTIME.startsWith(dateKey(new Date()))).reduce((s,o)=>s+o.paid_total,0),week:0,month:0,total:revenue},orderCounts:{total:orders.length,pending:0,offline:0,synced:orders.length,toInvoice:0,today:orders.filter(o=>o.CREATEDTIME.startsWith(dateKey(new Date()))).length},customers:{total:empty?0:24,new:empty?0:5,returning:empty?0:19,active:empty?0:22},profit:{total:revenue*.32,linesWithCost:orders.length,linesTotal:orders.length,revenueOnCostedLines:revenue,marginPct:empty?0:32},topProducts:products.slice(0,4).map((p,i)=>({itemId:p.ROWID,name:p.name,sku:p.sku,quantity:120-i*20,revenue:90000-i*13000})),slowMovers:[],movements:[],generatedAt:new Date().toISOString()};
const routes = {
  '/auth/me':{authenticated:true,role:'Admin',user:{email:'preview@example.test',name:'Sample data preview',user_id:'preview'}},
  '/profile/me':{success:true,profile:{name:'Sample data preview',email:'preview@example.test',role:'Admin'}},
  '/orders':{success:true,data:orders},'/items':{success:true,data:products},'/customers':{success:true,data:[]},'/dashboard/summary':{success:true,data:summary},
  '/settings/company':{success:true,company:{name:'Sample data preview',currency:'LKR'}},
};
http.createServer((req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5173');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Content-Type','application/json');
  if(req.method==='OPTIONS'){res.end('{}');return;}
  if(req.method!=='GET'){res.writeHead(405);res.end(JSON.stringify({error:'Read-only preview'}));return;}
  const path=new URL(req.url,'http://localhost').pathname.replace('/server/pos_backend/api','');
  res.end(JSON.stringify(routes[path]??{success:true,data:[],settings:{}}));
}).listen(3000,'127.0.0.1',()=>console.log(`Read-only dashboard preview on 3000 (${empty?'empty':'sample data'})`));
