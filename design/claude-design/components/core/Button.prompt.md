Botão de ação; use `primary` (âmbar) só uma vez por região — Aprovar, Enviar, ação principal.

```jsx
<Button variant="primary" icon="check" size="lg">Aprovar</Button>
<Button variant="danger" icon="square" kbd="⌘.">Cancelar</Button>
```

- variant: primary | secondary | ghost | danger (danger só tinge no hover: destrutivo não grita até você mirar)
- size: sm 28 · md 32 · lg 40 (aprovações)
- loading troca o ícone por spinner e bloqueia clique
