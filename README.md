# C4U APP v10.0

Versão baseada no C4U APP v9.0, mantendo Calendário, Busca Global e Central de Documentos e sem Mapas/Rotas.

## Novidades principais
- **Biblioteca de Itens**: cadastro mestre reutilizável, imagens, categorias/subcategorias, dados técnicos/comerciais, múltiplos fornecedores e duplicação.
- **Adicionar da Biblioteca** no orçamento: o item é copiado para o orçamento e o histórico antigo não muda quando o cadastro mestre é alterado.
- **Pré-Notas**: categoria própria, criação manual ou a partir de pedido, edição formal, duplicação e PDF via impressão do navegador.
- **Editáveis**: modelos separados para Máscara de Orçamento e Pré-Nota, com prévia A4, cores, logo, textos, campos visíveis, ordem de seções e múltiplos modelos.
- **Escolha de modelo** ao gerar orçamento ou Pré-Nota.
- **Campos dinâmicos** nos textos dos modelos, como `{{cliente}}`, `{{vendedor}}`, `{{total}}` e `{{prazo}}`.
- **Histórico de versões** de documentos gerados; versões anteriores podem ser visualizadas/reimpressas e aparecem também na Central de Documentos.
- **Configurações da empresa** ampliadas com dados do emitente e logo para os documentos.
- Busca Global também encontra itens da Biblioteca.

## PDF
O C4U abre a versão formatada para impressão. No Windows/Chrome/Edge, escolha **Salvar como PDF** na janela de impressão. Cada geração salva uma versão histórica dentro do C4U.

## Atualização segura
1. Faça backup de `data/db.json`.
2. Feche o C4U.
3. Extraia o ZIP de atualização sobre a pasta atual.
4. Substitua os arquivos solicitados.
5. **Não apague nem substitua sua pasta `data`.**
6. Execute `INICIAR C4U SIST.bat`.

A atualização não contém a pasta `data`. O arquivo completo inclui um banco vazio para instalação/teste separado.



## C4U APP v12.1 — Nova Interface
- Nova interface dark inspirada em aplicativos de produtividade modernos.
- Sidebar fixa voltou a ser a navegação principal, com módulos organizados por área.
- Contornos luminosos discretos em roxo, azul e laranja para ações, foco e alertas.
- Busca global permanece no topo e ganhou atalho Ctrl+K.
- Editor de Layout / edição de fotos removido completamente da interface e da API.
- Importação de catálogos NÃO foi adicionada nesta versão, conforme solicitado.
- Todos os módulos comerciais e administrativos anteriores foram preservados.


## v12.1
- Correção da barra lateral da nova interface, que podia ficar invisível por conflito com estilos legados.


## v12.2 — temas e navegação
- Corrige a reabertura da barra lateral quando recolhida.
- Ao passar o mouse sobre a barra recolhida, ela expande temporariamente para mostrar seções e opções.
- Seções da sidebar podem ser recolhidas/expandidas individualmente.
- Adiciona alternância de tema Claro/Escuro, salva por navegador/usuário local.
- Adiciona contornos LED decorativos em laranja, azul, rosa, vermelho e roxo.
- Laranja predomina em janelas/cards; azul em opções e botões. As demais cores são variações visuais sem significado de status.


## v13.0 — Rede Local
- O servidor escuta em 0.0.0.0:3000 para acesso na mesma rede local.
- Os computadores clientes acessam pelo navegador usando http://IP-DO-SERVIDOR:3000.
- Todos usam a mesma base `data/db.json` do computador servidor.
- Escrita do JSON passou a usar arquivo temporário + renomeação para reduzir risco de corrupção em interrupções.
- Incluído `CONFIGURAR REDE LOCAL.bat` para liberar a porta 3000 no Firewall em redes privadas.
- Incluído `VER ENDERECO DA REDE.bat`.
- Interface voltou ao visual claro/clássico do C4U, mantendo a navegação lateral. Tema escuro continua opcional.


## v13.1
- Adicionada a logomarca 4Z SYSTEM fornecida pelo usuário à barra lateral.
- Mantida a estrutura de rede local e os dados existentes.


## v13.2 — Login, presença e sincronização em tempo real
- Login obrigatório em todos os computadores.
- Usuários e senhas persistem no banco local compartilhado.
- Senhas são armazenadas como hash com scrypt, não em texto puro.
- Presença mostra máquinas conectadas e usuários Ativo/Offline.
- Atualizações do banco são transmitidas em tempo real para as telas abertas via SSE.
- O administrador pode criar e editar acessos pela área Usuários.
- Sessões são mantidas em memória do servidor e precisam de novo login quando o servidor é reiniciado.


## v14.0
Permissões por função, histórico/auditoria, Pipeline drag-and-drop, notificações, tarefas, dashboard por usuário, backups automáticos, presença/sessões, versões de registros e busca ampliada.


## v14.1 — Correção de acessos e computadores confiáveis
- Reparo do login administrativo existente por migração única.
- Acesso inicial de Paloma Alves cadastrado como Vendedor.
- Exclusão de usuários pela área Usuários (exceto o próprio usuário conectado).
- Computadores podem solicitar liberação sem login na tela de acesso.
- Administrador aprova a solicitação em Configurações e escolhe qual usuário será usado automaticamente naquela máquina.
- Computadores liberados ficam persistidos no banco e entram automaticamente nos próximos acessos.
- Administrador pode revogar a liberação sem login a qualquer momento.
- Exclusão de usuário encerra suas sessões e remove liberações automáticas vinculadas.


## v14.2
- Layout responsivo para tablets e celulares, com menu lateral em gaveta no mobile.
- Correção e reparo automático do acesso da Paloma.
- Login aceita e-mail/login sem diferenciar maiúsculas/minúsculas e ignora espaços acidentais.


## v14.4 — Planilha
- Nova categoria **Planilha** no menu principal.
- Tabela em cartões/linhas com Item, Unidades, Valor, Personalização, Fornecedor e Observação.
- Várias regras de quantidade/preço dentro da mesma célula.
- Edição direta nas células.
- Largura das colunas ajustável por arraste e altura de cada item ajustável por arraste.
- Salvamento automático na base JSON compartilhada.
- Exportação para PDF (impressão), Excel (.xls) e Word (.doc).


## v14.6 — Exportações profissionais da Planilha
- PDF em layout comercial A4 paisagem, com cabeçalho, identidade visual e regras de preço organizadas dentro de uma única célula.
- Excel estilizado com larguras, cabeçalho, quebra de linha e regras mantidas em uma única célula.
- Word em paisagem com layout comercial, tabela proporcional e regras internas organizadas.
- Valores monetários formatados automaticamente para padrão brasileiro nas exportações.

## v15.0 — Acessos, privacidade e auditoria
- Cadastro oficial de 5 acessos da equipe, com credenciais armazenadas por hash scrypt.
- Cauã permanece Administrador/Criador; acessos comerciais ficam como Vendedor.
- Chat privado por participante: usuários fora de uma conversa não recebem suas mensagens.
- Caixa de Entrada e comunicações do Dossiê respeitam remetente/destinatários.
- Autorizações revisadas no backend e no carregamento da interface.
- Bloqueada autoelevação de privilégio em edição da própria conta.
- Identificação de vendedor por ID único para suportar nomes repetidos.
- Limpeza de funções frontend antigas duplicadas.
- Consulte `LEIA-ME - ACESSOS E AUDITORIA v15.0.txt` para o relatório da auditoria.

## v15.2 TESTE — Prospecção + Roteiro
- **Prospecção** substitui no menu principal a antiga separação entre Planilha e Pipeline.
- **Leads**: lista única compartilhada por toda a equipe, com edição estilo planilha e atualização em tempo real.
- **Follow-up**: mostra somente clientes que já possuem pedido, com último pedido calculado automaticamente.
- **Pipeline de Prospecção**: usa os mesmos registros de Leads; mover um card atualiza o status da linha.
- **Listas**: canais de contato, origens e segmentos compartilhados; edição reservada ao Administrador.
- Leads podem ser convertidos em **Clientes** sem redigitação e enviados ao **Calendário** para follow-up.
- **Roteiro**: nova área principal para entregas e retiradas por dia, com motorista, observações, endereço, A/C, vendedor, pedido, status e ordem.
- Os itens do Roteiro aparecem automaticamente no **Calendário** e podem gerar **Notificações** ao vendedor responsável.
- Dashboard mostra acompanhamento do roteiro do dia e previsão dos próximos roteiros.
- Roteiros futuros e históricos permanecem disponíveis.
- Impressão A4 própria para o motorista.
- Mapas/GPS continuam fora do sistema.


## v15.3 TESTE — Pipelines + Sidebar Pro
- Pedidos entregues deixam automaticamente as pipelines relacionadas, sem apagar histórico.
- Sidebar reduzida e reorganizada com ícones vetoriais internos.
- Categorias da sidebar podem ser expandidas/recolhidas com animação e memória local.
- Entrada no sistema após login ganhou uma transição curta e discreta.


## v15.4 HOTFIX — Links de aprovação em rede
- Links de aprovação agora usam automaticamente o IP LAN recomendado do servidor quando o C4U estiver aberto em localhost/127.0.0.1.
- `/api/network-info` foi liberado para qualquer usuário autenticado, sem exigir permissão de Configurações.
- Aprovações retornam `shareUrl` absoluto para compartilhamento em outros computadores da mesma rede.
- Tela Aprovações ganhou botão **Testar link** e informa o endereço compartilhável.
- Rotas públicas `/aprovacao/:token` e `/api/public/approval/:token` continuam sem exigir login.
- Para acesso fora da rede local, ainda é necessário publicar o servidor com HTTPS/VPS ou outra conexão externa segura; este hotfix corrige o compartilhamento LAN.

## v15.5 TESTE — Redesign visual C4U
- Nova direção visual: operação comercial refinada, com superfícies neutras e roxo 4Z usado como acento.
- Tipografia deliberada com Bahnschrift/Aptos no Windows, sem dependência de fontes externas.
- Login redesenhado, sidebar mais disciplinada, topbar, tabelas, formulários, Chat, Prospecção, Roteiro e Dashboard harmonizados.
- Menos gradientes, sombras e cartões genéricos; hierarquia construída por tipografia, linhas, densidade e contraste.
- Movimento reduzido a transições que explicam mudança de estado; respeita `prefers-reduced-motion`.
- Regras de negócio, permissões, banco, realtime e fluxos funcionais preservados.

## v15.6 TESTE — Dashboard operacional
- Barra superior com perfil, tema, notificações e usuários online.
- Dashboard com estatísticas, agenda do dia, pedidos recentes, atividade e mensagens não lidas.
- Integrações reutilizam Calendário, Roteiro, Pedidos, Chat, Caixa de Entrada, Presença e Auditoria existentes.
