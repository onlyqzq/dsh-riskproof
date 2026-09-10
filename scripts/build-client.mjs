import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
const compile = file => ts.transpileModule(readFileSync(new URL(`../src/client/${file}.ts`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const wrap = code => `(()=>{const module={exports:{}};const exports=module.exports;\n${code}\nreturn module.exports;})()`;
writeFileSync(new URL('../dist/client.js', import.meta.url), `window.__ModuleLoader__.load({id:"dsh-riskproof",factory:()=>{const styles=${wrap(compile('styles'))};const require=id=>{if(id==="./styles.js")return styles;throw Error("Unexpected client import");};return ${wrap(compile('panel'))};}});\n`);
