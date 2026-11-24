// Registers the configuration schemas' alias annotations for ajv-cli, as
// `docs/AGENTS.md` runs it: `-c ./scripts/docs/ajv-annotations.cjs`.
module.exports = (ajv) => {
  ajv.addKeyword("x-env-aliases");
  ajv.addKeyword("x-flag-aliases");
  return ajv;
};
