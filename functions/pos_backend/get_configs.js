const catalyst = require('zcatalyst-sdk-node');

async function getConfigs() {
  try {
    const app = catalyst.initialize();
    const query = "SELECT * FROM Configurations";
    const result = await app.zcql().executeZCQLQuery(query);
    console.log("Configurations in database:");
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Error fetching configurations:", err.message);
  }
}

getConfigs();
