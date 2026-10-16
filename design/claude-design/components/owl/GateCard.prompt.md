Aprovação de push/merge/deploy/exclusão: o que, quem pediu, risco, Aprovar / Reprovar com motivo (obrigatório).

```jsx
<GateCard kind="Push" ticket="OWL-138" title="Gate de push com diff" command="git push origin owl/OWL-138" stats="3 commits · +182 −40" requester="dev-back" provider="claude-cli" onApprove={…} onReject={(m) => …} />
```

- Borda âmbar só enquanto pendente; depois vira linha neutra + rótulo verde/vermelho.
- Alvos de 40px. Reprovar exige motivo.
