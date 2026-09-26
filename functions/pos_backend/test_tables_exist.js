const catalyst = require('zcatalyst-sdk-node');

async function test() {
  console.log('Initializing Catalyst App...');
  const app = catalyst.initialize();
  
  const tablesToTest = ['Organizations', 'OrgUsers', 'Configurations', 'Products', 'Orders', 'Shifts', 'OrderItems', 'StockMovements', 'Categories'];
  
  for (const table of tablesToTest) {
    try {
      console.log(`Testing table '${table}' via ZCQL...`);
      const result = await app.zcql().executeZCQLQuery(`SELECT ROWID FROM ${table} LIMIT 1`);
      console.log(`✅ Table '${table}' exists! Found ${result.length} rows.`);
    } catch (err) {
      console.log(`❌ Table '${table}' failed: ${err.message}`);
    }
  }
}

test().catch(console.error);
