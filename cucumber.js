module.exports = {
  default: {
    require: ['features/**/*.ts'],
    requireModule: ['ts-node/register'],
    format: ['progress', '@cucumber/pretty-formatter'],
    formatOptions: { snippetInterface: 'async-await' },
    publishQuiet: true,
  },
};
