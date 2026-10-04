import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";

// The host expects its module-loader format, not a browser ESM entry point.
// Keep the small runtime dependency graph explicit and ordered dependencies first.
// Type-only imports (context and dashboard) disappear during compilation.
const modules = ["styles", "template", "view", "panel"];

function compile(name) {
  const source = new URL(`../src/client/${name}.ts`, import.meta.url);
  return ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
}

function wrapModule(code) {
  return `(() => {
    const module = { exports: {} };
    const exports = module.exports;
    ${code}
    return module.exports;
  })()`;
}

const compiledModules = modules.map((name) =>
  `modules["./${name}.js"] = ${wrapModule(compile(name))};`,
).join("\n");

const bundle = `window.__ModuleLoader__.load({
  id: "dsh-riskproof",
  factory: () => {
    const modules = Object.create(null);
    const require = (id) => {
      if (Object.hasOwn(modules, id)) return modules[id];
      throw Error("Unexpected client import: " + id);
    };
    ${compiledModules}
    return modules["./panel.js"];
  },
});
`;

writeFileSync(new URL("../dist/client.js", import.meta.url), bundle);
