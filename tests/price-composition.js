'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8'),start=source.indexOf('function calcQuote('),end=source.indexOf('function pricingRequestGuard(',start);
const pricing=new Function('const num=v=>Number(v||0);'+source.slice(start,end)+'\nreturn calcQuote;')();
const r=pricing({items:[{qty:10,unitCost:11.5,personalizationTotal:60,freight:70,extraExpenses:0,purchaseTaxPercent:0,taxPercent:13,commissionMargin:3,profitMargin:50}],discountPercent:0});
assert.equal(r.items[0].unitPrice,72.0588);assert.equal(r.total,720.59);assert.equal(r.items[0].baseCost,245);assert.equal(r.items[0].personalizationCost,60);assert.equal(r.items[0].freight,70);
console.log('PRECO_COMPOSICAO_OK: custo 245, unitário 72,0588, total 720,59.');
