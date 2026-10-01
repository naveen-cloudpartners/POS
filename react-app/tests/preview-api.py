"""Read-only UI review fixture. Binds loopback only; never connects to Catalyst."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import argparse
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("--role",default="Admin",choices=["Admin","Manager","Cashier","Storekeeper","Waiter","Chef"])
parser.add_argument("--guest",action="store_true")
options=parser.parse_args()
from urllib.parse import urlparse
PRODUCTS=[dict(ROWID=str(i),name=name,sku=f'DEMO-{i}',rate=price,stock=35,category=category,reorder_level=5,status='Active') for i,(name,price,category) in enumerate([('Signature burger',1250,'Kitchen'),('Garden salad',850,'Kitchen'),('Fresh espresso',450,'Beverages'),('Seasonal juice',650,'Beverages'),('Vegetable pizza',1850,'Kitchen'),('Artisan bread',550,'Bakery'),('Grilled sandwich',950,'Kitchen'),('Chocolate cake',750,'Bakery')],1)]
class Handler(BaseHTTPRequestHandler):
 def response(self,data,status=200):
  self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Access-Control-Allow-Origin','http://127.0.0.1:5173');self.send_header('Access-Control-Allow-Headers','Content-Type');self.end_headers();self.wfile.write(json.dumps(data).encode())
 def do_OPTIONS(self):self.response({})
 def do_GET(self):
  path=urlparse(self.path).path.replace('/server/pos_backend/api','')
  routes={
   '/auth/me':{'authenticated':not options.guest,'role':options.role,'user':{'email':'preview@example.test','name':'Preview account','user_id':'preview'}},
   '/items':{'success':True,'data':PRODUCTS},
   '/customers':{'success':True,'data':[]},
   '/settings/company':{'success':True,'company':{'name':'Muster Preview','currency':'LKR'}},
   '/settings/tax':{'success':True,'tax':{'enabled':False,'name':'Tax','default_rate':0,'mode':'exclusive','round':True,'profiles':[]}},
   '/settings/payments':{'success':True,'methods':[{'mode':m,'enabled':True} for m in ['Cash','Card','Bank']]},
   '/config/settings':{'success':True,'settings':{'store_name':'Muster Preview','currency':'LKR'}},
   '/config/smtp':{'success':True,'configured':False},
   '/categories':{'success':True,'data':[]},
   '/orders':{'success':True,'data':[]},
   '/dashboard/summary':{'success':True,'data':None},
   '/settings/books':{'master_configured':False,'secret_configured':False,'client_id':'','dc':'US','redirect_uri':'','connected':False,'connection':None,'organizations':[],'last_sync':None},
   '/profile/me':{'success':True,'profile':{'name':'Preview account','phone':'','email':'preview@example.test','role':options.role,'avatar_version':''}},
  }
  self.response(routes.get(path,{'success':True,'data':[],'settings':{}}))
 def do_POST(self):self.response({'error':'Read-only preview: changes are disabled.'},405)
 do_PUT=do_POST;do_DELETE=do_POST
 def log_message(self,*args):pass
print('Read-only UI preview API: http://127.0.0.1:3000',flush=True)
HTTPServer(('127.0.0.1',3000),Handler).serve_forever()
