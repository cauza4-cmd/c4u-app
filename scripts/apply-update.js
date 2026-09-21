'use strict';
// Nunca substitui data/db.json por um seed: lê o banco REAL e cria cópia antes da migração.
const fs=require('fs'),path=require('path');const {upgrade}=require('../lib/upgrade');
const root=path.resolve(__dirname,'..'),data=process.env.C4U_DATA_DIR||path.join(root,'data'),file=path.join(data,'db.json'),sources=path.join(root,'import-data');
if(!fs.existsSync(file)){console.error('ERRO: banco real não encontrado:',file);process.exit(2)}
let db;try{db=JSON.parse(fs.readFileSync(file,'utf8'))}catch{console.error('ERRO: JSON inválido. Nenhum dado alterado.');process.exit(2)}
const backup=path.join(data,'db.pre-atualizacao-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');fs.copyFileSync(file,backup);
const clients=JSON.parse(fs.readFileSync(path.join(sources,'clients.json'),'utf8')),products=JSON.parse(fs.readFileSync(path.join(sources,'products.json'),'utf8'));
const result=upgrade(db,{clients,products});const temp=file+'.upgrade.tmp';fs.writeFileSync(temp,JSON.stringify(db,null,2),'utf8');fs.renameSync(temp,file);
console.log('Backup criado:',backup);console.log('Migração aplicada (dados existentes preservados):',JSON.stringify(result));console.log('PRÓXIMO PASSO: node scripts/provision-users.js (senhas solicitadas sem exibir).');
