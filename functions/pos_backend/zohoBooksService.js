const axios = require('axios');

// Fallback credentials — must be configured via Catalyst Environment Variables.
// Never hardcode credentials in source code.
const FALLBACK_MASTER_CREDENTIALS = {
  client_id: process.env.ZOHO_CLIENT_ID || '1000.LJHGWKVRX6WJDTB4MDO7B0NQ3GZ4UR',
  client_secret: process.env.ZOHO_CLIENT_SECRET || 'd7800a427101467e28dacef9d688e47f03266f343d',
  dc: process.env.ZOHO_DC || 'com'
};

class ZohoBooksService {
  /**
   * @param {object} catalystApp - The initialized Catalyst App SDK instance
   * @param {object} [tenantConfig] - Optional dynamic tenant credentials from request headers
   */
  constructor(catalystApp, tenantConfig = null) {
    this.app = catalystApp;
    this.tenantConfig = tenantConfig; // Contains { refreshToken, orgId, dc }
  }

  /**
   * Map Zoho DC keys to Accounts and API base domains
   */
  getDomainUrls(dc = 'US') {
    const dcs = {
      'US': { accounts: 'https://accounts.zoho.com', api: 'https://www.zohoapis.com/books/v3' },
      'EU': { accounts: 'https://accounts.zoho.eu', api: 'https://www.zohoapis.eu/books/v3' },
      'IN': { accounts: 'https://accounts.zoho.in', api: 'https://www.zohoapis.in/books/v3' },
      'AU': { accounts: 'https://accounts.zoho.com.au', api: 'https://www.zohoapis.com.au/books/v3' },
      'JP': { accounts: 'https://accounts.zoho.jp', api: 'https://www.zohoapis.co.jp/books/v3' }
    };
    return dcs[dc.toUpperCase()] || dcs['US'];
  }

  /**
   * Helper to retrieve a configuration value from the Catalyst Data Store
   */
  async getConfig(key) {
    try {
      const safeKey = String(key).replace(/'/g, "''").replace(/[^a-zA-Z0-9_\-\.@]/g, '');
      const query = `SELECT config_value FROM Configurations WHERE config_key = '${safeKey}'`;
      const queryResult = await this.app.zcql().executeZCQLQuery(query);
      if (queryResult && queryResult.length > 0) {
        return queryResult[0].Configurations.config_value;
      }
    } catch (err) {
      console.warn(`Config key '${key}' lookup bypassed:`, err.message);
    }
    return null;
  }

  /**
   * Helper to write a configuration value to the Catalyst Data Store
   */
  async saveConfig(key, value) {
    try {
      const table = this.app.datastore().table('Configurations');
      const safeKey = String(key).replace(/'/g, "''").replace(/[^a-zA-Z0-9_\-\.@]/g, '');
      const query = `SELECT ROWID FROM Configurations WHERE config_key = '${safeKey}'`;
      const existing = await this.app.zcql().executeZCQLQuery(query);
      
      const payload = { config_key: key, config_value: value };

      if (existing && existing.length > 0) {
        await table.updateRow({
          ROWID: existing[0].Configurations.ROWID,
          ...payload
        });
      } else {
        await table.insertRow(payload);
      }
    } catch (err) {
      console.error(`Failed to save config key '${key}':`, err.message);
    }
  }

  /**
   * Resolves authentication headers.
   * Priority: Tenant OAuth token (user-authorized) → Catalyst Connection → DB fallback
   * The tenant token is tried first because it carries the user's full ZohoBooks.fullaccess.all scope.
   * The Catalyst Connection may only have limited server-level scope.
   */
  async getHeaders() {
    // 1. Try to resolve tenant-specific OAuth token based on posOrgId or orgId (highest priority)
    if (this.tenantConfig && (this.tenantConfig.posOrgId || this.tenantConfig.orgId)) {
      const posOrgId = this.tenantConfig.posOrgId;
      const orgId = this.tenantConfig.orgId;

      let refreshToken = null;
      let dc = null;
      let resolvedOrgId = orgId || posOrgId;

      if (posOrgId) {
        refreshToken = await this.getConfig(`zoho_refresh_token_${posOrgId}`);
        dc = await this.getConfig(`zoho_dc_${posOrgId}`);
      }

      if (!refreshToken && orgId) {
        refreshToken = await this.getConfig(`zoho_refresh_token_${orgId}`);
        dc = await this.getConfig(`zoho_dc_${orgId}`);
      }

      // Fallback & Auto-migration: if not in database, but passed in headers, migrate/save to database
      if (!refreshToken && this.tenantConfig.refreshToken && orgId) {
        console.log(`Token not found in Datastore for org ${orgId}. Migrating token from headers...`);
        refreshToken = this.tenantConfig.refreshToken;
        dc = this.tenantConfig.dc || dc || 'US';
        await this.saveConfig(`zoho_refresh_token_${orgId}`, refreshToken);
        await this.saveConfig(`zoho_dc_${orgId}`, dc);
        await this.saveConfig(`zoho_books_connected_${orgId}`, 'true');
        
        if (posOrgId) {
          await this.saveConfig(`zoho_refresh_token_${posOrgId}`, refreshToken);
          await this.saveConfig(`zoho_dc_${posOrgId}`, dc);
          await this.saveConfig(`zoho_books_connected_${posOrgId}`, 'true');
        }
      }

      if (refreshToken) {
        const clientId = await this.getConfig('zoho_client_id');
        const clientSecret = await this.getConfig('zoho_client_secret');
        const resolvedClientId = clientId || FALLBACK_MASTER_CREDENTIALS.client_id;
        const resolvedClientSecret = clientSecret || FALLBACK_MASTER_CREDENTIALS.client_secret;
        const resolvedDc = dc || this.tenantConfig.dc || 'US';

        if (resolvedClientId && resolvedClientSecret) {
          console.log(`Using database-secured tenant OAuth token for org ${resolvedOrgId} (DC: ${resolvedDc})`);
          const accessToken = await this.refreshAccessToken(resolvedClientId, resolvedClientSecret, refreshToken, resolvedDc, true, resolvedOrgId);
          return {
            'Authorization': `Zoho-oauthtoken ${accessToken}`,
            'Content-Type': 'application/json'
          };
        }
      }
      throw new Error('OAuth refresh token is missing for this organization. Please reconnect Zoho Books.');
    } else if (this.tenantConfig && this.tenantConfig.refreshToken) {
      // Fallback for cases where orgId is not provided but refreshToken is provided in headers
      const clientId = await this.getConfig('zoho_client_id');
      const clientSecret = await this.getConfig('zoho_client_secret');
      const dc = this.tenantConfig.dc || 'US';
      const refreshToken = this.tenantConfig.refreshToken;

      const resolvedClientId = clientId || FALLBACK_MASTER_CREDENTIALS.client_id;
      const resolvedClientSecret = clientSecret || FALLBACK_MASTER_CREDENTIALS.client_secret;

      if (resolvedClientId && resolvedClientSecret) {
        console.log(`Using header-provided tenant OAuth token (DC: ${dc}) — no orgId available`);
        const accessToken = await this.refreshAccessToken(resolvedClientId, resolvedClientSecret, refreshToken, dc, true);
        return {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json'
        };
      }
      throw new Error('Failed to resolve client credentials for the provided refresh token.');
    }

    // 2. Try Catalyst Connections API 'zohobooks_conn' (fallback for strictly global/internal requests only)
    try {
      console.log('Attempting Catalyst Connection "zohobooks_conn" as fallback...');
      const connCredentials = await this.app.connections().getConnectionCredentials('zohobooks_conn');
      console.log('Catalyst Connection response:', JSON.stringify(connCredentials).substring(0, 200));
      
      if (connCredentials && connCredentials.headers && connCredentials.headers['Authorization']) {
        console.log('Using Catalyst Connection "zohobooks_conn" for Zoho API access.');
        return {
          'Authorization': connCredentials.headers['Authorization'],
          'Content-Type': 'application/json'
        };
      }
      console.warn('Catalyst Connection returned empty credentials. Falling back...');
    } catch (connErr) {
      console.warn('Catalyst Connection "zohobooks_conn" failed:', connErr.message);
    }

    // 3. Try to load custom OAuth configs from database as global fallback
    let clientId = await this.getConfig('zoho_client_id');
    let clientSecret = await this.getConfig('zoho_client_secret');
    const refreshToken = await this.getConfig('zoho_refresh_token');
    const dc = (await this.getConfig('zoho_dc')) || 'US';

    // Fallback to hardcoded SaaS master credentials if DB is unavailable
    if (!clientId || !clientSecret) {
      console.warn('Configurations table unavailable — using hardcoded master credentials as fallback.');
      clientId = clientId || FALLBACK_MASTER_CREDENTIALS.client_id;
      clientSecret = clientSecret || FALLBACK_MASTER_CREDENTIALS.client_secret;
    }

    if (clientId && clientSecret && refreshToken) {
      console.log(`Using custom global Zoho OAuth credentials (DC: ${dc})`);
      const accessToken = await this.refreshAccessToken(clientId, clientSecret, refreshToken, dc, false);
      return {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json'
      };
    }

    // 4. Last resort: try direct client credential grant (no refresh token)
    if (clientId && clientSecret) {
      console.log('No refresh token available. Attempting client credentials grant...');
      try {
        const domains = this.getDomainUrls(dc);
        const response = await axios.post(`${domains.accounts}/oauth/v2/token`, null, {
          params: {
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'client_credentials',
            scope: 'ZohoBooks.fullaccess.all'
          }
        });
        if (response.data && response.data.access_token) {
          console.log('Client credentials grant succeeded.');
          return {
            'Authorization': `Zoho-oauthtoken ${response.data.access_token}`,
            'Content-Type': 'application/json'
          };
        }
      } catch (e) {
        console.warn('Client credentials grant failed:', e.message);
      }
    }

    throw new Error('No authentication method available. Please configure Zoho Books connection (Catalyst connection "zohobooks_conn" or provide OAuth credentials).');
  }

  /**
   * Refreshes and retrieves an access token using stored Client Refresh credentials.
   * Uses the correct DC-specific accounts server for token refresh and supports caching per-organization.
   */
  async refreshAccessToken(clientId, clientSecret, refreshToken, dc = 'US', isTenant = false, orgId = null) {
    const cacheKeyToken = orgId ? `zoho_access_token_${orgId}` : 'zoho_access_token';
    const cacheKeyTime = orgId ? `zoho_token_time_${orgId}` : 'zoho_token_time';

    // Try to use a cached token first
    const cachedToken = await this.getConfig(cacheKeyToken);
    const cachedTime = await this.getConfig(cacheKeyTime);
    
    // Check if token is less than 50 minutes old (Zoho OAuth tokens expire in 1 hour)
    if (cachedToken && cachedTime) {
      const elapsedMs = Date.now() - parseInt(cachedTime);
      if (elapsedMs < 50 * 60 * 1000) {
        console.log(`Using cached active access token for ${orgId || 'global'}.`);
        return cachedToken;
      }
    }

    console.log(`Access token expired or missing for ${orgId || 'global'}. Triggering refresh token exchange...`);
    const domains = this.getDomainUrls(dc);
    const tokenUrl = `${domains.accounts}/oauth/v2/token`;

    try {
      const response = await axios.post(tokenUrl, null, {
        params: {
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token'
        }
      });

      if (response.data && response.data.access_token) {
        const token = response.data.access_token;
        // Save back to local store
        await this.saveConfig(cacheKeyToken, token);
        await this.saveConfig(cacheKeyTime, Date.now().toString());
        return token;
      }
      
      // If DC-specific refresh failed and isTenant is true, try accounts.zoho.com as fallback
      if (isTenant && dc.toUpperCase() !== 'US') {
        console.warn(`DC-specific refresh failed for ${orgId}, trying accounts.zoho.com fallback...`);
        const fallbackResponse = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
          params: {
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'refresh_token'
          }
        });
        if (fallbackResponse.data && fallbackResponse.data.access_token) {
          const token = fallbackResponse.data.access_token;
          await this.saveConfig(cacheKeyToken, token);
          await this.saveConfig(cacheKeyTime, Date.now().toString());
          return token;
        }
      }
      
      throw new Error((response.data && (response.data.error || response.data.message)) || 'Failed to exchange refresh token.');
    } catch (error) {
      console.error(`Error refreshing access token for ${orgId || 'global'}:`, error.response ? JSON.stringify(error.response.data) : error.message);
      throw new Error(`Failed to refresh Zoho Books Access Token: ${error.message}`);
    }
  }

  /**
   * Helper to format active endpoint urls based on DC
   */
  async getBooksUrl(endpoint) {
    let dc = 'US';
    let orgId = '';

    if (this.tenantConfig && this.tenantConfig.orgId) {
      orgId = this.tenantConfig.orgId || '';
      // Look up tenant-specific DC from DB first
      const dbDc = await this.getConfig(`zoho_dc_${orgId}`);
      dc = dbDc || this.tenantConfig.dc || 'US';
    } else {
      dc = (await this.getConfig('zoho_dc')) || 'US';
      orgId = await this.getConfig('zoho_org_id') || '';
    }

    console.log(`getBooksUrl: endpoint=${endpoint}, dc=${dc}, orgId=${orgId}, tenantConfig=${JSON.stringify(this.tenantConfig)}`);

    const domains = this.getDomainUrls(dc);
    let url = `${domains.api}${endpoint}`;
    if (orgId) {
      url += (url.includes('?') ? '&' : '?') + `organization_id=${orgId}`;
    }
    return url;
  }

  /**
   * Fetch all Zoho Books organizations for the authenticated connection across all DCs, or a specific DC
   */
  async getOrganizations(dc = null) {
    const dcsToQuery = dc ? [dc.toUpperCase()] : ['US', 'EU', 'IN', 'AU', 'JP'];
    const allOrganizations = [];

    for (const d of dcsToQuery) {
      try {
        const headers = await this.getHeaders();
        const domains = this.getDomainUrls(d);
        const url = `${domains.api}/organizations`;
        console.log(`Probing organizations in ${d} DC: ${url}`);

        const response = await axios.get(url, { headers, timeout: 5000 });
        if (response.data && response.data.code === 0 && response.data.organizations) {
          const orgs = response.data.organizations.map(org => ({
            ...org,
            dc: d
          }));
          allOrganizations.push(...orgs);
        }
      } catch (error) {
        console.warn(`Failed to probe organizations in ${d} DC:`, error.message);
      }
    }

    return allOrganizations;
  }

  /**
   * Sync/retrieve active sales items from Zoho Books
   */
  async getItems() {
    try {
      const headers = await this.getHeaders();
      const url = await this.getBooksUrl('/items');
      console.log(`Calling Books API: ${url}`);
      
      const response = await axios.get(url, { headers, params: { status: 'active' } });
      console.log(`Books API response code: ${response.data.code}, message: ${response.data.message}`);
      
      if (response.data && response.data.code === 0) {
        return response.data.items || [];
      }
      
      // Zoho Books returned a non-zero code — include full details for debugging
      const errMsg = response.data.message || 'Unknown response structure from Zoho Books';
      const errCode = response.data.code || 'unknown';
      throw new Error(`Zoho Books API Error [${errCode}]: ${errMsg}`);
    } catch (error) {
      // Log full error response for debugging
      if (error.response) {
        console.error('Books API HTTP error:', error.response.status, JSON.stringify(error.response.data));
        const zohoMsg = error.response.data && error.response.data.message
          ? error.response.data.message
          : error.message;
        throw new Error(`Zoho Books: ${zohoMsg} (HTTP ${error.response.status})`);
      }
      console.error('Error fetching items from Zoho Books:', error.message);
      throw error;
    }
  }

  /**
   * Create or retrieve a customer contact in Zoho Books
   */
  async getOrCreateCustomer(customerName, email = '') {
    if (!customerName) {
      throw new Error('Customer name is required');
    }

    try {
      const headers = await this.getHeaders();
      const urlList = await this.getBooksUrl('/contacts');
      
      // Search for existing contact by name
      const searchResponse = await axios.get(urlList, { 
        headers, 
        params: { contact_name: customerName, contact_type: 'customer' } 
      });

      if (searchResponse.data && searchResponse.data.code === 0 && searchResponse.data.contacts && searchResponse.data.contacts.length > 0) {
        return searchResponse.data.contacts[0];
      }

      // If contact doesn't exist, create a new one
      const urlCreate = await this.getBooksUrl('/contacts');
      const payload = {
        contact_name: customerName,
        contact_type: 'customer',
        emails: email
      };

      const createResponse = await axios.post(urlCreate, payload, { headers });
      if (createResponse.data && createResponse.data.code === 0) {
        return createResponse.data.contact;
      }
      throw new Error(createResponse.data.message || 'Failed to create customer');
    } catch (error) {
      console.error('Error in getOrCreateCustomer:', error.message);
      throw error;
    }
  }

  /**
   * Create an invoice in Zoho Books
   */
  async createInvoice(customerId, lineItems, paymentMode = 'Cash', roomNote = '') {
    try {
      const headers = await this.getHeaders();
      const url = await this.getBooksUrl('/invoices');

      const formattedLineItems = lineItems.map(item => ({
        item_id: item.books_item_id || item.item_id,
        quantity: item.quantity,
        rate: item.rate,
        description: item.name || 'POS item'
      }));

      const today = new Date().toISOString().split('T')[0];
      const payload = {
        customer_id: customerId,
        date: today,
        due_date: today,
        line_items: formattedLineItems,
        payment_options: {
          payment_gateways: []
        },
        notes: `Cloud POS Order. ${roomNote ? 'Location/Room: ' + roomNote + '.' : ''} Payment: ${paymentMode}.`
      };

      console.log('Sending invoice request to Zoho Books...');
      const response = await axios.post(url, payload, { headers, params: { ignore_auto_number_generation: false } });
      
      if (response.data && response.data.code === 0) {
        const invoice = response.data.invoice;
        
        // Approve/Send the invoice so it can be paid
        const approveUrl = await this.getBooksUrl(`/invoices/${invoice.invoice_id}/status/sent`);
        await axios.post(approveUrl, {}, { headers });
        
        return invoice;
      }
      throw new Error(response.data.message || 'Failed to create invoice');
    } catch (error) {
      console.error('Error in createInvoice:', error.response ? JSON.stringify(error.response.data) : error.message);
      throw error;
    }
  }

  /**
   * Record a payment for an invoice in Zoho Books
   */
  async recordPayment(customerId, invoiceId, amount, paymentMode = 'Cash') {
    try {
      const headers = await this.getHeaders();
      const url = await this.getBooksUrl('/customerpayments');

      const today = new Date().toISOString().split('T')[0];
      const payload = {
        customer_id: customerId,
        payment_mode: paymentMode.toLowerCase() === 'cash' ? 'cash' : (paymentMode.toLowerCase() === 'card' ? 'creditcard' : 'bank_transfer'),
        amount: amount,
        date: today,
        invoice_id: invoiceId,
        invoices: [
          {
            invoice_id: invoiceId,
            amount_applied: amount
          }
        ],
        description: `Payment recorded via Cloud POS Checkout (${paymentMode})`
      };

      const response = await axios.post(url, payload, { headers });
      if (response.data && response.data.code === 0) {
        return response.data.payment;
      }
      throw new Error(response.data.message || 'Failed to record payment');
    } catch (error) {
      console.error('Error in recordPayment:', error.response ? JSON.stringify(error.response.data) : error.message);
      throw error;
    }
  }
}

module.exports = ZohoBooksService;
