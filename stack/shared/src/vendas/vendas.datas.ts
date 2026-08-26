/**
 * Datas do relatório de vendas em `YYYY-MM-DD`.
 *
 * NÃO usar `toISOString().slice(0, 10)`: ele converte para UTC. Em Brasília
 * (UTC-3), das 21h em diante isso devolve o dia SEGUINTE — o filtro abriria
 * com "até amanhã" e o usuário veria um período que não existe.
 * Aqui a data sai dos componentes LOCAIS, que é o que a pessoa enxerga no
 * relógio dela.
 */
export function dataLocalISO(d: Date): string {
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

/** `dias` dias antes de `d`, ainda em horário local. */
export function diasAntes(d: Date, dias: number): Date {
  const copia = new Date(d.getTime());
  copia.setDate(copia.getDate() - dias);
  return copia;
}
