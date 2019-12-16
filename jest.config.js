module.exports = {
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.tsx$': 'ts-jest'
  },
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.(ts?|tsx?)?$',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  coveragePathIgnorePatterns: ['(__test__/.*.mock).(|ts?|tsx?)$'],
  verbose: true,
  testPathIgnorePatterns: ['/__snapshots__/'],
  collectCoverage: true,
  collectCoverageFrom: ['**/*.{ts,tsx}', '!**/*.d.ts'],
  globals: {
    'process.env.__DEV__': true,
    'process.env.__PROD__': false,
    'process.env.__BROWSER__': false,
    'process.env.__SERVER__': false
  },
  preset: 'ts-jest',
  snapshotSerializers: ['jest-emotion'],
  setupFilesAfterEnv: ['./src/__test__/jest.setup.ts']
};
