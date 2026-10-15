---
name: revisao-de-arquitetura
description: Use ao revisar uma proposta ou mudança que afeta a estrutura do sistema (módulos, contratos entre pacotes, banco, segurança).
---
# Revisão de arquitetura

1. Diga em uma frase o que a mudança pretende.
2. Verifique os contratos: quem chama quem, o que muda de formato, o que quebra para quem já usa.
3. Procure acoplamento novo entre pacotes que antes não se conheciam.
4. Para banco: a migração é nova, reversível na prática (dados antigos continuam válidos) e testada?
5. Para segurança: entrada externa validada, nada de credenciais em log, nada de shell com texto do usuário.
6. Termine com: decisão (seguir / ajustar / refazer) e os ajustes em lista.
