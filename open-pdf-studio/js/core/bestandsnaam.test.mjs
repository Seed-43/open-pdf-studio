// Leesbare namen voor Android content://-URI's (#596): de titel was "19".
import assert from 'node:assert/strict';
import test from 'node:test';

import { androidWeergaveNaam, bestandsnaamUitPad, naamUitContentUri } from './bestandsnaam.js';

const DOWNLOADS = 'content://com.android.providers.downloads.documents/document/msf%3A19';

test('de naam van Android wint', () => {
  const brug = { displayName: (uri) => (uri === DOWNLOADS ? 'Bouwtekening A4.pdf' : null) };
  assert.equal(bestandsnaamUitPad(DOWNLOADS, brug), 'Bouwtekening A4.pdf');
});

test('de naam van Android wordt één keer opgevraagd', () => {
  const uri = 'content://media/external/file/77';
  let vragen = 0;
  const brug = { displayName: () => { vragen++; return 'plan.pdf'; } };
  assert.equal(androidWeergaveNaam(uri, brug), 'plan.pdf');
  assert.equal(androidWeergaveNaam(uri, brug), 'plan.pdf');
  assert.equal(vragen, 1);
});

test('zonder brug of als de brug faalt: een leesbare naam uit de URI', () => {
  const kapot = { displayName: () => { throw new Error('geen toegang'); } };
  assert.equal(bestandsnaamUitPad('content://x.provider/document/msf%3A20', kapot), 'Document.pdf');
  assert.equal(naamUitContentUri(DOWNLOADS), 'Document.pdf');
  assert.equal(naamUitContentUri('content://media/external/file/42'), 'Document.pdf');
  assert.equal(naamUitContentUri('content://com.android.externalstorage.documents/document/primary%3ADownload%2Fplan.pdf'), 'plan.pdf');
  assert.equal(naamUitContentUri('content://com.mail.provider/attachments/raw%3A%2Fstorage%2Fbrief.PDF'), 'brief.PDF');
});

test('een naam van Android wordt nooit een pad', () => {
  const uri = 'content://x.provider/document/21';
  assert.equal(androidWeergaveNaam(uri, { displayName: () => 'a/b\\c.pdf' }), 'a_b_c.pdf');
});

test('gewone paden blijven werken', () => {
  assert.equal(bestandsnaamUitPad('C:\\map\\plan.pdf'), 'plan.pdf');
  assert.equal(bestandsnaamUitPad('/home/x/plan.pdf'), 'plan.pdf');
  assert.equal(bestandsnaamUitPad(null), null);
});
