'use strict';
// C4U v16.0.8: migração segura. Preserva todo o db.json que já está no servidor
// e troca somente a Biblioteca de Itens pela coleção funcional de 1.386 itens.
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const data=process.env.C4U_DATA_DIR||path.join(root,'data');
const dbPath=path.join(data,'db.json');
const source=path.join(root,'release-data','itemLibrary-1386.json');
if(!fs.existsSync(dbPath)){console.error('ERRO: banco real não encontrado:',dbPath);process.exit(2)}
if(!fs.existsSync(source)){console.error('ERRO: coleção de Biblioteca não encontrada:',source);process.exit(2)}
let db,items;
try{db=JSON.parse(fs.readFileSync(dbPath,'utf8'));items=JSON.parse(fs.readFileSync(source,'utf8'))}catch(e){console.error('ERRO: JSON inválido. Nenhum dado alterado.',e.message);process.exit(2)}
if(!Array.isArray(items)||items.length!==1386){console.error('ERRO: coleção esperada de 1.386 itens não encontrada. Nenhum dado alterado.');process.exit(2)}
const backup=path.join(data,'db.pre-v1608-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
fs.copyFileSync(dbPath,backup);
const before=db.itemLibrary?.length||0;db.itemLibrary=items;
const tmp=dbPath+'.v1608.tmp';fs.writeFileSync(tmp,JSON.stringify(db,null,2),'utf8');fs.renameSync(tmp,dbPath);
console.log('C4U v16.0.8: Biblioteca atualizada com segurança.');
console.log('Itens antes:',before,'Itens depois:',db.itemLibrary.length);
console.log('Backup do banco:',backup);
