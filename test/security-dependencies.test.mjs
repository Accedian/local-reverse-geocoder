import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { realpathSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { parse } from 'csv-parse/sync';

// qs is an Express dependency rather than a direct application dependency.
// Resolve it from Express so this test exercises the version used by the
// request query parser.
const expressEntry = realpathSync(
  new URL('../node_modules/express/index.js', import.meta.url)
);
const requireFromExpress = createRequire(expressEntry);
const qs = requireFromExpress('qs');
const qsPackage = JSON.parse(
  readFileSync(
    join(dirname(requireFromExpress.resolve('qs')), '..', 'package.json'),
    'utf8'
  )
);

test('uses the patched qs version from Express', () => {
  assert.equal(qsPackage.version, '6.16.0');
});

test('qs enforces arrayLimit for bracket notation', () => {
  const input = Array.from(
    { length: 25 },
    (_, index) => `items[]=${index}`
  ).join('&');

  assert.throws(
    () => qs.parse(input, { arrayLimit: 20, throwOnLimitExceeded: true }),
    /Array limit exceeded/
  );
});

test('qs enforces arrayLimit before comma expansion', () => {
  const input = `items=${','.repeat(25)}`;

  assert.throws(
    () =>
      qs.parse(input, {
        arrayLimit: 5,
        comma: true,
        throwOnLimitExceeded: true,
      }),
    /Array limit exceeded/
  );
});

test('csv-parse does not replace the record prototype for duplicate proto headers', () => {
  const [record] = parse('__proto__\t__proto__\nfirst\tsecond', {
    columns: true,
    delimiter: '\t',
    group_columns_by_name: true,
  });

  assert.equal(Object.getPrototypeOf(record), Object.prototype);
  assert.deepEqual(record['__proto__'], ['first', 'second']);
});
