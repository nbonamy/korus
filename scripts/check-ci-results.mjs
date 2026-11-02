const expected = process.argv.slice(2);
const results = JSON.parse(process.env.CI_RESULTS || '{}');
if (
  !expected.length ||
  expected.some((name) => results[name]?.result !== 'success')
) {
  console.error(
    'Required CI jobs did not all succeed:',
    Object.fromEntries(
      expected.map((name) => [name, results[name]?.result ?? 'missing']),
    ),
  );
  process.exit(1);
}
console.log('All required CI jobs succeeded.');
