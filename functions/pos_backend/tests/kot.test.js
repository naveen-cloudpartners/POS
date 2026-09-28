const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScope } = require('./harness');

const { normPrintStation, stationForLine, kotDayStamp, kotTransitionAllowed, kotLogKey } = loadScope(
  ['normPrintStation', 'stationForLine', 'kotDayStamp', 'kotTransitionAllowed', 'kotLogKey'],
  ['PRINT_STATIONS', 'PRINT_TRANSPORTS', 'KOT_STATUSES']
);

describe('normPrintStation', () => {
  it('accepts counter/kitchen/bar and falls back safely', () => {
    assert.equal(normPrintStation('kitchen'), 'kitchen');
    assert.equal(normPrintStation('BAR'), 'bar');
    assert.equal(normPrintStation('dining-room'), 'counter');
    assert.equal(normPrintStation(undefined, 'kitchen'), 'kitchen');
    assert.equal(normPrintStation(undefined), 'counter');
  });
});

describe('stationForLine', () => {
  const routing = {
    byCategoryId: { 111: 'kitchen' },
    byCategoryName: { beverages: 'bar' },
    defaultStation: 'counter',
  };
  const stationMap = new Map([
    ['1', { category_id: '111', category: 'Food' }],
    ['2', { category_id: '', category: 'Beverages' }],
    ['3', { category_id: '', category: '' }],
    ['4', { category_id: '', category: 'Cold Beverages' }],
  ]);

  it('resolves category link, then name, then default', () => {
    assert.equal(stationForLine({ ROWID: '1' }, routing, stationMap), 'kitchen');
    assert.equal(stationForLine({ ROWID: '2' }, routing, stationMap), 'bar');
    assert.equal(stationForLine({ ROWID: '4' }, routing, stationMap), 'bar');
    assert.equal(stationForLine({ ROWID: '3' }, routing, stationMap), 'counter');
    assert.equal(stationForLine(null, routing, stationMap), 'counter');
    assert.equal(stationForLine({ ROWID: '999' }, routing, stationMap), 'counter');
  });
});

describe('kotDayStamp', () => {
  it('formats UTC days as YYYYMMDD for numbering and log keys', () => {
    assert.equal(kotDayStamp(new Date('2026-09-24T10:00:00.000Z')), '20260924');
    assert.equal(kotLogKey('cloudhub_admin', '20260924'), 'org_cloudhub_admin_setting_kot_log_20260924');
  });
});

describe('kotTransitionAllowed', () => {
  it('only allows forward FIRED → ACKED → DONE moves', () => {
    assert.equal(kotTransitionAllowed('FIRED', 'ACKED'), true);
    assert.equal(kotTransitionAllowed('FIRED', 'DONE'), false);
    assert.equal(kotTransitionAllowed('ACKED', 'DONE'), true);
    assert.equal(kotTransitionAllowed('ACKED', 'ACKED'), false);
    assert.equal(kotTransitionAllowed('DONE', 'ACKED'), false);
    assert.equal(kotTransitionAllowed('DONE', 'FIRED'), false);
  });
});
