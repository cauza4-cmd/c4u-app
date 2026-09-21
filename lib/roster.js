'use strict';
// Apenas dados públicos de identificação. Senhas fornecidas interativamente; nunca em código.
const roster=[
 {name:'Cauã',email:'cauza4@gmail.com',login:'Caua',role:'Administrador'},
 {name:'Gabriel',email:'vendas2@tocadosbrindes.com.br',login:'Gabriel',role:'Administrador'},
 {name:'Marcos',email:'vendas1@tocadosbrindes.com.br',login:'marcos',role:'Vendedor'},
 // O login "marcos" informado para Giovana conflita com Marcos; login único: giovana.
 {name:'Giovana',email:'vendas3@tocadosbrindes.com.br',login:'giovana',role:'Vendedor'},
 {name:'Gisele',email:'gisele@tocadosbrindes.com.br',login:'gisele',role:'Vendedor'},
 {name:'Fabio',email:'fabio@tocadosbrindes.com.br',login:'fabio',role:'Administrador'},
 {name:'Karen',email:'financeiro@tocadosbrindes.com.br',login:'Karen',role:'Financeiro'}
];
module.exports={roster};
