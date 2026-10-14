import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const module={exports:{}};
new Function('module','exports',ts.transpileModule(fs.readFileSync('lib/deepseek-key.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(module,module.exports);
const {normalizeDeepseekKey:normalize}=module.exports;
const key='test-only-provider-format_v4.1~+/==';
for(const value of [key,' '+key+'\n','"'+key+'"',"'"+key+"'",'Bearer '+key,'Bearer "'+key+'"','"Bearer '+key+'"','\u200bBearer '+key+'\ufeff'])assert.equal(normalize(value),key);
assert.equal(normalize('abc'),'abc','credential length/prefix are validated by the provider, not guessed locally');
const cases=[[undefined,/полный API/],['',/пустое/],['sk-********',/скрытый/],['sk-test…last',/сокращённый/],['sk-test...last',/сокращённый/],['https://platform.deepseek.com/api_keys',/адрес сайта/],[key+'\r\nAuthorization: injected',/пробел|перенос/],['test only',/пробел/],['я'.repeat(30),/посторонние/],['a'.repeat(4097),/слишком много/]];
for(const [value,pattern] of cases){assert.throws(()=>normalize(value),error=>{assert.match(error.message,pattern);if(typeof value==='string'&&value)assert.ok(!error.message.includes(value));return true;});}
console.log('DeepSeek key checks passed: copy wrappers, bearer token characters, provider-owned format validation, masked/URL/whitespace/control rejection and non-disclosure.');
